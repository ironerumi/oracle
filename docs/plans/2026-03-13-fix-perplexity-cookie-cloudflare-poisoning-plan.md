---
title: "fix: Perplexity cookie cf_clearance poisoning causes Internal Error"
type: fix
status: completed
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-robust-editor-detection-brainstorm.md
linear_issue: NAI-203
---

# fix: Perplexity cookie cf_clearance poisoning causes Internal Error

## Overview

Perplexity browser engine fails with "Could not find the Perplexity prompt editor" because Chrome-exported cookies include Cloudflare's `cf_clearance`, which is bound to Chrome's TLS/JA3 fingerprint. Injecting it into Camoufox (Firefox fork) triggers Cloudflare rejection, and Perplexity renders an "Internal Error" page with zero DOM content.

## Problem Statement

**Symptoms:** `oracle --engine browser -m ppl/sonar` fails with `ERROR: Could not find the Perplexity prompt editor.`

**Root cause (verified via Camoufox diagnostic 2026-03-13):**

| Scenario | Result |
|----------|--------|
| No cookies | Page loads fine (logged out) |
| All cookies from file | "Internal Error" |
| Expired cookies stripped | "Internal Error" |
| Auth token only | "Internal Error" |
| Fresh cookies from Chrome | "Internal Error" |
| Navigate first, THEN inject auth cookies + reload | **Works** (logged in, full DOM) |

The `cf_clearance` cookie from Chrome is fingerprint-bound. Camoufox has its own Firefox TLS fingerprint (spoofed at C++ level via BrowserForge). When Cloudflare sees a Chrome-clearance cookie from a Firefox fingerprint, it rejects the request. Perplexity surfaces this as "Internal Error."

**Secondary issue:** Cookie write-back (`index.ts:144-161`) saves ALL cookies including expired and Cloudflare cookies, polluting the file over time.

## Proposed Solution

Switch from single-phase (inject-then-navigate) to **two-phase navigation** (navigate-then-inject-then-reload), with pre-validation and error detection.

### Phase 1: Pre-validate cookies (before browser launch)

In the executor (`index.ts`), before calling `launchCamoufox()`:

1. If no cookies provided → skip validation entirely (anonymous sonar path is valid)
2. If cookies provided:
   a. Check `__Secure-next-auth.session-token` exists → if missing, fail: "cookie file missing auth token"
   b. Check its `expires` field — if `> 0 && < now`, fail: "auth cookie expired, re-export"
   c. Strip Cloudflare cookies by prefix: names starting with `cf_`, `__cf`, `CF_`, or `_cf` (future-proof)
   d. Strip expired cookies (any cookie with `expires > 0 && expires < now`; preserve session cookies with `expires <= 0`)

### Phase 2: Two-phase navigation (in executor)

Replace the current inject-then-navigate flow:

```
BEFORE:  addCookies(all) → goto(url) → check errors
AFTER:   goto(url) → CF check → addCookies(authOnly) → goto(url) → check errors
```

1. Navigate to `perplexity.ai` with `waitUntil: 'networkidle'` — Camoufox establishes its own `cf_clearance`
2. Check for Cloudflare block (after Phase 1, not Phase 2 — if bare Camoufox is blocked, nothing to do)
3. Inject only auth cookies (filtered in Phase 1)
4. Navigate again with `waitUntil: 'domcontentloaded'` — now authenticated with matching Cloudflare fingerprint

### Phase 3: Detect "Internal Error" page

Add `ensureNotInternalError(page, log)` in `navigation.ts`, called after the second navigation:

1. **Primary:** Check `document.body.innerText` for "Internal Error"
2. **Structural complement:** Also check that expected DOM landmarks are ABSENT (no `[data-lexical-editor]`, no sidebar/nav) — confirms error page rather than false positive on a page that happens to contain the phrase
3. If both match → fail fast with stage `'internal-error'` and re-export instruction

### Phase 4: Clean cookie write-back

In the write-back block (`index.ts:142-161`), add filters:

1. Strip Cloudflare cookies (same prefix matcher as Phase 1)
2. Strip expired cookies (`expires > 0 && expires < now`; preserve session cookies with `expires <= 0`)
3. Deduplicate by `domain:name:path` (prevents accumulation; path-aware to avoid collapsing distinct cookies)

## Technical Considerations

- **No-cookie path (logged out):** Pre-validation skips entirely when no cookies provided. `ensurePerplexityLoggedIn()` already handles `appliedCookies === 0` as a warning (not throw). Anonymous sonar works.
- **Cookies provided but auth missing:** Fail fast with "exported cookies missing `__Secure-next-auth.session-token` — re-export from correct Chrome profile". Better than silently proceeding to login-check failure.
- **Phase 1 `waitUntil: 'networkidle'`:** Ensures CF challenge completes before injecting auth cookies. Phase 2 can use `domcontentloaded` (faster, CF already cleared).
- **CF block check placement:** Run after Phase 1 only. If bare Camoufox passes CF, Phase 2 reload won't trigger a new challenge (same fingerprint, existing clearance).
- **CF cookie prefix matching:** `isCloudfareCookie(name)` checks prefixes `cf_`, `__cf`, `_cf`, `CF_` — covers known (`cf_clearance`, `__cf_bm`, `__cflb`, `CF_AppSession`, `_cfuvid`) and future CF cookies.
- **Cookie format:** `cdpCookiesToPlaywright()` remains unchanged. Filtering happens upstream in executor on raw CDP-format cookies.
- **Import paths:** `cookieFilter.ts` lives at `src/perplexity-browser/cookieFilter.ts` → imports from `../oracle/errors.js` and `./constants.js`.

## Acceptance Criteria

- [x]`oracle --engine browser -m ppl/sonar --browser-inline-cookies-file ~/.oracle/perplexity-cookies.json` works with existing cookie file containing `cf_clearance`
- [x]Expired auth token → fails before launching browser with actionable re-export message
- [x]Cookie file with no auth token → fails before launching browser with "missing auth token" message
- [x]Server-revoked session → "Internal Error" detected after Phase 2, fails with re-export instruction
- [x]No cookie file → works (logged-out page, sonar default); `ensurePerplexityLoggedIn` does not throw
- [x]Cookie write-back excludes Cloudflare and expired cookies, preserves session cookies (expires <= 0)
- [x]Write-back deduplicates by `domain:name:path`
- [x]`#ask-input` added to `PROMPT_SELECTORS` as defense-in-depth
- [x]Existing tests pass; new unit tests for `validateAndFilterCookies`, `isCloudfareCookie`, `ensureNotInternalError`

## MVP

### `src/perplexity-browser/constants.ts` — add CF cookie matcher + ask-input selector

```typescript
// Cloudflare cookie prefix matcher (future-proof)
const CF_COOKIE_PREFIXES = ['cf_', '__cf', '_cf', 'CF_'];
export function isCloudflareCookie(name: string): boolean {
  return CF_COOKIE_PREFIXES.some(p => name.startsWith(p));
}

// Internal error page signals
export const INTERNAL_ERROR_TEXTS = ['Internal Error'];

// Add #ask-input to PROMPT_SELECTORS:
export const PROMPT_SELECTORS = [
  '#ask-input',  // stable ID anchor
  'div[data-lexical-editor][contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
];
```

### `src/perplexity-browser/cookieFilter.ts` — new file, cookie pre-validation + filtering

```typescript
import { BrowserAutomationError } from '../oracle/errors.js';
import { isCloudflareCookie } from './constants.js';

const AUTH_COOKIE_NAME = '__Secure-next-auth.session-token';

export interface CookieValidationResult {
  authCookies: Array<Record<string, unknown>>;
  droppedCount: number;
}

export function validateAndFilterCookies(
  rawCookies: Array<Record<string, unknown>>,
): CookieValidationResult {
  const now = Math.floor(Date.now() / 1000);

  // Check auth token exists
  const authToken = rawCookies.find(c => c.name === AUTH_COOKIE_NAME);
  if (!authToken) {
    throw new BrowserAutomationError(
      `Cookie file missing ${AUTH_COOKIE_NAME}. Re-export from correct Chrome profile:\n` +
      '  npx tsx scripts/export-perplexity-cookies.ts "Profile 2"',
      { stage: 'cookie-validation' },
    );
  }

  // Check auth token not expired
  const exp = typeof authToken.expires === 'number' ? authToken.expires : 0;
  if (exp > 0 && exp < now) {
    throw new BrowserAutomationError(
      'Perplexity auth cookie expired. Re-export:\n' +
      '  npx tsx scripts/export-perplexity-cookies.ts "Profile 2"',
      { stage: 'cookie-validation' },
    );
  }

  // Strip Cloudflare cookies + expired cookies (preserve session cookies: expires <= 0)
  const filtered = rawCookies.filter(c => {
    const name = typeof c.name === 'string' ? c.name : '';
    if (isCloudflareCookie(name)) return false;
    const cExp = typeof c.expires === 'number' ? c.expires : 0;
    if (cExp > 0 && cExp < now) return false;
    return true;
  });

  return { authCookies: filtered, droppedCount: rawCookies.length - filtered.length };
}
```

### `src/perplexity-browser/actions/navigation.ts` — add Internal Error detection

```typescript
import { INTERNAL_ERROR_TEXTS, PROMPT_SELECTORS } from '../constants.js';

export async function ensureNotInternalError(page: Page, log?: BrowserLogger): Promise<void> {
  const result = await page.evaluate((args: { errorTexts: string[]; editorSels: string[] }) => {
    const bodyText = document.body?.innerText ?? '';
    const hasErrorText = args.errorTexts.some(t => bodyText.includes(t));
    const hasEditor = args.editorSels.some(sel => !!document.querySelector(sel));
    return { hasErrorText, hasEditor };
  }, { errorTexts: INTERNAL_ERROR_TEXTS, editorSels: PROMPT_SELECTORS });

  // Error text present AND no expected DOM landmarks = error page
  if (result.hasErrorText && !result.hasEditor) {
    log?.('[perplexity-browser] Detected "Internal Error" page');
    throw new BrowserAutomationError(
      'Perplexity returned "Internal Error" — session likely revoked server-side.\n' +
      'Re-export cookies: npx tsx scripts/export-perplexity-cookies.ts "Profile 2"',
      { stage: 'internal-error' },
    );
  }
}
```

### `src/perplexity-browser/index.ts` — two-phase navigation + filtered write-back

```typescript
// In createPerplexityBrowserExecutor, replace the cookie injection + navigation block:

// --- PRE-VALIDATE COOKIES ---
let authCookies: Array<Record<string, unknown>> = [];
if (browserConfig.inlineCookies?.length) {
  const { authCookies: filtered, droppedCount } = validateAndFilterCookies(browserConfig.inlineCookies);
  authCookies = filtered;
  if (droppedCount > 0) log(`[perplexity-browser] Dropped ${droppedCount} Cloudflare/expired cookies`);
}

// ... launch Camoufox ...

// --- PHASE 1: Navigate without cookies (establish Cloudflare clearance) ---
await race(navigateToPerplexity(page, url, log));  // use waitUntil: 'networkidle'
await race(ensureNotCloudflareBlocked(page, log));  // CF check AFTER Phase 1

// --- PHASE 2: Inject auth cookies + reload ---
if (authCookies.length > 0) {
  const pwCookies = cdpCookiesToPlaywright(authCookies);
  await context.addCookies(pwCookies);
  log(`[perplexity-browser] Injected ${pwCookies.length} auth cookies, reloading`);
  await race(navigateToPerplexity(page, url, log));  // use waitUntil: 'domcontentloaded'
}

// --- POST-NAVIGATION CHECKS ---
await race(ensureNotInternalError(page, log));       // NEW — catches revoked sessions
await race(ensurePerplexityLoggedIn(page, log, authCookies.length));

// --- WRITE-BACK (filtered) ---
const now = Math.floor(Date.now() / 1000);
const seen = new Map<string, boolean>();
const perplexityCookies = freshCookies
  .filter((c) => c.domain.includes('perplexity.ai'))
  .filter((c) => !isCloudflareCookie(c.name))
  .filter((c) => !(typeof c.expires === 'number' && c.expires > 0 && c.expires < now))
  .filter((c) => {  // deduplicate by domain:name:path
    const key = `${c.domain}:${c.name}:${c.path}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  })
  // ... existing .map(...)
```

## Dependencies & Risks

- **Risk:** Two navigations increase wall-clock time by ~3-5 seconds. Acceptable for a flow that "can take up to an hour."
- **Risk:** "Internal Error" text may differ in non-EN locales. Mitigated by structural complement (checking absence of DOM landmarks).
- **Risk:** Perplexity could tighten Cloudflare to block bare Camoufox on Phase 1 navigate. This would be a Camoufox/Cloudflare arms race issue, not fixable by cookie handling.
- **Mitigation:** CF cookie prefix matching is future-proof against new Cloudflare cookie names.
- **No breaking changes:** Cookie file format unchanged. Existing files work (CF cookies stripped at load).

## CLAUDE.md Update

Add to "Cookie sync" section:
- Two-phase navigation: Camoufox navigates bare first (gets own `cf_clearance`), then auth cookies injected, then reload. Chrome-exported CF cookies are always stripped — they're fingerprint-bound to Chrome.

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-13-robust-editor-detection-brainstorm.md](docs/brainstorms/2026-03-13-robust-editor-detection-brainstorm.md) — initial diagnosis (refined during investigation)
- **Camoufox plan:** [docs/plans/2026-03-09-feat-camoufox-headless-perplexity-plan.md](docs/plans/2026-03-09-feat-camoufox-headless-perplexity-plan.md) — cookie round-trip architecture, Cloudflare bypass via C++ fingerprint
- **Warp review:** Addressed P0 (no-cookie path guard), P1 (missing token case, import paths), P2 (dedup by path, locale fallback)
- **SpecFlow analysis:** Addressed gaps on CF check timing, waitUntil strategy, session cookie preservation, prefix-based CF stripping
- **Key files:**
  - `src/perplexity-browser/index.ts:72-161` — executor flow, cookie injection, write-back
  - `src/perplexity-browser/actions/navigation.ts:9-67` — navigate, Cloudflare check, login check
  - `src/perplexity-browser/camoufoxLifecycle.ts:33-84` — `cdpCookiesToPlaywright()`
  - `src/perplexity-browser/constants.ts` — all selector/label constants
