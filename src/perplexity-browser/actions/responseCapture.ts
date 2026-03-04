import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import {
  RESPONSE_PROSE_SELECTOR,
  COPY_BUTTON_SELECTORS,
  CITATION_SELECTOR,
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
 * Citations are extracted from span.citation.inline elements.
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

  // 3. Extract citations
  const citations = await extractCitations(runtime);
  log?.(
    `[perplexity-browser] Captured response: ${text.length} chars, ${citations.length} citation(s)`,
  );

  return { text, citations };
}

/**
 * Format response text with citations as markdown footnotes.
 */
export function formatWithCitations(text: string, citations: Citation[]): string {
  if (!citations.length) return text;

  // Build footnote reference map
  let markdown = text;

  // Append footnote definitions
  const footnotes = citations
    .map((c) => {
      const target = c.url ?? c.label;
      return `[${c.index}]: ${target}`;
    })
    .join('\n');

  return `${markdown}\n\n${footnotes}`;
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
        // Check for copy button (primary completion signal)
        for (const sel of copySelectors) {
          if (document.querySelector(sel)) return { done: true, signal: 'copy-button' };
        }
        // Check for follow-up suggestion buttons (secondary signal)
        // These appear as a grid/list of buttons after the response
        const followUps = document.querySelectorAll('[role="tabpanel"] button');
        let suggestionCount = 0;
        for (const btn of followUps) {
          const text = btn.textContent?.trim() ?? '';
          // Follow-up suggestions are typically longer than action buttons
          if (text.length > 15 && text.length < 200) {
            suggestionCount++;
          }
        }
        if (suggestionCount >= 3) return { done: true, signal: 'follow-up-suggestions' };
        return { done: false };
      })()`,
      returnByValue: true,
    });

    if (result.result?.value?.done) {
      log?.(`[perplexity-browser] Response complete (signal: ${result.result.value.signal})`);
      // Small settle time after completion signal
      await new Promise((r) => setTimeout(r, 500));
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
      // Get text content, preserving paragraph breaks
      const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, blockquote');
      if (paragraphs.length === 0) return container.innerText?.trim() ?? '';
      const parts = [];
      for (const el of paragraphs) {
        const tag = el.tagName.toLowerCase();
        let text = el.innerText?.trim() ?? '';
        if (!text) continue;
        if (tag.startsWith('h')) {
          const level = parseInt(tag[1], 10);
          text = '${'#'.repeat(1)}' + '#'.repeat(level) + ' ' + text;
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

async function extractCitations(runtime: Runtime): Promise<Citation[]> {
  const citationSel = JSON.stringify(CITATION_SELECTOR);
  const result = await runtime.evaluate({
    expression: `(() => {
      const citations = document.querySelectorAll(${citationSel});
      const results = [];
      let index = 1;
      for (const el of citations) {
        const label = el.textContent?.trim() ?? '';
        if (!label) continue;
        // Try to find an anchor link parent or nearby
        const anchor = el.closest('a') ?? el.querySelector('a');
        const url = anchor?.href ?? null;
        results.push({ index, label, url });
        index++;
      }
      // Also try to extract from a Sources panel/tab if present
      const sourceLinks = document.querySelectorAll('[role="tabpanel"] a[href^="http"]');
      const urlSet = new Set(results.map(r => r.url).filter(Boolean));
      for (const link of sourceLinks) {
        const href = link.href;
        if (href && !urlSet.has(href) && !href.includes('perplexity.ai')) {
          // This is a source link not yet captured
          const linkLabel = link.textContent?.trim() || new URL(href).hostname;
          results.push({ index, label: linkLabel, url: href });
          urlSet.add(href);
          index++;
        }
      }
      return results;
    })()`,
    returnByValue: true,
  });

  const raw = result.result?.value;
  if (!Array.isArray(raw)) return [];
  return raw as Citation[];
}
