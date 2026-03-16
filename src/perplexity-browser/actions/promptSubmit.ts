import type { Page } from "playwright-core";
import type { BrowserLogger } from "../../browser/types.js";
import { BrowserAutomationError } from "../../oracle/errors.js";
import { PROMPT_SELECTORS, SUBMIT_BUTTON_SELECTORS } from "../constants.js";

/**
 * Submit a prompt to Perplexity via the Lexical rich-text editor.
 *
 * Lexical uses contenteditable divs (not <textarea>), so we:
 * 1. Focus the editor
 * 2. Fire a beforeinput event (Lexical's only reliable input path)
 * 3. Verify text landed
 * 4. Click submit button
 */
export async function submitPerplexityPrompt(
  page: Page,
  prompt: string,
  log?: BrowserLogger,
): Promise<void> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new BrowserAutomationError("Prompt text is required", { stage: "prompt-submit" });
  }

  log?.(`[perplexity-browser] Submitting prompt (${trimmedPrompt.length} chars)`);

  // 1. Wait for the Lexical editor to appear (poll up to 15s for React hydration)
  const editorWaitDeadline = Date.now() + 15_000;
  let editorFound = false;

  while (Date.now() < editorWaitDeadline) {
    editorFound = await page.evaluate((selectors: string[]) => {
      for (const sel of selectors) {
        const editor = document.querySelector(sel) as HTMLElement | null;
        if (editor) {
          editor.focus();
          const s = window.getSelection();
          if (s && editor.lastChild) {
            s.collapse(editor.lastChild, editor.lastChild.textContent?.length ?? 0);
          } else if (s) {
            s.collapse(editor, 0);
          }
          return true;
        }
      }
      return false;
    }, PROMPT_SELECTORS);
    if (editorFound) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!editorFound) {
    throw new BrowserAutomationError(
      "Could not find the Perplexity prompt editor. The UI may have changed — update PROMPT_SELECTORS.",
      { stage: "prompt-submit" },
    );
  }

  // 2. Insert text via Lexical's beforeinput event pipeline.
  await page.evaluate(
    (args: { selectors: string[]; text: string }) => {
      for (const sel of args.selectors) {
        const editor = document.querySelector(sel) as HTMLElement | null;
        if (editor) {
          editor.focus();
          const s = window.getSelection();
          if (s) {
            s.selectAllChildren(editor);
            s.collapseToEnd();
          }
          const ev = new InputEvent("beforeinput", {
            inputType: "insertText",
            data: args.text,
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          editor.dispatchEvent(ev);
          return;
        }
      }
    },
    { selectors: PROMPT_SELECTORS, text: trimmedPrompt },
  );

  // Settle for Lexical to process
  await new Promise((r) => setTimeout(r, 600));

  // 3. Verify text landed in Lexical's state
  const hasText = await page.evaluate((selectors: string[]) => {
    for (const sel of selectors) {
      const editor = document.querySelector(sel) as HTMLElement | null;
      if (editor) {
        const text = editor.innerText?.trim() ?? "";
        if (text.length > 0) return true;
      }
    }
    return false;
  }, PROMPT_SELECTORS);

  if (!hasText) {
    // Fallback: execCommand
    log?.("[perplexity-browser] beforeinput did not land; trying execCommand fallback");
    await page.evaluate(
      (args: { selectors: string[]; text: string }) => {
        for (const sel of args.selectors) {
          const editor = document.querySelector(sel) as HTMLElement | null;
          if (editor) {
            editor.focus();
            document.execCommand("insertText", false, args.text);
            return;
          }
        }
      },
      { selectors: PROMPT_SELECTORS, text: trimmedPrompt },
    );
    await new Promise((r) => setTimeout(r, 400));

    // Last resort: Playwright keyboard.type
    const stillEmpty = await page.evaluate((selectors: string[]) => {
      for (const sel of selectors) {
        const editor = document.querySelector(sel) as HTMLElement | null;
        if (editor && (editor.innerText?.trim() ?? "").length > 0) return false;
      }
      return true;
    }, PROMPT_SELECTORS);

    if (stillEmpty) {
      log?.("[perplexity-browser] execCommand did not land; trying keyboard.type");
      await page.keyboard.type(trimmedPrompt);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // 4. Wait for submit button to become enabled
  const enableDeadline = Date.now() + 5_000;
  while (Date.now() < enableDeadline) {
    const enabled = await page.evaluate((selectors: string[]) => {
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLButtonElement | null;
        if (btn && !btn.disabled) return true;
      }
      return false;
    }, SUBMIT_BUTTON_SELECTORS);
    if (enabled) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const submitResult = await page.evaluate((selectors: string[]) => {
    for (const sel of selectors) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        btn.click();
        return { clicked: true, selector: sel };
      }
    }
    // Fallback: find any button near the editor that looks like submit
    const editors = document.querySelectorAll('[data-lexical-editor][contenteditable="true"]');
    for (const editor of editors) {
      const container = editor.closest("form") ?? editor.parentElement?.parentElement;
      if (container) {
        const buttons = container.querySelectorAll("button:not([disabled])");
        for (const btn of buttons) {
          const svg = btn.querySelector("svg");
          if (svg && !btn.textContent?.trim()) {
            (btn as HTMLElement).click();
            return { clicked: true, selector: "fallback-icon-button" };
          }
        }
      }
    }
    // Diagnostic info
    const editorText =
      (document.querySelector("[data-lexical-editor]") as HTMLElement)?.innerText?.slice(0, 100) ??
      "(no editor)";
    const allBtns = Array.from(document.querySelectorAll("button"))
      .slice(0, 30)
      .map((b) => ({
        aria: b.getAttribute("aria-label"),
        disabled: b.disabled,
        text: (b.textContent?.trim() ?? "").slice(0, 40),
        hasSvg: !!b.querySelector("svg"),
      }));
    return { clicked: false, editorText, buttons: allBtns };
  }, SUBMIT_BUTTON_SELECTORS);

  if (!submitResult?.clicked) {
    const diag = submitResult as {
      editorText?: string;
      buttons?: Array<{ aria: string | null; disabled: boolean; text: string; hasSvg: boolean }>;
    };
    const editorText = diag?.editorText ?? "(unknown)";
    const buttons = (diag?.buttons ?? [])
      .map((b) => `[aria="${b.aria}" disabled=${b.disabled} svg=${b.hasSvg} "${b.text}"]`)
      .join("\n  ");
    throw new BrowserAutomationError(
      `Could not find or click the Perplexity submit button.\n` +
        `Editor text: "${editorText}"\n` +
        `Buttons found:\n  ${buttons || "(none)"}`,
      { stage: "prompt-submit" },
    );
  }

  log?.(`[perplexity-browser] Prompt submitted via ${submitResult.selector}`);
}
