import { describe, expect, test } from 'vitest';
import {
  resolvePerplexityTimeout,
  resolvePerplexityModelLabels,
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

describe('resolvePerplexityModelLabels', () => {
  test('returns locale-aware labels for all sonar variants', () => {
    // All sonar API models map to the same "Sonar" picker entry
    expect(resolvePerplexityModelLabels('sonar')).toEqual(['Sonar', 'ソナー']);
    expect(resolvePerplexityModelLabels('sonar-pro')).toEqual(['Sonar', 'ソナー']);
    expect(resolvePerplexityModelLabels('sonar-reasoning-pro')).toEqual(['Sonar', 'ソナー']);
    expect(resolvePerplexityModelLabels('sonar-deep-research')).toEqual(['Sonar', 'ソナー']);
  });

  test('returns null for unknown model', () => {
    expect(resolvePerplexityModelLabels('unknown-model')).toBeNull();
  });

  test('returns Sonar labels for null/undefined/empty (defaults to sonar)', () => {
    expect(resolvePerplexityModelLabels(null)).toEqual(['Sonar', 'ソナー']);
    expect(resolvePerplexityModelLabels(undefined)).toEqual(['Sonar', 'ソナー']);
    expect(resolvePerplexityModelLabels('')).toEqual(['Sonar', 'ソナー']);
  });
});
