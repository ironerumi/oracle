# Sprint 1 Plan: Perplexity Integration

## Goal

Add Perplexity as direct provider with sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research models.

## Tasks

### Must Have

- [x] S1-1: Add Perplexity types
  - Add `'perplexity'` to provider union (`ModelConfig.provider`) in `types.ts:47`
  - Add 4 model names to `KnownModelName` union
  - Acceptance: TypeScript compiles without errors
  - Evidence: `pnpm run build`
  - Note: types.ts compiles; full build requires S1-2 (Record<KnownModelName> needs all entries)

- [x] S1-2: Add model configs
  - Depends on: S1-1
  - Add 4 model configs to `MODEL_CONFIGS` in `config.ts`
  - Include for all: `provider: 'perplexity'`, `pricing: null`, `supportsBackground: false`, `supportsSearch: true`
  - Include for sonar: `inputLimit: 128000`
  - Include for sonar-pro: `inputLimit: 200000`
  - Include for sonar-reasoning-pro: `inputLimit: 128000`, `reasoning: { effort: 'high' }`
  - Include for sonar-deep-research: `inputLimit: 128000`
  - Acceptance: `resolveKnownModelConfig('sonar')` returns config with provider 'perplexity' and supportsSearch true
  - Evidence: `pnpm test`

- [x] S1-3: Create perplexity.ts client
  - Depends on: S1-1
  - Create `src/oracle/perplexity.ts` with `createPerplexityClient()` returning `ClientLike`
  - Implement `buildMessages()` for request adaptation (system + user messages)
  - Implement `parsePerplexityResponse()` for response adaptation
  - Handle SSE streaming: parse `data: {json}` lines, `data: [DONE]` terminator
    - **Note**: Verify actual SSE schema with live API call before finalizing implementation
  - Extract `usage.cost.total_cost` AND token counts from final chunk
  - Ensure `finalResponse()` returns complete usage even if stream not fully consumed (follow gemini.ts pattern)
  - Handle errors:
    - 401/429/4xx/5xx: parse error JSON, throw Error with message
    - Network errors: wrap in `OracleTransportError` (match existing patterns in errors.ts)
    - Malformed JSON: catch parse error, throw with raw text
  - **Base URL handling**: accept origin (https://api.perplexity.ai) OR full URL; normalize by stripping trailing /chat/completions if present before appending
  - Acceptance: Can stream response from Perplexity API with usage tokens
  - Evidence: Manual test with `PERPLEXITY_API_KEY`

- [x] S1-3b: Add perplexity unit tests
  - Depends on: S1-3
  - Create `tests/oracle/perplexity.test.ts`
  - Test: `buildMessages()`, response adaptation, error handling (401, 429, OracleTransportError), SSE parsing, finalResponse usage, base URL normalization
  - Acceptance: All unit tests pass
  - Evidence: `pnpm exec vitest run tests/oracle/perplexity.test.ts`

- [x] S1-4: Add routing in client.ts
  - Depends on: S1-2, S1-3
  - Import `createPerplexityClient` from `./perplexity.js`
  - Import `isKnownModel` from `./modelResolver.js`
  - Import `MODEL_CONFIGS` from `./config.js`
  - Check `knownConfig?.provider === 'perplexity'` BEFORE prefix-based routing (gemini/claude checks)
  - Unknown `sonar-*` models (e.g., `sonar-invalid`) must NOT route to Perplexity - falls through to OpenRouter/default
  - Acceptance: `sonar` routes to Perplexity; `sonar-invalid` does NOT
  - Evidence: `oracle -m sonar "test"` hits Perplexity; `oracle -m sonar-invalid "test"` errors/falls through

- [x] S1-5: Update run.ts for env/key/cost/fallback
  - Depends on: S1-4
  - Add `hasPerplexityKey` check at ~line 95
  - Add `(provider === 'perplexity' && !hasPerplexityKey)` to providerKeyMissing check ~line 107-112
  - **Exclude perplexity from OpenRouter fallback**: update `openRouterFallback` logic to NOT trigger when `provider === 'perplexity'`
  - Update `getApiKeyForModel()` at ~line 155: check `knownConfig?.provider === 'perplexity'` (NOT just sonar prefix) to return `PERPLEXITY_API_KEY`
  - **Missing-key error env-var selection**: use `knownConfig?.provider === 'perplexity'` to report `PERPLEXITY_API_KEY`
    - Unknown `sonar-invalid` should NOT suggest PERPLEXITY_API_KEY (falls through to OPENROUTER_API_KEY)
  - Add Perplexity base URL resolution at ~line 98-105:
    - CLI `--base-url` option takes precedence (passed via options.baseUrl)
    - If options.baseUrl unset, use `PERPLEXITY_BASE_URL` env var
  - Prefer `(response as any)._upstream_cost_usd` over calculated cost at ~line 608
  - Error message: "Missing PERPLEXITY_API_KEY. Set it via the environment or a .env file."
  - Acceptance: Missing key shows friendly error with PERPLEXITY_API_KEY for known models; cost displays from API; no OpenRouter fallback
  - Evidence: Run `sonar` without key (error mentioning PERPLEXITY_API_KEY), run `sonar-invalid` without key (error mentioning OPENROUTER_API_KEY)

- [x] S1-6: Update runOptions.ts for Perplexity baseUrl
  - Depends on: S1-2
  - Update `src/cli/runOptions.ts` to NOT inherit `OPENAI_BASE_URL` for Perplexity models
  - Check `isKnownModel(model) && MODEL_CONFIGS[model].provider === 'perplexity'`
  - When model is known Perplexity, leave baseUrl unset so run.ts fills from `PERPLEXITY_BASE_URL`
  - Acceptance: `oracle -m sonar "test"` with `OPENAI_BASE_URL` set does NOT use OpenAI endpoint
  - Evidence: Set `OPENAI_BASE_URL=https://example.com` and verify sonar hits Perplexity API

- [x] S1-7: Update engine.ts for Perplexity API key detection
  - Depends on: S1-2 (needs MODEL_CONFIGS to check if model is Perplexity)
  - Update `src/cli/engine.ts` to recognize `PERPLEXITY_API_KEY` as valid for `api` engine
  - Check: if model is known Perplexity model AND `PERPLEXITY_API_KEY` exists, use `api` engine
  - Currently defaults to `browser` when `OPENAI_API_KEY` is missing
  - Acceptance: `oracle -m sonar "test"` with only PERPLEXITY_API_KEY uses api engine
  - Evidence: Run without OPENAI_API_KEY, verify api engine selected

- [x] S1-INT: Integration test
  - Depends on: S1-1, S1-2, S1-3, S1-3b, S1-4, S1-5, S1-6, S1-7
  - E2E test with real Perplexity API: query, stream, cost extraction, token usage
  - Test all 4 models: sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research
  - Verify unknown sonar-invalid does NOT call Perplexity (spec A9)
  - Verify no OpenRouter fallback when PERPLEXITY_API_KEY missing but OPENROUTER_API_KEY present
  - Verify missing-key error for `sonar` mentions PERPLEXITY_API_KEY
  - Verify missing-key error for `sonar-invalid` mentions OPENROUTER_API_KEY (not PERPLEXITY_API_KEY)
  - Acceptance: All models return valid responses with cost and tokens; invalid model errors correctly
  - Evidence: Manual `oracle -m <model> "test"` x4 + error message tests

### Nice to Have

- [ ] S1-X: Add sonar-reasoning-pro thinking token support
  - Parse `<thinking>` tags if present in reasoning model output
  - Display differently in CLI output

## Dependencies

```
S1-1 ───► S1-2 ───┬───► S1-6 ────────────────┐
                  │                          │
                  ├───► S1-7 ────────────────┤
                  │                          │
S1-1 ───► S1-3 ───► S1-3b ───────────────────┼───► S1-4 ───► S1-5 ───► S1-INT
```

## Notes

- No new dependencies needed (HTTP-based like claude.ts)
- Cost comes from API `usage.cost.total_cost` - verify exact SSE response shape with live call before implementing
- Breaking: sonar models now prefer direct Perplexity over OpenRouter (intended, no silent fallback)
- Key resolution and error messages use known model config provider check, NOT sonar prefix (ensures A9 compliance)
- Base URL: CLI `--base-url` > env `PERPLEXITY_BASE_URL` > default; normalize origin vs full URL
- Must exclude perplexity from automatic OpenRouter fallback path
- Network errors should use OracleTransportError for consistency
- Citations may appear inline in Perplexity responses but are not extracted separately (out of scope)
