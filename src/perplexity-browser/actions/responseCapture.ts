import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import {
  RESPONSE_PROSE_SELECTOR,
  COPY_BUTTON_SELECTORS,
  SOURCES_TAB_TEXTS,
  TAB_SELECTOR,
} from '../constants.js';

export interface CapturedResponse {
  text: string;
  citations: Citation[];
}

export interface Citation {
  index: number;
  label: string;
  url: string | null;
}

/**
 * Wait for the Perplexity response to complete, then extract text and citations.
 *
 * Completion signal: the Copy button appears after streaming ends.
 * Citations: extracted from the "Links" tab panel (NOT inline citation spans,
 * which are just popover triggers with domain+count text).
 */
export async function capturePerplexityResponse(
  page: Page,
  timeoutMs: number,
  log?: BrowserLogger,
): Promise<CapturedResponse> {
  log?.('[perplexity-browser] Waiting for response...');

  // 1. Wait for completion signal (copy button appearing)
  await waitForCompletion(page, timeoutMs, log);

  // 2. Extract response text from the prose container
  const text = await extractResponseText(page);
  if (!text) {
    throw new BrowserAutomationError(
      'Response completed but no text found in the response container.',
      { stage: 'response-capture' },
    );
  }

  // 3. Extract source URLs from the Links tab
  const citations = await extractSourcesFromLinksTab(page, log);
  log?.(
    `[perplexity-browser] Captured response: ${text.length} chars, ${citations.length} source(s)`,
  );

  return { text, citations };
}

/**
 * Format response text with citations as markdown footnotes.
 */
export function formatWithCitations(text: string, citations: Citation[]): string {
  if (!citations.length) return text;

  const footnotes = citations
    .map((c) => {
      const target = c.url ?? c.label;
      return `[${c.index}]: ${target}`;
    })
    .join('\n');

  return `${text}\n\n${footnotes}`;
}

async function waitForCompletion(page: Page, timeoutMs: number, log?: BrowserLogger): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 2_000;
  let lastLogAt = 0;

  while (Date.now() < deadline) {
    const result = await page.evaluate((args: { copySelectors: string[]; proseSelector: string }) => {
      // Primary signal: copy button (appears only after streaming ends — most reliable)
      for (const sel of args.copySelectors) {
        if (document.querySelector(sel)) return { done: true, signal: 'copy-button' };
      }
      // Secondary signal: follow-up suggestions — but only if response text exists.
      // DR progress UI can have buttons that match the heuristic before the real response.
      const hasProse = !!(document.querySelector(args.proseSelector) as HTMLElement)?.innerText?.trim();
      if (hasProse) {
        const followUps = document.querySelectorAll('[role="tabpanel"] button');
        let suggestionCount = 0;
        for (const btn of followUps) {
          const text = btn.textContent?.trim() ?? '';
          if (text.length > 15 && text.length < 200) suggestionCount++;
        }
        if (suggestionCount >= 3) return { done: true, signal: 'follow-up-suggestions' };
      }
      return { done: false };
    }, { copySelectors: COPY_BUTTON_SELECTORS, proseSelector: RESPONSE_PROSE_SELECTOR });

    if (result?.done) {
      log?.(`[perplexity-browser] Response complete (signal: ${result.signal})`);
      // Wait for DOM rendering to finish — copy button can appear before
      // the last chunk of text is rendered. Poll until text stabilizes.
      let prevLen = 0;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const curLen = await page.evaluate(
          (sel: string) => (document.querySelector(sel) as HTMLElement)?.innerText?.length ?? 0, RESPONSE_PROSE_SELECTOR,
        );
        if (curLen > 0 && curLen === prevLen) break;
        prevLen = curLen;
      }
      return;
    }

    const now = Date.now();
    if (now - lastLogAt > 15_000) {
      const elapsed = Math.round((now - (deadline - timeoutMs)) / 1000);
      log?.(`[perplexity-browser] Still waiting for response... (${elapsed}s elapsed)`);
      lastLogAt = now;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new BrowserAutomationError(
    `Timed out waiting for Perplexity response after ${Math.round(timeoutMs / 1000)}s. ` +
      'The model may still be processing (especially Deep Research). Try increasing --timeout.',
    { stage: 'response-capture' },
  );
}

async function extractResponseText(page: Page): Promise<string> {
  return await page.evaluate((proseSelector: string) => {
    const container = document.querySelector(proseSelector) as HTMLElement | null;
    if (!container) return '';

    const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, blockquote');
    if (paragraphs.length === 0) return container.innerText?.trim() ?? '';
    const parts: string[] = [];
    for (const el of paragraphs) {
      const tag = el.tagName.toLowerCase();
      let text = (el as HTMLElement).innerText?.trim() ?? '';
      if (!text) continue;
      if (tag.startsWith('h')) {
        const level = parseInt(tag[1], 10);
        text = '#'.repeat(level) + ' ' + text;
      } else if (tag === 'li') {
        text = '- ' + text;
      } else if (tag === 'pre') {
        text = '\n' + text + '\n';
      } else if (tag === 'blockquote') {
        text = '> ' + text;
      }
      parts.push(text);
    }
    return parts.join('\n\n');
  }, RESPONSE_PROSE_SELECTOR);
}

/**
 * Extract source URLs from the Links/Sources tab panel.
 *
 * Live inspection confirmed: citation URLs are NOT in inline spans (those are
 * popover triggers). Real URLs are only available in the "リンク" (Links) tab.
 * We programmatically activate the tab, extract a[href] links, then switch back.
 *
 * Uses page.click() for tab switching with fallback to pointer event sequences.
 */
async function extractSourcesFromLinksTab(page: Page, log?: BrowserLogger): Promise<Citation[]> {
  // Step 1: find and click the Links tab
  const clickResult = await page.evaluate(
    (args: { tabTexts: string[]; tabSelector: string }) => {
      const tabs = document.querySelectorAll(args.tabSelector);
      let linksTab: Element | null = null;
      let answerTabId: string | null = null;

      for (const tab of tabs) {
        const text = tab.textContent?.trim() ?? '';
        if (args.tabTexts.some(t => text.includes(t))) {
          linksTab = tab;
        }
        const isActive = tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true';
        if (isActive && !answerTabId) {
          answerTabId = tab.textContent?.trim() ?? null;
        }
      }

      if (!linksTab) return { found: false };

      // Try click() first; fall back to full pointer event sequence for Radix tabs
      const rect = linksTab.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const evtOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      linksTab.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
      linksTab.dispatchEvent(new MouseEvent('mousedown', evtOpts));
      linksTab.dispatchEvent(new PointerEvent('pointerup', evtOpts));
      linksTab.dispatchEvent(new MouseEvent('mouseup', evtOpts));
      (linksTab as HTMLElement).click();

      return { found: true, answerTabId };
    },
    { tabTexts: SOURCES_TAB_TEXTS, tabSelector: TAB_SELECTOR },
  );

  if (!clickResult?.found) {
    log?.('[perplexity-browser] Could not extract sources: links-tab-not-found');
    return [];
  }

  // Step 2: Wait for Radix tab panel to render
  await new Promise((r) => setTimeout(r, 800));

  // Step 3: Extract links
  const sources = await page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]') || document;
    const links = panel.querySelectorAll('a[href^="http"]');
    const result: Array<{ index: number; label: string; url: string }> = [];
    let index = 1;
    const seen = new Set<string>();
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      if (!href || href.includes('perplexity.ai') || seen.has(href)) continue;
      seen.add(href);
      const label = link.textContent?.trim() || '';
      try {
        const hostname = new URL(href).hostname;
        result.push({ index, label: label || hostname, url: href });
        index++;
      } catch { /* skip invalid URLs */ }
    }
    return result;
  });

  // Step 4: Switch back to Answer tab (best-effort)
  if (clickResult.answerTabId) {
    await page.evaluate(
      (args: { answerTabText: string; tabSelector: string }) => {
        const tabs = document.querySelectorAll(args.tabSelector);
        for (const tab of tabs) {
          if (tab.textContent?.trim() === args.answerTabText) {
            const rect = tab.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
            tab.dispatchEvent(new PointerEvent('pointerdown', opts));
            tab.dispatchEvent(new MouseEvent('mousedown', opts));
            tab.dispatchEvent(new PointerEvent('pointerup', opts));
            tab.dispatchEvent(new MouseEvent('mouseup', opts));
            (tab as HTMLElement).click();
            break;
          }
        }
      },
      { answerTabText: clickResult.answerTabId, tabSelector: TAB_SELECTOR },
    ).catch(() => undefined);
  }

  return sources as Citation[];
}
