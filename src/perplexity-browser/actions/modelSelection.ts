import type { Page } from 'playwright-core';
import type { BrowserLogger } from '../../browser/types.js';
import { BrowserAutomationError } from '../../oracle/errors.js';
import {
  MODEL_PICKER_SELECTORS,
  MODEL_PICKER_BUTTON_TEXTS,
  PERPLEXITY_MODEL_LABELS,
  PERPLEXITY_THINKING_MODELS,
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
 *
 * IMPORTANT: Radix UI menus require real pointer events — plain element.click() from
 * page.evaluate() does NOT open dropdowns. Use Playwright's locator.click() instead.
 */
export async function selectPerplexityModel(
  page: Page,
  desiredModel: string | null | undefined,
  log?: BrowserLogger,
): Promise<void> {
  const raw = desiredModel?.trim() ?? '';
  const model = raw.toLowerCase() || 'ppl/sonar';
  const knownLabels = PERPLEXITY_MODEL_LABELS[model];

  // Known model → use locale-aware labels; unknown → use raw string as picker label passthrough.
  const labels = knownLabels ?? (raw ? [raw] : null);

  if (!labels) {
    log?.(`[perplexity-browser] No model specified and no default — skipping model picker.`);
    return;
  }

  // Find the picker button
  const pickerBtn = await findPickerButton(page);
  if (!pickerBtn) {
    if (model === 'ppl/sonar' || model.startsWith('ppl/sonar')) {
      log?.('[perplexity-browser] Model picker button not found, but sonar is the default. Continuing.');
      return;
    }
    throw new BrowserAutomationError(
      'Could not find the Perplexity model picker button. The UI may have changed.',
      { stage: 'model-selection' },
    );
  }

  // Check if the current model already matches
  const currentText = (await pickerBtn.textContent())?.trim() ?? '';
  const alreadySelected = labels.some(t => currentText.includes(t));

  if (alreadySelected) {
    log?.(`[perplexity-browser] Model already set to "${currentText}" — matches ${model}`);
    return;
  }

  // Need to open picker and select
  log?.(`[perplexity-browser] Current model is "${currentText}", need to switch to ${model}`);

  // Open picker with Playwright click (dispatches proper pointer events for Radix)
  await pickerBtn.click();
  await page.waitForTimeout(600);

  // Scan all menu items in a single evaluate (avoids per-item Playwright timeouts)
  const scanResult = await page.evaluate(
    (args: { targetLabels: string[]; checkMaxDisabled: boolean }) => {
      const sel = '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="listbox"] button, [data-radix-collection-root] button';
      const candidates = document.querySelectorAll(sel);
      const available: string[] = [];
      let matchIndex = -1;
      let matchDisabled = false;

      for (let i = 0; i < candidates.length; i++) {
        const text = candidates[i].textContent?.trim() ?? '';
        if (text) available.push(text);
        if (matchIndex === -1 && args.targetLabels.some(t => text.includes(t))) {
          matchIndex = i;
          if (args.checkMaxDisabled) {
            const el = candidates[i] as HTMLElement;
            matchDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.dataset?.disabled != null;
          }
        }
      }
      return { matchIndex, matchDisabled, available: available.slice(0, 15) };
    },
    { targetLabels: labels, checkMaxDisabled: model === 'ppl/claude-opus-4.6' },
  );

  if (scanResult.matchIndex === -1) {
    await page.keyboard.press('Escape');
    throw new BrowserAutomationError(
      `Could not find model matching ${JSON.stringify(labels)} in picker. ` +
        `Available: ${scanResult.available.join(', ') || '(none)'}. ` +
        'Update PERPLEXITY_MODEL_LABELS in constants.ts.',
      { stage: 'model-selection' },
    );
  }

  if (scanResult.matchDisabled) {
    await page.keyboard.press('Escape');
    throw new BrowserAutomationError(
      'ppl/claude-opus-4.6 requires Perplexity Max subscription.',
      { stage: 'model-selection' },
    );
  }

  // Click the matched item via Playwright locator (proper pointer events)
  const menuItems = page.locator('[role="menuitem"], [role="option"], [role="menuitemradio"], [role="listbox"] button, [data-radix-collection-root] button');
  const matched = menuItems.nth(scanResult.matchIndex);
  await matched.click({ timeout: 5000 });
  await page.waitForTimeout(300);

  log?.(`[perplexity-browser] Model switched to: ${scanResult.available[scanResult.matchIndex] ?? 'unknown'}`);

  // Thinking toggle: check for menuitemcheckbox with inner switch
  if (model in PERPLEXITY_THINKING_MODELS) {
    const thinkingResult = await activateThinkingToggle(page, log);
    if (thinkingResult === 'activated') {
      log?.('[perplexity-browser] Thinking toggle activated');
    } else if (thinkingResult === 'already-on') {
      log?.('[perplexity-browser] Thinking toggle already ON');
    } else {
      log?.('[perplexity-browser] Thinking toggle not found in picker (may not be available)');
    }
  }
}

async function findPickerButton(page: Page) {
  // Try aria-label selectors first
  for (const sel of MODEL_PICKER_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.count() > 0) return loc;
  }
  // Fallback: find button by exact text matching MODEL_PICKER_BUTTON_TEXTS
  for (const text of MODEL_PICKER_BUTTON_TEXTS) {
    const loc = page.locator(`button:text-is("${text}")`).first();
    if (await loc.count() > 0) return loc;
  }
  // Structural fallback: button with aria-haspopup near the lexical editor
  const nearEditor = page.locator('[data-lexical-editor]').locator('..').locator('button[aria-haspopup="menu"]').first();
  if (await nearEditor.count() > 0) return nearEditor;
  return null;
}

async function activateThinkingToggle(page: Page, log?: BrowserLogger): Promise<'activated' | 'already-on' | 'not-found'> {
  const checkbox = page.locator('[role="menuitemcheckbox"]').first();
  if (await checkbox.count() === 0) return 'not-found';

  const sw = checkbox.locator('button[role="switch"]').first();
  if (await sw.count() === 0) return 'not-found';

  const checked = await sw.getAttribute('aria-checked');
  if (checked === 'false') {
    await sw.click();
    await page.waitForTimeout(200);
    return 'activated';
  }
  return 'already-on';
}
