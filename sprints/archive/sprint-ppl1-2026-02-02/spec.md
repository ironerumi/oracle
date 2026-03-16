# Perplexity Integration

## Background

**Current problem:** Oracle supports OpenAI, Anthropic, Google Gemini, X.AI (Grok), and OpenRouter. Users wanting grounded search-augmented responses must use OpenRouter or external tools.

**User's goal:** Use Perplexity's search-grounded models directly with Oracle CLI, same workflow as other providers.

## Requirements

### User Story

As an Oracle user, when I have a `PERPLEXITY_API_KEY`, I want to run `oracle --model sonar-pro "query"` because Perplexity provides real-time web-grounded answers that other models lack.

### Scope

**In:**

- 4 models: `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research`
- API key authentication via `PERPLEXITY_API_KEY`
- Base URL override via `PERPLEXITY_BASE_URL`
- Streaming and non-streaming responses
- File attachment (text embedding, existing pattern)
- Token usage reporting
- Cost reporting (using API-provided `usage.cost.total_cost`)

**Out (this sprint):**

- Filters (language, domain, recency) - stretch goal, separate PR
- Citations/sources extraction (API returns them, but we don't surface yet)
- Web auth (OAuth, browser-based)

### Functional Requirements

**F1: Model Configuration**

```typescript
// types.ts - KnownModelName union
| 'sonar'
| 'sonar-pro'
| 'sonar-reasoning-pro'
| 'sonar-deep-research'

// types.ts - provider union
| 'perplexity'

// config.ts - MODEL_CONFIGS entries (pricing null - API returns cost directly)
'sonar': {
  model: 'sonar',
  provider: 'perplexity',
  tokenizer: countTokensGpt5,  // approximate, may differ from Perplexity's count
  inputLimit: 128000,
  pricing: null,  // API provides total_cost including request fees
  reasoning: null,
  supportsSearch: true,
  supportsBackground: false,  // Perplexity doesn't support background mode
}
'sonar-pro': { inputLimit: 200000, ... }
'sonar-reasoning-pro': { inputLimit: 128000, reasoning: { effort: 'high' }, ... }
'sonar-deep-research': { inputLimit: 128000, ... }
```

**F2: API Key Resolution**

```typescript
// run.ts - add hasPerplexityKey check (line ~95)
const hasPerplexityKey = Boolean(optionsApiKey) || Boolean(process.env.PERPLEXITY_API_KEY);

// run.ts - add to providerKeyMissing check (line ~107-112)
provider === "perplexity" && !hasPerplexityKey;

// run.ts - add to getApiKeyForModel() (line ~155)
// Use knownConfig.provider check, NOT prefix - ensures A9 compliance (sonar-invalid won't suggest PERPLEXITY_API_KEY)
const knownConfig = isKnownModel(model) ? MODEL_CONFIGS[model] : undefined;
if (knownConfig?.provider === "perplexity") {
  return { key: optionsApiKey ?? process.env.PERPLEXITY_API_KEY, source: "PERPLEXITY_API_KEY" };
}

// run.ts - add base URL resolution for perplexity (line ~98-105)
if (provider === "perplexity") {
  baseUrl = process.env.PERPLEXITY_BASE_URL?.trim();
  // Note: baseUrl is origin only (e.g., https://api.perplexity.ai)
  // perplexity.ts appends /chat/completions
}
```

- Error message when missing: `Missing PERPLEXITY_API_KEY. Set it via the environment or a .env file.`

**F3: Client Routing**

```typescript
// client.ts - Route by known model config, not just prefix
// This prevents routing unknown models like 'sonar-invalid' to Perplexity
const knownConfig = isKnownModel(options?.model) ? MODEL_CONFIGS[options.model] : undefined;
if (knownConfig?.provider === "perplexity") {
  return createPerplexityClient(key, options.model, options.resolvedModelId, options.baseUrl);
}
// Fallback: prefix check for flexibility (but known models take precedence)
if (options?.model?.startsWith("sonar") && !knownConfig) {
  // Unknown sonar model - let it fall through to OpenRouter or error
}
```

**F4: Request/Response Adaptation**

Request (OracleRequestBody → Perplexity):

```typescript
// Build messages array from ALL input entries (not just first)
// This matches OpenRouter adapter pattern in client.ts:141-151
const messages: Array<{ role: string; content: string }> = [];
if (body.instructions) {
  messages.push({ role: 'system', content: body.instructions });
}
for (const entry of body.input) {
  const textParts = entry.content
    .filter((c) => c.type === 'input_text')
    .map((c) => c.text)
    .filter(Boolean)
    .join('\n\n');
  messages.push({ role: entry.role ?? 'user', content: textParts });
}

// Final request
{
  model: body.model,
  messages,
  stream: boolean,
  max_tokens: body.max_output_tokens
}
```

Response (Perplexity → OracleResponse):

```typescript
{
  id: response.id,
  status: 'completed',
  output_text: [response.choices[0].message.content],
  // Note: citations not in OracleResponse type - stored internally for future use
  usage: {
    input_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.completion_tokens,
    total_tokens: response.usage.total_tokens,
  }
}
// Cost handled separately - see F6
```

**F5: Streaming**

- SSE format with `data: {json}` lines, ending with `data: [DONE]`
- Delta content in `choices[0].delta.content`
- Final chunk has `object: "chat.completion.done"` with full usage and cost
- Yield `{ type: 'response.output_text.delta', delta: chunk }` events
- Aggregate content; extract cost from final chunk for `finalResponse()`
- If final chunk missing cost, return null (graceful degradation)

**F6: Cost Reporting**
Perplexity API returns cost breakdown directly in `usage.cost`:

```typescript
{
  input_tokens_cost: number,   // tokens * rate
  output_tokens_cost: number,  // tokens * rate
  request_cost: number,        // per-request fee based on search_context_size
  total_cost: number           // sum of above - USE THIS
}
```

**Implementation approach:**
Since `OracleResponse.usage` doesn't have a `cost` field and `run.ts` calculates cost from `modelConfig.pricing`:

1. Store `upstream_cost_usd` on response (internal field, not in type)
2. In `run.ts`, prefer `response._upstream_cost_usd` over calculated cost when available
3. This keeps type changes minimal while enabling API-provided costs

```typescript
// perplexity.ts - store cost on response
const oracleResponse: OracleResponse & { _upstream_cost_usd?: number } = {
  // ... normal fields
};
if (response.usage?.cost?.total_cost != null) {
  oracleResponse._upstream_cost_usd = response.usage.cost.total_cost;
}

// run.ts - prefer upstream cost (line ~608)
const cost = (response as any)._upstream_cost_usd ?? (pricing ? estimateUsdCost(...) : undefined);
```

**F7: Error Handling**

```typescript
import { OracleTransportError } from './errors.js';

// perplexity.ts - check response status before parsing
let raw: Response;
try {
  raw = await callPerplexity({ ... });
} catch (err) {
  // Network errors (DNS, connection refused, timeout) → wrap in OracleTransportError
  throw new OracleTransportError(`Perplexity API network error: ${err.message}`, { cause: err });
}

if (!raw.ok) {
  // Try to parse error JSON, fallback to raw text if malformed
  let errorMessage: string;
  try {
    const errorBody = await raw.json();
    errorMessage = errorBody.error?.message || `Perplexity API error: ${raw.status}`;
  } catch {
    const rawText = await raw.text().catch(() => '');
    errorMessage = rawText || `Perplexity API error: ${raw.status}`;
  }
  throw new Error(errorMessage);
}
```

## Technical Design

### New File: `src/oracle/perplexity.ts`

```typescript
import type {
  ClientLike,
  ModelName,
  OracleRequestBody,
  OracleResponse,
  ResponseStreamLike,
} from "./types.js";

const DEFAULT_PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

function buildMessages(body: OracleRequestBody): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }
  for (const entry of body.input) {
    const textParts = entry.content
      .filter((c) => c.type === "input_text")
      .map((c) => c.text ?? "")
      .filter(Boolean)
      .join("\n\n");
    if (textParts) {
      messages.push({ role: entry.role ?? "user", content: textParts });
    }
  }
  return messages;
}

async function callPerplexity(params: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  endpoint?: string;
  stream?: boolean;
  maxTokens?: number;
}): Promise<Response> {
  const url = params.endpoint?.trim() || DEFAULT_PERPLEXITY_ENDPOINT;
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: params.stream ?? false,
      max_tokens: params.maxTokens,
    }),
  });
}

async function parsePerplexityResponse(
  raw: Response,
): Promise<OracleResponse & { _upstream_cost_usd?: number }> {
  if (!raw.ok) {
    const errorBody = await raw.json().catch(() => ({}));
    throw new Error(errorBody.error?.message || `Perplexity API error: ${raw.status}`);
  }
  const json = await raw.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const result: OracleResponse & { _upstream_cost_usd?: number } = {
    id: json.id ?? `pplx-${Date.now()}`,
    status: "completed",
    output_text: [text],
    output: [{ type: "text", text }],
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      total_tokens: json.usage?.total_tokens ?? 0,
    },
  };
  if (json.usage?.cost?.total_cost != null) {
    result._upstream_cost_usd = json.usage.cost.total_cost;
  }
  return result;
}

export function createPerplexityClient(
  apiKey: string,
  modelName: ModelName,
  resolvedModelId?: string,
  baseUrl?: string,
): ClientLike {
  const modelId = resolvedModelId ?? modelName;
  // Normalize baseUrl: strip trailing slash AND /chat/completions if present (prevents double-append)
  const normalizedBase = baseUrl?.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
  const endpoint = normalizedBase
    ? `${normalizedBase}/chat/completions`
    : DEFAULT_PERPLEXITY_ENDPOINT;

  const stream = async (body: OracleRequestBody): Promise<ResponseStreamLike> => {
    const messages = buildMessages(body);
    const resp = await callPerplexity({
      apiKey,
      model: modelId,
      messages,
      stream: true,
      endpoint,
      maxTokens: body.max_output_tokens,
    });
    if (!resp.ok) {
      const errorBody = await resp.json().catch(() => ({}));
      throw new Error(errorBody.error?.message || `Perplexity API error: ${resp.status}`);
    }
    // ... SSE parsing, yield deltas, return finalResponse with cost
  };

  const create = async (body: OracleRequestBody): Promise<OracleResponse> => {
    const messages = buildMessages(body);
    const resp = await callPerplexity({
      apiKey,
      model: modelId,
      messages,
      stream: false,
      endpoint,
      maxTokens: body.max_output_tokens,
    });
    return parsePerplexityResponse(resp);
  };

  const retrieve = async (id: string): Promise<OracleResponse> => ({
    id,
    status: "error",
    error: { message: "Retrieve by ID not supported for Perplexity API." },
  });

  return { responses: { stream, create, retrieve } };
}
```

### Files Modified

| File                       | Change                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| `src/oracle/types.ts`      | Add `'perplexity'` to provider, 4 models to KnownModelName               |
| `src/oracle/config.ts`     | Add 4 MODEL_CONFIGS entries with `supportsBackground: false`             |
| `src/oracle/client.ts`     | Add routing for perplexity provider (by config, not just prefix)         |
| `src/oracle/run.ts`        | Add `hasPerplexityKey`, key resolution, base URL, upstream cost handling |
| `src/oracle/perplexity.ts` | **NEW** - client implementation                                          |

### Data Flow

```
User: oracle --model sonar-pro "query"
         ↓
run.ts: getApiKeyForModel() → PERPLEXITY_API_KEY
         ↓
client.ts: knownConfig.provider === 'perplexity' → createPerplexityClient()
         ↓
perplexity.ts: callPerplexity() → POST /chat/completions
         ↓
Response: adapt to OracleResponse with _upstream_cost_usd → stream/print
         ↓
run.ts: use _upstream_cost_usd for cost display
```

### Error Handling

| Error            | Handling                                              |
| ---------------- | ----------------------------------------------------- |
| Missing API key  | `PromptValidationError` with env var hint             |
| 401 Unauthorized | Parse error JSON, show `error.message`                |
| 429 Rate limit   | Parse error JSON, show message, no retry              |
| 4xx/5xx errors   | Parse error JSON if possible, fallback to status code |
| Network error    | `OracleTransportError`                                |
| Malformed JSON   | Catch parse error, throw with raw text                |

## Acceptance Criteria

**A1: Model selection works**

```bash
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY oracle --model sonar "What is 2+2?"
# Expected: Returns "Four" or similar (may include inline citations like [1][2] but not extracted)
```

**A2: All 4 models recognized**

```bash
oracle --model sonar --preview json | grep -q '"model":"sonar"'
oracle --model sonar-pro --preview json | grep -q '"model":"sonar-pro"'
oracle --model sonar-reasoning-pro --preview json | grep -q '"model":"sonar-reasoning-pro"'
oracle --model sonar-deep-research --preview json | grep -q '"model":"sonar-deep-research"'
```

**A3: API key required**

```bash
PERPLEXITY_API_KEY= oracle --model sonar "test" 2>&1 | grep -q "Missing PERPLEXITY_API_KEY"
```

**A4: Token usage reported**

```bash
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY oracle --model sonar "hello"
# Output includes token counts: ↑N ↓N ↻0 ΔN
```

**A5: Streaming works**

```bash
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY oracle --model sonar "Count 1 to 5"
# Response streams incrementally (visible in TTY)
```

**A6: File attachment works**

```bash
echo "The answer is 42" > /tmp/test.txt
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY oracle --model sonar --file /tmp/test.txt "What is the answer in this file?"
# Response references "42" from file content
```

**A7: Base URL override works**

```bash
PERPLEXITY_BASE_URL=https://custom.endpoint \
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY oracle --model sonar --verbose "test" 2>&1 | grep -q "custom.endpoint"
```

**A8: Cost from API shown**

```bash
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY oracle --model sonar "hello"
# Output includes cost (e.g., $0.005 - comes from API usage.cost.total_cost)
```

**A9: Unknown sonar model falls through**

```bash
# 'sonar-invalid' is NOT a known model, should not route to Perplexity
oracle --model sonar-invalid "test" 2>&1
# Should error or fall to OpenRouter, NOT call Perplexity with invalid model
```

## Edge Cases

| Case                               | Expected                                      |
| ---------------------------------- | --------------------------------------------- |
| Empty response from API            | `(no text output)` displayed                  |
| API returns error JSON             | Error message extracted and shown             |
| Very long prompt (>128K for sonar) | `PromptValidationError` with token count      |
| sonar-pro with >200K prompt        | `PromptValidationError` with token count      |
| Unknown model `sonar-invalid`      | Error or OpenRouter fallback (NOT Perplexity) |
| API error 401                      | Show "Unauthorized" or API error message      |
| API error 429                      | Show rate limit message from API              |
| Streaming without final cost       | Cost displays as undefined, no crash          |
| Base URL with trailing slash       | Handled: `baseUrl.replace(/\/$/, '')`         |
| Base URL with /chat/completions    | Stripped before appending (no double-append)  |
| Network error (DNS, timeout)       | Wrapped in `OracleTransportError`             |
| Malformed error JSON from API      | Falls back to raw text in error message       |

## Test Plan

**Unit tests** (`tests/oracle/perplexity.test.ts`):

- `createPerplexityClient` returns valid ClientLike
- `buildMessages` handles instructions + multiple inputs
- Response adaptation (choices → output_text, cost extraction)
- Error response parsing (401, 429, malformed)
- Streaming SSE parsing

**Integration tests** (manual, requires API key):

- All 4 models respond correctly
- Streaming works with incremental display
- Token usage matches API response
- Cost matches API `usage.cost.total_cost`

**Routing tests** (`tests/oracle/clientFactory.test.ts`):

- Known Perplexity models route to `createPerplexityClient`
- Unknown `sonar-*` models do NOT route to Perplexity

## Dependencies

- No new npm packages
- Env vars: `PERPLEXITY_API_KEY` (required), `PERPLEXITY_BASE_URL` (optional)

## Breaking Changes

**Note:** Adding `sonar`, `sonar-pro`, etc. to `KnownModelName` may change behavior for users who previously used these model IDs via OpenRouter. If a user had `OPENROUTER_API_KEY` and ran `--model sonar`, it would go to OpenRouter. After this change, it will require `PERPLEXITY_API_KEY` and go directly to Perplexity.

**Mitigation:** Document in release notes. Users wanting OpenRouter routing can use full OpenRouter model ID (e.g., `perplexity/sonar-pro`).
