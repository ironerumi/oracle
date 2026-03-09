---
title: "feat: ppl/ prefix model routing for Perplexity browser"
type: feat
status: active
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-ppl-prefix-model-routing-brainstorm.md
---

# feat: `ppl/` prefix model routing for Perplexity

## Overview

Unify all Perplexity models under `ppl/*` namespace. Hard cutover: bare `sonar*` removed. `ppl/*` models with `apiModel` use API when `PERPLEXITY_API_KEY` is set; those without auto-fall to browser.

## Problem Statement / Motivation

Perplexity's web UI hosts Sonnet, Gemini, GPT, Grok, Kimi — but oracle only routes `sonar-*` through Perplexity. No way to say "use Sonnet via Perplexity" without routing to Anthropic. The `ppl/` prefix creates a single namespace for everything Perplexity — API and browser.

(see brainstorm: docs/brainstorms/2026-03-09-ppl-prefix-model-routing-brainstorm.md — **note:** brainstorm said "browser only, API unchanged". This plan supersedes that: `ppl/*` unifies both API and browser under one namespace. Brainstorm decisions on prefix convention, model registry, thinking toggle, and Max detection still apply.)

## Proposed Solution

### One Namespace, Two Engines

Every Perplexity model is `ppl/*`. Engine resolution uses existing `apiModel` field:

```
Has apiModel?  →  PERPLEXITY_API_KEY set?  →  API
                  No key?                  →  Browser
No apiModel?   →  Browser (always)
               →  --engine api?            →  Error: "no API equivalent"
```

### Model Registry (verified live 2026-03-09 via Camoufox)

| Model | `apiModel` | Browser UI label | Thinking | Notes |
|---|---|---|---|---|
| `ppl/sonar` | `sonar` | "Sonar" | No | |
| `ppl/sonar-pro` | `sonar-pro` | "Sonar" | No | UI doesn't distinguish tiers |
| `ppl/sonar-reasoning-pro` | `sonar-reasoning-pro` | "Sonar" | No | |
| `ppl/sonar-deep-research` | `sonar-deep-research` | "Sonar" + DR toggle | No | |
| `ppl/best` | — | "Best" | No | |
| `ppl/gpt-5.4` | — | "GPT-5.4" | Yes (default OFF) | |
| `ppl/gemini-3.1-pro` | — | "Gemini 3.1 Pro" | Yes (default ON) | |
| `ppl/claude-sonnet-4.6` | — | "Claude Sonnet 4.6" | Yes (default OFF) | |
| `ppl/claude-opus-4.6` | — | "Claude Opus 4.6" | Yes (assumed) | **Max-only** — fail fast |
| `ppl/kimi-k2.5` | — | "Kimi K2.5" | Yes (default ON) | |

### Engine Resolution (updated `resolveEngine()`)

```typescript
if (config?.provider === 'perplexity') {
  if (explicitEngine === 'api') {
    if (!config.apiModel) throw new Error(`'${model}' has no API equivalent. Remove --engine api.`);
    if (!env.PERPLEXITY_API_KEY) throw new Error(`'${model}' requires PERPLEXITY_API_KEY.`);
    return 'api';
  }
  if (explicitEngine === 'browser') return 'browser';
  // No explicit engine: prefer API if model has apiModel + key
  if (config.apiModel && env.PERPLEXITY_API_KEY) return 'api';
  return 'browser';
}
```

No new fields on `ModelConfig`. Uses existing `apiModel` + `provider`.

### Provider-Based Detection (replaces prefix hacks)

```typescript
// isBrowserCompatible() — both sites
const config = isKnownModel(model) ? MODEL_CONFIGS[model] : undefined;
if (config?.provider === 'perplexity') return true;  // all ppl/* can browser
return model.startsWith('gpt-') || model.startsWith('gemini');

// isPerplexity in oracle-cli.ts
const isPerplexity = isKnownModel(model) && MODEL_CONFIGS[model]?.provider === 'perplexity';
```

### Thinking Toggle Activation

After model selection in the picker, ensure thinking is ON.

**DOM structure** (verified live 2026-03-09):
- `[role="menuitemcheckbox"]` — sibling of selected `menuitemradio`
- Contains `button[role="switch"][aria-checked][data-state]`

**Logic:** After selecting a model, while picker is still open:
1. Find `[role="menuitemcheckbox"]` — at most one in the picker dropdown
2. If not found → skip (Sonar, Best don't have it)
3. Check inner `button[role="switch"]` `aria-checked`
4. If `"false"` → click switch to enable
5. If `"true"` → no-op

**Locale note:** Use `[role="menuitemcheckbox"]` (structural), NOT text matching. Role is locale-independent.

### Max-Only Detection

"Claude Opus 4.6" entry text includes "Max" suffix ("Claude Opus 4.6Max").

**Strategy:** After opening picker, before clicking model:
1. Find `menuitemradio` matching target label
2. Check if the element has `disabled`, `aria-disabled="true"`, or `data-disabled` attribute
3. If disabled → throw `BrowserAutomationError('ppl/claude-opus-4.6 requires Perplexity Max subscription')`
4. Do NOT use text "Max" for detection — Max subscribers see the same text but have access

### Dynamic Model Picker Button

Picker button `aria-label` is now dynamic (shows selected model name).

**Fix:** `MODEL_PICKER_SELECTORS` structural fallbacks:
- Primary: `button[aria-haspopup="menu"][aria-label]` in prompt toolbar
- Secondary: `button[aria-label="Model"]`
- Fallback: buttons adjacent to `[data-lexical-editor]` with `aria-haspopup="menu"`

## Technical Considerations

### Hard Cutover: Bare Sonar Removed

Bare `sonar*` removed from `MODEL_CONFIGS` and `KnownModelName`. Explicit migration check:
```typescript
const REMOVED_SONAR = ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'];
if (REMOVED_SONAR.includes(model.toLowerCase())) {
  throw new Error(`Model '${model}' moved to 'ppl/${model}'. Update your --model flag.`);
}
```

### `--space` Forces Browser

`--space` is a Perplexity browser-only feature. If `--space` is present with a `ppl/*` model that has `apiModel` + key (would normally route to API), `--space` forces browser. No conflict error — `--space` is an implicit `--engine browser`.

### Multi-Model with `ppl/`

`--models` + any `ppl/` model → error. Browser executor launches one Camoufox, selects one model.

### `desiredModel` Flow

`ppl/*` is the full key everywhere. `PERPLEXITY_MODEL_LABELS` keyed by full name:
- `buildBrowserConfig()`: `config.provider === 'perplexity'` → `desiredModel = model`
- `selectPerplexityModel('ppl/claude-sonnet-4.6')` → looks up `PERPLEXITY_MODEL_LABELS['ppl/claude-sonnet-4.6']` → `['Claude Sonnet 4.6']`

### Known Out-of-Scope

Pre-existing P1 gaps — not introduced by this feature:
- `restartSession` missing Perplexity executor path
- `--space` not persisted in session metadata
- Detached session execution missing Perplexity deps

## Acceptance Criteria

### Phase 1: Core Routing

- [ ] Add `ppl/*` entries to `KnownModelName` — `types.ts`
- [ ] Add `ppl/*` entries to `MODEL_CONFIGS` with `provider: 'perplexity'`, sonar variants with `apiModel` — `config.ts`
- [ ] Remove bare `sonar*` from `KnownModelName` and `MODEL_CONFIGS`
- [ ] `resolveEngine()`: perplexity provider logic — has `apiModel` + key → api; no `apiModel` → browser; explicit `--engine api` + no `apiModel` → error — `engine.ts`
- [ ] `isBrowserCompatible()`: check `config.provider === 'perplexity'` — `engine.ts:49-51`
- [ ] `isBrowserCompatible()` second site synced — `runOptions.ts:60` / `oracle-cli.ts:1006`
- [ ] `isPerplexity` in `oracle-cli.ts`: `config.provider === 'perplexity'`
- [ ] Bare sonar migration error in CLI early path
- [ ] `--models` + any `ppl/` → error
- [ ] `normalizeModelOption()`: accept `ppl/` as valid
- [ ] `inferModelFromLabel()`: recognize `ppl/*` names, don't fall through to GPT aliases — `src/cli/options.ts`
- [ ] `--space` forces browser for `ppl/*` models (overrides API preference)

### Phase 2: Model Selection & Thinking Toggle

- [ ] `PERPLEXITY_MODEL_LABELS` keyed by full `ppl/*` names — `constants.ts`
- [ ] `MODEL_PICKER_SELECTORS` structural fallbacks — `constants.ts`
- [ ] `MODEL_PICKER_BUTTON_TEXTS` with all model labels — `constants.ts`
- [ ] Thinking toggle activation in `selectPerplexityModel()` — `modelSelection.ts`
- [ ] Max-only detection: check `disabled`/`aria-disabled` on menuitemradio → fail fast — `modelSelection.ts`
- [ ] `ppl/best`: same code path, opens picker, selects "Best" if not active

### Phase 3: Config Cleanup

- [ ] `BROWSER_MODEL_LABELS` in `browserConfig.ts`: replace sonar → `ppl/*`
- [ ] `buildBrowserConfig()`: `isPerplexityModel` via `config.provider`
- [ ] Executor `index.ts`: default `'ppl/sonar'`, DR check `'ppl/sonar-deep-research'`
- [ ] `resolvePerplexityTimeout()`: `'ppl/sonar-deep-research'` check
- [ ] `--space` error message references `ppl/*`
- [ ] `--model` help text lists `ppl/*` models

### Phase 4: Validation

- [ ] `ppl/claude-sonnet-4.6` → Camoufox, "Claude Sonnet 4.6", thinking ON, result
- [ ] `ppl/best` → opens picker, selects "Best"
- [ ] `ppl/sonar-deep-research` → "Sonar" + DR toggle
- [ ] `ppl/gpt-5.4` → "GPT-5.4", thinking ON
- [ ] `ppl/sonar-pro` + `PERPLEXITY_API_KEY` → API call with `sonar-pro`
- [ ] `ppl/sonar-pro` without key → browser, picks "Sonar"
- [ ] `ppl/claude-sonnet-4.6 --engine api` → error: no API equivalent
- [ ] `sonar` (bare) → migration error
- [ ] `ppl/claude-opus-4.6` → Max-only error
- [ ] `--models ppl/x,gpt-5.2-pro` → error
- [ ] `ppl/sonar-pro --space my-space` + `PERPLEXITY_API_KEY` → browser (--space forces browser)

## File Change Map

| File | Change |
|---|---|
| `src/oracle/types.ts` | Add `ppl/*` to `KnownModelName`, remove bare sonar |
| `src/oracle/config.ts` | Replace 4 bare sonar → 10 `ppl/*` configs (4 sonar + 6 browser-only) |
| `src/cli/engine.ts` | `resolveEngine()`: perplexity apiModel logic; `isBrowserCompatible()`: provider check |
| `src/cli/runOptions.ts` | Sync `isBrowserCompatible()` |
| `src/cli/options.ts` | `inferModelFromLabel()`: recognize `ppl/*`, don't fall through to GPT |
| `bin/oracle-cli.ts` | `isPerplexity`: provider check; migration error; `--space` forces browser; help text |
| `src/perplexity-browser/constants.ts` | `PERPLEXITY_MODEL_LABELS` keyed `ppl/*`; picker selectors |
| `src/cli/browserConfig.ts` | `BROWSER_MODEL_LABELS`: `ppl/*`; `isPerplexityModel` at line 126: provider check; `buildBrowserConfig()` desiredModel path |
| `src/perplexity-browser/actions/modelSelection.ts` | Thinking toggle, Max detection |
| `src/perplexity-browser/index.ts` | Default model, DR check |
| `src/perplexity-browser/config.ts` | Timeout check |

**No new files. No new ModelConfig fields. Uses existing `apiModel` + `provider`.**

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-09-ppl-prefix-model-routing-brainstorm.md](docs/brainstorms/2026-03-09-ppl-prefix-model-routing-brainstorm.md) — `ppl/` prefix, model registry, thinking toggle, Max detection
- **Prior plan:** [docs/plans/2026-03-09-feat-camoufox-headless-perplexity-plan.md](docs/plans/2026-03-09-feat-camoufox-headless-perplexity-plan.md) — Camoufox executor, cookie lifecycle
- **CLAUDE.md:** `isBrowserCompatible()` in TWO places, `desiredModel` semantics
