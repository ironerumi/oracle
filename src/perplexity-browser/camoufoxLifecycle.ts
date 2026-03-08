/**
 * Camoufox browser lifecycle for Perplexity engine.
 *
 * Replaces Chrome/CDP with headless Camoufox (Firefox fork) + Playwright.
 * ChatGPT/Gemini engines continue to use chromeLifecycle.ts — this module
 * is Perplexity-only.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { BrowserLogger } from '../browser/types.js';

export interface CamoufoxLaunchOptions {
  headless?: boolean;
  log: BrowserLogger;
}

export interface CamoufoxInstance {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Normalize CDP-shaped cookies (from ~/.oracle/perplexity-cookies.json) to
 * Playwright's addCookies format.
 *
 * Key differences:
 * - CDP uses `url` field; Playwright uses `domain` (strip `url`)
 * - Playwright requires `domain` to be present
 * - `sameSite` casing is the same (capitalized) — no change needed
 * - `expires` as Unix seconds — same in both
 */
export function cdpCookiesToPlaywright(
  cookies: Array<Record<string, unknown>>,
  fallbackDomain = '.perplexity.ai',
): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: number;
}> {
  const result: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    expires?: number;
  }> = [];

  for (const c of cookies) {
    if (!c?.name || typeof c.name !== 'string') continue;

    const domain = typeof c.domain === 'string' && c.domain ? c.domain : fallbackDomain;
    const pw: (typeof result)[number] = {
      name: c.name,
      value: typeof c.value === 'string' ? c.value : '',
      domain,
      path: typeof c.path === 'string' ? c.path : '/',
    };

    if (c.secure === true) pw.secure = true;
    if (c.httpOnly === true) pw.httpOnly = true;
    if (typeof c.sameSite === 'string') {
      const cap = c.sameSite.charAt(0).toUpperCase() + c.sameSite.slice(1).toLowerCase();
      if (cap === 'Strict' || cap === 'Lax' || cap === 'None') {
        pw.sameSite = cap as 'Strict' | 'Lax' | 'None';
      }
    }
    if (typeof c.expires === 'number' && c.expires > 0) {
      pw.expires = c.expires;
    }

    result.push(pw);
  }

  return result;
}

/**
 * Launch Camoufox headless browser, returning a ready-to-use page.
 *
 * Handles binary bootstrap: if the Camoufox binary is missing, downloads it
 * before launching (with progress logging).
 */
export async function launchCamoufox(options: CamoufoxLaunchOptions): Promise<CamoufoxInstance> {
  const { headless = true, log } = options;

  // Ensure binary is installed before launching
  await ensureCamoufoxBinary(log);

  log('[perplexity-browser] Launching Camoufox (headless)');

  // Dynamic import — camoufox-js is ESM-only
  const { Camoufox } = await import('camoufox-js');
  const browser: Browser = await Camoufox({ headless });

  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = await context.newPage();

  log('[perplexity-browser] Camoufox browser ready');

  return { browser, context, page };
}

/**
 * Check if the Camoufox binary is installed; if not, download it.
 * Handles the async bug in camoufox-js's camoufoxPath() which starts
 * download but doesn't await it.
 */
async function ensureCamoufoxBinary(log: BrowserLogger): Promise<void> {
  try {
    // Dynamic import — camoufox-js internals
    const { camoufoxPath } = await import('camoufox-js/dist/pkgman.js');
    // Check without downloading (throws if missing)
    camoufoxPath(false);
  } catch {
    log('[perplexity-browser] Camoufox binary not found — downloading (first run)...');
    try {
      const { CamoufoxFetcher } = await import('camoufox-js/dist/pkgman.js');
      const fetcher = new CamoufoxFetcher();
      await fetcher.install();
      log('[perplexity-browser] Camoufox binary installed successfully');
    } catch (installErr) {
      throw new Error(
        `Failed to download Camoufox browser binary: ${installErr instanceof Error ? installErr.message : installErr}. ` +
        'Run "npx camoufox-js fetch" manually, or use PERPLEXITY_API_KEY for API access.',
      );
    }
  }
}

/**
 * Register SIGINT/SIGTERM hooks to close the Camoufox browser on exit.
 * Returns a cleanup function that removes the hooks.
 */
export function registerCamoufoxTerminationHooks(browser: Browser, log: BrowserLogger): () => void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  let handling = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    if (handling) return;
    handling = true;
    log(`Received ${signal}; closing Camoufox browser`);
    void browser.close().catch(() => undefined).finally(() => {
      const exitCode = signal === 'SIGINT' ? 130 : 1;
      process.exitCode = exitCode;
      const isTestRun = process.env.VITEST === '1' || process.env.NODE_ENV === 'test';
      if (!isTestRun) {
        process.exit(exitCode);
      }
    });
  };

  for (const signal of signals) {
    process.on(signal, handleSignal);
  }

  return () => {
    for (const signal of signals) {
      process.removeListener(signal, handleSignal);
    }
  };
}
