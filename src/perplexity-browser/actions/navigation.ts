import type { Page } from "playwright-core";
import type { BrowserLogger } from "../../browser/types.js";
import { BrowserAutomationError } from "../../oracle/errors.js";
import {
  CLOUDFLARE_TITLES,
  INTERNAL_ERROR_TEXTS,
  LOGIN_BUTTON_TEXTS,
  PROMPT_SELECTORS,
  PERPLEXITY_URL,
} from "../constants.js";

/**
 * Navigate to the Perplexity home page and wait for the document to be ready.
 */
export async function navigateToPerplexity(
  page: Page,
  url: string = PERPLEXITY_URL,
  log?: BrowserLogger,
): Promise<void> {
  log?.(`[perplexity-browser] Navigating to ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
}

/**
 * Check if the current page is a Cloudflare challenge page.
 * Throws if blocked.
 */
export async function ensureNotCloudflareBlocked(page: Page, log?: BrowserLogger): Promise<void> {
  const title = await page.evaluate(() => document.title.toLowerCase());
  for (const challengeTitle of CLOUDFLARE_TITLES) {
    if (title.includes(challengeTitle)) {
      throw new BrowserAutomationError(
        "Perplexity is showing a Cloudflare challenge page. " +
          "Your cookies may have expired. Re-export cookies from your browser and update ~/.oracle/perplexity-cookies.json.",
        { stage: "cloudflare-block" },
      );
    }
  }
  log?.("[perplexity-browser] No Cloudflare block detected");
}

/**
 * Detect whether the user is logged in to Perplexity.
 * When NOT logged in, login/signup buttons are present.
 */
export async function ensurePerplexityLoggedIn(
  page: Page,
  log?: BrowserLogger,
  appliedCookies?: number,
): Promise<void> {
  const value = await page.evaluate((buttonTexts: string[]) => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent?.trim() ?? "";
      if (buttonTexts.some((t) => text.includes(t))) {
        return { loggedIn: false, matchedText: text };
      }
    }
    return { loggedIn: true };
  }, LOGIN_BUTTON_TEXTS);

  if (value && !value.loggedIn) {
    const cookieHint =
      appliedCookies === 0
        ? " No cookies were applied — provide --browser-inline-cookies-file pointing to your exported Perplexity cookies."
        : ` ${appliedCookies} cookie(s) were applied but auth may have expired. Re-export cookies from your browser and update ~/.oracle/perplexity-cookies.json.`;
    throw new BrowserAutomationError(
      `Not logged in to Perplexity (detected "${value.matchedText}" button).${cookieHint}`,
      { stage: "login-check" },
    );
  }
  log?.("[perplexity-browser] Logged in to Perplexity");
}

/**
 * Detect Perplexity "Internal Error" page (caused by poisoned CF cookies or
 * server-revoked sessions). Checks both error text AND absence of expected
 * DOM landmarks to avoid false positives.
 */
export async function ensureNotInternalError(page: Page, log?: BrowserLogger): Promise<void> {
  const result = await page.evaluate(
    (args: { errorTexts: string[]; editorSels: string[] }) => {
      const bodyText = document.body?.innerText ?? "";
      const hasErrorText = args.errorTexts.some((t) => bodyText.includes(t));
      const hasEditor = args.editorSels.some((sel) => !!document.querySelector(sel));
      return { hasErrorText, hasEditor };
    },
    { errorTexts: INTERNAL_ERROR_TEXTS, editorSels: PROMPT_SELECTORS },
  );

  if (result.hasErrorText && !result.hasEditor) {
    log?.('[perplexity-browser] Detected "Internal Error" page');
    throw new BrowserAutomationError(
      'Perplexity returned "Internal Error" — session likely revoked server-side.\n' +
        'Re-export cookies: npx tsx scripts/export-perplexity-cookies.ts "Profile 2"',
      { stage: "internal-error" },
    );
  }
}
