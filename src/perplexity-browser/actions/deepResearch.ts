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
 * Access path: click "Add files or tools" [+] button → find the Deep Research
 * menuitemradio by its telescope SVG icon (#pplx-icon-telescope) → click to activate.
 *
 * Deep Research is a top-level item in the [+] menu (NOT inside "Connectors & Sources").
 * It uses [role="menuitemradio"] with aria-checked state.
 *
 * After activation, a toolbar indicator button with the telescope icon appears inline
 * in the prompt toolbar, confirming DR mode is on.
 *
 * Must be called BEFORE submitPerplexityPrompt() — only for `sonar-deep-research` model.
 */
export async function activateDeepResearch(
  page: Page,
  log?: BrowserLogger,
): Promise<void> {
  // First check if DR is already active via the toolbar indicator
  const alreadyActive = await page.evaluate((iconId: string) => {
    const uses = document.querySelectorAll('button use');
    for (const u of uses) {
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

  // Step 1: Open the [+] "Add files or tools" menu
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
    log?.('[perplexity-browser] Could not find "Add tools" button — cannot activate Deep Research');
    return;
  }

  // Wait for menu to render
  await new Promise((r) => setTimeout(r, 500));

  // Step 2: Find and click the Deep Research menuitemradio by telescope icon or text
  const toggleResult = await page.evaluate(
    (args: { drIconId: string; drTexts: string[] }) => {
      // Strategy 1: Find by SVG icon ID (most reliable, locale-independent)
      const uses = document.querySelectorAll('[role="menuitemradio"] use');
      for (const u of uses) {
        const href = u.getAttribute('xlink:href') || u.getAttribute('href');
        if (href === args.drIconId) {
          const radio = u.closest('[role="menuitemradio"]');
          if (!radio) continue;
          const checked = radio.getAttribute('aria-checked') === 'true';
          if (checked) return { found: true, alreadyChecked: true };
          (radio as HTMLElement).click();
          return { found: true, alreadyChecked: false };
        }
      }

      // Strategy 2: Fallback to text match
      const radios = document.querySelectorAll('[role="menuitemradio"]');
      for (const radio of radios) {
        const text = radio.textContent?.trim() ?? '';
        if (args.drTexts.some(t => text.includes(t))) {
          const checked = radio.getAttribute('aria-checked') === 'true';
          if (checked) return { found: true, alreadyChecked: true };
          (radio as HTMLElement).click();
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

  // Step 3: Close menu by clicking the page body
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
