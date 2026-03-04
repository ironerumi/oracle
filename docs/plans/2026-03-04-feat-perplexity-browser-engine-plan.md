---
title: "feat: Add Perplexity browser engine with Spaces support"
type: feat
status: active
date: 2026-03-04
origin: docs/brainstorms/2026-03-04-perplexity-browser-engine-brainstorm.md
---

# feat: Add Perplexity browser engine with Spaces support

## Overview

Add a CDP-based browser engine for Perplexity, mirroring the ChatGPT browser engine pattern. This lets users leverage their Perplexity Pro subscription instead of paying per-token API costs, and enables Spaces integration for query organization.

(see brainstorm: `docs/brainstorms/2026-03-04-perplexity-browser-engine-brainstorm.md`)

## Problem Statement / Motivation

- **Cost**: Perplexity API charges per-token ($1-15/M tokens + per-request fees). Users with Pro subscriptions are paying twice.
- **Spaces**: Perplexity Spaces (persistent topic workspaces) are web-only -- the API has no equivalent. Users want queries organized into Spaces for context continuity.
- **Parity**: Oracle already has browser engines for ChatGPT (CDP) and Gemini (HTTP). Perplexity is the only provider with API support but no browser path.

## Proposed Solution

Create a new `src/perplexity-browser/` module that automates `perplexity.ai` via Chrome DevTools Protocol, following the ChatGPT browser engine pattern. Add a `--space` CLI flag for Space routing. Plug into the existing session runner via the executor pattern established by Gemini-web.

## Technical Approach

### Architecture

Follow the **Gemini-web executor pattern**: create `createPerplexityBrowserExecutor()` returning `(BrowserRunOptions) => Promise<BrowserRunResult>`. This keeps the Perplexity browser logic fully isolated from the ChatGPT browser engine.

**Why not extend `runBrowserMode()`?** The ChatGPT browser engine (`src/browser/index.ts`) is a 1100-line monolith with ChatGPT-specific logic deeply embedded. Adding provider branching would make it worse. The executor pattern (proven by Gemini-web) keeps each provider self-contained.

**Routing**: In `bin/oracle-cli.ts` executor selection (lines 1207-1227), add a Perplexity case before the Gemini case:

```
if provider is perplexity -> createPerplexityBrowserExecutor()
if model starts with gemini -> createGeminiWebExecutor()
else -> runBrowserMode (ChatGPT)
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engine type | CDP (like ChatGPT) | Full UI access for Spaces, model picker (brainstorm) |
| Executor pattern | Separate executor (like Gemini-web) | Isolation, no monolith bloat |
| Cookie source | `--browser-chrome-profile` (existing flag) | User's dedicated "Yifu" / "Profile 2" Chrome profile |
| Space navigation | Direct URL navigation | Spaces are URL-path based: `perplexity.ai/spaces/<slug>` |
| Citations | Embedded as markdown footnotes in `answerMarkdown` | Preserves Perplexity's value prop without changing `BrowserRunResult` type |
| `--space` scope | Perplexity-only, errors on other providers | Prevents nonsensical combinations |
| Attachments in MVP | Throw error if provided | Explicit > silent ignore |
| Headless default | Headful (like ChatGPT) | Unknown bot protection behavior |
| Auto-resolution | No API key + Perplexity model -> `'browser'` | Mirrors OpenAI fallback pattern |

### Implementation Phases

#### Phase 0: UI Reconnaissance (Manual, Pre-Implementation)

Before writing any code, inspect the Perplexity web UI in Chrome DevTools to document:

- [x] Prompt textarea selector(s) -- `src/perplexity-browser/constants.ts`
- [x] Submit button selector(s)
- [x] Model picker trigger + option selectors + label text for each model tier
- [x] Response container selector(s)
- [x] Citation/source element selectors
- [x] Response completion signal (what appears when streaming ends?)
- [x] Login state indicator (how to detect logged-in vs not)
- [ ] Deep Research progress indicators (if different from other models)
- [ ] Auth cookie names + domain (DevTools > Application > Cookies > perplexity.ai)
- [ ] Space page structure (does the prompt input appear directly on `/spaces/<slug>`?)

**Deliverable**: Populate `src/perplexity-browser/constants.ts` with verified selectors.

#### Phase 1: Plumbing (Engine Resolution + CLI + Config)

Wire up the infrastructure so `oracle --engine browser -m sonar` reaches the right code path (even if the executor is a stub).

**`src/cli/engine.ts`** -- Add Perplexity browser fallback:
```
// After existing Perplexity API key check (line 42-47):
// If Perplexity model and no API key -> browser
if (model is perplexity provider && !PERPLEXITY_API_KEY) return 'browser';
```

**`src/cli/runOptions.ts`** -- Extend browser compatibility:
```
// line 60: add sonar prefix
const isBrowserCompatible = (m: string) =>
  m.startsWith('gpt-') || m.startsWith('gemini') || m.startsWith('sonar');
```
Also add `--space` validation: error if `--space` used with non-Perplexity model.

**`bin/oracle-cli.ts`** -- Extend the **second** `isBrowserCompatible` gate (line 992):
```
// IMPORTANT: There are TWO browser compatibility gates:
// 1. src/cli/runOptions.ts:60 -- resolveRunOptions() validation
// 2. bin/oracle-cli.ts:992 -- pre-dispatch validation
// Both must include sonar* to avoid early rejection.
const isBrowserCompatible = (model: string) =>
  model.startsWith('gpt-') || model.startsWith('gemini') || model.startsWith('sonar');
```

**`bin/oracle-cli.ts`** -- Add `--space` flag:
```
.option('--space <space>', 'Perplexity Space slug or URL for query context')
```
Thread `space` through `CliOptions` -> `ResolveRunOptionsInput` -> `RunOracleOptions` -> browser config.

**`src/cli/browserConfig.ts`** -- Add Perplexity model labels:
```
// BROWSER_MODEL_LABELS additions (exact labels TBD from Phase 0):
sonar -> "Default" (or whatever the UI shows)
sonar-pro -> "Pro"
sonar-reasoning-pro -> "Reasoning"
sonar-deep-research -> "Deep Research"
```
Add Perplexity URL + space URL construction logic.

**`bin/oracle-cli.ts` executor dispatch** (lines 1207-1227) -- Add Perplexity routing:
```
if (provider === 'perplexity') -> createPerplexityBrowserExecutor(browserConfig)
```

**Files changed**:
- `src/cli/engine.ts`
- `src/cli/runOptions.ts`
- `bin/oracle-cli.ts`
- `src/cli/browserConfig.ts`

**Acceptance criteria**:
- [x] `oracle --engine browser -m sonar "test"` reaches the Perplexity executor (can be a stub that logs and exits)
- [x] `oracle -m sonar "test"` without `PERPLEXITY_API_KEY` auto-resolves to browser engine
- [x] `oracle --engine browser -m gpt-5.2-pro --space foo` throws validation error
- [x] `oracle --engine browser -m sonar --space "llmcli-0s6TGbvNSfe6kPyQRKdFww"` passes space through to config

#### Phase 2: Core Browser Automation

Implement the Perplexity-specific CDP automation.

**New files**:

```
src/perplexity-browser/
  index.ts              -- createPerplexityBrowserExecutor(), session lifecycle
  constants.ts          -- CSS selectors, PERPLEXITY_URL, COOKIE_URLS
  config.ts             -- Perplexity browser config types, model label map
  actions/
    navigation.ts       -- Navigate to perplexity.ai (or space URL), handle auth
    modelSelection.ts   -- Open model picker, select target model by label
    spaceNavigation.ts  -- Navigate to Space URL, verify landing
    promptSubmit.ts     -- Find prompt input, type text, click submit
    responseCapture.ts  -- Wait for completion, extract text + citations as markdown
```

**`src/perplexity-browser/index.ts`** -- Executor entry point:
```typescript
export function createPerplexityBrowserExecutor(config: BrowserSessionConfig) {
  return async (runOptions: BrowserRunOptions): Promise<BrowserRunResult> => {
    // 1. Launch Chrome (reuse chromeLifecycle.ts from src/browser/)
    // 2. Sync Perplexity cookies from Chrome profile
    // 3. Navigate to space URL (or perplexity.ai home)
    // 4. Detect login state
    // 5. Select model in UI picker
    // 6. Submit prompt
    // 7. Wait for response completion
    // 8. Capture response text + citations
    // 9. Return BrowserRunResult
  };
}
```

**Cookie handling** -- `syncCookies()` in `src/browser/cookies.ts` hardcodes ChatGPT's `COOKIE_URLS` at line 102:
```typescript
const origins = Array.from(new Set([stripQuery(url), ...COOKIE_URLS]));
```
This means passing a Perplexity URL still merges in ChatGPT domains. **Fix**: Add an optional `extraOrigins` parameter to `syncCookies()` that replaces `COOKIE_URLS` when provided:
```typescript
// src/browser/cookies.ts -- add optional parameter:
export async function syncCookies(
  Network, url, profile, logger, options?,
  extraOrigins?: string[]  // override COOKIE_URLS when provided
) {
  const origins = Array.from(new Set([stripQuery(url), ...(extraOrigins ?? COOKIE_URLS)]));
  // ... rest unchanged
}
```
Then in the Perplexity executor, call with Perplexity-specific origins:
```typescript
// src/perplexity-browser/constants.ts
export const PERPLEXITY_URL = 'https://www.perplexity.ai/';
export const PERPLEXITY_COOKIE_URLS = ['https://www.perplexity.ai', 'https://perplexity.ai'];

// src/perplexity-browser/index.ts
await syncCookies(Network, PERPLEXITY_URL, profile, logger, opts, PERPLEXITY_COOKIE_URLS);
```
**Files changed**: `src/browser/cookies.ts` (add parameter, backward-compatible).

**Space navigation** -- `actions/spaceNavigation.ts`:

`--space` identifier contract:
| Input | Example | Behavior |
|-------|---------|----------|
| Full URL | `https://www.perplexity.ai/spaces/llmcli-0s6TGbvNSfe6kPyQRKdFww` | Use as-is |
| Slug (with hash) | `llmcli-0s6TGbvNSfe6kPyQRKdFww` | Prepend `https://www.perplexity.ai/spaces/` |
| Short name (no hash) | `llmcli` | **Error**: "Space slug must include the hash suffix. Find the full slug in your Perplexity Space URL." |
| Empty / whitespace | `` | Skip space navigation, use Perplexity home |

Validation: `isFullUrl` if starts with `http`; `isSlug` if contains `-` followed by 20+ alphanumeric chars; otherwise reject.

```
// After navigation: verify current URL contains the space slug
// If Perplexity 404s or redirects to home -> throw:
//   "Space not found: <slug>. Verify the Space exists in your Perplexity account."
```

**Response capture with citations** -- `actions/responseCapture.ts`:
```
// 1. Wait for response completion (selector/signal TBD from Phase 0)
// 2. Extract response text from DOM
// 3. Extract citation elements (numbered references)
// 4. Format as markdown with footnote links:
//    "Answer text [1][2]...\n\n[1]: https://source1.com\n[2]: https://source2.com"
// 5. Return in answerMarkdown field of BrowserRunResult
```

**Shared code reuse from `src/browser/`**:
- `chromeLifecycle.ts` -- Chrome launch/connect/close
- `cookies.ts` -- `syncCookies()` (with different URLs)
- `detect.ts` -- `detectChromeBinary()`, `detectChromeCookieDb()`
- `profileState.ts` -- Profile locking (if manual-login mode added later)
- CDP utilities: `Runtime.evaluate`, `DOM.querySelector`, `Page.navigate`

**Files created**: 8 new files in `src/perplexity-browser/` (3 root + 5 actions)
**Files changed**: `src/browser/cookies.ts` (add `extraOrigins` parameter)

**Acceptance criteria**:
- [ ] `oracle --engine browser -m sonar --browser-chrome-profile "Profile 2" "what is rust?"` launches Chrome, navigates to perplexity.ai, submits query, returns response text
- [ ] `oracle --engine browser -m sonar-pro --space "llmcli-0s6TGbvNSfe6kPyQRKdFww" "query"` navigates to the Space, submits query in Space context
- [ ] Response includes citations as markdown footnotes
- [ ] Model picker selects the correct model tier
- [ ] Expired/missing cookies produce a clear error message (not a timeout)
- [ ] Invalid space slug produces a clear error message

#### Phase 3: Polish and Edge Cases

- [ ] **Attachment rejection**: Throw `PromptValidationError` if `attachments` provided with Perplexity browser mode
- [ ] **Deep Research timeout**: Increase default timeout for `sonar-deep-research` browser runs (e.g., 30 min)
- [ ] **Multi-model validation**: Error if `--models sonar,sonar-pro --engine browser` (browser is single-model)
- [ ] **Bot protection handling**: Add generic Cloudflare/challenge detection (check for challenge page title/scripts)
- [ ] **`--browser-keep-browser`**: Support keeping Chrome open between runs (navigate to new thread in same Space)
- [ ] **Reattach/session persistence**: Ensure `space` is persisted in session config for reattach flows (`src/browser/reattach.ts` pattern). MVP can skip reattach entirely -- throw "reattach not supported for Perplexity browser" if attempted.

**Files changed**: `src/perplexity-browser/index.ts`, `src/cli/runOptions.ts`

## System-Wide Impact

- **Engine resolution**: `resolveEngine()` gains a new Perplexity browser fallback path. No change to existing ChatGPT/Gemini resolution.
- **`isBrowserCompatible()`**: Expanded in **two locations** (`src/cli/runOptions.ts:60` and `bin/oracle-cli.ts:992`) to include `sonar*`. Additive change -- existing gpt-*/gemini* checks unchanged.
- **`syncCookies()`**: New optional `extraOrigins` parameter added to `src/browser/cookies.ts`. Backward-compatible -- existing callers pass nothing and get `COOKIE_URLS` as before.
- **CLI**: One new flag (`--space`). All existing flags unchanged.
- **`BrowserRunResult`**: No type changes. Citations embedded in existing `answerMarkdown` field.
- **Session runner**: Executor dispatch gains one new case. Existing ChatGPT and Gemini paths untouched.
- **Error propagation**: Perplexity browser errors use existing `BrowserAutomationError` with Perplexity-specific `stage` values.
- **Shared file risk**: Changes to `engine.ts`, `runOptions.ts`, `oracle-cli.ts`, `browserConfig.ts`, `cookies.ts` touch shared paths. Mitigated by existing test coverage (`tests/engine.test.ts`, `tests/runOptions.test.ts`).

## Acceptance Criteria

### Functional

- [ ] Browser mode works for all 4 Perplexity models (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research)
- [ ] `--space` routes queries to the correct Perplexity Space
- [ ] `--space` accepts both full URLs and slugs
- [ ] Response includes citations as markdown footnotes
- [ ] Engine auto-resolves to browser when no `PERPLEXITY_API_KEY` is set
- [ ] Chrome profile isolation works via `--browser-chrome-profile`

### Non-Functional

- [ ] Minimal regression risk to existing ChatGPT/Gemini paths (mitigated via existing engine + runOptions tests)
- [ ] Clear error messages for: expired cookies, invalid space, unsupported model, attachments
- [ ] Existing Perplexity API path continues to work unchanged

### Quality Gates

- [ ] Unit tests for engine resolution changes (`tests/engine.test.ts`)
- [ ] Unit tests for `--space` validation and URL normalization
- [ ] Live test: `tests/live/perplexity-browser-live.test.ts`
- [ ] Test Space for development: `xin-siisuhesu-0eNIgGZIRbu0fQYD3x4Dsw` (Chrome profile: `Profile 2`)

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Perplexity UI changes break selectors | High (over time) | Medium | Maintain fallback selector arrays like ChatGPT; document selector update process |
| Model picker labels don't match expectations | Medium | Low | Phase 0 reconnaissance; easy to update labels |
| Perplexity adds bot protection | Low | High | Generic Cloudflare detection; `--browser-manual-login` as fallback |
| Cookie auth mechanism changes | Low | Medium | Inline cookies as alternative auth path |
| Deep Research takes >20min | Medium | Low | Configurable timeout per model |

## Future Considerations

- **File uploads**: Add `--file` support for Perplexity browser mode (post-MVP)
- **Headless mode**: Test and enable if Perplexity doesn't block headless Chrome
- **Reattach/keep-browser**: Full session persistence for multi-query workflows
- **Space auto-creation**: Create new Spaces from CLI
- **Display name profile resolution**: Map Chrome display name ("Yifu") -> directory name ("Profile 2")

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-04-perplexity-browser-engine-brainstorm.md](docs/brainstorms/2026-03-04-perplexity-browser-engine-brainstorm.md) -- Key decisions: CDP approach, --space CLI flag, separate Chrome profile, URL-based Space navigation

### Internal References

- ChatGPT browser engine: `src/browser/index.ts` (reference implementation)
- Gemini-web executor pattern: `src/gemini-web/executor.ts` (executor architecture)
- Engine resolution: `src/cli/engine.ts:42-47` (Perplexity API key check)
- Browser compatibility gate: `src/cli/runOptions.ts:60` (isBrowserCompatible)
- Executor dispatch: `bin/oracle-cli.ts:1207-1227`
- Perplexity API client: `src/oracle/perplexity.ts` (existing API path)
- Model configs: `src/oracle/config.ts:149-188` (4 Perplexity models)
- Cookie handling: `src/browser/cookies.ts` (reusable syncCookies)
- Browser config builder: `src/cli/browserConfig.ts` (model label mapping)
