import { describe, expect, test } from 'vitest';
import { resolveSpaceUrl } from '../../src/perplexity-browser/actions/spaceNavigation.js';

describe('resolveSpaceUrl', () => {
  test('full URL passes through unchanged', () => {
    const url = 'https://www.perplexity.ai/spaces/llmcli-0s6TGbvNSfe6kPyQRKdFww';
    expect(resolveSpaceUrl(url)).toBe(url);
  });

  test('slug with hash suffix gets base URL prepended', () => {
    expect(resolveSpaceUrl('llmcli-0s6TGbvNSfe6kPyQRKdFww')).toBe(
      'https://www.perplexity.ai/spaces/llmcli-0s6TGbvNSfe6kPyQRKdFww',
    );
  });

  test('slug with longer hash suffix works', () => {
    expect(resolveSpaceUrl('xin-siisuhesu-0eNIgGZIRbu0fQYD3x4Dsw')).toBe(
      'https://www.perplexity.ai/spaces/xin-siisuhesu-0eNIgGZIRbu0fQYD3x4Dsw',
    );
  });

  test('short name without hash suffix throws', () => {
    expect(() => resolveSpaceUrl('llmcli')).toThrow('hash suffix');
  });

  test('empty string throws', () => {
    expect(() => resolveSpaceUrl('')).toThrow('Empty --space');
  });

  test('whitespace-only throws', () => {
    expect(() => resolveSpaceUrl('   ')).toThrow('Empty --space');
  });
});
