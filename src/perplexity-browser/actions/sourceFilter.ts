import type { Page } from "playwright-core";
import type { BrowserLogger } from "../../browser/types.js";
import { CONNECTORS_MENUITEM_TEXTS, SOURCE_ICON_IDS, SOCIAL_SOURCE_TEXTS } from "../constants.js";
import { openAddToolsMenu, dismissRadixMenu } from "./radixUtils.js";

/**
 * Enable the Social source filter in Perplexity's search.
 *
 * Access path: click [+] button → "Connectors & Sources" submenu → find Social toggle.
 *
 * Strategies (tried in order):
 * 1. SVG icon ID match on [role="menuitemcheckbox"]
 * 2. Text match ("Social") on any clickable element in the open menu/submenu
 */
export async function enableSocialSource(page: Page, log?: BrowserLogger): Promise<void> {
  // Step 1: Open the [+] "Add tools" menu
  if (!(await openAddToolsMenu(page, log))) {
    log?.('[perplexity-browser] Skipping social source toggle — "Add tools" button not found');
    return;
  }

  // Step 2: Click "Connectors & Sources" submenu (pointer events for Radix)
  const subResult = await page.evaluate((texts: string[]) => {
    // Use function expression (not const =>) to avoid esbuild __name() decoration leaking into page context
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
    // Try [role="menuitem"] first
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      const text = item.textContent?.trim() ?? "";
      if (texts.some((t) => text.includes(t))) {
        clickRadix(item as HTMLElement);
        return { found: true, text };
      }
    }
    // Fallback: search inside Radix popper or open popover
    const scope =
      document.querySelector("[data-radix-popper-content-wrapper]") ||
      document.querySelector('[data-state="open"][role="dialog"]') ||
      document.querySelector('[data-state="open"]');
    if (scope) {
      for (const el of scope.querySelectorAll("div, button")) {
        const text = el.textContent?.trim() ?? "";
        if (texts.some((t) => text.includes(t)) && el.children.length < 10) {
          clickRadix(el as HTMLElement);
          return { found: true, text };
        }
      }
    }
    return { found: false };
  }, CONNECTORS_MENUITEM_TEXTS);

  if (!subResult?.found) {
    log?.('[perplexity-browser] Could not find "Connectors & Sources" menuitem — skipping');
    await dismissRadixMenu(page);
    return;
  }

  await new Promise((r) => setTimeout(r, 500));

  // Step 3: Find Social toggle — by icon or text (pointer events for Radix)
  const toggleResult = await page.evaluate(
    (args: { iconId: string; texts: string[] }) => {
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

      // Strategy 1: SVG icon match on [role="menuitemcheckbox"]
      for (const u of document.querySelectorAll('[role="menuitemcheckbox"] use')) {
        const href = u.getAttribute("xlink:href") || u.getAttribute("href");
        if (href === args.iconId) {
          const checkbox = u.closest('[role="menuitemcheckbox"]') as HTMLElement;
          if (!checkbox) continue;
          const checked =
            checkbox.getAttribute("aria-checked") === "true" ||
            checkbox.getAttribute("data-state") === "checked";
          if (checked) return { found: true, alreadyChecked: true };
          clickRadix(checkbox);
          return { found: true, alreadyChecked: false };
        }
      }

      // Strategy 2: Text match on any toggle/button in the menu
      const scope =
        document.querySelector("[data-radix-popper-content-wrapper]") ||
        document.querySelector('[data-state="open"]') ||
        document;
      for (const el of scope.querySelectorAll(
        'button, [role="menuitemcheckbox"], [role="switch"], [role="checkbox"]',
      )) {
        const text =
          el.closest('[class*="col-start"]')?.parentElement?.textContent?.trim() ??
          el.parentElement?.textContent?.trim() ??
          el.textContent?.trim() ??
          "";
        if (args.texts.some((t) => text.includes(t))) {
          const checked =
            el.getAttribute("aria-checked") === "true" ||
            el.getAttribute("data-state") === "checked";
          if (checked) return { found: true, alreadyChecked: true };
          clickRadix(el as HTMLElement);
          return { found: true, alreadyChecked: false };
        }
      }

      return { found: false };
    },
    { iconId: SOURCE_ICON_IDS.social, texts: SOCIAL_SOURCE_TEXTS },
  );

  if (!toggleResult?.found) {
    log?.("[perplexity-browser] Could not find Social source checkbox — skipping");
  } else if (toggleResult.alreadyChecked) {
    log?.("[perplexity-browser] Social source already enabled");
  } else {
    log?.("[perplexity-browser] Enabled Social source filter");
  }

  await dismissRadixMenu(page);
}
