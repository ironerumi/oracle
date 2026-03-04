import type { ChromeClient, BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import { MODEL_PICKER_SELECTORS, PERPLEXITY_MODEL_LABELS } from '../constants.js';

type Runtime = ChromeClient['Runtime'];

/**
 * Select a Perplexity model via the web UI picker.
 * Skips if the desired model is 'sonar' (the default) or if no label is found.
 */
export async function selectPerplexityModel(
  runtime: Runtime,
  desiredModel: string | null | undefined,
  log?: BrowserLogger,
): Promise<void> {
  const model = desiredModel?.trim() ?? 'sonar';
  if (model === 'sonar') {
    log?.('[perplexity-browser] Using default model (sonar), skipping model picker');
    return;
  }

  const label = PERPLEXITY_MODEL_LABELS[model];
  if (!label) {
    log?.(`[perplexity-browser] Unknown model "${model}" — no label mapping. Skipping model picker.`);
    return;
  }

  log?.(`[perplexity-browser] Selecting model "${model}" (label: "${label}")`);

  const pickerSelectors = JSON.stringify(MODEL_PICKER_SELECTORS);
  const result = await runtime.evaluate({
    expression: `(async () => {
      const pickerSelectors = ${pickerSelectors};
      const targetLabel = ${JSON.stringify(label)};

      // 1. Find and click the model picker button
      let pickerBtn = null;
      for (const sel of pickerSelectors) {
        pickerBtn = document.querySelector(sel);
        if (pickerBtn) break;
      }
      if (!pickerBtn) {
        return { status: 'picker-not-found' };
      }
      pickerBtn.click();

      // 2. Wait for dropdown to appear (Radix UI popover)
      await new Promise(r => setTimeout(r, 500));

      // 3. Find the option matching the target label
      // Perplexity model picker uses Radix menu items
      const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], button');
      let matched = null;
      for (const item of menuItems) {
        const text = item.textContent?.trim() ?? '';
        if (text.includes(targetLabel)) {
          matched = item;
          break;
        }
      }
      if (!matched) {
        // Close picker by pressing Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { status: 'label-not-found', targetLabel, available: Array.from(menuItems).slice(0, 10).map(el => el.textContent?.trim()) };
      }

      matched.click();
      await new Promise(r => setTimeout(r, 300));
      return { status: 'selected', targetLabel };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result?.value as {
    status: string;
    targetLabel?: string;
    available?: string[];
  } | undefined;

  if (!value || value.status === 'picker-not-found') {
    throw new BrowserAutomationError(
      'Could not find the Perplexity model picker button. The UI may have changed.',
      { stage: 'model-selection' },
    );
  }
  if (value.status === 'label-not-found') {
    throw new BrowserAutomationError(
      `Could not find model "${label}" in the Perplexity model picker. ` +
        `Available options: ${(value.available ?? []).filter(Boolean).join(', ') || '(none detected)'}. ` +
        'The model labels may have changed — update PERPLEXITY_MODEL_LABELS in constants.ts.',
      { stage: 'model-selection', targetLabel: label },
    );
  }

  log?.(`[perplexity-browser] Model selected: ${value.targetLabel}`);
}
