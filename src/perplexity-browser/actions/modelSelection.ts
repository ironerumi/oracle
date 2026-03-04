import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import {
  MODEL_PICKER_SELECTORS,
  MODEL_PICKER_BUTTON_TEXTS,
  PERPLEXITY_MODEL_LABELS,
} from '../constants.js';

type Runtime = ChromeClient['Runtime'];

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
  runtime: Runtime,
  desiredModel: string | null | undefined,
  log?: BrowserLogger,
): Promise<void> {
  const model = (desiredModel?.trim() ?? 'sonar').toLowerCase();
  const labels = PERPLEXITY_MODEL_LABELS[model];

  if (!labels) {
    log?.(`[perplexity-browser] Unknown model "${model}" — no label mapping. Skipping model picker.`);
    return;
  }

  // Check if the current model already matches by reading the picker button text
  const pickerBtnTexts = JSON.stringify(MODEL_PICKER_BUTTON_TEXTS);
  const targetLabels = JSON.stringify(labels);
  const pickerSelectors = JSON.stringify(MODEL_PICKER_SELECTORS);

  const checkResult = await runtime.evaluate({
    expression: `(() => {
      const pickerSelectors = ${pickerSelectors};
      const pickerBtnTexts = ${pickerBtnTexts};
      const targetLabels = ${targetLabels};

      // Find the model picker button.
      // It may have aria-label="Select model" OR show the current model name.
      let pickerBtn = null;
      for (const sel of pickerSelectors) {
        pickerBtn = document.querySelector(sel);
        if (pickerBtn) break;
      }
      if (!pickerBtn) {
        // Fallback: find button whose text matches known picker labels
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const text = btn.textContent?.trim() ?? '';
          if (pickerBtnTexts.some(t => text === t)) {
            pickerBtn = btn;
            break;
          }
        }
      }
      if (!pickerBtn) return { found: false };

      const currentText = pickerBtn.textContent?.trim() ?? '';
      const alreadySelected = targetLabels.some(t => currentText.includes(t));
      return { found: true, currentText, alreadySelected };
    })()`,
    returnByValue: true,
  });

  const check = checkResult.result?.value as {
    found: boolean;
    currentText?: string;
    alreadySelected?: boolean;
  } | undefined;

  if (!check?.found) {
    // Model picker not found — not fatal for sonar (it's the default)
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

  // Need to open picker and select. For sonar models this shouldn't happen
  // (Sonar is the default), but handle it gracefully.
  log?.(`[perplexity-browser] Current model is "${check.currentText}", need to switch to ${model}`);

  const selectResult = await runtime.evaluate({
    expression: `(async () => {
      const pickerSelectors = ${pickerSelectors};
      const pickerBtnTexts = ${pickerBtnTexts};
      const targetLabels = ${targetLabels};

      let pickerBtn = null;
      for (const sel of pickerSelectors) {
        pickerBtn = document.querySelector(sel);
        if (pickerBtn) break;
      }
      if (!pickerBtn) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const text = btn.textContent?.trim() ?? '';
          if (pickerBtnTexts.some(t => text === t)) { pickerBtn = btn; break; }
        }
      }
      if (!pickerBtn) return { status: 'picker-not-found' };

      pickerBtn.click();
      await new Promise(r => setTimeout(r, 600));

      // Scan all visible items for a match
      const candidates = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="listbox"] button, [data-radix-collection-root] button');
      let matched = null;
      for (const item of candidates) {
        const text = item.textContent?.trim() ?? '';
        if (targetLabels.some(t => text.includes(t))) {
          matched = item;
          break;
        }
      }
      if (!matched) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const available = Array.from(candidates).slice(0, 15).map(el => el.textContent?.trim()).filter(Boolean);
        return { status: 'label-not-found', available };
      }

      matched.click();
      await new Promise(r => setTimeout(r, 300));
      return { status: 'selected', text: matched.textContent?.trim() };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  const result = selectResult.result?.value as {
    status: string;
    text?: string;
    available?: string[];
  } | undefined;

  if (result?.status === 'selected') {
    log?.(`[perplexity-browser] Model switched to: ${result.text}`);
  } else if (result?.status === 'label-not-found') {
    throw new BrowserAutomationError(
      `Could not find model matching ${JSON.stringify(labels)} in picker. ` +
        `Available: ${(result.available ?? []).join(', ') || '(none)'}. ` +
        'Update PERPLEXITY_MODEL_LABELS in constants.ts.',
      { stage: 'model-selection' },
    );
  } else {
    // For sonar models, failing to switch is non-fatal (it's the default)
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
