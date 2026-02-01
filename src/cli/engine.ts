import { isProModel, isKnownModel } from '../oracle/modelResolver.js';
import { MODEL_CONFIGS } from '../oracle/config.js';

export type EngineMode = 'api' | 'browser';

export function defaultWaitPreference(model: string, engine: EngineMode): boolean {
  // Pro-class API runs can take a long time; prefer non-blocking unless explicitly overridden.
  if (engine === 'api' && isProModel(model)) {
    return false;
  }
  return true; // browser or non-pro models are fast enough to block by default
}

/**
 * Determine which engine to use based on CLI flags and the environment.
 *
 * Precedence:
 * 1) Legacy --browser flag forces browser.
 * 2) Explicit --engine value.
 * 3) ORACLE_ENGINE environment override (api|browser).
 * 4) OPENAI_API_KEY decides: api when set, otherwise browser.
 */
export function resolveEngine(
  {
    engine,
    browserFlag,
    env,
    model,
  }: { engine?: EngineMode; browserFlag?: boolean; env: NodeJS.ProcessEnv; model?: string },
): EngineMode {
  if (browserFlag) {
    return 'browser';
  }
  if (engine) {
    return engine;
  }
  const envEngine = normalizeEngineMode(env.ORACLE_ENGINE);
  if (envEngine) {
    return envEngine;
  }
  // Check Perplexity key for known Perplexity models
  if (model && isKnownModel(model) && MODEL_CONFIGS[model]?.provider === 'perplexity') {
    if (env.PERPLEXITY_API_KEY) {
      return 'api';
    }
  }
  return env.OPENAI_API_KEY ? 'api' : 'browser';
}

function normalizeEngineMode(raw: unknown): EngineMode | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'api') return 'api';
  if (normalized === 'browser') return 'browser';
  return null;
}
