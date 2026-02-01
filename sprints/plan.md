# Sprint 1 Plan: Perplexity Integration

## Goal
Add Perplexity as direct provider with sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research models.

## Tasks

### Must Have

- [ ] S1-1: Add Perplexity types
  - Add `'perplexity'` to provider union (`ModelConfig.provider`) in `types.ts:47`
  - Add 4 model names to `KnownModelName` union
  - Acceptance: TypeScript compiles without errors
  - Evidence: `bun run build`

- [ ] S1-2: Add model configs
  - Depends on: S1-1
  - Add 4 model configs to `MODEL_CONFIGS` in `config.ts`
  - Include: input limits (128K/200K), `provider: 'perplexity'`, `pricing: null`, `supportsBackground: false`
  - Acceptance: `resolveKnownModelConfig('sonar')` returns config with provider 'perplexity'
  - Evidence: `bun run test`

- [ ] S1-3: Create perplexity.ts client
  - Depends on: S1-1
  - Create `src/oracle/perplexity.ts` with `createPerplexityClient()` returning `ClientLike`
  - Implement `buildMessages()` for request adaptation (system + user messages)
  - Implement `parsePerplexityResponse()` for response adaptation
  - Handle SSE streaming with delta content, extract `usage.cost.total_cost` from final chunk
  - Handle errors: 401, 429, network, malformed JSON (spec F7)
  - Acceptance: Can stream response from Perplexity API
  - Evidence: Manual test with `PERPLEXITY_API_KEY`

- [ ] S1-3b: Add perplexity unit tests
  - Depends on: S1-3
  - Create `tests/oracle/perplexity.test.ts`
  - Test: `buildMessages()`, response adaptation, error handling (401, 429), SSE parsing
  - Acceptance: All unit tests pass
  - Evidence: `bun run test tests/oracle/perplexity.test.ts`

- [ ] S1-4: Add routing in client.ts
  - Depends on: S1-2, S1-3
  - Import `createPerplexityClient` from `./perplexity.js`
  - Import `isKnownModel`, `MODEL_CONFIGS` from `./config.js` if not present
  - Check `knownConfig?.provider === 'perplexity'` BEFORE prefix-based routing
  - Unknown `sonar-*` models (e.g., `sonar-invalid`) must NOT route to Perplexity (spec A9)
  - Acceptance: `sonar` routes to Perplexity; `sonar-invalid` does NOT
  - Evidence: `oracle -m sonar "test"` hits Perplexity; `oracle -m sonar-invalid "test"` errors/falls through

- [ ] S1-5: Update run.ts for env/key/cost
  - Depends on: S1-4
  - Add `hasPerplexityKey` check at ~line 95
  - Add `(provider === 'perplexity' && !hasPerplexityKey)` to providerKeyMissing check ~line 107-112
  - Update `getApiKeyForModel()` at ~line 155 for sonar prefix: return `PERPLEXITY_API_KEY`
  - Add Perplexity base URL resolution at ~line 98-105 (check `PERPLEXITY_BASE_URL`)
  - Prefer `(response as any)._upstream_cost_usd` over calculated cost at ~line 608
  - Error message: "Missing PERPLEXITY_API_KEY. Set it via the environment or a .env file."
  - Acceptance: Missing key shows friendly error; cost displays from API response
  - Evidence: Run without key (error), run with key (cost shown)

- [ ] S1-INT: Integration test
  - Depends on: S1-1, S1-2, S1-3, S1-3b, S1-4, S1-5
  - E2E test with real Perplexity API: query, stream, cost extraction
  - Test all 4 models: sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research
  - Verify unknown sonar-invalid does NOT call Perplexity (spec A9)
  - Acceptance: All models return valid responses with cost; invalid model errors correctly
  - Evidence: Manual `oracle -m <model> "test"` x4 + `oracle -m sonar-invalid "test"`

### Nice to Have

- [ ] S1-X: Add sonar-reasoning-pro thinking token support
  - Parse `<thinking>` tags if present in reasoning model output
  - Display differently in CLI output

## Dependencies

```
S1-1 ─────┬───► S1-2 ──────────────┐
          │                        │
          └───► S1-3 ───► S1-3b ───┼───► S1-4 ───► S1-5 ───► S1-INT
```

## Notes

- No new dependencies needed (HTTP-based like claude.ts)
- Cost comes from API `usage.cost.total_cost`, not calculated
- Breaking: sonar models now prefer direct Perplexity over OpenRouter (intended)
- Key resolution uses model prefix `sonar` since all 4 models share it
