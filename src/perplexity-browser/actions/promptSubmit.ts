import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import { PROMPT_SELECTORS, SUBMIT_BUTTON_SELECTORS } from '../constants.js';

type Runtime = ChromeClient['Runtime'];
type Input = ChromeClient['Input'];

/**
 * Submit a prompt to Perplexity via the Lexical rich-text editor.
 *
 * Lexical uses contenteditable divs (not <textarea>), so we:
 * 1. Focus the editor
 * 2. Use CDP Input.insertText (works with contenteditable)
 * 3. Verify text landed
 * 4. Click submit button
 */
export async function submitPerplexityPrompt(
  runtime: Runtime,
  input: Input,
  prompt: string,
  log?: BrowserLogger,
): Promise<void> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new BrowserAutomationError('Prompt text is required', { stage: 'prompt-submit' });
  }

  log?.(`[perplexity-browser] Submitting prompt (${trimmedPrompt.length} chars)`);

  // 1. Focus the Lexical editor
  const selectors = JSON.stringify(PROMPT_SELECTORS);
  const focusResult = await runtime.evaluate({
    expression: `(() => {
      const selectors = ${selectors};
      let editor = null;
      for (const sel of selectors) {
        editor = document.querySelector(sel);
        if (editor) break;
      }
      if (!editor) return { found: false };
      editor.focus();
      // Collapse selection to end
      const sel = window.getSelection();
      if (sel && editor.lastChild) {
        sel.collapse(editor.lastChild, editor.lastChild.textContent?.length ?? 0);
      } else if (sel) {
        sel.collapse(editor, 0);
      }
      return { found: true };
    })()`,
    returnByValue: true,
  });

  if (!focusResult.result?.value?.found) {
    throw new BrowserAutomationError(
      'Could not find the Perplexity prompt editor. The UI may have changed — update PROMPT_SELECTORS.',
      { stage: 'prompt-submit' },
    );
  }

  // 2. Insert text via CDP (works with contenteditable)
  await input.insertText({ text: trimmedPrompt });

  // Brief settle for Lexical to process the input
  await new Promise((r) => setTimeout(r, 400));

  // 3. Verify text landed in the editor
  const verifyResult = await runtime.evaluate({
    expression: `(() => {
      const selectors = ${selectors};
      for (const sel of selectors) {
        const editor = document.querySelector(sel);
        if (editor) {
          const text = editor.innerText?.trim() ?? '';
          if (text.length > 0) return { hasText: true, length: text.length };
        }
      }
      return { hasText: false };
    })()`,
    returnByValue: true,
  });

  if (!verifyResult.result?.value?.hasText) {
    // Fallback: set textContent directly and fire input event (Lexical listens to these)
    log?.('[perplexity-browser] Input.insertText did not land; trying textContent fallback');
    const encodedPrompt = JSON.stringify(trimmedPrompt);
    await runtime.evaluate({
      expression: `(() => {
        const selectors = ${selectors};
        for (const sel of selectors) {
          const editor = document.querySelector(sel);
          if (editor) {
            editor.focus();
            // Use execCommand which Lexical hooks into
            document.execCommand('insertText', false, ${encodedPrompt});
            return true;
          }
        }
        return false;
      })()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  // 4. Click submit button
  await new Promise((r) => setTimeout(r, 300));
  const submitSelectors = JSON.stringify(SUBMIT_BUTTON_SELECTORS);
  const submitResult = await runtime.evaluate({
    expression: `(() => {
      const selectors = ${submitSelectors};
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
          btn.click();
          return { clicked: true, selector: sel };
        }
      }
      // Fallback: find any button near the editor that looks like submit
      // (handle localized aria-labels we don't know about)
      const editors = document.querySelectorAll('[data-lexical-editor][contenteditable="true"]');
      for (const editor of editors) {
        const container = editor.closest('form') ?? editor.parentElement?.parentElement;
        if (container) {
          const buttons = container.querySelectorAll('button:not([disabled])');
          for (const btn of buttons) {
            const svg = btn.querySelector('svg');
            if (svg && !btn.textContent?.trim()) {
              // Icon-only button near editor — likely submit
              btn.click();
              return { clicked: true, selector: 'fallback-icon-button' };
            }
          }
        }
      }
      return { clicked: false };
    })()`,
    returnByValue: true,
  });

  if (!submitResult.result?.value?.clicked) {
    throw new BrowserAutomationError(
      'Could not find or click the Perplexity submit button. It may be disabled or the UI changed.',
      { stage: 'prompt-submit' },
    );
  }

  log?.(`[perplexity-browser] Prompt submitted via ${submitResult.result.value.selector}`);
}
