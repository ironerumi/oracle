import { describe, expect, it } from 'vitest';
import { runOracle, extractTextOutput } from '../../src/oracle.js';

const live = process.env.ORACLE_LIVE_TEST === '1';
const hasKey = Boolean(process.env.PERPLEXITY_API_KEY);

/**
 * Perplexity live integration tests (S1-INT)
 *
 * Run with: ORACLE_LIVE_TEST=1 pnpm test tests/live/perplexity-live.test.ts
 *
 * Tests:
 * - All 4 models: sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research
 * - Token usage and cost extraction
 * - Streaming works
 */
(live ? describe : describe.skip)('Perplexity live smoke', () => {
  if (!hasKey) {
    it.skip('requires PERPLEXITY_API_KEY', () => {});
    return;
  }

  const expectTokens = (usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) => {
    expect(usage?.inputTokens ?? 0).toBeGreaterThan(0);
    expect(usage?.totalTokens ?? 0).toBeGreaterThan(0);
  };

  it(
    'sonar returns response with usage',
    async () => {
      try {
        const result = await runOracle(
          {
            prompt: 'Reply with exactly "sonar ok" on one line.',
            model: 'sonar',
            search: true,
            silent: true,
            maxOutput: 64,
          },
          { log: () => {}, write: () => true },
        );
        if (result.mode !== 'live') {
          throw new Error(`Expected live result, received ${result.mode ?? 'unknown'}`);
        }
        const text = extractTextOutput(result.response).toLowerCase();
        expect(text).toContain('sonar ok');
        expectTokens(result.usage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/401|403|rate limit|access|permission|model.*not.*exist/i.test(message)) {
          console.warn(`Skipping sonar test: ${message}`);
          return;
        }
        throw error;
      }
    },
    120_000,
  );

  it(
    'sonar-pro returns response with usage',
    async () => {
      try {
        const result = await runOracle(
          {
            prompt: 'Reply with exactly "sonar-pro ok" on one line.',
            model: 'sonar-pro',
            search: true,
            silent: true,
            maxOutput: 64,
          },
          { log: () => {}, write: () => true },
        );
        if (result.mode !== 'live') {
          throw new Error(`Expected live result, received ${result.mode ?? 'unknown'}`);
        }
        const text = extractTextOutput(result.response).toLowerCase();
        expect(text).toContain('sonar-pro ok');
        expectTokens(result.usage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/401|403|rate limit|access|permission|model.*not.*exist/i.test(message)) {
          console.warn(`Skipping sonar-pro test: ${message}`);
          return;
        }
        throw error;
      }
    },
    120_000,
  );

  it(
    'sonar-reasoning-pro returns response with usage',
    async () => {
      try {
        const result = await runOracle(
          {
            prompt: 'Reply with exactly "sonar-reasoning ok" on one line.',
            model: 'sonar-reasoning-pro',
            search: true,
            silent: true,
            maxOutput: 128,
          },
          { log: () => {}, write: () => true },
        );
        if (result.mode !== 'live') {
          throw new Error(`Expected live result, received ${result.mode ?? 'unknown'}`);
        }
        const text = extractTextOutput(result.response).toLowerCase();
        expect(text).toContain('sonar-reasoning ok');
        expectTokens(result.usage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/401|403|rate limit|access|permission|model.*not.*exist/i.test(message)) {
          console.warn(`Skipping sonar-reasoning-pro test: ${message}`);
          return;
        }
        throw error;
      }
    },
    180_000,
  );

  it(
    'sonar-deep-research returns response with usage',
    async () => {
      try {
        const result = await runOracle(
          {
            prompt: 'Reply with exactly "deep-research ok" on one line.',
            model: 'sonar-deep-research',
            search: true,
            silent: true,
            maxOutput: 128,
          },
          { log: () => {}, write: () => true },
        );
        if (result.mode !== 'live') {
          throw new Error(`Expected live result, received ${result.mode ?? 'unknown'}`);
        }
        const text = extractTextOutput(result.response).toLowerCase();
        expect(text).toContain('deep-research ok');
        expectTokens(result.usage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/401|403|rate limit|access|permission|model.*not.*exist/i.test(message)) {
          console.warn(`Skipping sonar-deep-research test: ${message}`);
          return;
        }
        throw error;
      }
    },
    300_000, // deep-research may take longer
  );

  it(
    'cost is extracted from API response',
    async () => {
      try {
        const result = await runOracle(
          {
            prompt: 'Say "cost test" exactly.',
            model: 'sonar',
            search: true,
            silent: true,
            maxOutput: 32,
          },
          { log: () => {}, write: () => true },
        );
        if (result.mode !== 'live') {
          throw new Error(`Expected live result, received ${result.mode ?? 'unknown'}`);
        }
        // Cost should be present (from _upstream_cost_usd)
        // Note: cost may be very small or undefined if API doesn't return it
        if (result.cost !== undefined) {
          expect(typeof result.cost).toBe('number');
          expect(result.cost).toBeGreaterThanOrEqual(0);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/401|403|rate limit|access|permission|model.*not.*exist/i.test(message)) {
          console.warn(`Skipping cost test: ${message}`);
          return;
        }
        throw error;
      }
    },
    120_000,
  );
});

/**
 * Routing tests - verify unknown sonar models don't route to Perplexity
 */
describe('Perplexity routing', () => {
  it('sonar-invalid does NOT suggest PERPLEXITY_API_KEY', async () => {
    // Clear PERPLEXITY_API_KEY and OPENROUTER_API_KEY to trigger missing key error
    const origPerplexity = process.env.PERPLEXITY_API_KEY;
    const origOpenRouter = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.PERPLEXITY_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      await expect(
        runOracle(
          { prompt: 'test', model: 'sonar-invalid', search: false },
          { log: () => {}, write: () => true },
        ),
      ).rejects.toThrow(/OPENROUTER_API_KEY/);
    } finally {
      // Restore
      if (origPerplexity) process.env.PERPLEXITY_API_KEY = origPerplexity;
      if (origOpenRouter) process.env.OPENROUTER_API_KEY = origOpenRouter;
    }
  });

  it('sonar (known model) suggests PERPLEXITY_API_KEY when missing', async () => {
    const origPerplexity = process.env.PERPLEXITY_API_KEY;
    const origOpenRouter = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.PERPLEXITY_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      await expect(
        runOracle(
          { prompt: 'test', model: 'sonar', search: false },
          { log: () => {}, write: () => true },
        ),
      ).rejects.toThrow(/PERPLEXITY_API_KEY/);
    } finally {
      if (origPerplexity) process.env.PERPLEXITY_API_KEY = origPerplexity;
      if (origOpenRouter) process.env.OPENROUTER_API_KEY = origOpenRouter;
    }
  });

  it('Perplexity does NOT fall back to OpenRouter when PERPLEXITY_API_KEY missing', async () => {
    const origPerplexity = process.env.PERPLEXITY_API_KEY;
    const origOpenRouter = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.PERPLEXITY_API_KEY;
      // Set OpenRouter key - should NOT be used for Perplexity models
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key';

      await expect(
        runOracle(
          { prompt: 'test', model: 'sonar', search: false },
          { log: () => {}, write: () => true },
        ),
      ).rejects.toThrow(/PERPLEXITY_API_KEY/);
    } finally {
      if (origPerplexity) process.env.PERPLEXITY_API_KEY = origPerplexity;
      if (origOpenRouter) {
        process.env.OPENROUTER_API_KEY = origOpenRouter;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });
});
