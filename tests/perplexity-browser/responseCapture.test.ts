import { describe, expect, test } from 'vitest';
import { formatWithCitations } from '../../src/perplexity-browser/actions/responseCapture.js';
import type { Citation } from '../../src/perplexity-browser/actions/responseCapture.js';

describe('formatWithCitations', () => {
  test('returns text unchanged when no citations', () => {
    expect(formatWithCitations('Hello world', [])).toBe('Hello world');
  });

  test('appends footnotes with URLs', () => {
    const citations: Citation[] = [
      { index: 1, label: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Rust' },
      { index: 2, label: 'github', url: 'https://github.com/rust-lang/rust' },
    ];
    const result = formatWithCitations('Rust is a language', citations);
    expect(result).toBe(
      'Rust is a language\n\n[1]: https://en.wikipedia.org/wiki/Rust\n[2]: https://github.com/rust-lang/rust',
    );
  });

  test('uses label as fallback when URL is null', () => {
    const citations: Citation[] = [
      { index: 1, label: 'wikipedia+1', url: null },
    ];
    const result = formatWithCitations('Some text', citations);
    expect(result).toBe('Some text\n\n[1]: wikipedia+1');
  });
});
