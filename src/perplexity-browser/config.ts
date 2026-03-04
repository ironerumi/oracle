import type { BrowserSessionConfig } from '../sessionManager.js';
import { PERPLEXITY_MODEL_LABELS } from './constants.js';

/** Default timeout for most Perplexity models (2 minutes). */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Deep Research can take much longer (30 minutes). */
export const DEEP_RESEARCH_TIMEOUT_MS = 30 * 60 * 1_000;

export function resolvePerplexityTimeout(model: string | null | undefined, configTimeout?: number): number {
  if (typeof configTimeout === 'number' && Number.isFinite(configTimeout) && configTimeout > 0) {
    return configTimeout;
  }
  return model === 'sonar-deep-research' ? DEEP_RESEARCH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

/**
 * Resolve the UI label for a Perplexity model.
 * Returns null if the model is 'sonar' (default, no picker change needed).
 */
export function resolvePerplexityModelLabel(model: string | null | undefined): string | null {
  const m = model?.trim() ?? 'sonar';
  if (m === 'sonar') return null; // default model — no picker interaction needed
  return PERPLEXITY_MODEL_LABELS[m] ?? null;
}

export function resolvePerplexityUrl(config: BrowserSessionConfig, space?: string | null): string {
  if (config.url) return config.url;
  // Space URL is handled separately in spaceNavigation; this returns the base URL.
  return 'https://www.perplexity.ai/';
}
