# Fix Perplexity Cookie Poisoning + Error Detection

Date: 2026-03-13

## What We're Building

Fix the Perplexity browser engine failing with "Could not find the Perplexity prompt editor" — caused by poisoned/expired cookies triggering Perplexity's "Internal Error" page, NOT stale DOM selectors.

### Root Cause (verified via Camoufox diagnostic)

- **With cookies**: Perplexity returns "Internal Error" page (no DOM rendered)
- **Without cookies**: Page loads perfectly, all selectors still match
- Expired `CF_AppSession` and `pplx.session-id` cookies cause server-side error
- Main auth token `__Secure-next-auth.session-token` is still valid (28 days)

### Fix: Cookie filtering + error page detection + retry

1. **Filter expired cookies at injection time** — drop cookies where `expires < now` before `context.addCookies()`
2. **Detect error pages** — after navigation, check for "Internal Error" text. If found, clear cookies and retry.
3. **Clear error messages** — distinguish "cookies expired (re-export needed)" from "selectors changed" from "Cloudflare block"
4. **Add `#ask-input` selector** — new stable anchor discovered in current DOM, good defense-in-depth

### Also add (defense-in-depth for selectors)

- Add `#ask-input` to `PROMPT_SELECTORS`
- Add `button[aria-label="Model"]` already in `MODEL_PICKER_SELECTORS` (confirmed working)

## Why This Approach

- Root cause is cookies, not selectors — fixing selectors alone wouldn't help
- Filtering expired cookies is zero-risk (they'd be rejected by the server anyway)
- Error page detection + retry is self-healing — no manual cookie re-export needed for recoverable cases
- Clear error messages prevent wild goose chases (like "update PROMPT_SELECTORS")

## Key Decisions

1. **Filter expired cookies** at injection time in executor (not in `cdpCookiesToPlaywright`)
2. **Detect "Internal Error" page** after navigation, retry without cookies
3. **Separate error types**: error page vs login required vs Cloudflare vs selectors stale
4. **Add `#ask-input`** to PROMPT_SELECTORS for resilience

## Scope

### In scope
- Cookie expiry filtering in Perplexity executor (`index.ts`)
- "Internal Error" page detection + cookie-less retry in navigation flow
- Better error messages in `promptSubmit.ts` and `navigation.ts`
- Add `#ask-input` to `PROMPT_SELECTORS` in `constants.ts`

### Out of scope
- Scored element fallback (selectors are fine; defer to future)
- Cookie re-export automation
- Other engines (ChatGPT/Gemini)

## Open Questions

None — all resolved during brainstorm.
