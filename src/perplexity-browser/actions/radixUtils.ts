import type { Page } from "playwright-core";
import type { BrowserLogger } from "../../browser/types.js";
import { ADD_TOOLS_BUTTON_LABELS } from "../constants.js";

/**
 * Open the [+] "Add tools" Radix menu via pointer events.
 * Shared between deepResearch and sourceFilter actions.
 */
export async function openAddToolsMenu(page: Page, log?: BrowserLogger): Promise<boolean> {
  const found = await page.evaluate((labels: string[]) => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const label = btn.getAttribute("aria-label") ?? "";
      if (labels.some((l) => label.includes(l))) {
        const rect = btn.getBoundingClientRect();
        const evt = {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2,
        };
        btn.dispatchEvent(new PointerEvent("pointerdown", evt));
        btn.dispatchEvent(new MouseEvent("mousedown", evt));
        btn.dispatchEvent(new PointerEvent("pointerup", evt));
        btn.dispatchEvent(new MouseEvent("mouseup", evt));
        btn.dispatchEvent(new MouseEvent("click", evt));
        return true;
      }
    }
    return false;
  }, ADD_TOOLS_BUTTON_LABELS);

  if (!found) {
    log?.('[perplexity-browser] Could not find "Add tools" button');
    return false;
  }

  await new Promise((r) => setTimeout(r, 500));
  return true;
}

/**
 * Dismiss an open Radix menu by clicking on <main> with pointer events.
 */
export async function dismissRadixMenu(page: Page): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const evt = { bubbles: true, cancelable: true, clientX: 10, clientY: 10 };
    main.dispatchEvent(new PointerEvent("pointerdown", evt));
    main.dispatchEvent(new MouseEvent("mousedown", evt));
    main.dispatchEvent(new PointerEvent("pointerup", evt));
    main.dispatchEvent(new MouseEvent("mouseup", evt));
  });
  await new Promise((r) => setTimeout(r, 300));
}
