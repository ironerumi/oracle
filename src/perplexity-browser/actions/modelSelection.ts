import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import {
  MODEL_PICKER_SELECTORS,
  MODEL_PICKER_BUTTON_TEXTS,
  PERPLEXITY_MODEL_LABELS,
} from '../constants.js';

/**
 * Select a Perplexity model via the web UI picker.
 *
 * Live inspection (2026-03-04) revealed the picker is a flat list of cross-provider
 * models (ソナー, Gemini 3 Flash, GPT-5.2, Claude Sonnet 4.6, etc.).
 * All sonar API models (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research)
 * map to the single "ソナー"/"Sonar" entry. The web UI doesn't distinguish sonar tiers.
 *
 * This means: for any sonar model, we verify "Sonar" is the current selection and skip.
 * The model picker button shows the CURRENT model name as its label.
 */
export async function selectPerplexityModel(
  page: Page,
  desiredModel: string | null | undefined,
  log?: BrowserLogger,
): Promise<void> {
  const raw = desiredModel?.trim() ?? '';
  const model = raw.toLowerCase() || 'sonar';
  const knownLabels = PERPLEXITY_MODEL_LABELS[model];

  // Known model → use locale-aware labels; unknown → use raw string as picker label passthrough.
  const labels = knownLabels ?? (raw ? [raw] : null);

  if (!labels) {
    log?.(`[perplexity-browser] No model specified and no default — skipping model picker.`);
    return;
  }

  // Check if the current model already matches by reading the picker button text
  const check = await page.evaluate(
    (args: { pickerSelectors: string[]; pickerBtnTexts: string[]; targetLabels: string[] }) => {
      let pickerBtn: Element | null = null;
      for (const sel of args.pickerSelectors) {
        pickerBtn = document.querySelector(sel);
        if (pickerBtn) break;
      }
      if (!pickerBtn) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const text = btn.textContent?.trim() ?? '';
          if (args.pickerBtnTexts.some(t => text === t)) {
            pickerBtn = btn;
            break;
          }
        }
      }
      if (!pickerBtn) return { found: false };

      const currentText = pickerBtn.textContent?.trim() ?? '';
      const alreadySelected = args.targetLabels.some(t => currentText.includes(t));
      return { found: true, currentText, alreadySelected };
    },
    { pickerSelectors: MODEL_PICKER_SELECTORS, pickerBtnTexts: MODEL_PICKER_BUTTON_TEXTS, targetLabels: labels },
  );

  if (!check?.found) {
    if (model.startsWith('sonar')) {
      log?.('[perplexity-browser] Model picker button not found, but sonar is the default. Continuing.');
      return;
    }
    throw new BrowserAutomationError(
      'Could not find the Perplexity model picker button. The UI may have changed.',
      { stage: 'model-selection' },
    );
  }

  if (check.alreadySelected) {
    log?.(`[perplexity-browser] Model already set to "${check.currentText}" — matches ${model}`);
    return;
  }

  // Need to open picker and select
  log?.(`[perplexity-browser] Current model is "${check.currentText}", need to switch to ${model}`);

  const result = await page.evaluate(
    async (args: { pickerSelectors: string[]; pickerBtnTexts: string[]; targetLabels: string[] }) => {
      let pickerBtn: Element | null = null;
      for (const sel of args.pickerSelectors) {
        pickerBtn = document.querySelector(sel);
        if (pickerBtn) break;
      }
      if (!pickerBtn) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const text = btn.textContent?.trim() ?? '';
          if (args.pickerBtnTexts.some(t => text === t)) { pickerBtn = btn; break; }
        }
      }
      if (!pickerBtn) return { status: 'picker-not-found' };

      (pickerBtn as HTMLElement).click();
      await new Promise(r => setTimeout(r, 600));

      const candidates = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="listbox"] button, [data-radix-collection-root] button');
      let matched: Element | null = null;
      for (const item of candidates) {
        const text = item.textContent?.trim() ?? '';
        if (args.targetLabels.some(t => text.includes(t))) {
          matched = item;
          break;
        }
      }
      if (!matched) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const available = Array.from(candidates).slice(0, 15).map(el => el.textContent?.trim()).filter(Boolean);
        return { status: 'label-not-found', available };
      }

      (matched as HTMLElement).click();
      await new Promise(r => setTimeout(r, 300));
      return { status: 'selected', text: matched.textContent?.trim() };
    },
    { pickerSelectors: MODEL_PICKER_SELECTORS, pickerBtnTexts: MODEL_PICKER_BUTTON_TEXTS, targetLabels: labels },
  );

  if (result?.status === 'selected') {
    log?.(`[perplexity-browser] Model switched to: ${result.text}`);
  } else if (result?.status === 'label-not-found') {
    throw new BrowserAutomationError(
      `Could not find model matching ${JSON.stringify(labels)} in picker. ` +
        `Available: ${((result as { available?: string[] }).available ?? []).join(', ') || '(none)'}. ` +
        'Update PERPLEXITY_MODEL_LABELS in constants.ts.',
      { stage: 'model-selection' },
    );
  } else {
    if (model.startsWith('sonar')) {
      log?.('[perplexity-browser] Could not switch model but sonar is default. Continuing.');
      return;
    }
    throw new BrowserAutomationError(
      'Failed to open model picker or select model.',
      { stage: 'model-selection' },
    );
  }
}
