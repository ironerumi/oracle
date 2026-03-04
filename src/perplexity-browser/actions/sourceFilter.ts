import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import {
  ADD_TOOLS_BUTTON_LABELS,
  CONNECTORS_MENUITEM_TEXTS,
  SOURCE_ICON_IDS,
} from '../constants.js';

type Runtime = ChromeClient['Runtime'];

/**
 * Enable the Social source filter in Perplexity's search.
 *
 * Access path: click "Add files or tools" button → "Connectors & Sources" submenu
 * → find Social checkbox by SVG icon ID (#pplx-icon-social) → toggle if unchecked.
 *
 * The Social source is always enabled by default for richer search results.
 */
export async function enableSocialSource(
  runtime: Runtime,
  log?: BrowserLogger,
): Promise<void> {
  const toolsLabels = JSON.stringify(ADD_TOOLS_BUTTON_LABELS);
  const connectorsTexts = JSON.stringify(CONNECTORS_MENUITEM_TEXTS);
  const socialIconId = JSON.stringify(SOURCE_ICON_IDS.social);

  // Step 1: Open the "Add files or tools" menu
  const openResult = await runtime.evaluate({
    expression: `(() => {
      const labels = ${toolsLabels};
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const label = btn.getAttribute('aria-label') ?? '';
        if (labels.some(l => label.includes(l))) {
          btn.click();
          return { found: true, label };
        }
      }
      return { found: false };
    })()`,
    returnByValue: true,
  });

  if (!openResult.result?.value?.found) {
    log?.('[perplexity-browser] Could not find "Add tools" button — skipping social source toggle');
    return;
  }

  // Wait for menu to render
  await new Promise((r) => setTimeout(r, 500));

  // Step 2: Click "Connectors & Sources" submenu
  const subResult = await runtime.evaluate({
    expression: `(() => {
      const texts = ${connectorsTexts};
      const items = document.querySelectorAll('[role="menuitem"]');
      for (const item of items) {
        const text = item.textContent?.trim() ?? '';
        if (texts.some(t => text.includes(t))) {
          item.click();
          return { found: true, text };
        }
      }
      return { found: false };
    })()`,
    returnByValue: true,
  });

  if (!subResult.result?.value?.found) {
    log?.('[perplexity-browser] Could not find "Connectors & Sources" menuitem — skipping');
    // Close menu by pressing Escape
    await runtime.evaluate({ expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))` });
    return;
  }

  // Wait for submenu to render
  await new Promise((r) => setTimeout(r, 500));

  // Step 3: Find Social checkbox by SVG icon and toggle if unchecked
  const toggleResult = await runtime.evaluate({
    expression: `(() => {
      const iconId = ${socialIconId};
      const uses = document.querySelectorAll('[role="menuitemcheckbox"] use');
      for (const u of uses) {
        const href = u.getAttribute('xlink:href') || u.getAttribute('href');
        if (href === iconId) {
          const checkbox = u.closest('[role="menuitemcheckbox"]');
          if (!checkbox) return { found: false };
          const checked = checkbox.getAttribute('aria-checked') === 'true';
          if (checked) return { found: true, alreadyChecked: true };
          checkbox.click();
          return { found: true, alreadyChecked: false };
        }
      }
      return { found: false };
    })()`,
    returnByValue: true,
  });

  const val = toggleResult.result?.value as { found: boolean; alreadyChecked?: boolean } | undefined;
  if (!val?.found) {
    log?.('[perplexity-browser] Could not find Social source checkbox — skipping');
  } else if (val.alreadyChecked) {
    log?.('[perplexity-browser] Social source already enabled');
  } else {
    log?.('[perplexity-browser] Enabled Social source filter');
  }

  // Step 4: Close menu by clicking the page body outside the menu overlay.
  // Radix UI menus don't reliably close from synthetic Escape on `document`.
  await new Promise((r) => setTimeout(r, 300));
  await runtime.evaluate({
    expression: `(() => {
      // Click on main content area to dismiss any open menu/overlay
      const main = document.querySelector('main') || document.body;
      main.click();
      // Also dispatch pointer events in case .click() alone doesn't dismiss Radix overlays
      const evt = { bubbles: true, cancelable: true, clientX: 10, clientY: 10 };
      main.dispatchEvent(new PointerEvent('pointerdown', evt));
      main.dispatchEvent(new MouseEvent('mousedown', evt));
      main.dispatchEvent(new PointerEvent('pointerup', evt));
      main.dispatchEvent(new MouseEvent('mouseup', evt));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 300));
}
