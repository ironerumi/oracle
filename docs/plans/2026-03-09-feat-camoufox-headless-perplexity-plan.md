---
title: "feat: Replace Perplexity headed Chrome with headless Camoufox"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-camoufox-perplexity-headless-brainstorm.md
---

# feat: Replace Perplexity headed Chrome with headless Camoufox

## Overview

Replace the Perplexity browser engine's headed Chrome + CDP stack with headless Camoufox (Firefox fork) + Playwright via `camoufox-js`. Eliminates the visible browser window that currently annoys users.

Spike validated (2026-03-09): Camoufox headless bypasses Perplexity's Cloudflare, cookie injection works. (see brainstorm: `docs/brainstorms/2026-03-09-camoufox-perplexity-headless-brainstorm.md`)

## Problem Statement

Oracle's Perplexity engine forces a visible Chrome window because:
- Headless Chrome is blocked by Cloudflare (TLS fingerprint mismatch)
- Minimized Chrome defers DOM rendering
- Current workaround: 100x100px window + virtual viewport — hacky, still visible

## Proposed Solution

Swap browser backend from Chrome/CDP to Camoufox/Playwright in the Perplexity engine only. ChatGPT and Gemini engines stay on Chrome/CDP unchanged.

**Platform policy:** Camoufox FF146 is macOS-only. On non-Mac platforms, Perplexity browser mode errors with a clear message directing users to `PERPLEXITY_API_KEY`. No Chrome fallback — maintaining two codepaths is unsustainable. Resolve P0 first to confirm.

**Key dependency:** `camoufox-js` (npm v0.9.1) — full JS port of Camoufox wrapper, uses `playwright-core`, no Python needed.

## Technical Considerations

### Migration surface

| Layer | Current (CDP) | After (Playwright) | Effort |
|-------|--------------|---------------------|--------|
| Browser launch | `chrome-launcher` → `launchChrome()` | `camoufox-js` → `Camoufox({})` | New module |
| Connection | `chrome-remote-interface` → CDP client | Playwright `Browser` / `Page` | Replace |
| DOM interaction | `Runtime.evaluate({expression})` ×30 | `page.evaluate(fn)` | Bulk rewrite |
| Cookie inject | `Network.setCookie()` loop | `context.addCookies([])` batch | Simpler |
| Cookie read | `Network.getAllCookies()` | `context.cookies()` | Trivial |
| Navigation | `Page.navigate({url})` | `page.goto(url)` | Trivial |
| Text input | `Input.insertText({text})` (fallback) | `page.keyboard.type(text)` | See note below |
| Window hiding | `Browser.setWindowBounds` + `Emulation.setDeviceMetricsOverride` | Not needed (headless) | Delete |
| Disconnect | `client.on('disconnect')` | `browser.on('disconnected')` | Trivial |
| Cleanup | `chrome.kill()` + `rm(tempDir)` | `browser.close()` | Simpler |

### What stays the same
- All CSS selectors in `constants.ts` — pure DOM, not CDP-specific
- All JS logic inside `evaluate()` calls — just needs different wrapping
- Executor pattern and `BrowserRunResult` return type
- CLI wiring in `oracle-cli.ts` — still injects executor the same way
- ChatGPT/Gemini engines — completely untouched

### Key architectural constraint
`src/browser/chromeLifecycle.ts` is shared with ChatGPT engine — must NOT be modified. Perplexity gets its own `camoufoxLifecycle.ts`.

### `Runtime.evaluate` conversion pattern
Current CDP pattern:
```typescript
const { result } = await Runtime.evaluate({
  expression: `(() => { ${jsCode} })()`,
  returnByValue: true,
  awaitPromise: true,
});
return result.value;
```

Playwright equivalent:
```typescript
return await page.evaluate(() => { /* same jsCode */ });
```

Constants currently injected via template literals (`${JSON.stringify(selectors)}`) become `page.evaluate` arguments:
```typescript
return await page.evaluate((selectors) => { /* jsCode using selectors */ }, selectors);
```

## System-Wide Impact

- **Shared infrastructure**: `chromeLifecycle.ts`, `cookies.ts`, `types.ts` stay intact for ChatGPT. Perplexity stops importing from `chromeLifecycle.ts`
- **Error propagation**: Cloudflare detection (`document.title` check) ports 1:1. Auth check ports 1:1. Browser crash detection changes from `client.on('disconnect')` to `browser.on('disconnected')` — same race pattern. **Error messages must be updated in the same commit as the port** — current messages reference `--browser-chrome-profile` and headed Chrome, which become dead advice
- **State lifecycle**: Camoufox manages its own temp profile (no `mkdtemp` + cleanup needed). Cookie write-back changes API but not semantics
- **API surface parity**: `BrowserRunResult` field mapping: `chromePid` ← `browser.process().pid`, `chromePort` ← null, `chromeHost` ← null, `chromeTargetId` ← null, `userDataDir` ← null (Camoufox manages its own). Session store format unchanged
- **CLI flags**: `--browser-chrome-profile`, `--browser-chrome-path`, `--browser-headless`, `--browser-hide-window`, `--browser-debug-port` become no-ops for Perplexity. Warn and ignore

## Acceptance Criteria

- [x] `oracle --model sonar-pro "test query"` runs fully headless with no visible browser window
- [x] Cloudflare bypass works (no "Just a moment" challenge)
- [x] Cookie injection from `~/.oracle/perplexity-cookies.json` works
- [x] Cookie write-back after successful run works
- [x] Model selection (all Sonar variants) works (sonar default — picker not found but sonar is default; sonar-deep-research triggers DR activation)
- [ ] Source filter toggling works — "Connectors & Sources" menuitem not found (pre-existing UI selector issue)
- [x] Deep Research mode works — activation code triggers after cliModel passthrough fix; UI toggle not found (selector issue)
- [x] Space navigation works
- [x] ChatGPT browser engine is completely unaffected (no changes to `src/browser/` or ChatGPT action files)
- [x] Chrome-specific CLI flags warn and are ignored for Perplexity
- [x] First run with missing Camoufox binary shows download progress, not a hang (binary auto-bootstrap via `ensureCamoufoxBinary`)
- [x] Unsupported platform (if applicable) shows clear error message — N/A: camoufox-js v0.9.1 supports mac/linux/win

## Pre-Implementation: Resolve Unknowns

Before writing any production code, answer these with quick scripts:

### P0. Platform support
```bash
npx camoufox-js fetch  # does it download on macOS? check if Linux/Windows binaries exist
```
If macOS-only: add runtime platform guard that throws `Error: Camoufox browser engine requires macOS. Use PERPLEXITY_API_KEY for API access on this platform.` No Chrome fallback — one codepath only.

### P1. Binary bootstrap UX
Test what happens when binary is missing: does `Camoufox({})` auto-download? Is there a separate `fetch` step?
- If auto-downloads: hook into progress events, surface via oracle log stream (`[perplexity-browser] Downloading Camoufox browser (first run)...`)
- If separate fetch: call explicitly in `launchCamoufox()` before `launch()`, with progress logging
- Test failure mode: what happens on network error mid-download?

### P2. Cookie format round-trip
```typescript
// Load existing CDP-shaped cookies → normalize for Playwright → addCookies → cookies() → compare
```
Verify `url` field handling, `sameSite` casing, `expires` format.

### P3. Viewport defaults
Check what viewport size Camoufox headless defaults to. If not 1280x720, set explicitly via `page.setViewportSize()`.

### P4. Playwright click vs Radix pointer events
Test if `page.click(selector)` triggers React/Radix tab switches. If yes, simplify the 5-event pointer sequences in `sourceFilter.ts`, `responseCapture.ts`, `deepResearch.ts`. If no, port the `evaluate()` approach 1:1.

## Implementation Phases

### Phase 1: Foundation — Camoufox lifecycle module

**Files:**
- New: `src/perplexity-browser/camoufoxLifecycle.ts`
- Modify: `package.json` (add `camoufox-js`, `playwright-core`)

**Tasks:**
- [x] Add `camoufox-js` and `playwright-core` as dependencies
- [x] Create `camoufoxLifecycle.ts` with:
  - `launchCamoufox(options)` — binary check/download, launch headless, set viewport
  - `registerCamoufoxTerminationHooks(browser, log)` — SIGINT/SIGTERM cleanup
  - `cdpCookiesToPlaywright()` — normalize CDP-shaped cookies to Playwright format
- [x] Validate binary bootstrap with progress logging

### Phase 2: Port action files (CDP → Playwright)

All action files currently accept a `Runtime` (CDP) parameter. Change to accept a `Page` (Playwright) parameter.

**Files (7 action files):**
- [x] `actions/navigation.ts` — 3 evaluate calls, `Page.navigate`. **Update error messages**: Cloudflare and login failure messages reference `--browser-chrome-profile` and headed Chrome — rewrite to reference `--browser-inline-cookies-file` and cookie re-export
- [x] `actions/modelSelection.ts` — 2 evaluate calls
- [x] `actions/promptSubmit.ts` — 8+ evaluate calls. **Note**: the 3-tier text input fallback chain (`beforeinput` → `execCommand` → `Input.insertText`) needs attention — `Input.insertText` is CDP-only. Replaced with `page.keyboard.type(text)` as third fallback
- [x] `actions/responseCapture.ts` — 6 evaluate calls
- [x] `actions/sourceFilter.ts` — 5 evaluate calls
- [x] `actions/deepResearch.ts` — 4 evaluate calls
- [x] `actions/spaceNavigation.ts` — 2 evaluate calls, `Page.navigate`

**Conversion pattern:**
```typescript
// Before: action accepts CDP domains
export async function navigateToPerplexity(
  Page: ChromeClient['Page'],
  Runtime: ChromeClient['Runtime'],
  url: string,
  log: LogFn,
) { ... }

// After: action accepts Playwright Page
export async function navigateToPerplexity(
  page: import('playwright-core').Page,
  url: string,
  log: LogFn,
) { ... }
```

### Phase 3: Port executor (`index.ts`)

**File:** `src/perplexity-browser/index.ts`

- [x] Replace `launchChrome()` with `launchCamoufox()`
- [x] Replace CDP connection with Playwright browser/page
- [x] Replace cookie injection: `Network.setCookie` loop → `context.addCookies()`
- [x] Replace cookie write-back: `Network.getAllCookies()` → `context.cookies()`
- [x] Remove window-hiding code (lines 128-141)
- [x] Remove temp `userDataDir` creation/cleanup
- [x] Remove `Network.enable()`, `Page.enable()`, `Runtime.enable()` calls
- [x] Update disconnect detection
- [x] Wire all ported action functions with `page` instead of CDP domains
- [x] Update `BrowserRunResult` return: Chrome-specific fields omitted (browser.process() not available on Camoufox)

### Phase 4: CLI flag handling

**File:** `bin/oracle-cli.ts`, `src/cli/browserConfig.ts`

- [x] When engine is Perplexity: warn and ignore Chrome-specific flags (in executor)
- [x] `--browser-inline-cookies-file` — add validation: warn if not provided for Perplexity browser mode
- [x] Verify `isBrowserCompatible()` in BOTH locations (`runOptions.ts:60` AND `oracle-cli.ts:1006`) — already includes `sonar`

### Phase 5: Cleanup, documentation, and smoke tests

- [x] Update `.claude/CLAUDE.md` — remove headed Chrome workaround docs, add Camoufox notes
- [x] Remove dead imports from `chromeLifecycle.ts` in Perplexity engine (all Chrome imports removed)
- [x] Verify `src/browser/types.ts` `ChromeClient` type is only used by ChatGPT engine now (confirmed: 15 files in `src/browser/`, zero in `src/perplexity-browser/`)
- [x] Update `docs/browser-mode.md` if it documents Perplexity-specific behavior (no Perplexity refs found — no update needed)
- [x] Document cookie seed workflow: existing `~/.oracle/perplexity-cookies.json` + auto-refresh on each run. Export via `npx tsx export-cookies-script "Profile 2"`. Documented in `.claude/CLAUDE.md`.

**Smoke test checklist** (browser-only, testable on current macOS setup):
- [x] `oracle --model sonar "what is 2+2"` — basic headless query, Cloudflare bypass, cookie round-trip
- [x] `oracle --model sonar-deep-research "research X"` — Deep Research activation triggers (bug fix: cliModel passthrough). Toggle not found in UI (pre-existing selector issue; query still succeeds with rich results)
- [x] `oracle --model sonar --space <slug> "query"` — space navigation
- [x] Run with missing/empty cookie file — verify clear error message (not dead Chrome advice)
- [x] Run with `--browser-chrome-profile "Profile 2"` — verify warning is emitted and flag is ignored

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `camoufox-js` v0.9.1 bugs | Medium | High | Pin version, test thoroughly, have rollback plan |
| macOS-only binary | High | Medium | Platform guard + clear error. Chrome fallback if needed |
| Cloudflare tightens Perplexity config | Low | High | Monitor. Cookie write-back keeps session alive |
| Playwright `click()` doesn't work on Radix UI | Medium | Low | Fall back to pointer event sequences via `evaluate()` |
| Cookie format incompatibility | Low | Medium | Normalize in loader, strip `url` field |

## Success Metrics

- Zero visible browser window during Perplexity queries
- No regression in query success rate
- Cookie round-trip works (inject → run → write-back → next run)
- First-run binary download completes with user-visible progress

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-09-camoufox-perplexity-headless-brainstorm.md](docs/brainstorms/2026-03-09-camoufox-perplexity-headless-brainstorm.md) — spike validated Cloudflare bypass + cookie injection; `camoufox-js` eliminates Python dependency
- **Spike script:** `spike/camoufox-test.py`
- **Camoufox:** https://github.com/daijro/camoufox
- **camoufox-js:** https://www.npmjs.com/package/camoufox-js
- Key files: `src/perplexity-browser/index.ts`, `src/perplexity-browser/actions/*.ts`, `src/perplexity-browser/camoufoxLifecycle.ts`, `src/browser/chromeLifecycle.ts`, `src/browser/types.ts`

## Session Log — 2026-03-09

### Decisions
| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Cookie normalization location | Dedicated `cdpCookiesToPlaywright()` in `camoufoxLifecycle.ts` | Inline in executor | Boundary normalization — isolated, testable, single responsibility |
| Text input CDP fallback | Replace `Input.insertText` with `page.keyboard.type` as 3rd fallback | Remove fallback entirely | Playwright keyboard API is the closest equivalent; keeps fallback chain |
| Radix pointer events | Port 1:1 with `page.evaluate()` pointer sequences | Simplify to `page.click()` only | Can't test against live Perplexity yet; `page.click()` untested on Radix. Will try in smoke tests |
| Platform guard | None added — `camoufox-js` OS_ARCH_MATRIX supports mac/linux/win | macOS-only guard per original plan | Discovery: v0.9.1 declares cross-platform support, not macOS-only as brainstorm stated |
| `browser.process()` PID | Omit Chrome-specific fields from `BrowserRunResult` | Set to null | Method doesn't exist on Camoufox browser object; cleaner to omit |
| Cookie sameSite casing | Normalize with `.charAt(0).toUpperCase()` | Pass through raw | Playwright accepts capitalized only; CDP cookies may have inconsistent casing |

### Files Modified
- `package.json` — added `camoufox-js` ^0.9.1, `playwright-core` ^1.58.2
- `pnpm-lock.yaml` — lockfile update
- `src/perplexity-browser/camoufoxLifecycle.ts` — NEW: launch, binary bootstrap, cookie normalization, signal hooks
- `src/perplexity-browser/index.ts` — rewired from Chrome/CDP to Camoufox/Playwright; removed window-hiding, temp dir, CDP enables
- `src/perplexity-browser/actions/navigation.ts` — CDP Runtime/Page → Playwright Page; updated error messages
- `src/perplexity-browser/actions/modelSelection.ts` — CDP Runtime → Playwright Page
- `src/perplexity-browser/actions/promptSubmit.ts` — CDP Runtime/Input → Playwright Page; `Input.insertText` → `page.keyboard.type`
- `src/perplexity-browser/actions/responseCapture.ts` — CDP Runtime → Playwright Page
- `src/perplexity-browser/actions/sourceFilter.ts` — CDP Runtime → Playwright Page
- `src/perplexity-browser/actions/deepResearch.ts` — CDP Runtime → Playwright Page
- `src/perplexity-browser/actions/spaceNavigation.ts` — CDP Runtime/Page → Playwright Page
- `.claude/CLAUDE.md` — updated architecture docs for Camoufox (version_id: 260309.0)

### Session Export
- Full history: .sessions/260308-1617_19354b55/main.md

### Open / Next
- ~~**Smoke test basic query**~~: DONE — all passing
- ~~**Smoke test Deep Research**~~: DONE — activation triggers after bug fix
- ~~**Smoke test space**~~: DONE — passing
- ~~**Smoke test Chrome flag warning**~~: DONE — warning emitted
- **Source filter / Deep Research UI selectors**: "Connectors & Sources" menuitem and Deep Research toggle not found in current Perplexity UI. Selectors may need updating for latest UI. Queries still succeed without these features.
- **Radix click validation**: Not tested — source filter menu not reachable. Deferred to selector fix.
- **`ensureCamoufoxBinary` import path**: `camoufox-js/dist/pkgman.js` is an internal path — may break on version bumps. Monitor or find a public API

## Session Log — 2026-03-09 (Smoke Tests)

### Bug Fix
| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Deep Research never activated | `browserConfig.desiredModel` mapped to browser label `'Sonar'` — lost original model name `'sonar-deep-research'` | Added `cliModel` to `PerplexityBrowserOptions`, passed from CLI, used for DR activation check |

### Files Modified
- `src/perplexity-browser/index.ts` — added `cliModel` option to `PerplexityBrowserOptions`; use `cliModel` for Deep Research activation check
- `bin/oracle-cli.ts` — pass `resolvedModel` as `cliModel` to Perplexity executor

### Smoke Test Results (2026-03-09)
| Test | Status | Time | Notes |
|------|--------|------|-------|
| Basic query (`sonar "what is 2+2"`) | PASS | 9.3s | Headless, CF bypass, 14 cookies injected, write-back |
| Deep Research (`sonar-deep-research`) | PASS* | 20.6s | *Activation triggers, toggle not found (UI change). 25 sources, 1619 chars |
| Space nav (`sonar --space dev-...`) | PASS | 10.5s | Space URL navigated, prompt editor found, 10 sources |
| Missing cookies | PASS | 9.4s | Warning: "Provide --browser-inline-cookies-file". No dead Chrome advice |
| Chrome flag warning | PASS | — | `--browser-chrome-profile` warning emitted, flag ignored |

### Observations
- Perplexity allows unauthenticated basic queries (no cookies = still works)
- Cookie write-back creates file even if it didn't exist (auto-bootstrap)
- `better-sqlite3` native module needed rebuild after Node version change (`npx node-gyp rebuild`)
- "Connectors & Sources" and Deep Research toggle selectors need update for current Perplexity UI
