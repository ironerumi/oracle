import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import { CLOUDFLARE_TITLES, LOGIN_BUTTON_TEXTS, PERPLEXITY_URL } from '../constants.js';

type Runtime = ChromeClient['Runtime'];
type Page = ChromeClient['Page'];

/**
 * Navigate to the Perplexity home page and wait for the document to be ready.
 */
export async function navigateToPerplexity(
  page: Page,
  runtime: Runtime,
  url: string = PERPLEXITY_URL,
  log?: BrowserLogger,
): Promise<void> {
  log?.(`[perplexity-browser] Navigating to ${url}`);
  await page.navigate({ url });
  await waitForDocumentReady(runtime, 45_000);
}

/**
 * Wait for document.readyState to be 'complete' or 'interactive'.
 */
export async function waitForDocumentReady(runtime: Runtime, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: 'document.readyState',
      returnByValue: true,
    });
    const state = result.result?.value;
    if (state === 'complete' || state === 'interactive') {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new BrowserAutomationError('Timed out waiting for page to load', {
    stage: 'navigation',
  });
}

/**
 * Check if the current page is a Cloudflare challenge page.
 * Throws if blocked.
 */
export async function ensureNotCloudflareBlocked(runtime: Runtime, log?: BrowserLogger): Promise<void> {
  const result = await runtime.evaluate({
    expression: 'document.title.toLowerCase()',
    returnByValue: true,
  });
  const title = (result.result?.value ?? '') as string;
  for (const challengeTitle of CLOUDFLARE_TITLES) {
    if (title.includes(challengeTitle)) {
      throw new BrowserAutomationError(
        'Perplexity is showing a Cloudflare challenge page. ' +
          'Try using a headed Chrome session with --browser-chrome-profile to bypass bot detection.',
        { stage: 'cloudflare-block' },
      );
    }
  }
  log?.('[perplexity-browser] No Cloudflare block detected');
}

/**
 * Detect whether the user is logged in to Perplexity.
 * When NOT logged in, login/signup buttons are present.
 */
export async function ensurePerplexityLoggedIn(
  runtime: Runtime,
  log?: BrowserLogger,
  appliedCookies?: number,
): Promise<void> {
  const buttonTexts = JSON.stringify(LOGIN_BUTTON_TEXTS);
  const result = await runtime.evaluate({
    expression: `(() => {
      const texts = ${buttonTexts};
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim() ?? '';
        if (texts.some(t => text.includes(t))) {
          return { loggedIn: false, matchedText: text };
        }
      }
      return { loggedIn: true };
    })()`,
    returnByValue: true,
    awaitPromise: false,
  });

  const value = result.result?.value as { loggedIn: boolean; matchedText?: string } | undefined;
  if (value && !value.loggedIn) {
    const cookieHint =
      appliedCookies === 0
        ? ' No cookies were applied — ensure --browser-chrome-profile points to a Chrome profile where you are logged in to Perplexity.'
        : ` ${appliedCookies} cookie(s) were applied but auth may have expired. Re-login to Perplexity in your Chrome profile and try again.`;
    throw new BrowserAutomationError(
      `Not logged in to Perplexity (detected "${value.matchedText}" button).${cookieHint}`,
      { stage: 'login-check' },
    );
  }
  log?.('[perplexity-browser] Logged in to Perplexity');
}
