import { describe, expect, it } from 'vitest';
import { createPerplexityBrowserExecutor } from '../../src/perplexity-browser/index.js';
import type { BrowserSessionConfig } from '../../src/sessionStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const live = process.env.ORACLE_LIVE_TEST === '1';

/**
 * Perplexity browser engine live integration tests.
 *
 * Requires:
 *   - Perplexity cookies at ~/.oracle/perplexity-cookies.json
 *   - Chrome installed at default location
 *
 * Run with:
 *   ORACLE_LIVE_TEST=1 pnpm test tests/live/perplexity-browser-live.test.ts
 */

const cookiePath = path.join(os.homedir(), '.oracle', 'perplexity-cookies.json');
const hasCookies = fs.existsSync(cookiePath);

function loadCookies(): unknown[] | null {
  try {
    return JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  } catch {
    return null;
  }
}

function makeBrowserConfig(overrides?: Partial<BrowserSessionConfig>): BrowserSessionConfig {
  return {
    headless: false,
    hideWindow: true,
    cookieSync: false,
    inlineCookies: loadCookies() as BrowserSessionConfig['inlineCookies'],
    inlineCookiesSource: 'inline-file',
    desiredModel: null,
    ...overrides,
  } as BrowserSessionConfig;
}

(live ? describe : describe.skip)('Perplexity browser live smoke', () => {
  if (!hasCookies) {
    it.skip('requires ~/.oracle/perplexity-cookies.json', () => {});
    return;
  }

  it(
    'basic query returns response with citations',
    async () => {
      const config = makeBrowserConfig();
      const execute = createPerplexityBrowserExecutor(config, { cookieFilePath: cookiePath });
      const result = await execute({
        prompt: 'What is the Rust programming language? Answer in one paragraph.',
        log: (msg: string) => console.log(msg),
      });
      expect(result.answerText.length).toBeGreaterThan(50);
      expect(result.answerMarkdown).toContain('[');
      expect(result.tookMs).toBeGreaterThan(0);
      expect(result.chromePid).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    'space query routes to correct space',
    async () => {
      const spaceSlug = process.env.ORACLE_TEST_SPACE_SLUG;
      if (!spaceSlug) {
        console.warn('Skipping space test: set ORACLE_TEST_SPACE_SLUG');
        return;
      }
      const config = makeBrowserConfig();
      const execute = createPerplexityBrowserExecutor(config, {
        space: spaceSlug,
        cookieFilePath: cookiePath,
      });
      const result = await execute({
        prompt: 'What is this space about? One sentence.',
        log: (msg: string) => console.log(msg),
      });
      expect(result.answerText.length).toBeGreaterThan(10);
    },
    180_000,
  );

  it(
    'expired/missing cookies produces clear error',
    async () => {
      const config = makeBrowserConfig({
        inlineCookies: [{ name: 'bogus', value: 'expired', domain: '.perplexity.ai' }] as BrowserSessionConfig['inlineCookies'],
      });
      const execute = createPerplexityBrowserExecutor(config);
      await expect(
        execute({
          prompt: 'test',
          log: () => {},
        }),
      ).rejects.toThrow(/not logged in|Continue with Google|login/i);
    },
    60_000,
  );

  it('rejects attachments', async () => {
    const config = makeBrowserConfig();
    const execute = createPerplexityBrowserExecutor(config);
    await expect(
      execute({
        prompt: 'test',
        attachments: [{ type: 'file', path: '/tmp/test.txt' }],
        log: () => {},
      }),
    ).rejects.toThrow(/attachments.*not supported/i);
  });
});
