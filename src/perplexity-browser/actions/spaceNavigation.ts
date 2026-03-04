import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import { buildSpaceUrl } from '../constants.js';
import { waitForDocumentReady } from './navigation.js';

type Runtime = ChromeClient['Runtime'];
type Page = ChromeClient['Page'];

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
      // /spaces/slug -> slug
      const match = pathname.match(/\/spaces\/(.+)/);
      return match?.[1] ?? trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Navigate to a Perplexity Space and verify the landing page.
 */
export async function navigateToSpace(
  page: Page,
  runtime: Runtime,
  space: string,
  log?: BrowserLogger,
): Promise<void> {
  const url = resolveSpaceUrl(space);
  log?.(`[perplexity-browser] Navigating to Space: ${url}`);

  await page.navigate({ url });
  await waitForDocumentReady(runtime, 30_000);

  // Verify we landed on the space (not redirected to home or 404)
  const result = await runtime.evaluate({
    expression: 'location.href',
    returnByValue: true,
  });
  const currentUrl = (result.result?.value ?? '') as string;
  const slug = extractSlug(space);

  if (!currentUrl.includes(slug)) {
    throw new BrowserAutomationError(
      `Space not found: ${slug}. Verify the Space exists in your Perplexity account.`,
      { stage: 'space-navigation', slug },
    );
  }

  log?.(`[perplexity-browser] Landed on Space: ${currentUrl}`);
}
