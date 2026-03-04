import { describe, expect, test } from 'vitest';
import {
  resolvePerplexityTimeout,
  resolvePerplexityModelLabel,
  DEFAULT_TIMEOUT_MS,
  DEEP_RESEARCH_TIMEOUT_MS,
} from '../../src/perplexity-browser/config.js';

describe('resolvePerplexityTimeout', () => {
  test('returns default for standard models', () => {
    expect(resolvePerplexityTimeout('sonar')).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout('sonar-pro')).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('returns 30min for deep-research', () => {
    expect(resolvePerplexityTimeout('sonar-deep-research')).toBe(DEEP_RESEARCH_TIMEOUT_MS);
  });

  test('respects explicit config timeout', () => {
    expect(resolvePerplexityTimeout('sonar-deep-research', 60_000)).toBe(60_000);
  });

  test('ignores invalid config timeout', () => {
    expect(resolvePerplexityTimeout('sonar', NaN)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout('sonar', 0)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout('sonar', -1)).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('returns default for null/undefined model', () => {
    expect(resolvePerplexityTimeout(null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolvePerplexityTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe('resolvePerplexityModelLabel', () => {
  test('returns null for default sonar model', () => {
    expect(resolvePerplexityModelLabel('sonar')).toBeNull();
  });

  test('returns label for known models', () => {
    expect(resolvePerplexityModelLabel('sonar-pro')).toBe('Pro');
    expect(resolvePerplexityModelLabel('sonar-reasoning-pro')).toBe('Reasoning Pro');
    expect(resolvePerplexityModelLabel('sonar-deep-research')).toBe('Deep Research');
  });

  test('returns null for unknown model', () => {
    expect(resolvePerplexityModelLabel('unknown-model')).toBeNull();
  });

  test('returns null for null/undefined/empty', () => {
    expect(resolvePerplexityModelLabel(null)).toBeNull();
    expect(resolvePerplexityModelLabel(undefined)).toBeNull();
    expect(resolvePerplexityModelLabel('')).toBeNull();
  });
});
