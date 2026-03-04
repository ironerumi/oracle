// Perplexity browser engine constants -- verified via agent-browser CDP inspection (2026-03-04).
// Note: aria-labels are locale-dependent (e.g. JP: "送信", EN: "Submit").
// Prefer structural/class selectors over aria-label text.

export const PERPLEXITY_URL = 'https://www.perplexity.ai/';
export const PERPLEXITY_COOKIE_URLS = ['https://www.perplexity.ai', 'https://perplexity.ai'];

// --- Prompt input ---
// Perplexity uses Lexical (Meta's rich text editor), NOT a standard <textarea>.
export const PROMPT_SELECTORS = [
  'div[data-lexical-editor][contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
];

// --- Submit button ---
// Disabled when prompt is empty; enabled once text is entered.
// aria-label is localized; match by position relative to the prompt container.
export const SUBMIT_BUTTON_SELECTORS = [
  'button[aria-label="Submit"]',
  'button[aria-label="送信"]',       // Japanese
  'button[aria-label="Envoyer"]',    // French
  'button[aria-label="Senden"]',     // German
];

// --- Model picker ---
// Button adjacent to the prompt input that opens a model selection dropdown.
// The button label shows the current model name (e.g. "ソナー"), not a static aria-label.
export const MODEL_PICKER_SELECTORS = [
  'button[aria-label="Select model"]',
  'button[aria-label="モデルを選択"]',
];

// --- Sources/Links tab ---
// After response, tabs: 回答 (Answer), リンク (Links), 画像 (Images).
// Source URLs are ONLY in the Links tab panel, not in inline citation spans.
export const SOURCES_TAB_TEXTS = ['Links', 'リンク', 'Sources'];

// --- Response container ---
// Tailwind prose container inside a Radix UI tab panel.
export const RESPONSE_PROSE_SELECTOR = '[role="tabpanel"] .prose';
export const TABPANEL_SELECTOR = '[role="tabpanel"]';

// --- Query heading ---
export const QUERY_HEADING_SELECTOR = 'h1';

// --- Citations ---
// Inline citation badges (e.g. "wikipedia+1", "github+2").
export const CITATION_SELECTOR = 'span.citation.inline';
export const CITATION_NBSP_SELECTOR = 'span.citation-nbsp';

// --- Completion signals ---
// Follow-up suggestions and action buttons appear only after response streaming ends.
// The copy button's aria-label is also localized.
export const COPY_BUTTON_SELECTORS = [
  'button[aria-label="Copy"]',
  'button[aria-label="コピー"]',
];

// --- Tabs ---
export const TAB_SELECTOR = '[role="tab"]';
export const ACTIVE_TAB_SELECTOR = '[role="tab"][data-state="active"]';

// --- Cloudflare challenge detection ---
export const CLOUDFLARE_TITLES = ['just a moment', 'しばらくお待ちください'];

// --- Login state ---
// When NOT logged in, "Continue with Google/Apple" buttons are present.
// When logged in, sidebar with spaces/library links appears.
export const LOGIN_BUTTON_TEXTS = ['Continue with Google', 'Googleで続ける', 'Continue with Apple', 'Appleで続ける'];

// --- Space URL construction ---
export const SPACES_PATH_PREFIX = '/spaces/';
export function buildSpaceUrl(slug: string): string {
  return `${PERPLEXITY_URL.replace(/\/$/, '')}${SPACES_PATH_PREFIX}${slug}`;
}

// --- Perplexity model labels (as shown in the web UI model picker) ---
// Verified via live CDP inspection 2026-03-04:
// The picker is a FLAT list of cross-provider models, NOT Perplexity tier labels.
// All sonar API models (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research)
// map to the single "ソナー" / "Sonar" entry in the web UI.
// The picker label is locale-dependent (JP: "ソナー", EN: "Sonar").
export const PERPLEXITY_MODEL_LABELS: Record<string, string[]> = {
  // sonar variants all map to the same picker entry
  sonar: ['Sonar', 'ソナー'],
  'sonar-pro': ['Sonar', 'ソナー'],
  'sonar-reasoning-pro': ['Sonar', 'ソナー'],
  'sonar-deep-research': ['Sonar', 'ソナー'],
};

// The model picker button label shows the CURRENT model name, not a static label.
// On first load with default model, it shows "ソナー" / "Sonar".
export const MODEL_PICKER_BUTTON_TEXTS = ['Sonar', 'ソナー', 'Select model', 'モデルを選択'];
