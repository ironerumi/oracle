import type { Page } from "playwright-core";
import type { BrowserLogger } from "../../browser/types.js";
import { BrowserAutomationError } from "../../oracle/errors.js";
import {
  MODEL_PICKER_BUTTON_TEXTS,
  MODEL_PICKER_SELECTORS,
  PERPLEXITY_MODEL_LABELS,
  PERPLEXITY_THINKING_MODELS,
} from "../constants.js";

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="listbox"] button, [data-radix-collection-root] button';

/**
 * Select a Perplexity model via the web UI picker.
 *
 * All clicks use pointer event dispatch via page.evaluate — never Playwright's
 * coordinate-based locator.click(). Perplexity's sidebar thread list can
 * visually overlap the toolbar, and Playwright's actionability checks fail
 * when another element intercepts pointer events at the target coordinates.
 * Direct dispatchEvent bypasses this entirely.
 */
export async function selectPerplexityModel(
  page: Page,
  desiredModel: string | null | undefined,
  log?: BrowserLogger,
): Promise<void> {
  const raw = desiredModel?.trim() ?? "";
  const model = raw.toLowerCase() || "ppl/sonar";
  const knownLabels = PERPLEXITY_MODEL_LABELS[model];

  // Known model → use locale-aware labels; unknown → use raw string as picker label passthrough.
  const labels = knownLabels ?? (raw ? [raw] : null);

  if (!labels) {
    log?.(`[perplexity-browser] No model specified and no default — skipping model picker.`);
    return;
  }

  // Find the picker button (returns its text, or null if not found)
  const currentText = await findPickerButton(page);
  if (currentText === null) {
    if (model === "ppl/sonar" || model.startsWith("ppl/sonar")) {
      log?.(
        "[perplexity-browser] Model picker button not found, but sonar is the default. Continuing.",
      );
      return;
    }
    throw new BrowserAutomationError(
      "Could not find the Perplexity model picker button. The UI may have changed.",
      { stage: "model-selection" },
    );
  }

  // Check if the current model already matches
  const alreadySelected = labels.some((t) => currentText.includes(t));
  if (alreadySelected) {
    log?.(`[perplexity-browser] Model already set to "${currentText}" — matches ${model}`);
    return;
  }

  // Open picker via pointer events (immune to sidebar overlap)
  log?.(`[perplexity-browser] Current model is "${currentText}", need to switch to ${model}`);
  await dispatchRadixClick(page, '[data-oracle-picker="true"]');
  await page.waitForTimeout(600);

  // Scan menu items and click the match — all in page context
  const result = await page.evaluate(
    (args: { targetLabels: string[]; checkMaxDisabled: boolean; sel: string }) => {
      function clickRadix(el: HTMLElement) {
        const rect = el.getBoundingClientRect();
        const evt = {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2,
        };
        el.dispatchEvent(new PointerEvent("pointerdown", evt));
        el.dispatchEvent(new MouseEvent("mousedown", evt));
        el.dispatchEvent(new PointerEvent("pointerup", evt));
        el.dispatchEvent(new MouseEvent("mouseup", evt));
        el.dispatchEvent(new MouseEvent("click", evt));
      }
      const candidates = document.querySelectorAll(args.sel);
      const available: string[] = [];
      let matchIndex = -1;
      let matchDisabled = false;

      for (let i = 0; i < candidates.length; i++) {
        const text = candidates[i].textContent?.trim() ?? "";
        if (text) available.push(text);
        if (matchIndex === -1 && args.targetLabels.some((t) => text.includes(t))) {
          matchIndex = i;
          if (args.checkMaxDisabled) {
            const el = candidates[i] as HTMLElement;
            matchDisabled =
              el.hasAttribute("disabled") ||
              el.getAttribute("aria-disabled") === "true" ||
              el.dataset?.disabled != null;
          }
        }
      }

      if (matchIndex >= 0 && !matchDisabled) {
        clickRadix(candidates[matchIndex] as HTMLElement);
      }
      return { matchIndex, matchDisabled, available: available.slice(0, 15) };
    },
    {
      targetLabels: labels,
      checkMaxDisabled: model === "ppl/claude-opus-4.6",
      sel: MENU_ITEM_SELECTOR,
    },
  );

  if (result.matchIndex === -1) {
    await page.keyboard.press("Escape");
    throw new BrowserAutomationError(
      `Could not find model matching ${JSON.stringify(labels)} in picker. ` +
        `Available: ${result.available.join(", ") || "(none)"}. ` +
        "Update PERPLEXITY_MODEL_LABELS in constants.ts.",
      { stage: "model-selection" },
    );
  }

  await page.waitForTimeout(300);
  log?.(
    `[perplexity-browser] Model switched to: ${result.available[result.matchIndex] ?? "unknown"}`,
  );

  // Thinking toggle
  if (model in PERPLEXITY_THINKING_MODELS) {
    const thinkingResult = await activateThinkingToggle(page, log);
    if (thinkingResult === "activated") {
      log?.("[perplexity-browser] Thinking toggle activated");
    } else if (thinkingResult === "already-on") {
      log?.("[perplexity-browser] Thinking toggle already ON");
    } else {
      log?.("[perplexity-browser] Thinking toggle not found in picker (may not be available)");
    }
  }
}

/**
 * Dispatch a full Radix-compatible pointer event sequence on a selector.
 * Immune to sidebar overlap — events target the element directly.
 */
async function dispatchRadixClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const evt = {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", evt));
    el.dispatchEvent(new MouseEvent("mousedown", evt));
    el.dispatchEvent(new PointerEvent("pointerup", evt));
    el.dispatchEvent(new MouseEvent("mouseup", evt));
    el.dispatchEvent(new MouseEvent("click", evt));
  }, selector);
}

/**
 * Find the model picker button. Returns its text content, or null if not found.
 * Tags the element with data-oracle-picker for subsequent clicks.
 *
 * Both the fast path (aria-label selectors) and structural path (text match)
 * stamp the attribute — no divergence.
 */
async function findPickerButton(page: Page): Promise<string | null> {
  // Wait for React hydration — picker renders after editor
  await page
    .locator("[data-lexical-editor]")
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(1000);

  // Single evaluate: try aria-label selectors first, then text-match structural approach.
  // Both paths stamp data-oracle-picker on the found element.
  return page.evaluate(
    (args: { selectors: string[]; knownTexts: string[] }) => {
      // Fast path: aria-label selectors
      for (const sel of args.selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          (btn as HTMLElement).setAttribute("data-oracle-picker", "true");
          return btn.textContent?.trim() ?? "";
        }
      }
      // Structural: button[aria-haspopup="menu"] with known model text
      for (const btn of document.querySelectorAll('button[aria-haspopup="menu"]')) {
        const text = btn.textContent?.trim() ?? "";
        const label = btn.getAttribute("aria-label") ?? "";
        if (args.knownTexts.some((t) => text.includes(t) || label.includes(t))) {
          (btn as HTMLElement).setAttribute("data-oracle-picker", "true");
          return text;
        }
      }
      return null;
    },
    { selectors: MODEL_PICKER_SELECTORS, knownTexts: MODEL_PICKER_BUTTON_TEXTS },
  );
}

async function activateThinkingToggle(
  page: Page,
  _log?: BrowserLogger,
): Promise<"activated" | "already-on" | "not-found"> {
  // Use evaluate to find and click — same pattern, immune to overlap
  return page.evaluate(() => {
    const checkbox = document.querySelector('[role="menuitemcheckbox"]');
    if (!checkbox) return "not-found" as const;
    const sw = checkbox.querySelector('button[role="switch"]');
    if (!sw) return "not-found" as const;

    const checked = sw.getAttribute("aria-checked");
    if (checked === "false") {
      const rect = (sw as HTMLElement).getBoundingClientRect();
      const evt = {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      };
      sw.dispatchEvent(new PointerEvent("pointerdown", evt));
      sw.dispatchEvent(new MouseEvent("mousedown", evt));
      sw.dispatchEvent(new PointerEvent("pointerup", evt));
      sw.dispatchEvent(new MouseEvent("mouseup", evt));
      sw.dispatchEvent(new MouseEvent("click", evt));
      return "activated" as const;
    }
    return "already-on" as const;
  });
}
