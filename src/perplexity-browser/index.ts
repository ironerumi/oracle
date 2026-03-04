import type { BrowserRunOptions, BrowserRunResult } from '../browser/types.js';
import type { BrowserSessionConfig } from '../sessionStore.js';

export interface PerplexityBrowserOptions {
  /** Perplexity Space slug or full URL. */
  space?: string | null;
}

/**
 * Create a Perplexity browser executor following the Gemini-web executor pattern.
 * Returns a function that takes BrowserRunOptions and returns BrowserRunResult.
 *
 * Phase 1: stub -- logs intent and throws "not yet implemented".
 * Phase 2 will add CDP automation (navigate, submit prompt, capture response).
 */
export function createPerplexityBrowserExecutor(
  _browserConfig: BrowserSessionConfig,
  options: PerplexityBrowserOptions = {},
): (runOptions: BrowserRunOptions) => Promise<BrowserRunResult> {
  return async (runOptions: BrowserRunOptions): Promise<BrowserRunResult> => {
    const log = runOptions.log;
    const space = options.space ?? null;

    log?.('[perplexity-browser] Starting Perplexity browser executor (stub)');
    if (space) {
      log?.(`[perplexity-browser] Space: ${space}`);
    }
    log?.(`[perplexity-browser] Prompt: ${runOptions.prompt.slice(0, 80)}...`);

    throw new Error(
      'Perplexity browser engine is not yet implemented. ' +
        'Phase 2 will add CDP automation. ' +
        'Set PERPLEXITY_API_KEY to use the API engine instead.',
    );
  };
}
