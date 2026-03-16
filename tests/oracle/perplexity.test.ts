import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildMessages,
  createPerplexityClient,
  parsePerplexityResponse,
} from '../../src/oracle/perplexity.js';
import { OracleTransportError } from '../../src/oracle/errors.js';
import type { OracleRequestBody } from '../../src/oracle/types.js';

const mockBody: OracleRequestBody = {
  model: 'sonar',
  instructions: 'respond helpfully',
  input: [
    {
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    },
  ],
};

describe('buildMessages', () => {
  test('includes system message from instructions', () => {
    const messages = buildMessages(mockBody);
    expect(messages[0]).toEqual({ role: 'system', content: 'respond helpfully' });
  });

  test('includes user message from input', () => {
    const messages = buildMessages(mockBody);
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  test('handles multiple inputs', () => {
    const body: OracleRequestBody = {
      model: 'sonar',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
        { role: 'assistant', content: [{ type: 'input_text', text: 'response' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'second' }] },
      ],
    };
    const messages = buildMessages(body);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'first' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'response' });
    expect(messages[2]).toEqual({ role: 'user', content: 'second' });
  });

  test('joins multiple text parts with double newline', () => {
    const body: OracleRequestBody = {
      model: 'sonar',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'part one' },
            { type: 'input_text', text: 'part two' },
          ],
        },
      ],
    };
    const messages = buildMessages(body);
    expect(messages[0].content).toBe('part one\n\npart two');
  });

  test('filters out non-text content types', () => {
    const body: OracleRequestBody = {
      model: 'sonar',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'visible' },
            { type: 'input_image', image_url: 'http://example.com/img.png' } as any,
          ],
        },
      ],
    };
    const messages = buildMessages(body);
    expect(messages[0].content).toBe('visible');
  });

  test('skips empty text entries', () => {
    const body: OracleRequestBody = {
      model: 'sonar',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '' },
            { type: 'input_text', text: 'actual content' },
          ],
        },
      ],
    };
    const messages = buildMessages(body);
    expect(messages[0].content).toBe('actual content');
  });

  test('omits system message if no instructions', () => {
    const body: OracleRequestBody = {
      model: 'sonar',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    };
    const messages = buildMessages(body);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});

describe('parsePerplexityResponse', () => {
  test('parses successful response with cost', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: 'pplx-123',
        choices: [{ message: { content: 'test reply' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
          cost: { total_cost: 0.005 },
        },
      }),
      { status: 200 },
    );

    const result = await parsePerplexityResponse(mockResponse);
    expect(result.id).toBe('pplx-123');
    expect(result.output_text?.[0]).toBe('test reply');
    expect(result.usage?.input_tokens).toBe(10);
    expect(result.usage?.output_tokens).toBe(20);
    expect(result.usage?.total_tokens).toBe(30);
    expect(result._upstream_cost_usd).toBe(0.005);
  });

  test('handles missing cost gracefully', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: 'pplx-456',
        choices: [{ message: { content: 'no cost' } }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      }),
      { status: 200 },
    );

    const result = await parsePerplexityResponse(mockResponse);
    expect(result._upstream_cost_usd).toBeUndefined();
  });

  test('throws on 401 with error message', async () => {
    const mockResponse = new Response(
      JSON.stringify({ error: { message: 'Invalid API key' } }),
      { status: 401 },
    );

    await expect(parsePerplexityResponse(mockResponse)).rejects.toThrow('Invalid API key');
  });

  test('throws on 429 rate limit', async () => {
    const mockResponse = new Response(
      JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
      { status: 429 },
    );

    await expect(parsePerplexityResponse(mockResponse)).rejects.toThrow('Rate limit exceeded');
  });

  test('falls back to status code on malformed error JSON', async () => {
    const mockResponse = new Response('not json', { status: 500 });

    // Note: Response body can only be consumed once; after json() fails, text() returns empty
    await expect(parsePerplexityResponse(mockResponse)).rejects.toThrow('Perplexity API error: 500');
  });

  test('handles error in response body', async () => {
    const mockResponse = new Response(
      JSON.stringify({ error: { message: 'Something went wrong' } }),
      { status: 200 },
    );

    await expect(parsePerplexityResponse(mockResponse)).rejects.toThrow('Something went wrong');
  });

  test('handles empty choices array', async () => {
    const mockResponse = new Response(
      JSON.stringify({ id: 'test', choices: [], usage: {} }),
      { status: 200 },
    );

    const result = await parsePerplexityResponse(mockResponse);
    expect(result.output_text?.[0]).toBe('');
  });
});

describe('createPerplexityClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('create() maps response to OracleResponse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'pplx-abc',
          choices: [{ message: { content: 'hello there' } }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
            cost: { total_cost: 0.003 },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    const resp = await client.responses.create(mockBody);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resp.output_text?.[0]).toBe('hello there');
    expect(resp.usage?.total_tokens).toBe(15);
    expect((resp as any)._upstream_cost_usd).toBe(0.003);
  });

  test('create() throws OracleTransportError on network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    await expect(client.responses.create(mockBody)).rejects.toThrow(OracleTransportError);
    await expect(client.responses.create(mockBody)).rejects.toThrow('DNS resolution failed');
  });

  test('create() throws Error on API error response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    await expect(client.responses.create(mockBody)).rejects.toThrow('Bad request');
  });

  test('retrieve() returns unsupported error', async () => {
    const client = createPerplexityClient('sk-test', 'sonar');
    const resp = await client.responses.retrieve('some-id');
    expect(resp.status).toBe('error');
    expect(resp.error?.message).toContain('not supported');
  });
});

describe('base URL normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('uses default endpoint when no baseUrl provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: {} }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    await client.responses.create(mockBody);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.perplexity.ai/chat/completions',
      expect.any(Object),
    );
  });

  test('strips trailing slash from baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: {} }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar', undefined, 'https://custom.api/');
    await client.responses.create(mockBody);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.api/chat/completions',
      expect.any(Object),
    );
  });

  test('strips /chat/completions from baseUrl to prevent double-append', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: {} }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient(
      'sk-test',
      'sonar',
      undefined,
      'https://custom.api/chat/completions',
    );
    await client.responses.create(mockBody);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.api/chat/completions',
      expect.any(Object),
    );
  });

  test('handles baseUrl with trailing /chat/completions/', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: {} }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient(
      'sk-test',
      'sonar',
      undefined,
      'https://custom.api/chat/completions/',
    );
    await client.responses.create(mockBody);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.api/chat/completions',
      expect.any(Object),
    );
  });
});

describe('SSE streaming', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createSSEResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }

  test('parses SSE data lines and yields deltas', async () => {
    const sseChunks = [
      'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"id":"1","choices":[{"delta":{"content":" world"}}]}\n',
      'data: {"id":"1","object":"chat.completion.done","usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n',
      'data: [DONE]\n',
    ];

    const fetchMock = vi.fn().mockResolvedValue(createSSEResponse(sseChunks));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    const streamResp = await client.responses.stream(mockBody);

    const deltas: string[] = [];
    for await (const event of streamResp) {
      if (event.type === 'response.output_text.delta') {
        deltas.push(event.delta);
      }
    }

    expect(deltas).toEqual(['Hello', ' world']);

    const finalResp = await streamResp.finalResponse();
    expect(finalResp.output_text?.[0]).toBe('Hello world');
    expect(finalResp.usage?.total_tokens).toBe(7);
  });

  test('extracts cost from final chunk', async () => {
    const sseChunks = [
      'data: {"id":"1","choices":[{"delta":{"content":"test"}}]}\n',
      'data: {"id":"1","object":"chat.completion.done","usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6,"cost":{"total_cost":0.001}}}\n',
      'data: [DONE]\n',
    ];

    const fetchMock = vi.fn().mockResolvedValue(createSSEResponse(sseChunks));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    const streamResp = await client.responses.stream(mockBody);

    // Consume stream
    for await (const _ of streamResp) {
      // drain
    }

    const finalResp = await streamResp.finalResponse();
    expect((finalResp as any)._upstream_cost_usd).toBe(0.001);
  });

  test('finalResponse() works without consuming stream', async () => {
    const sseChunks = [
      'data: {"id":"1","choices":[{"delta":{"content":"auto"}}]}\n',
      'data: {"id":"1","object":"chat.completion.done","usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n',
      'data: [DONE]\n',
    ];

    const fetchMock = vi.fn().mockResolvedValue(createSSEResponse(sseChunks));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    const streamResp = await client.responses.stream(mockBody);

    // Call finalResponse without iterating
    const finalResp = await streamResp.finalResponse();
    expect(finalResp.output_text?.[0]).toBe('auto');
  });

  test('handles malformed JSON in SSE gracefully', async () => {
    const sseChunks = [
      'data: {"id":"1","choices":[{"delta":{"content":"ok"}}]}\n',
      'data: {bad json}\n', // malformed - should be skipped
      'data: {"id":"1","object":"chat.completion.done","usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n',
      'data: [DONE]\n',
    ];

    const fetchMock = vi.fn().mockResolvedValue(createSSEResponse(sseChunks));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    const streamResp = await client.responses.stream(mockBody);

    const deltas: string[] = [];
    for await (const event of streamResp) {
      if (event.type === 'response.output_text.delta') {
        deltas.push(event.delta);
      }
    }

    expect(deltas).toEqual(['ok']);
  });

  test('stream() throws OracleTransportError on network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Connection reset'));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    await expect(client.responses.stream(mockBody)).rejects.toThrow(OracleTransportError);
  });

  test('stream() throws Error on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createPerplexityClient('sk-test', 'sonar');
    await expect(client.responses.stream(mockBody)).rejects.toThrow('Unauthorized');
  });
});
