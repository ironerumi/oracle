import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import {
  RESPONSE_PROSE_SELECTOR,
  COPY_BUTTON_SELECTORS,
  SOURCES_TAB_TEXTS,
  TAB_SELECTOR,
} from '../constants.js';

type Runtime = ChromeClient['Runtime'];

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
  runtime: Runtime,
  timeoutMs: number,
  log?: BrowserLogger,
): Promise<CapturedResponse> {
  log?.('[perplexity-browser] Waiting for response...');

  // 1. Wait for completion signal (copy button appearing)
  await waitForCompletion(runtime, timeoutMs, log);

  // 2. Extract response text from the prose container
  const text = await extractResponseText(runtime);
  if (!text) {
    throw new BrowserAutomationError(
      'Response completed but no text found in the response container.',
      { stage: 'response-capture' },
    );
  }

  // 3. Extract source URLs from the Links tab
  const citations = await extractSourcesFromLinksTab(runtime, log);
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

async function waitForCompletion(runtime: Runtime, timeoutMs: number, log?: BrowserLogger): Promise<void> {
  const copySelectors = JSON.stringify(COPY_BUTTON_SELECTORS);
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 2_000;
  let lastLogAt = 0;

  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: `(() => {
        const copySelectors = ${copySelectors};
        for (const sel of copySelectors) {
          if (document.querySelector(sel)) return { done: true, signal: 'copy-button' };
        }
        const followUps = document.querySelectorAll('[role="tabpanel"] button');
        let suggestionCount = 0;
        for (const btn of followUps) {
          const text = btn.textContent?.trim() ?? '';
          if (text.length > 15 && text.length < 200) suggestionCount++;
        }
        if (suggestionCount >= 3) return { done: true, signal: 'follow-up-suggestions' };
        return { done: false };
      })()`,
      returnByValue: true,
    });

    if (result.result?.value?.done) {
      log?.(`[perplexity-browser] Response complete (signal: ${result.result.value.signal})`);
      // Wait for DOM rendering to finish — copy button can appear before
      // the last chunk of text is rendered. Poll until text stabilizes.
      let prevLen = 0;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const lenCheck = await runtime.evaluate({
          expression: `(document.querySelector('[role="tabpanel"] .prose')?.innerText?.length ?? 0)`,
          returnByValue: true,
        });
        const curLen = (lenCheck.result?.value ?? 0) as number;
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

async function extractResponseText(runtime: Runtime): Promise<string> {
  const proseSelector = JSON.stringify(RESPONSE_PROSE_SELECTOR);
  const result = await runtime.evaluate({
    expression: `(() => {
      const container = document.querySelector(${proseSelector});
      if (!container) return '';
      const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, blockquote');
      if (paragraphs.length === 0) return container.innerText?.trim() ?? '';
      const parts = [];
      for (const el of paragraphs) {
        const tag = el.tagName.toLowerCase();
        let text = el.innerText?.trim() ?? '';
        if (!text) continue;
        if (tag.startsWith('h')) {
          const level = parseInt(tag[1], 10);
          text = '#'.repeat(level) + ' ' + text;
        } else if (tag === 'li') {
          text = '- ' + text;
        } else if (tag === 'pre') {
          text = '\\n' + text + '\\n';
        } else if (tag === 'blockquote') {
          text = '> ' + text;
        }
        parts.push(text);
      }
      return parts.join('\\n\\n');
    })()`,
    returnByValue: true,
  });

  return (result.result?.value ?? '') as string;
}

/**
 * Extract source URLs from the Links/Sources tab panel.
 *
 * Live inspection confirmed: citation URLs are NOT in inline spans (those are
 * popover triggers). Real URLs are only available in the "リンク" (Links) tab.
 * We programmatically activate the tab, extract a[href] links, then switch back.
 *
 * Important: avoid async IIFE with awaitPromise:true here — Perplexity SPA
 * navigation on tab click destroys the JS execution context mid-evaluation,
 * causing "Promise was collected". Use Node-side sleeps between sync evals.
 */
async function extractSourcesFromLinksTab(runtime: Runtime, log?: BrowserLogger): Promise<Citation[]> {
  const tabTexts = JSON.stringify(SOURCES_TAB_TEXTS);
  const tabSelector = JSON.stringify(TAB_SELECTOR);

  // Step 1: find tabs and click the Links tab (synchronous, no await inside)
  const clickResult = await runtime.evaluate({
    expression: `(() => {
      const tabTexts = ${tabTexts};
      const tabs = document.querySelectorAll(${tabSelector});
      let linksTab = null;
      let answerTabId = null;

      for (const tab of tabs) {
        const text = tab.textContent?.trim() ?? '';
        if (tabTexts.some(t => text.includes(t))) {
          linksTab = tab;
        }
        const isActive = tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true';
        if (isActive && !answerTabId) {
          answerTabId = tab.textContent?.trim() ?? null;
        }
      }

      if (!linksTab) return { found: false };

      // Activate the Links tab using full pointer event sequence
      // (plain .click() doesn't trigger React/Radix tab switching)
      const rect = linksTab.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const evtOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      linksTab.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
      linksTab.dispatchEvent(new MouseEvent('mousedown', evtOpts));
      linksTab.dispatchEvent(new PointerEvent('pointerup', evtOpts));
      linksTab.dispatchEvent(new MouseEvent('mouseup', evtOpts));
      linksTab.click();

      return { found: true, answerTabId };
    })()`,
    returnByValue: true,
  });

  const clickVal = clickResult.result?.value as { found: boolean; answerTabId?: string | null } | undefined;
  if (!clickVal?.found) {
    log?.('[perplexity-browser] Could not extract sources: links-tab-not-found');
    return [];
  }

  // Step 2: Node-side sleep to let Radix tab panel render (avoids async IIFE)
  await new Promise((r) => setTimeout(r, 800));

  // Step 3: extract links (synchronous)
  const linksResult = await runtime.evaluate({
    expression: `(() => {
      const links = document.querySelectorAll('a[href^="http"]');
      const sources = [];
      let index = 1;
      const seen = new Set();
      for (const link of links) {
        const href = link.href;
        if (!href || href.includes('perplexity.ai') || seen.has(href)) continue;
        seen.add(href);
        const label = link.textContent?.trim() || '';
        try {
          const hostname = new URL(href).hostname;
          sources.push({ index, label: label || hostname, url: href });
          index++;
        } catch {}
      }
      return sources;
    })()`,
    returnByValue: true,
  });

  const sources = (linksResult.result?.value ?? []) as Citation[];

  // Step 4: switch back to Answer tab (synchronous, best-effort)
  if (clickVal.answerTabId) {
    const answerTabText = JSON.stringify(clickVal.answerTabId);
    await runtime.evaluate({
      expression: `(() => {
        const tabSelector = ${tabSelector};
        const tabs = document.querySelectorAll(tabSelector);
        for (const tab of tabs) {
          if (tab.textContent?.trim() === ${answerTabText}) {
            const rect = tab.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
            tab.dispatchEvent(new PointerEvent('pointerdown', opts));
            tab.dispatchEvent(new MouseEvent('mousedown', opts));
            tab.dispatchEvent(new PointerEvent('pointerup', opts));
            tab.dispatchEvent(new MouseEvent('mouseup', opts));
            tab.click();
            break;
          }
        }
      })()`,
      returnByValue: false,
    }).catch(() => undefined); // best-effort
  }

  return sources;
}
