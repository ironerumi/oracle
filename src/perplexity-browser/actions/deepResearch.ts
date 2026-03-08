import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import {
  ADD_TOOLS_BUTTON_LABELS,
  DEEP_RESEARCH_ICON_ID,
  DEEP_RESEARCH_TEXTS,
} from '../constants.js';

/**
 * Activate Deep Research mode in Perplexity's web UI.
 *
 * Access path: click [+] button → find Deep Research item → click to activate.
 *
 * Strategies (tried in order):
 * 1. SVG icon match (#pplx-icon-telescope) on [role="menuitemradio"]
 * 2. Text match ("Deep Research") on any element in the open menu
 *
 * Must be called BEFORE submitPerplexityPrompt() — only for `sonar-deep-research` model.
 */
export async function activateDeepResearch(
  page: Page,
  log?: BrowserLogger,
): Promise<void> {
  // First check if DR is already active via the toolbar indicator
  const alreadyActive = await page.evaluate((iconId: string) => {
    for (const u of document.querySelectorAll('button use')) {
      const href = u.getAttribute('xlink:href') || u.getAttribute('href');
      if (href === iconId) {
        const btn = u.closest('button');
        if (btn && !btn.closest('[role="menu"]')) return true;
      }
    }
    return false;
  }, DEEP_RESEARCH_ICON_ID);

  if (alreadyActive) {
    log?.('[perplexity-browser] Deep Research already active (toolbar indicator present)');
    return;
  }

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
    log?.('[perplexity-browser] Could not find "Add tools" button — cannot activate Deep Research');
    return;
  }

  await new Promise((r) => setTimeout(r, 500));

  // Step 2: Find and click the Deep Research item (pointer events for Radix)
  const toggleResult = await page.evaluate(
    (args: { drIconId: string; drTexts: string[] }) => {
      const clickRadix = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const evt = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
        el.dispatchEvent(new PointerEvent('pointerdown', evt));
        el.dispatchEvent(new MouseEvent('mousedown', evt));
        el.dispatchEvent(new PointerEvent('pointerup', evt));
        el.dispatchEvent(new MouseEvent('mouseup', evt));
        el.dispatchEvent(new MouseEvent('click', evt));
      };

      // Strategy 1: SVG icon match on [role="menuitemradio"]
      for (const u of document.querySelectorAll('[role="menuitemradio"] use')) {
        const href = u.getAttribute('xlink:href') || u.getAttribute('href');
        if (href === args.drIconId) {
          const radio = u.closest('[role="menuitemradio"]') as HTMLElement;
          if (!radio) continue;
          const checked = radio.getAttribute('aria-checked') === 'true' || radio.getAttribute('data-state') === 'checked';
          if (checked) return { found: true, alreadyChecked: true };
          clickRadix(radio);
          return { found: true, alreadyChecked: false };
        }
      }

      // Strategy 2: Text match in the open menu (any Radix structure)
      const scope = document.querySelector('[data-radix-popper-content-wrapper]')
        || document.querySelector('[data-state="open"][role="dialog"]')
        || document.querySelector('[data-state="open"]')
        || document;
      const candidates = scope.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], [data-radix-collection-item]');
      for (const el of candidates) {
        const text = el.textContent?.trim() ?? '';
        if (args.drTexts.some(t => text.includes(t))) {
          const checked = el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
          if (checked) return { found: true, alreadyChecked: true };
          clickRadix(el as HTMLElement);
          return { found: true, alreadyChecked: false };
        }
      }

      // Strategy 3: Broadest fallback — any element with matching text inside the popover
      for (const el of scope.querySelectorAll('div, button')) {
        const ownText = el.childNodes.length <= 3 ? (el.textContent?.trim() ?? '') : '';
        if (ownText && args.drTexts.some(t => ownText.includes(t))) {
          const target = (el.closest('[class*="col-start"]')?.parentElement ?? el) as HTMLElement;
          clickRadix(target);
          return { found: true, alreadyChecked: false };
        }
      }

      return { found: false };
    },
    { drIconId: DEEP_RESEARCH_ICON_ID, drTexts: DEEP_RESEARCH_TEXTS },
  );

  if (!toggleResult?.found) {
    log?.('[perplexity-browser] Could not find Deep Research toggle in menu — skipping');

  } else if (toggleResult.alreadyChecked) {
    log?.('[perplexity-browser] Deep Research already checked in menu');
  } else {
    log?.('[perplexity-browser] Activated Deep Research mode');
  }

  // Step 3: Close menu
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
