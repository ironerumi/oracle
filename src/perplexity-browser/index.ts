import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BrowserRunOptions, BrowserRunResult, BrowserLogger, ChromeClient } from '../browser/types.js';
import type { BrowserSessionConfig } from '../sessionStore.js';
import {
  launchChrome,
  registerTerminationHooks,
  hideChromeWindow,
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

export interface PerplexityBrowserOptions {
  /** Perplexity Space slug or full URL. */
  space?: string | null;
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
      hideWindow: browserConfig.hideWindow ?? false,
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

      const { Network, Page, Runtime, Input } = client;

      // Enable CDP domains
      await Promise.all([Network.enable({}), Page.enable(), Runtime.enable()]);
      await Network.clearBrowserCookies();

      // Sync Perplexity cookies from Chrome profile
      let appliedCookies = 0;
      if (resolvedConfig.cookieSync) {
        const cookieCount = await syncCookies(Network, PERPLEXITY_URL, resolvedConfig.chromeProfile, log, {
          allowErrors: resolvedConfig.allowCookieErrors,
          filterNames: resolvedConfig.cookieNames ?? undefined,
          inlineCookies: resolvedConfig.inlineCookies ?? undefined,
          cookiePath: resolvedConfig.chromeCookiePath ?? undefined,
          waitMs: resolvedConfig.cookieSyncWaitMs,
          extraOrigins: PERPLEXITY_COOKIE_URLS,
        });
        appliedCookies = cookieCount;
        if (cookieCount === 0 && !resolvedConfig.inlineCookies) {
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

      // Submit prompt
      await race(submitPerplexityPrompt(Runtime, Input, promptText, log));

      // Capture response
      const { text, citations } = await race(capturePerplexityResponse(Runtime, timeoutMs, log));

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
