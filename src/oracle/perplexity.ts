import type {
  ClientLike,
  ModelName,
  OracleRequestBody,
  OracleResponse,
  ResponseStreamEvent,
  ResponseStreamLike,
} from './types.js';
import { OracleTransportError } from './errors.js';

const DEFAULT_PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';

/**
 * Build messages array from OracleRequestBody.
 * Follows OpenRouter adapter pattern: system + all user inputs.
 */
export function buildMessages(body: OracleRequestBody): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }
  for (const entry of body.input) {
    const textParts = entry.content
      .filter((c) => c.type === 'input_text')
      .map((c) => c.text ?? '')
      .filter(Boolean)
      .join('\n\n');
    if (textParts) {
      messages.push({ role: entry.role ?? 'user', content: textParts });
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
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: params.stream ?? false,
      max_tokens: params.maxTokens,
    }),
  });
}

interface PerplexityUsageCost {
  input_tokens_cost?: number;
  output_tokens_cost?: number;
  request_cost?: number;
  total_cost?: number;
}

interface PerplexityUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: PerplexityUsageCost;
}

interface PerplexityResponse {
  id?: string;
  object?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    delta?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: PerplexityUsage;
  error?: { message?: string };
}

/**
 * Parse Perplexity API error response.
 * Attempts JSON parse, falls back to raw text.
 */
async function parseErrorResponse(raw: Response): Promise<string> {
  try {
    const errorBody = (await raw.json()) as { error?: { message?: string } };
    return errorBody.error?.message || `Perplexity API error: ${raw.status}`;
  } catch {
    const rawText = await raw.text().catch(() => '');
    return rawText || `Perplexity API error: ${raw.status}`;
  }
}

export async function parsePerplexityResponse(
  raw: Response,
): Promise<OracleResponse & { _upstream_cost_usd?: number }> {
  if (!raw.ok) {
    const errorMessage = await parseErrorResponse(raw);
    throw new Error(errorMessage);
  }

  let json: PerplexityResponse;
  try {
    json = (await raw.json()) as PerplexityResponse;
  } catch {
    const rawText = await raw.text().catch(() => '');
    throw new Error(`Failed to parse Perplexity response: ${rawText}`);
  }

  if (json.error) {
    throw new Error(json.error.message || 'Perplexity request failed');
  }

  const text = json.choices?.[0]?.message?.content ?? '';
  const result: OracleResponse & { _upstream_cost_usd?: number } = {
    id: json.id ?? `pplx-${Date.now()}`,
    status: 'completed',
    output_text: [text],
    output: [{ type: 'text', text }],
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

/**
 * Normalize base URL: strip trailing slash AND /chat/completions if present.
 * Prevents double-append (e.g., .../chat/completions/chat/completions).
 */
function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return DEFAULT_PERPLEXITY_ENDPOINT;
  const normalized = baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
  return `${normalized}/chat/completions`;
}

export function createPerplexityClient(
  apiKey: string,
  modelName: ModelName,
  resolvedModelId?: string,
  baseUrl?: string,
): ClientLike {
  const modelId = resolvedModelId ?? modelName;
  const endpoint = normalizeBaseUrl(baseUrl);

  const stream = async (body: OracleRequestBody): Promise<ResponseStreamLike> => {
    const messages = buildMessages(body);

    let resp: Response;
    try {
      resp = await callPerplexity({
        apiKey,
        model: modelId,
        messages,
        stream: true,
        endpoint,
        maxTokens: body.max_output_tokens,
      });
    } catch (err) {
      throw new OracleTransportError(
        'connection-lost',
        `Perplexity API network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!resp.ok) {
      const errorMessage = await parseErrorResponse(resp);
      throw new Error(errorMessage);
    }

    let aggregatedText = '';
    let finalUsage: PerplexityUsage | undefined;
    let finalId: string | undefined;
    let finalResponsePromise: Promise<OracleResponse & { _upstream_cost_usd?: number }> | null = null;

    async function* iterator(): AsyncGenerator<ResponseStreamEvent> {
      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const chunk = JSON.parse(jsonStr) as PerplexityResponse;
                finalId = chunk.id ?? finalId;

                const delta = chunk.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  aggregatedText += delta;
                  yield { type: 'response.output_text.delta', delta };
                }

                // Final chunk has object: "chat.completion.done" with full usage
                if (chunk.object === 'chat.completion.done' || chunk.usage) {
                  if (chunk.usage) {
                    finalUsage = chunk.usage;
                  }
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Build final response
      const finalResponse: OracleResponse & { _upstream_cost_usd?: number } = {
        id: finalId ?? `pplx-${Date.now()}`,
        status: 'completed',
        output_text: [aggregatedText],
        output: [{ type: 'text', text: aggregatedText }],
        usage: {
          input_tokens: finalUsage?.prompt_tokens ?? 0,
          output_tokens: finalUsage?.completion_tokens ?? 0,
          total_tokens: finalUsage?.total_tokens ?? 0,
        },
      };

      if (finalUsage?.cost?.total_cost != null) {
        finalResponse._upstream_cost_usd = finalUsage.cost.total_cost;
      }

      finalResponsePromise = Promise.resolve(finalResponse);
    }

    const generator = iterator();

    return {
      [Symbol.asyncIterator]: () => generator,
      async finalResponse(): Promise<OracleResponse> {
        // Consume stream if not already done
        if (!finalResponsePromise) {
          // biome-ignore lint/suspicious/noEmptyBlockStatements: consume stream
          for await (const _ of generator) {}
        }
        if (!finalResponsePromise) {
          // Stream yielded nothing; return empty response
          return {
            id: finalId ?? `pplx-${Date.now()}`,
            status: 'completed',
            output_text: [aggregatedText],
            output: [{ type: 'text', text: aggregatedText }],
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
            },
          };
        }
        return finalResponsePromise;
      },
    };
  };

  const create = async (body: OracleRequestBody): Promise<OracleResponse> => {
    const messages = buildMessages(body);

    let resp: Response;
    try {
      resp = await callPerplexity({
        apiKey,
        model: modelId,
        messages,
        stream: false,
        endpoint,
        maxTokens: body.max_output_tokens,
      });
    } catch (err) {
      throw new OracleTransportError(
        'connection-lost',
        `Perplexity API network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    return parsePerplexityResponse(resp);
  };

  const retrieve = async (id: string): Promise<OracleResponse> => ({
    id,
    status: 'error',
    error: { message: 'Retrieve by ID not supported for Perplexity API.' },
  });

  return {
    responses: {
      stream,
      create,
      retrieve,
    },
  };
}
