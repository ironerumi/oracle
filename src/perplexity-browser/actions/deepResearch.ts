import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import {
  ADD_TOOLS_BUTTON_LABELS,
  DEEP_RESEARCH_ICON_ID,
  DEEP_RESEARCH_TEXTS,
} from '../constants.js';

type Runtime = ChromeClient['Runtime'];

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
  runtime: Runtime,
  log?: BrowserLogger,
): Promise<void> {
  // First check if DR is already active via the toolbar indicator
  const alreadyActive = await runtime.evaluate({
    expression: `(() => {
      const uses = document.querySelectorAll('button use');
      for (const u of uses) {
        const href = u.getAttribute('xlink:href') || u.getAttribute('href');
        if (href === ${JSON.stringify(DEEP_RESEARCH_ICON_ID)}) {
          // Telescope icon in a toolbar button = DR already active
          const btn = u.closest('button');
          if (btn && !btn.closest('[role="menu"]')) return true;
        }
      }
      return false;
    })()`,
    returnByValue: true,
  });

  if (alreadyActive.result?.value === true) {
    log?.('[perplexity-browser] Deep Research already active (toolbar indicator present)');
    return;
  }

  const toolsLabels = JSON.stringify(ADD_TOOLS_BUTTON_LABELS);
  const drIconId = JSON.stringify(DEEP_RESEARCH_ICON_ID);
  const drTexts = JSON.stringify(DEEP_RESEARCH_TEXTS);

  // Step 1: Open the [+] "Add files or tools" menu
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
    log?.('[perplexity-browser] Could not find "Add tools" button — cannot activate Deep Research');
    return;
  }

  // Wait for menu to render
  await new Promise((r) => setTimeout(r, 500));

  // Step 2: Find and click the Deep Research menuitemradio by telescope icon or text
  const toggleResult = await runtime.evaluate({
    expression: `(() => {
      const iconId = ${drIconId};
      const texts = ${drTexts};

      // Strategy 1: Find by SVG icon ID (most reliable, locale-independent)
      const uses = document.querySelectorAll('[role="menuitemradio"] use');
      for (const u of uses) {
        const href = u.getAttribute('xlink:href') || u.getAttribute('href');
        if (href === iconId) {
          const radio = u.closest('[role="menuitemradio"]');
          if (!radio) continue;
          const checked = radio.getAttribute('aria-checked') === 'true';
          if (checked) return { found: true, alreadyChecked: true };
          radio.click();
          return { found: true, alreadyChecked: false };
        }
      }

      // Strategy 2: Fallback to text match
      const radios = document.querySelectorAll('[role="menuitemradio"]');
      for (const radio of radios) {
        const text = radio.textContent?.trim() ?? '';
        if (texts.some(t => text.includes(t))) {
          const checked = radio.getAttribute('aria-checked') === 'true';
          if (checked) return { found: true, alreadyChecked: true };
          radio.click();
          return { found: true, alreadyChecked: false };
        }
      }

      return { found: false };
    })()`,
    returnByValue: true,
  });

  const val = toggleResult.result?.value as { found: boolean; alreadyChecked?: boolean } | undefined;
  if (!val?.found) {
    log?.('[perplexity-browser] Could not find Deep Research toggle in menu — skipping');
  } else if (val.alreadyChecked) {
    log?.('[perplexity-browser] Deep Research already checked in menu');
  } else {
    log?.('[perplexity-browser] Activated Deep Research mode');
  }

  // Step 3: Close menu by clicking the page body
  await new Promise((r) => setTimeout(r, 300));
  await runtime.evaluate({
    expression: `(() => {
      const main = document.querySelector('main') || document.body;
      main.click();
      const evt = { bubbles: true, cancelable: true, clientX: 10, clientY: 10 };
      main.dispatchEvent(new PointerEvent('pointerdown', evt));
      main.dispatchEvent(new MouseEvent('mousedown', evt));
      main.dispatchEvent(new PointerEvent('pointerup', evt));
      main.dispatchEvent(new MouseEvent('mouseup', evt));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 300));
}
