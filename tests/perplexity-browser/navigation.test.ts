import { describe, expect, test, vi } from 'vitest';
import { ensureNotInternalError } from '../../src/perplexity-browser/actions/navigation.js';
import { BrowserAutomationError } from '../../src/oracle/errors.js';

/** Minimal Page mock — only `evaluate` is needed. */
function mockPage(evaluateResult: { hasErrorText: boolean; hasEditor: boolean }) {
  return { evaluate: vi.fn().mockResolvedValue(evaluateResult) } as any;
}

describe('ensureNotInternalError', () => {
  test('does nothing on normal page (no error text, has editor)', async () => {
    const page = mockPage({ hasErrorText: false, hasEditor: true });
    await expect(ensureNotInternalError(page)).resolves.toBeUndefined();
  });

  test('does nothing when error text present but editor also present (false positive guard)', async () => {
    // A normal page that happens to mention "Internal Error" in content
    const page = mockPage({ hasErrorText: true, hasEditor: true });
    await expect(ensureNotInternalError(page)).resolves.toBeUndefined();
  });

  test('does nothing on empty page (no error text, no editor)', async () => {
    const page = mockPage({ hasErrorText: false, hasEditor: false });
    await expect(ensureNotInternalError(page)).resolves.toBeUndefined();
  });

  test('throws on Internal Error page (error text + no editor)', async () => {
    const page = mockPage({ hasErrorText: true, hasEditor: false });
    await expect(ensureNotInternalError(page)).rejects.toThrow(BrowserAutomationError);
  });

  test('error has stage internal-error', async () => {
    const page = mockPage({ hasErrorText: true, hasEditor: false });
    try {
      await ensureNotInternalError(page);
      expect.unreachable();
    } catch (e: any) {
      expect(e.details?.stage).toBe('internal-error');
      expect(e.message).toContain('Internal Error');
    }
  });

  test('calls log when error page detected', async () => {
    const page = mockPage({ hasErrorText: true, hasEditor: false });
    const log = vi.fn();
    await expect(ensureNotInternalError(page, log)).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Internal Error'));
  });
});
