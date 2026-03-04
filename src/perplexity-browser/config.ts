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
 * Resolve the UI labels for a Perplexity model (locale-aware array).
 * All sonar variants map to ["Sonar", "ソナー"] — the web UI doesn't distinguish tiers.
 * Returns null for unknown models.
 */
export function resolvePerplexityModelLabels(model: string | null | undefined): string[] | null {
  const m = model?.trim() || 'sonar';
  return PERPLEXITY_MODEL_LABELS[m] ?? null;
}

export function resolvePerplexityUrl(config: BrowserSessionConfig, space?: string | null): string {
  if (config.url) return config.url;
  // Space URL is handled separately in spaceNavigation; this returns the base URL.
  return 'https://www.perplexity.ai/';
}
