# Brainstorm: Camoufox for Headless Perplexity Access

Date: 2026-03-09

## Problem

Oracle's Perplexity engine forces a visible Chrome window on the user because:

- Headless Chrome is blocked by Cloudflare (TLS fingerprint mismatch)
- Minimized Chrome defers DOM rendering
- Current workaround: 100x100px physical window + virtual viewport — hacky, still visible

## Proposed Solution

Replace headed Chrome with [Camoufox](https://github.com/daijro/camoufox) — a Firefox fork with C++ level fingerprint spoofing that supports true headless mode.

## Validated Facts (spike: 2026-03-09)

| Test                                                      | Result                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| Camoufox headless → perplexity.ai                         | Cloudflare bypassed (title: "Perplexity", no challenge) |
| Cookie injection from `~/.oracle/perplexity-cookies.json` | Authenticated session confirmed                         |
| Binary used                                               | FF146-BETA, macOS ARM64 (auto-downloaded)               |

Perplexity's Cloudflare does NOT use the SpiderMonkey-detecting Interstitial challenge that Camoufox's own docs warn about.

Spike script: `spike/camoufox-test.py`

## Key Technical Facts

**Camoufox core**: Patched Firefox binary. Fingerprints injected at C++ level via BrowserForge. Uses Playwright/Juggler protocol (not CDP).

**`camoufox-js`** (npm, v0.9.1): Full JS port of the Python wrapper. No Python needed. Launches patched Firefox via `playwright-core`. API:

```typescript
import { Camoufox } from "camoufox-js";
const browser = await Camoufox({});
const page = await browser.newPage(); // standard Playwright Page
```

**Related npm packages** (all built on `camoufox-js`, no Python):

- `camofox-browser` (v2.1.1) — REST API server wrapping Camoufox, Express + TypeScript
- `@sport-use/camoufox-server` (v2.2.1) — Browser-as-a-Service with REST + WebSocket/CDP

## Integration Options

### Option A: Direct `camoufox-js` in oracle (Recommended)

Replace CDP Chrome launch with `camoufox-js` Playwright-Firefox in the Perplexity engine. Rewrite Perplexity automation from CDP to Playwright API.

- Pro: single language, single runtime, true headless, zero visible UI
- Con: CDP → Playwright rewrite of Perplexity engine (medium effort)
- Con: `camoufox-js` v0.9.1 is "experimental"

### Option B: `camofox-browser` as REST proxy

Run `camofox-browser` as local service (port 9377). Oracle calls HTTP endpoints.

- Pro: oracle barely changes, REST is language-agnostic
- Con: extra process to manage, REST latency, another dependency

### Option C: Standalone thin CLI

New project (JS or Python) using Camoufox directly. Accepts prompt, returns answer.

- Pro: clean separation, self-contained
- Con: duplicates oracle's existing Perplexity logic (model select, source filter, Deep Research, response capture)

## Risks

- `camoufox-js` is v0.9.1 — experimental, may have bugs
- FF146 is beta, macOS-only (Linux/Windows coming)
- Cloudflare could tighten Perplexity's config anytime, breaking Camoufox
- CDP → Playwright is a non-trivial API surface change in the Perplexity engine
