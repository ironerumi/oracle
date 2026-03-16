# Brainstorm: `ppl/` Prefix Model Routing for Perplexity Browser

Date: 2026-03-09

## What We're Building

A `ppl/` model name prefix (OpenRouter-style) that routes any model through Perplexity's browser UI. Instead of `--model sonar`, users write `--model ppl/claude-sonnet-4.6` to use Claude Sonnet 4.6 inside Perplexity's web UI.

**Problem:** Perplexity's web UI hosts Sonnet, Gemini, GPT, Grok, Kimi — but oracle only routes `sonar-*` models through Perplexity. There's no way to say "use Sonnet via Perplexity" without it routing to Anthropic's API.

**Analogy:** Azure OpenAI has `--azure-deployment` to decouple deployment names from model identity. We do the same with a prefix convention — simpler, no extra flags.

## Why This Approach

- **Single `--model` flag** — no extra `--perplexity-model` or `--via` flags that make `--model` meaningless
- **OpenRouter precedent** — `ppl/` prefix is familiar to users of OpenRouter's `openai/gpt-4` style
- **Hard cutover** — bare `sonar` names removed; everything under `ppl/` for consistency
- **Browser only** — Perplexity API still uses `sonar-*` names natively; this feature is about the web UI model picker

## Model Registry (verified live 2026-03-09)

| `ppl/` model name         | Perplexity UI label            | Notes                                                       |
| ------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `ppl/best`                | "Best"                         | Default. "Selects your best available models"               |
| `ppl/sonar`               | "Sonar"                        |                                                             |
| `ppl/sonar-deep-research` | "Sonar" + Deep Research toggle | Separate toggle, not model picker                           |
| `ppl/gpt-5.4`             | "GPT-5.4"                      | Marked "New" in UI                                          |
| `ppl/gemini-3.1-pro`      | "Gemini 3.1 Pro"               |                                                             |
| `ppl/claude-sonnet-4.6`   | "Claude Sonnet 4.6"            |                                                             |
| `ppl/claude-opus-4.6`     | "Claude Opus 4.6"              | **Max-only** — fail fast with clear error for non-Max users |
| `ppl/kimi-k2.5`           | "Kimi K2.5"                    | "Hosted in the US"                                          |

### Dropped sonar tiers

`sonar-pro` and `sonar-reasoning-pro` are API-only distinctions. The browser UI has a single "Sonar" entry, so these don't get `ppl/` equivalents.

## Thinking Toggle (verified live 2026-03-09)

All models except Sonar and Best have a "Thinking" toggle in the model picker dropdown.

**DOM structure:**

- `[role="menuitemcheckbox"]` with text "Thinking" — sibling of the selected `menuitemradio`
- Contains `button[role="switch"][aria-checked][data-state]`
- State: `aria-checked="true"` / `data-state="checked"` = ON

**Per-model default state (Perplexity's default, before we touch it):**

| Model             | Thinking toggle exists | Perplexity default |
| ----------------- | ---------------------- | ------------------ |
| Best              | No                     | N/A                |
| Sonar             | No                     | N/A                |
| GPT-5.4           | Yes                    | OFF                |
| Gemini 3.1 Pro    | Yes                    | ON                 |
| Claude Sonnet 4.6 | Yes                    | OFF                |
| Claude Opus 4.6   | Yes (assumed)          | Unknown (Max-only) |
| Kimi K2.5         | Yes                    | ON                 |

**Oracle behavior:** Always ensure thinking is ON. After selecting a model, check the switch. If off → click to enable. If already on → no-op. If no toggle exists (Sonar, Best) → skip.

**Note:** The model picker button `aria-label` now shows the selected model name (e.g. `aria-label="GPT-5.4"`) rather than a static label. The picker must be found by checking multiple aria-label patterns or positional heuristics.

## Key Decisions

1. **Prefix convention: `ppl/`** — parsed from `--model` value, no new CLI flags
2. **Hard cutover** — bare `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research` model names removed from browser-compatible models
3. **Oracle naming for values** — `ppl/claude-sonnet-4.6` not `ppl/Claude Sonnet 4.6`; mapped to UI labels via `PERPLEXITY_MODEL_LABELS`
4. **Browser only** — `ppl/` models force `engine=browser`, `provider=perplexity`. API path unchanged.
5. **Max-only detection** — `ppl/claude-opus-4.6` detects "Max" badge or disabled state in picker; fails fast with clear error message
6. **`ppl/best`** — maps to "Best" (default pre-selected model)
7. **Model picker selector update** — `aria-label` now dynamic (shows selected model name, e.g. `"GPT-5.4"`), not static `"Select model"`. Need broader matching.
8. **Thinking toggle: always ON** — after model selection, ensure thinking switch is enabled for all models that support it. Check `[role="menuitemcheckbox"]` with "Thinking" text → click `[role="switch"]` if `aria-checked="false"`.

## Touch Points

- `src/oracle/config.ts` — MODEL_CONFIGS: remove bare sonar entries, add `ppl/*` entries with `provider: 'perplexity'`
- `src/cli/engine.ts` — `resolveEngine()`: detect `ppl/` prefix → force browser + perplexity
- `src/cli/runOptions.ts` + `bin/oracle-cli.ts` — `isBrowserCompatible()`: accept `ppl/*`
- `src/perplexity-browser/constants.ts` — extend `PERPLEXITY_MODEL_LABELS` with all `ppl/*` mappings; update `MODEL_PICKER_SELECTORS` and `MODEL_PICKER_BUTTON_TEXTS` for dynamic aria-label
- `src/cli/browserConfig.ts` — `buildBrowserConfig()`: strip `ppl/` prefix for `desiredModel` resolution
- `src/perplexity-browser/actions/modelSelection.ts` — handle Max-only detection, `ppl/best`, **thinking toggle activation**
- `normalizeModelOption()` in CLI — recognize `ppl/` as valid prefix

## Open Questions

None — all decisions resolved during brainstorming.
