import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BrowserRunOptions, BrowserRunResult, BrowserLogger, ChromeClient } from '../browser/types.js';
import type { BrowserSessionConfig } from '../sessionStore.js';
import {
  launchChrome,
  registerTerminationHooks,
  connectWithNewTab,
  closeTab,
} from '../browser/chromeLifecycle.js';
import { syncCookies } from '../browser/cookies.js';
import { estimateTokenCount } from '../browser/utils.js';
import { BrowserAutomationError } from '../oracle/errors.js';
import { PERPLEXITY_URL, PERPLEXITY_COOKIE_URLS } from './constants.js';
import { resolvePerplexityTimeout } from './config.js';
import { navigateToPerplexity, ensureNotCloudflareBlocked, ensurePerplexityLoggedIn } from './actions/navigation.js';
import { selectPerplexityModel } from './actions/modelSelection.js';
import { navigateToSpace } from './actions/spaceNavigation.js';
import { submitPerplexityPrompt } from './actions/promptSubmit.js';
import { capturePerplexityResponse, formatWithCitations } from './actions/responseCapture.js';
import { enableSocialSource } from './actions/sourceFilter.js';
import { activateDeepResearch } from './actions/deepResearch.js';

export interface PerplexityBrowserOptions {
  /** Perplexity Space slug or full URL. */
  space?: string | null;
  /** Path to inline cookies file — enables auto-refresh write-back after successful runs. */
  cookieFilePath?: string | null;
}

/**
 * Create a Perplexity browser executor following the Gemini-web executor pattern.
 * Returns a function that takes BrowserRunOptions and returns BrowserRunResult.
 *
 * Lifecycle: launch Chrome -> sync cookies -> navigate -> detect auth ->
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
      throw new BrowserAutomationError('Prompt text is required', { stage: 'validation' });
    }

    if (runOptions.attachments?.length) {
      throw new BrowserAutomationError(
        'Attachments are not supported in Perplexity browser mode.',
        { stage: 'validation' },
      );
    }

    log('[perplexity-browser] Starting Perplexity browser executor');
    if (space) log(`[perplexity-browser] Space: ${space}`);

    const timeoutMs = resolvePerplexityTimeout(browserConfig.desiredModel, browserConfig.timeoutMs);
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'oracle-perplexity-'));
    log(`[perplexity-browser] Temporary Chrome profile: ${userDataDir}`);

    // Build a resolved config suitable for chromeLifecycle
    const resolvedConfig = {
      headless: browserConfig.headless ?? false,
      hideWindow: browserConfig.hideWindow ?? true,
      keepBrowser: false,
      url: PERPLEXITY_URL,
      chatgptUrl: null,
      timeoutMs,
      debugPort: browserConfig.debugPort ?? null,
      inputTimeoutMs: browserConfig.inputTimeoutMs ?? 30_000,
      assistantRecheckDelayMs: 0,
      assistantRecheckTimeoutMs: 0,
      reuseChromeWaitMs: 0,
      profileLockTimeoutMs: 0,
      autoReattachDelayMs: 0,
      autoReattachIntervalMs: 0,
      autoReattachTimeoutMs: 0,
      cookieSync: browserConfig.cookieSync ?? true,
      cookieNames: browserConfig.cookieNames ?? null,
      cookieSyncWaitMs: browserConfig.cookieSyncWaitMs ?? 0,
      inlineCookies: browserConfig.inlineCookies ?? null,
      inlineCookiesSource: browserConfig.inlineCookiesSource ?? null,
      chromePath: browserConfig.chromePath ?? null,
      chromeProfile: browserConfig.chromeProfile ?? null,
      chromeCookiePath: browserConfig.chromeCookiePath ?? null,
      desiredModel: browserConfig.desiredModel ?? null,
      debug: browserConfig.debug ?? false,
      allowCookieErrors: browserConfig.allowCookieErrors ?? false,
      remoteChrome: null,
      manualLogin: false,
      manualLoginProfileDir: null,
      manualLoginCookieSync: false,
    };

    const chrome = await launchChrome(resolvedConfig, userDataDir, log);
    const chromeHost = (chrome as unknown as { host?: string }).host ?? '127.0.0.1';
    const removeHooks = registerTerminationHooks(chrome, userDataDir, false, log);

    let client: ChromeClient | null = null;
    let isolatedTargetId: string | undefined;

    try {
      // Connect with isolated tab
      const connection = await connectWithNewTab(chrome.port, log, undefined, chromeHost);
      client = connection.client;
      isolatedTargetId = connection.targetId;

      // Watch for premature Chrome close
      const disconnectPromise = new Promise<never>((_, reject) => {
        client?.on('disconnect', () => {
          reject(new BrowserAutomationError(
            'Chrome window closed before Perplexity response was captured. Keep Chrome open until completion.',
            { stage: 'chrome-disconnect' },
          ));
        });
      });
      const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, disconnectPromise]);

      const { Network, Page, Runtime, Input, Browser, Emulation } = client;

      // Hide Chrome window: shrink to tiny physical window but emulate full viewport.
      // Cannot minimize (Chrome defers DOM rendering) or use headless (Cloudflare blocks).
      // Cannot use AppleScript (needs Accessibility permissions).
      // Solution: tiny physical window + virtual viewport via Emulation.
      if (resolvedConfig.hideWindow && !resolvedConfig.headless) {
        try {
          const { windowId } = await Browser.getWindowForTarget({ targetId: isolatedTargetId });
          await Browser.setWindowBounds({ windowId, bounds: { windowState: 'normal', left: 0, top: 0, width: 100, height: 100 } });
          await Emulation.setDeviceMetricsOverride({ width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
          log('[perplexity-browser] Chrome window hidden (100x100 physical, 1280x720 virtual)');
        } catch (e) {
          log(`[perplexity-browser] Could not hide window via CDP: ${e instanceof Error ? e.message : e}`);
        }
      }

      // Enable CDP domains
      await Promise.all([Network.enable({}), Page.enable(), Runtime.enable()]);
      await Network.clearBrowserCookies();

      // Apply Perplexity cookies.
      // Two paths:
      // 1. Inline cookies (--browser-inline-cookies-file): apply directly via CDP setCookie,
      //    preserving both url AND domain to ensure all subdomains receive auth cookies.
      //    --browser-no-cookie-sync does NOT suppress inline cookies.
      // 2. Chrome profile cookies (default): read via syncCookies + Keychain/profile path.
      let appliedCookies = 0;
      if (resolvedConfig.inlineCookies?.length) {
        let applied = 0;
        for (const cookie of resolvedConfig.inlineCookies) {
          if (!cookie?.name) continue;
          try {
            // Apply with url so CDP accepts it; keep domain so Perplexity subdomain requests
            // (e.g. /spaces/ page) receive the auth token.
            const cookieParam = {
              ...cookie,
              url: `https://${cookie.domain ?? 'www.perplexity.ai'}`,
            };
            const result = await Network.setCookie(cookieParam);
            if (result?.success) applied++;
          } catch {
            // ignore individual cookie failures
          }
        }
        appliedCookies = applied;
        log(`[perplexity-browser] Applied ${applied} inline Perplexity cookie(s)`);
      } else if (resolvedConfig.cookieSync) {
        const cookieCount = await syncCookies(Network, PERPLEXITY_URL, resolvedConfig.chromeProfile, log, {
          allowErrors: resolvedConfig.allowCookieErrors,
          filterNames: resolvedConfig.cookieNames ?? undefined,
          cookiePath: resolvedConfig.chromeCookiePath ?? undefined,
          waitMs: resolvedConfig.cookieSyncWaitMs,
          extraOrigins: PERPLEXITY_COOKIE_URLS,
        });
        appliedCookies = cookieCount;
        if (cookieCount === 0) {
          log('[perplexity-browser] Warning: no Perplexity cookies found. Login check will likely fail.');
        } else {
          log(`[perplexity-browser] Applied ${cookieCount} Perplexity cookie(s)`);
        }
      }

      // Navigate to Perplexity home
      await race(navigateToPerplexity(Page, Runtime, PERPLEXITY_URL, log));

      // Check for Cloudflare block
      await race(ensureNotCloudflareBlocked(Runtime, log));

      // Check login state
      await race(ensurePerplexityLoggedIn(Runtime, log, appliedCookies));

      // Navigate to Space if provided
      if (space) {
        await race(navigateToSpace(Page, Runtime, space, log));
      }

      // Select model in picker (skips for default 'sonar')
      await race(selectPerplexityModel(Runtime, resolvedConfig.desiredModel, log));

      // Enable Social source filter (always on for richer results)
      await race(enableSocialSource(Runtime, log));

      // Activate Deep Research mode for sonar-deep-research
      const normalizedModel = (resolvedConfig.desiredModel?.trim() || 'sonar').toLowerCase();
      if (normalizedModel === 'sonar-deep-research') {
        await race(activateDeepResearch(Runtime, log));
      }

      // Submit prompt
      await race(submitPerplexityPrompt(Runtime, Input, promptText, log));

      // Capture response
      const { text, citations } = await race(capturePerplexityResponse(Runtime, timeoutMs, log));

      // Write back refreshed cookies to the inline cookies file (auto-refresh)
      if (cookieFilePath) {
        try {
          const { cookies: freshCookies } = await Network.getAllCookies();
          const perplexityCookies = freshCookies
            .filter((c: { domain: string }) => c.domain.includes('perplexity.ai'))
            .map((c: { name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite?: string; expires?: number }) => ({
              name: c.name, value: c.value, domain: c.domain,
              path: c.path || '/', secure: c.secure ?? true, httpOnly: c.httpOnly ?? false,
              ...(c.sameSite && c.sameSite !== 'None' ? { sameSite: c.sameSite } : {}),
              ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
            }));
          if (perplexityCookies.length > 0) {
            await mkdir(path.dirname(cookieFilePath), { recursive: true });
            await writeFile(cookieFilePath, JSON.stringify(perplexityCookies, null, 2));
            log(`[perplexity-browser] Refreshed ${perplexityCookies.length} cookies → ${cookieFilePath}`);
          }
        } catch (e) {
          log(`[perplexity-browser] Cookie write-back failed (non-fatal): ${e instanceof Error ? e.message : e}`);
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
        chromePid: chrome.pid,
        chromePort: chrome.port,
        chromeHost,
        userDataDir,
        chromeTargetId: isolatedTargetId,
      };
    } finally {
      removeHooks();
      if (client) {
        if (isolatedTargetId) {
          await closeTab(chrome.port, isolatedTargetId, log, chromeHost).catch(() => undefined);
        }
        await client.close().catch(() => undefined);
      }
      try {
        await chrome.kill();
      } catch {
        // ignore kill failures
      }
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
