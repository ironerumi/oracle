import { BrowserAutomationError } from "../oracle/errors.js";
import { isCloudflareCookie } from "./constants.js";

const AUTH_COOKIE_NAME = "__Secure-next-auth.session-token";

export interface CookieValidationResult {
  authCookies: Array<Record<string, unknown>>;
  droppedCount: number;
}

/**
 * Validate and filter Perplexity cookies before browser launch.
 *
 * 1. Fail fast if auth token is missing or expired.
 * 2. Strip Cloudflare cookies (fingerprint-bound to Chrome, poison Camoufox).
 * 3. Strip expired cookies (preserve session cookies with expires <= 0).
 */
export function validateAndFilterCookies(
  rawCookies: Array<Record<string, unknown>>,
): CookieValidationResult {
  const now = Math.floor(Date.now() / 1000);

  // Strip Cloudflare cookies + expired cookies first (preserve session cookies: expires <= 0)
  const filtered = rawCookies.filter((c) => {
    const name = typeof c.name === "string" ? c.name : "";
    if (isCloudflareCookie(name)) return false;
    const cExp = typeof c.expires === "number" ? c.expires : 0;
    if (cExp > 0 && cExp < now) return false;
    return true;
  });

  // Check a valid (non-expired) auth token survived filtering
  const hasAuth = filtered.some((c) => c.name === AUTH_COOKIE_NAME);
  if (!rawCookies.some((c) => c.name === AUTH_COOKIE_NAME)) {
    throw new BrowserAutomationError(
      `Cookie file missing ${AUTH_COOKIE_NAME}. Re-export from correct Chrome profile:\n` +
        '  npx tsx scripts/export-perplexity-cookies.ts "Profile 2"',
      { stage: "cookie-validation" },
    );
  }
  if (!hasAuth) {
    throw new BrowserAutomationError(
      "Perplexity auth cookie expired. Re-export:\n" +
        '  npx tsx scripts/export-perplexity-cookies.ts "Profile 2"',
      { stage: "cookie-validation" },
    );
  }

  return { authCookies: filtered, droppedCount: rawCookies.length - filtered.length };
}
