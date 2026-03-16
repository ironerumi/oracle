import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserRunOptions, BrowserRunResult, BrowserLogger } from "../browser/types.js";
import type { BrowserSessionConfig } from "../sessionStore.js";
import { estimateTokenCount } from "../browser/utils.js";
import { BrowserAutomationError } from "../oracle/errors.js";
import { PERPLEXITY_URL, isCloudflareCookie } from "./constants.js";
import { validateAndFilterCookies } from "./cookieFilter.js";
import { resolvePerplexityTimeout } from "./config.js";
import {
  launchCamoufox,
  registerCamoufoxTerminationHooks,
  cdpCookiesToPlaywright,
} from "./camoufoxLifecycle.js";
import {
  navigateToPerplexity,
  ensureNotCloudflareBlocked,
  ensurePerplexityLoggedIn,
  ensureNotInternalError,
} from "./actions/navigation.js";
import { selectPerplexityModel } from "./actions/modelSelection.js";
import { navigateToSpace } from "./actions/spaceNavigation.js";
import { submitPerplexityPrompt } from "./actions/promptSubmit.js";
import { capturePerplexityResponse, formatWithCitations } from "./actions/responseCapture.js";
import { enableSocialSource } from "./actions/sourceFilter.js";
import { activateDeepResearch } from "./actions/deepResearch.js";

export interface PerplexityBrowserOptions {
  /** Perplexity Space slug or full URL. */
  space?: string | null;
  /** Path to inline cookies file — enables auto-refresh write-back after successful runs. */
  cookieFilePath?: string | null;
}

/**
 * Create a Perplexity browser executor using headless Camoufox + Playwright.
 * Returns a function that takes BrowserRunOptions and returns BrowserRunResult.
 *
 * Two-phase lifecycle: validate cookies -> launch Camoufox -> navigate bare
 * (establish CF clearance) -> inject auth cookies -> reload -> check errors ->
 * select model -> handle space -> submit prompt -> capture response.
 */
export function createPerplexityBrowserExecutor(
  browserConfig: BrowserSessionConfig,
  options: PerplexityBrowserOptions = {},
): (runOptions: BrowserRunOptions) => Promise<BrowserRunResult> {
  return async (runOptions: BrowserRunOptions): Promise<BrowserRunResult> => {
    const startTime = Date.now();
    const log: BrowserLogger = runOptions.log ?? ((_msg: string) => {});
    const space = options.space ?? null;
    const cookieFilePath = options.cookieFilePath ?? null;
    const promptText = runOptions.prompt?.trim();

    if (!promptText) {
      throw new BrowserAutomationError("Prompt text is required", { stage: "validation" });
    }

    if (runOptions.attachments?.length) {
      throw new BrowserAutomationError(
        "Attachments are not supported in Perplexity browser mode.",
        { stage: "validation" },
      );
    }

    log("[perplexity-browser] Starting Perplexity browser executor (Camoufox headless)");
    if (space) log(`[perplexity-browser] Space: ${space}`);

    const timeoutMs = resolvePerplexityTimeout(browserConfig.desiredModel, browserConfig.timeoutMs);
    const desiredModel = browserConfig.desiredModel ?? null;

    // Warn about Chrome-specific flags that are no-ops for Camoufox
    if (browserConfig.chromeProfile) {
      log(
        "[perplexity-browser] Warning: --browser-chrome-profile is ignored for Perplexity (uses Camoufox, not Chrome)",
      );
    }
    if (browserConfig.chromePath) {
      log(
        "[perplexity-browser] Warning: --browser-chrome-path is ignored for Perplexity (uses Camoufox, not Chrome)",
      );
    }
    if (browserConfig.debugPort) {
      log(
        "[perplexity-browser] Warning: --browser-debug-port is ignored for Perplexity (uses Camoufox, not Chrome)",
      );
    }

    // --- PRE-VALIDATE COOKIES (before browser launch) ---
    let authCookies: Array<Record<string, unknown>> = [];
    if (browserConfig.inlineCookies?.length) {
      const raw = browserConfig.inlineCookies as unknown as Array<Record<string, unknown>>;
      const { authCookies: filtered, droppedCount } = validateAndFilterCookies(raw);
      authCookies = filtered;
      if (droppedCount > 0)
        log(`[perplexity-browser] Dropped ${droppedCount} Cloudflare/expired cookies`);
    }

    // Launch Camoufox headless browser
    const { browser, context, page } = await launchCamoufox({ headless: true, log });
    const removeHooks = registerCamoufoxTerminationHooks(browser, log);

    try {
      // Watch for premature browser close
      const disconnectPromise = new Promise<never>((_, reject) => {
        browser.once("disconnected", () => {
          reject(
            new BrowserAutomationError("Browser closed before Perplexity response was captured.", {
              stage: "browser-disconnect",
            }),
          );
        });
      });
      const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, disconnectPromise]);

      // Inject __name shim — esbuild/tsx decorates function declarations with __name() which
      // leaks into page.evaluate() calls and fails because __name doesn't exist in browser context.
      // addInitScript survives navigations.
      await context.addInitScript(() => {
        (window as any).__name = (fn: any) => fn;
      });

      // --- PHASE 1: Navigate bare (establish Camoufox's own CF clearance) ---
      // Use domcontentloaded, not networkidle — Perplexity's SPA has persistent
      // WebSocket/SSE connections that prevent networkidle from ever resolving.
      // Camoufox passes CF via C++ fingerprint spoofing, no challenge to wait for.
      await race(navigateToPerplexity(page, PERPLEXITY_URL, log));
      await race(ensureNotCloudflareBlocked(page, log));

      // --- PHASE 2: Inject auth cookies + reload ---
      let appliedCookies = 0;
      if (authCookies.length > 0) {
        const pwCookies = cdpCookiesToPlaywright(authCookies);
        await context.addCookies(pwCookies);
        appliedCookies = pwCookies.length;
        log(`[perplexity-browser] Injected ${appliedCookies} auth cookies, reloading`);
        await race(navigateToPerplexity(page, PERPLEXITY_URL, log));
      }

      if (appliedCookies === 0) {
        log(
          "[perplexity-browser] Warning: no cookies applied. Provide --browser-inline-cookies-file with Perplexity cookies.",
        );
      }

      // --- POST-NAVIGATION CHECKS ---
      await race(ensureNotInternalError(page, log));
      await race(ensurePerplexityLoggedIn(page, log, appliedCookies));

      // Navigate to Space if provided
      if (space) {
        await race(navigateToSpace(page, space, log));
      }

      // Select model in picker (skips for default 'ppl/sonar')
      await race(selectPerplexityModel(page, desiredModel, log));

      // Enable Social source filter (always on for richer results)
      await race(enableSocialSource(page, log));

      // Activate Deep Research mode for sonar-deep-research
      const normalizedModel = (desiredModel?.trim() || "ppl/sonar").toLowerCase();
      if (normalizedModel === "ppl/sonar-deep-research") {
        await race(activateDeepResearch(page, log));
      }

      // Submit prompt
      await race(submitPerplexityPrompt(page, promptText, log));

      // Capture response
      const { text, citations } = await race(capturePerplexityResponse(page, timeoutMs, log));

      // Write back refreshed cookies (filtered: no CF cookies, no expired, deduped)
      if (cookieFilePath) {
        try {
          const now = Math.floor(Date.now() / 1000);
          const freshCookies = await context.cookies();
          const seen = new Map<string, boolean>();
          const perplexityCookies = freshCookies
            .filter((c) => c.domain.includes("perplexity.ai"))
            .filter((c) => !isCloudflareCookie(c.name))
            .filter((c) => !(typeof c.expires === "number" && c.expires > 0 && c.expires < now))
            .filter((c) => {
              const key = `${c.domain}:${c.name}:${c.path}`;
              if (seen.has(key)) return false;
              seen.set(key, true);
              return true;
            })
            .map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path || "/",
              secure: c.secure ?? true,
              httpOnly: c.httpOnly ?? false,
              ...(c.sameSite && c.sameSite !== "None" ? { sameSite: c.sameSite } : {}),
              ...(typeof c.expires === "number" && c.expires > 0 ? { expires: c.expires } : {}),
            }));
          if (perplexityCookies.length > 0) {
            await mkdir(path.dirname(cookieFilePath), { recursive: true });
            await writeFile(cookieFilePath, JSON.stringify(perplexityCookies, null, 2));
            log(
              `[perplexity-browser] Refreshed ${perplexityCookies.length} cookies → ${cookieFilePath}`,
            );
          }
        } catch (e) {
          log(
            `[perplexity-browser] Cookie write-back failed (non-fatal): ${e instanceof Error ? e.message : e}`,
          );
        }
      }

      // Format with citations
      const answerMarkdown = formatWithCitations(text, citations);
      const tookMs = Date.now() - startTime;
      log(`[perplexity-browser] Completed in ${Math.round(tookMs / 1000)}s`);

      return {
        answerText: text,
        answerMarkdown,
        tookMs,
        answerTokens: estimateTokenCount(text),
        answerChars: text.length,
      };
    } finally {
      removeHooks();
      await browser.close().catch(() => undefined);
    }
  };
}
