import { describe, expect, test } from 'vitest';
import {
  resolvePerplexityTimeout,
  DEFAULT_TIMEOUT_MS,
  DEEP_RESEARCH_TIMEOUT_MS,
} from '../../src/perplexity-browser/config.js';

describe('resolvePerplexityTimeout', () => {
  test('returns default for standard models', () => {
    expect(resolvePerplexityTimeout('ppl/sonar')).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout('ppl/sonar-pro')).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('returns 30min for deep-research', () => {
    expect(resolvePerplexityTimeout('ppl/sonar-deep-research')).toBe(DEEP_RESEARCH_TIMEOUT_MS);
  });

  test('respects explicit config timeout', () => {
    expect(resolvePerplexityTimeout('ppl/sonar-deep-research', 60_000)).toBe(60_000);
  });

  test('ignores invalid config timeout', () => {
    expect(resolvePerplexityTimeout('ppl/sonar', NaN)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout('ppl/sonar', 0)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout('ppl/sonar', -1)).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('returns default for null/undefined model', () => {
    expect(resolvePerplexityTimeout(null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
  });
});
