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

  // 1. Wait for the Lexical editor to appear (poll up to 15s for React hydration)
  const selectors = JSON.stringify(PROMPT_SELECTORS);
  const editorWaitDeadline = Date.now() + 15_000;
  let focusResult: Awaited<ReturnType<typeof runtime.evaluate>> | null = null;

  while (Date.now() < editorWaitDeadline) {
    focusResult = await runtime.evaluate({
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
    if (focusResult.result?.value?.found) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!focusResult?.result?.value?.found) {
    throw new BrowserAutomationError(
      'Could not find the Perplexity prompt editor. The UI may have changed — update PROMPT_SELECTORS.',
      { stage: 'prompt-submit' },
    );
  }

  // 2. Insert text via Lexical's beforeinput event pipeline.
  //    Lexical manages its own virtual state tree and only responds to
  //    beforeinput events with inputType='insertText' — not execCommand,
  //    not CDP Input.insertText, not DOM mutations.
  const encodedPrompt = JSON.stringify(trimmedPrompt);
  await runtime.evaluate({
    expression: `(() => {
      const selectors = ${selectors};
      for (const sel of selectors) {
        const editor = document.querySelector(sel);
        if (editor) {
          editor.focus();
          const s = window.getSelection();
          if (s) { s.selectAllChildren(editor); s.collapseToEnd(); }
          // Lexical hooks into beforeinput — this is the only reliable way
          const ev = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: ${encodedPrompt},
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          editor.dispatchEvent(ev);
          return { method: 'beforeinput' };
        }
      }
      return { method: 'none' };
    })()`,
    returnByValue: true,
  });

  // Settle for Lexical to process
  await new Promise((r) => setTimeout(r, 600));

  // 3. Verify text landed in Lexical's state (check both DOM and submit button)
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
    // Fallback chain: execCommand, then CDP Input.insertText
    log?.('[perplexity-browser] beforeinput did not land; trying execCommand fallback');
    await runtime.evaluate({
      expression: `(() => {
        const selectors = ${selectors};
        for (const sel of selectors) {
          const editor = document.querySelector(sel);
          if (editor) {
            editor.focus();
            document.execCommand('insertText', false, ${encodedPrompt});
            return true;
          }
        }
        return false;
      })()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 400));

    // If still nothing, try CDP Input.insertText as last resort
    const recheck = await runtime.evaluate({
      expression: `(() => {
        const selectors = ${selectors};
        for (const sel of selectors) {
          const editor = document.querySelector(sel);
          if (editor && (editor.innerText?.trim() ?? '').length > 0) return true;
        }
        return false;
      })()`,
      returnByValue: true,
    });
    if (!recheck.result?.value) {
      log?.('[perplexity-browser] execCommand did not land; trying CDP Input.insertText');
      await input.insertText({ text: trimmedPrompt });
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // 4. Wait for submit button to become enabled (Lexical state update may take a tick)
  const submitSelectors = JSON.stringify(SUBMIT_BUTTON_SELECTORS);
  const enableDeadline = Date.now() + 5_000;
  while (Date.now() < enableDeadline) {
    const check = await runtime.evaluate({
      expression: `(() => {
        const selectors = ${submitSelectors};
        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled) return true;
        }
        return false;
      })()`,
      returnByValue: true,
    });
    if (check.result?.value === true) break;
    await new Promise((r) => setTimeout(r, 300));
  }

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
      // Collect diagnostic info
      const editorText = document.querySelector('[data-lexical-editor]')?.innerText?.slice(0, 100) ?? '(no editor)';
      const allBtns = Array.from(document.querySelectorAll('button')).slice(0, 30).map(b => ({
        aria: b.getAttribute('aria-label'),
        disabled: b.disabled,
        text: (b.textContent?.trim() ?? '').slice(0, 40),
        hasSvg: !!b.querySelector('svg'),
      }));
      return { clicked: false, editorText, buttons: allBtns };
    })()`,
    returnByValue: true,
  });

  if (!submitResult.result?.value?.clicked) {
    const diag = submitResult.result?.value;
    const editorText = diag?.editorText ?? '(unknown)';
    const buttons = (diag?.buttons ?? [])
      .map((b: { aria: string | null; disabled: boolean; text: string; hasSvg: boolean }) =>
        `[aria="${b.aria}" disabled=${b.disabled} svg=${b.hasSvg} "${b.text}"]`)
      .join('\n  ');
    throw new BrowserAutomationError(
      `Could not find or click the Perplexity submit button.\n` +
      `Editor text: "${editorText}"\n` +
      `Buttons found:\n  ${buttons || '(none)'}`,
      { stage: 'prompt-submit' },
    );
  }

  log?.(`[perplexity-browser] Prompt submitted via ${submitResult.result.value.selector}`);
}
