import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import { buildSpaceUrl } from '../constants.js';

/**
 * Resolve a --space argument to a full Perplexity Space URL.
 *
 * | Input                       | Behavior                                        |
 * |-----------------------------|-------------------------------------------------|
 * | Full URL (starts with http) | Use as-is                                       |
 * | Slug with hash (20+ chars)  | Prepend https://www.perplexity.ai/spaces/        |
 * | Short name (no hash suffix) | Error with helpful message                      |
 */
export function resolveSpaceUrl(space: string): string {
  const trimmed = space.trim();
  if (!trimmed) {
    throw new BrowserAutomationError(
      'Empty --space value. Provide a Space slug or full URL.',
      { stage: 'space-navigation' },
    );
  }

  // Full URL
  if (trimmed.startsWith('http')) {
    return trimmed;
  }

  // Slug with hash suffix: name-<20+ alphanumeric chars>
  if (/-.{20,}$/.test(trimmed)) {
    return buildSpaceUrl(trimmed);
  }

  // Short name without hash — reject
  throw new BrowserAutomationError(
    'Space slug must include the hash suffix. Find the full slug in your Perplexity Space URL ' +
      '(e.g., "my-space-0eNIgGZIRbu0fQYD3x4Dsw").',
    { stage: 'space-navigation', slug: trimmed },
  );
}

/**
 * Extract the slug portion from a space identifier (URL or slug string).
 */
function extractSlug(space: string): string {
  const trimmed = space.trim();
  if (trimmed.startsWith('http')) {
    try {
      const pathname = new URL(trimmed).pathname;
      const match = pathname.match(/\/spaces\/(.+)/);
      return match?.[1] ?? trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

// Space "New Thread" button texts (locale-dependent)
const NEW_THREAD_TEXTS = ['New Thread', '新しいスレッド', 'Nouveau fil', 'Neuer Thread'];

/**
 * Navigate to a Perplexity Space and verify the landing page.
 * After landing, click "New Thread" if the prompt editor is not directly visible
 * (Space landing pages show existing threads; the input only appears post-click).
 */
export async function navigateToSpace(
  page: Page,
  space: string,
  log?: BrowserLogger,
): Promise<void> {
  const url = resolveSpaceUrl(space);
  log?.(`[perplexity-browser] Navigating to Space: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Verify we landed on the space (not redirected to home or 404)
  const currentUrl = await page.evaluate(() => location.href);
  const slug = extractSlug(space);

  if (!currentUrl.includes(slug)) {
    throw new BrowserAutomationError(
      `Space not found: ${slug}. Verify the Space exists in your Perplexity account.`,
      { stage: 'space-navigation', slug },
    );
  }

  log?.(`[perplexity-browser] Landed on Space: ${currentUrl}`);

  // Wait for React hydration
  await new Promise((r) => setTimeout(r, 1_000));

  // Check if prompt editor is already present; if not, try "New Thread" button.
  const clickVal = await page.evaluate((newThreadTexts: string[]) => {
    const editor = document.querySelector('[data-lexical-editor][contenteditable="true"]')
      ?? document.querySelector('[role="textbox"][contenteditable="true"]');
    if (editor) return { hadEditor: true };

    const allBtns = document.querySelectorAll('button, a[role="button"]');
    for (const btn of allBtns) {
      const text = btn.textContent?.trim() ?? '';
      const label = btn.getAttribute('aria-label') ?? '';
      if (newThreadTexts.some(t => text.includes(t) || label.includes(t))) {
        (btn as HTMLElement).click();
        return { hadEditor: false, clicked: text || label };
      }
    }
    return { hadEditor: false, clicked: null };
  }, NEW_THREAD_TEXTS);

  if (clickVal?.hadEditor) {
    log?.('[perplexity-browser] Prompt editor already present in Space');
  } else if (clickVal?.clicked) {
    log?.(`[perplexity-browser] Clicked "New Thread" button: "${clickVal.clicked}"`);
    await new Promise((r) => setTimeout(r, 1_000));
  } else {
    log?.('[perplexity-browser] No "New Thread" button found; proceeding (editor may appear)');
  }
}
