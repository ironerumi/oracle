# Perplexity Browser Engine

**Date**: 2026-03-04
**Status**: Draft

## What We're Building

A browser engine for Perplexity that automates `perplexity.ai` via Chrome DevTools Protocol (CDP), mirroring the existing ChatGPT browser engine pattern. This allows using a Perplexity Pro subscription instead of paying per-token API costs, while also enabling Spaces integration for query organization.

### Core Features (MVP)

1. **Query submission** -- Send prompts to Perplexity web UI, extract response text + citations
2. **Space selection** -- Route queries to specific Perplexity Spaces via `--space <name>` CLI flag; when called from an agent, the agent chooses the space name
3. **Model selection** -- Map API model names (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research) to Perplexity web UI model picker labels

## Why This Approach

### CDP over reverse-engineering

- **Proven pattern**: ChatGPT browser engine already uses CDP successfully
- **Feature-complete**: Can interact with any UI element (Spaces, model picker, file uploads later)
- **Maintainable**: Selector-based approach is understood by the team; gemini-web's reverse-engineering requires deeper API knowledge and breaks silently

### Trade-offs

| Factor | CDP (chosen) | Reverse-engineer |
|--------|-------------|-----------------|
| Speed | Slower (needs Chrome) | Faster (HTTP only) |
| Reliability | Fragile to UI changes | Fragile to API changes |
| Feature access | Full UI access | Limited to discovered endpoints |
| Dependencies | Chrome required | None beyond fetch |
| Debugging | Visual (can watch browser) | Opaque |

CDP wins on feature access (Spaces, model picker) and debuggability. Speed is acceptable for oracle's use case (one-shot queries, not high-throughput).

## Key Decisions

1. **Engine type**: CDP browser automation (like ChatGPT, not like Gemini-web)
2. **Space routing**: CLI `--space <name>` flag; agents pass space name programmatically
3. **Model mapping**: Map `sonar` / `sonar-pro` / `sonar-reasoning-pro` / `sonar-deep-research` to Perplexity web UI picker labels
4. **Cookie handling**: Read Perplexity session cookies from a dedicated Chrome profile via `--browser-chrome-profile` (same pattern as ChatGPT cookies.ts). User creates a separate Chrome profile for Perplexity to keep it isolated from their corporate browser.
5. **Engine resolution**: Add Perplexity to `isBrowserCompatible()` check; resolve engine based on `PERPLEXITY_API_KEY` presence (API) vs absence (browser)

## Implementation Sketch

### New files needed

```
src/perplexity-browser/
  index.ts          -- Entry point, session lifecycle
  constants.ts      -- CSS selectors for perplexity.ai UI
  config.ts         -- Browser config (URLs, timeouts, model labels)
  actions/
    navigation.ts   -- Navigate to perplexity.ai, handle auth state
    modelSelection.ts -- Open model picker, select target model
    spaceSelection.ts -- Navigate to Space URL (perplexity.ai/spaces/<slug>)
    promptSubmit.ts  -- Type prompt, submit, wait for response
    responseCapture.ts -- Extract answer text + citations from DOM
```

### Changes to existing files

- `src/cli/engine.ts` -- Add Perplexity browser resolution path
- `src/cli/runOptions.ts` -- Add `sonar*` to `isBrowserCompatible()`
- `src/cli/oracle-cli.ts` -- Add `--space` flag
- `src/oracle/config.ts` -- No change (models already defined)
- `src/browser/cookies.ts` -- Add Perplexity cookie URLs or create parallel cookie handler

### Model label mapping (TBD -- needs UI inspection)

| API Model | Expected Web UI Label |
|-----------|----------------------|
| sonar | Default / Quick Search |
| sonar-pro | Pro Search |
| sonar-reasoning-pro | Reasoning |
| sonar-deep-research | Deep Research |

*Exact labels need to be confirmed by inspecting the Perplexity web UI.*

## Resolved Questions

1. **Space navigation**: URL-path based. Each Space has a direct URL like `https://www.perplexity.ai/spaces/llmcli-0s6TGbvNSfe6kPyQRKdFww`. Navigation is simply `goto(spaceUrl)` -- no UI picker automation needed.
2. **Cloudflare / bot protection**: User has not encountered Cloudflare challenges on perplexity.ai. Likely not an issue, but should handle gracefully if detected.

## Open Questions

1. **Perplexity web UI selectors**: What are the actual CSS selectors / DOM structure for Perplexity's prompt input, model picker, and response output? Needs manual inspection or a test run.
2. **Cookie domain**: What cookies does Perplexity use for session auth? (Likely `perplexity.ai` domain, but need to confirm specific cookie names.)
3. **Space URL format**: The `--space` flag should accept either a full URL or a slug. Need to confirm if the slug format is always `<name>-<hash>` or varies.
