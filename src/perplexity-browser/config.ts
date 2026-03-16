/** Default timeout for most Perplexity models (2 minutes). */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Deep Research can take much longer (30 minutes). */
export const DEEP_RESEARCH_TIMEOUT_MS = 30 * 60 * 1_000;

export function resolvePerplexityTimeout(
  model: string | null | undefined,
  configTimeout?: number,
): number {
  if (typeof configTimeout === "number" && Number.isFinite(configTimeout) && configTimeout > 0) {
    return configTimeout;
  }
  return model === "ppl/sonar-deep-research" ? DEEP_RESEARCH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}
