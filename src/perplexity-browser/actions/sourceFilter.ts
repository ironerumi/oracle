import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import {
  ADD_TOOLS_BUTTON_LABELS,
  CONNECTORS_MENUITEM_TEXTS,
  SOURCE_ICON_IDS,
} from '../constants.js';

/**
 * Enable the Social source filter in Perplexity's search.
 *
 * Access path: click "Add files or tools" button → "Connectors & Sources" submenu
 * → find Social checkbox by SVG icon ID (#pplx-icon-social) → toggle if unchecked.
 *
 * The Social source is always enabled by default for richer search results.
 */
export async function enableSocialSource(
  page: Page,
  log?: BrowserLogger,
): Promise<void> {
  // Step 1: Open the "Add files or tools" menu
  const openResult = await page.evaluate((labels: string[]) => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') ?? '';
      if (labels.some(l => label.includes(l))) {
        btn.click();
        return { found: true, label };
      }
    }
    return { found: false };
  }, ADD_TOOLS_BUTTON_LABELS);

  if (!openResult?.found) {
    log?.('[perplexity-browser] Could not find "Add tools" button — skipping social source toggle');
    return;
  }

  // Wait for menu to render
  await new Promise((r) => setTimeout(r, 500));

  // Step 2: Click "Connectors & Sources" submenu
  const subResult = await page.evaluate((texts: string[]) => {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      const text = item.textContent?.trim() ?? '';
      if (texts.some(t => text.includes(t))) {
        (item as HTMLElement).click();
        return { found: true, text };
      }
    }
    return { found: false };
  }, CONNECTORS_MENUITEM_TEXTS);

  if (!subResult?.found) {
    log?.('[perplexity-browser] Could not find "Connectors & Sources" menuitem — skipping');
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    return;
  }

  // Wait for submenu to render
  await new Promise((r) => setTimeout(r, 500));

  // Step 3: Find Social checkbox by SVG icon and toggle if unchecked
  const toggleResult = await page.evaluate((socialIconId: string) => {
    const uses = document.querySelectorAll('[role="menuitemcheckbox"] use');
    for (const u of uses) {
      const href = u.getAttribute('xlink:href') || u.getAttribute('href');
      if (href === socialIconId) {
        const checkbox = u.closest('[role="menuitemcheckbox"]');
        if (!checkbox) return { found: false };
        const checked = checkbox.getAttribute('aria-checked') === 'true';
        if (checked) return { found: true, alreadyChecked: true };
        (checkbox as HTMLElement).click();
        return { found: true, alreadyChecked: false };
      }
    }
    return { found: false };
  }, SOURCE_ICON_IDS.social);

  if (!toggleResult?.found) {
    log?.('[perplexity-browser] Could not find Social source checkbox — skipping');
  } else if (toggleResult.alreadyChecked) {
    log?.('[perplexity-browser] Social source already enabled');
  } else {
    log?.('[perplexity-browser] Enabled Social source filter');
  }

  // Step 4: Close menu by clicking the page body
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    (main as HTMLElement).click();
    const evt = { bubbles: true, cancelable: true, clientX: 10, clientY: 10 };
    main.dispatchEvent(new PointerEvent('pointerdown', evt));
    main.dispatchEvent(new MouseEvent('mousedown', evt));
    main.dispatchEvent(new PointerEvent('pointerup', evt));
    main.dispatchEvent(new MouseEvent('mouseup', evt));
  });
  await new Promise((r) => setTimeout(r, 300));
}
