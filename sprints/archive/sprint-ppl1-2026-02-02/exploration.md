# Exploration: Perplexity Integration

## Questions

- [x] What is Perplexity's API format? → OpenAI-compatible chat completions
- [x] What models are available? → sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research
- [x] What auth method is used? → Bearer token (API key)
- [x] How does file attachment work in Oracle? → Files embedded as text in prompt (no native API)
- [x] What filters does Perplexity support? → `search_language_filter`, `search_domain_filter`, `search_recency_filter`
- [x] What are exact model IDs for API? → `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research`
- [x] Context window sizes? → 128K (sonar, reasoning, deep-research), 200K (sonar-pro)

## Hypotheses

- H1: Perplexity uses OpenAI-compatible API → **CONFIRMED** (chat/completions endpoint)
- H2: Can reuse OpenRouter adapter pattern → **CONFIRMED** (same request/response structure)
- H3: Search is always enabled for Perplexity → **CONFIRMED** (all models return citations/search_results)

## API Specification

### Endpoint

`https://api.perplexity.ai/chat/completions`

### Authentication

```
Authorization: Bearer $PERPLEXITY_API_KEY
Content-Type: application/json
```

### Request Format (OpenAI-compatible)

```json
{
  "model": "sonar-pro",
  "messages": [{ "role": "user", "content": "..." }],
  "stream": false,
  "search_language_filter": ["en"],
  "search_domain_filter": ["nature.com"],
  "search_recency_filter": "month"
}
```

### Response Format

```json
{
  "id": "...",
  "model": "sonar-pro",
  "created": 1234567890,
  "choices": [{ "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30 }
}
```

## Models (CONFIRMED via live API testing)

| Model               | API ID                | Context | Input $/1M | Output $/1M | Notes               |
| ------------------- | --------------------- | ------- | ---------- | ----------- | ------------------- |
| Sonar               | `sonar`               | 128K    | $1         | $1          | Lightweight search  |
| Sonar Pro           | `sonar-pro`           | 200K    | $3         | $15         | Advanced search     |
| Sonar Reasoning Pro | `sonar-reasoning-pro` | 128K    | $2         | $8          | CoT + search        |
| Sonar Deep Research | `sonar-deep-research` | 128K    | $2         | $8          | Exhaustive research |

**All models have search grounding** - verified that all return `citations[]` and `search_results[]`.

## Cost Structure (CONFIRMED)

API returns cost breakdown in `usage.cost`:

```json
{
  "input_tokens_cost": 0.00001,
  "output_tokens_cost": 0.00005,
  "request_cost": 0.005, // per-request fee based on search_context_size
  "total_cost": 0.00506 // USE THIS
}
```

Request cost varies by `search_context_size` (low/medium/high): $5-14 per 1K requests.
**Key insight**: Use `total_cost` directly instead of calculating from pricing table.

## Filter Parameters (stretch goal)

| Filter                   | Type                 | Example            | Max     |
| ------------------------ | -------------------- | ------------------ | ------- |
| `search_language_filter` | string[] (ISO 639-1) | `["en", "fr"]`     | 10      |
| `search_domain_filter`   | string[]             | `["arxiv.org"]`    | unknown |
| `search_recency_filter`  | string               | `"month"`, `"day"` | n/a     |

## Architecture Analysis

### Files to Modify

1. **`src/oracle/types.ts`** (lines 3-14, 47)
   - Add `'perplexity'` to provider union
   - Add Perplexity models to `KnownModelName`

2. **`src/oracle/config.ts`** (lines 13-149)
   - Add entries for `pplx-sonar`, `pplx-sonar-pro`, `pplx-sonar-reasoning-pro`
   - Set `provider: 'perplexity'`, `supportsSearch: true`

3. **`src/oracle/perplexity.ts`** (NEW)
   - Create client following `claude.ts` pattern (~137 lines)
   - HTTP client, OpenAI-compatible format
   - Support streaming + non-streaming

4. **`src/oracle/client.ts`** (line 34)
   - Add routing: `if (options?.model?.startsWith('pplx'))`

5. **`src/oracle/run.ts`** (lines 95, 111, 155)
   - Add `hasPerplexityKey` detection
   - Add to provider key missing check
   - Add to `getApiKeyForModel()`

### Implementation Pattern

Use `claude.ts` as template (HTTP client, not SDK):

```typescript
// src/oracle/perplexity.ts
const DEFAULT_PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

async function callPerplexity({
  apiKey,
  model,
  messages,
  endpoint,
  stream = false,
}): Promise<Response> {
  return fetch(endpoint || DEFAULT_PERPLEXITY_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream }),
  });
}

export function createPerplexityClient(apiKey, modelName, resolvedModelId?, baseUrl?): ClientLike {
  // ... adapt OracleRequestBody to messages format
  // ... adapt response to OracleResponse format
}
```

## Feasibility Assessment

### Effort: LOW-MEDIUM

| Component | Effort | Notes                       |
| --------- | ------ | --------------------------- |
| Types     | Low    | 5 lines                     |
| Config    | Low    | ~40 lines (4 model entries) |
| Client    | Medium | ~150 lines (new file)       |
| Run.ts    | Low    | ~15 lines                   |
| Client.ts | Low    | 3 lines                     |
| Tests     | Medium | ~100 lines                  |
| Docs      | Low    | ~50 lines                   |

**Total estimate:** ~360 lines of code

### Risk Assessment

| Risk                        | Likelihood | Mitigation                     |
| --------------------------- | ---------- | ------------------------------ |
| Model IDs differ from docs  | Medium     | Test with actual API           |
| Streaming format differs    | Low        | OpenAI-compatible standard     |
| Missing context window info | Medium     | Use conservative estimate      |
| Filter params break         | Low        | Make optional, fail gracefully |

### Dependencies

- No new npm packages needed (uses native fetch)
- Env var: `PERPLEXITY_API_KEY`
- Optional: `PERPLEXITY_BASE_URL` for custom endpoints

## Stretch Goal: Filters

Add to `RunOracleOptions`:

```typescript
perplexityFilters?: {
  languages?: string[];
  domains?: string[];
  recency?: 'day' | 'week' | 'month' | 'year';
};
```

Pass through to perplexity client when provider is perplexity.

## Status

[x] READY: Perplexity Integration - can now write spec

**Rationale:**

- API is OpenAI-compatible → straightforward adapter
- Pattern well-established in codebase (Claude, Gemini, OpenRouter)
- No external SDK needed
- All required information gathered
