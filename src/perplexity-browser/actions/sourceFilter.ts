import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import {
  ADD_TOOLS_BUTTON_LABELS,
  CONNECTORS_MENUITEM_TEXTS,
  SOURCE_ICON_IDS,
  SOCIAL_SOURCE_TEXTS,
} from '../constants.js';

/**
 * Enable the Social source filter in Perplexity's search.
 *
 * Access path: click [+] button → "Connectors & Sources" submenu → find Social toggle.
 *
 * Strategies (tried in order):
 * 1. SVG icon ID match on [role="menuitemcheckbox"]
 * 2. Text match ("Social") on any clickable element in the open menu/submenu
 */
export async function enableSocialSource(
  page: Page,
  log?: BrowserLogger,
): Promise<void> {
  // Step 1: Open the [+] "Add tools" menu (pointer events required for Radix)
  const openResult = await page.evaluate((labels: string[]) => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') ?? '';
      if (labels.some(l => label.includes(l))) {
        const rect = btn.getBoundingClientRect();
        const evt = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
        btn.dispatchEvent(new PointerEvent('pointerdown', evt));
        btn.dispatchEvent(new MouseEvent('mousedown', evt));
        btn.dispatchEvent(new PointerEvent('pointerup', evt));
        btn.dispatchEvent(new MouseEvent('mouseup', evt));
        btn.dispatchEvent(new MouseEvent('click', evt));
        return { found: true, label };
      }
    }
    return { found: false };
  }, ADD_TOOLS_BUTTON_LABELS);

  if (!openResult?.found) {
    log?.('[perplexity-browser] Could not find "Add tools" button — skipping social source toggle');
    return;
  }

  await new Promise((r) => setTimeout(r, 500));

  // Step 2: Click "Connectors & Sources" submenu (pointer events for Radix)
  const subResult = await page.evaluate((texts: string[]) => {
    const clickRadix = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const evt = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', evt));
      el.dispatchEvent(new MouseEvent('mousedown', evt));
      el.dispatchEvent(new PointerEvent('pointerup', evt));
      el.dispatchEvent(new MouseEvent('mouseup', evt));
      el.dispatchEvent(new MouseEvent('click', evt));
    };
    // Try [role="menuitem"] first
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      const text = item.textContent?.trim() ?? '';
      if (texts.some(t => text.includes(t))) {
        clickRadix(item as HTMLElement);
        return { found: true, text };
      }
    }
    // Fallback: search inside Radix popper or open popover
    const scope = document.querySelector('[data-radix-popper-content-wrapper]')
      || document.querySelector('[data-state="open"][role="dialog"]')
      || document.querySelector('[data-state="open"]');
    if (scope) {
      for (const el of scope.querySelectorAll('div, button')) {
        const text = el.textContent?.trim() ?? '';
        if (texts.some(t => text.includes(t)) && el.children.length < 10) {
          clickRadix(el as HTMLElement);
          return { found: true, text };
        }
      }
    }
    return { found: false };
  }, CONNECTORS_MENUITEM_TEXTS);

  if (!subResult?.found) {
    log?.('[perplexity-browser] Could not find "Connectors & Sources" menuitem — skipping');
    await dismissMenu(page);
    return;
  }

  await new Promise((r) => setTimeout(r, 500));

  // Step 3: Find Social toggle — by icon or text (pointer events for Radix)
  const toggleResult = await page.evaluate((args: { iconId: string; texts: string[] }) => {
    const clickRadix = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const evt = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', evt));
      el.dispatchEvent(new MouseEvent('mousedown', evt));
      el.dispatchEvent(new PointerEvent('pointerup', evt));
      el.dispatchEvent(new MouseEvent('mouseup', evt));
      el.dispatchEvent(new MouseEvent('click', evt));
    };

    // Strategy 1: SVG icon match on [role="menuitemcheckbox"]
    for (const u of document.querySelectorAll('[role="menuitemcheckbox"] use')) {
      const href = u.getAttribute('xlink:href') || u.getAttribute('href');
      if (href === args.iconId) {
        const checkbox = u.closest('[role="menuitemcheckbox"]') as HTMLElement;
        if (!checkbox) continue;
        const checked = checkbox.getAttribute('aria-checked') === 'true' || checkbox.getAttribute('data-state') === 'checked';
        if (checked) return { found: true, alreadyChecked: true };
        clickRadix(checkbox);
        return { found: true, alreadyChecked: false };
      }
    }

    // Strategy 2: Text match on any toggle/button in the menu
    const scope = document.querySelector('[data-radix-popper-content-wrapper]')
      || document.querySelector('[data-state="open"]')
      || document;
    for (const el of scope.querySelectorAll('button, [role="menuitemcheckbox"], [role="switch"], [role="checkbox"]')) {
      const text = el.closest('[class*="col-start"]')?.parentElement?.textContent?.trim()
        ?? el.parentElement?.textContent?.trim()
        ?? el.textContent?.trim()
        ?? '';
      if (args.texts.some(t => text.includes(t))) {
        const checked = el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
        if (checked) return { found: true, alreadyChecked: true };
        clickRadix(el as HTMLElement);
        return { found: true, alreadyChecked: false };
      }
    }

    return { found: false };
  }, { iconId: SOURCE_ICON_IDS.social, texts: SOCIAL_SOURCE_TEXTS });

  if (!toggleResult?.found) {
    log?.('[perplexity-browser] Could not find Social source checkbox — skipping');
  } else if (toggleResult.alreadyChecked) {
    log?.('[perplexity-browser] Social source already enabled');
  } else {
    log?.('[perplexity-browser] Enabled Social source filter');
  }

  await dismissMenu(page);
}

async function dismissMenu(page: Page): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const evt = { bubbles: true, cancelable: true, clientX: 10, clientY: 10 };
    main.dispatchEvent(new PointerEvent('pointerdown', evt));
    main.dispatchEvent(new MouseEvent('mousedown', evt));
    main.dispatchEvent(new PointerEvent('pointerup', evt));
    main.dispatchEvent(new MouseEvent('mouseup', evt));
  });
  await new Promise((r) => setTimeout(r, 300));
}
