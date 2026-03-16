// Perplexity browser engine constants -- verified via agent-browser CDP inspection (2026-03-04).
// Note: aria-labels are locale-dependent (e.g. JP: "送信", EN: "Submit").
// Prefer structural/class selectors over aria-label text.

export const PERPLEXITY_URL = "https://www.perplexity.ai/";
export const PERPLEXITY_COOKIE_URLS = ["https://www.perplexity.ai", "https://perplexity.ai"];

// --- Prompt input ---
// Perplexity uses Lexical (Meta's rich text editor), NOT a standard <textarea>.
export const PROMPT_SELECTORS = [
  "#ask-input", // stable ID anchor (defense-in-depth)
  'div[data-lexical-editor][contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
];

// --- Submit button ---
// Disabled when prompt is empty; enabled once text is entered.
// aria-label is localized; match by position relative to the prompt container.
export const SUBMIT_BUTTON_SELECTORS = [
  'button[aria-label="Submit"]',
  'button[aria-label="送信"]', // Japanese
  'button[aria-label="Envoyer"]', // French
  'button[aria-label="Senden"]', // German
];

// --- Model picker ---
// Button adjacent to the prompt input that opens a model selection dropdown.
// The button label is dynamic (shows selected model name), so prefer structural selectors.
export const MODEL_PICKER_SELECTORS = [
  'button[aria-label="Select model"]',
  'button[aria-label="モデルを選択"]',
  'button[aria-label="Model"]',
];

// --- Sources/Links tab ---
// After response, tabs: 回答 (Answer), リンク (Links), 画像 (Images).
// Source URLs are ONLY in the Links tab panel, not in inline citation spans.
export const SOURCES_TAB_TEXTS = ["Links", "リンク", "Sources"];

// --- Response container ---
// Tailwind prose container inside a Radix UI tab panel.
export const RESPONSE_PROSE_SELECTOR = '[role="tabpanel"] .prose';

// --- Completion signals ---
// Follow-up suggestions and action buttons appear only after response streaming ends.
// The copy button's aria-label is also localized.
export const COPY_BUTTON_SELECTORS = ['button[aria-label="Copy"]', 'button[aria-label="コピー"]'];

// --- Tabs ---
export const TAB_SELECTOR = '[role="tab"]';

// --- Cloudflare challenge detection ---
export const CLOUDFLARE_TITLES = ["just a moment", "しばらくお待ちください"];

// --- Cloudflare cookie prefix matcher (future-proof) ---
const CF_COOKIE_PREFIXES = ["cf_", "__cf", "_cf", "CF_"];
export function isCloudflareCookie(name: string): boolean {
  return CF_COOKIE_PREFIXES.some((p) => name.startsWith(p));
}

// --- Internal error page detection ---
export const INTERNAL_ERROR_TEXTS = ["Internal Error"];

// --- Login state ---
// When NOT logged in, "Continue with Google/Apple" buttons are present.
// When logged in, sidebar with spaces/library links appears.
export const LOGIN_BUTTON_TEXTS = [
  "Continue with Google",
  "Googleで続ける",
  "Continue with Apple",
  "Appleで続ける",
];

// --- Space URL construction ---
export const SPACES_PATH_PREFIX = "/spaces/";
export function buildSpaceUrl(slug: string): string {
  return `${PERPLEXITY_URL.replace(/\/$/, "")}${SPACES_PATH_PREFIX}${slug}`;
}

// --- Perplexity model labels (as shown in the web UI model picker) ---
// Verified via live CDP inspection 2026-03-04:
// The picker is a FLAT list of cross-provider models, NOT Perplexity tier labels.
// All sonar API models (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research)
// map to the single "ソナー" / "Sonar" entry in the web UI.
// The picker label is locale-dependent (JP: "ソナー", EN: "Sonar").
export const PERPLEXITY_MODEL_LABELS: Record<string, string[]> = {
  // sonar variants all map to the same picker entry
  "ppl/sonar": ["Sonar", "ソナー"],
  "ppl/sonar-pro": ["Sonar", "ソナー"],
  "ppl/sonar-reasoning-pro": ["Sonar", "ソナー"],
  "ppl/sonar-deep-research": ["Sonar", "ソナー"],
  "ppl/best": ["Best", "ベスト"],
  "ppl/gpt-5.4": ["GPT-5.4"],
  "ppl/gemini-3.1-pro": ["Gemini 3.1 Pro"],
  "ppl/claude-sonnet-4.6": ["Claude Sonnet 4.6"],
  "ppl/claude-opus-4.6": ["Claude Opus 4.6"],
  "ppl/kimi-k2.5": ["Kimi K2.5"],
};

// Thinking toggle: models that support extended thinking in the Perplexity UI.
// Value = default state (true = ON by default, false = OFF by default).
export const PERPLEXITY_THINKING_MODELS: Record<string, boolean> = {
  "ppl/gpt-5.4": false,
  "ppl/gemini-3.1-pro": true,
  "ppl/claude-sonnet-4.6": false,
  "ppl/claude-opus-4.6": false,
  "ppl/kimi-k2.5": true,
};

// The model picker button label shows the CURRENT model name, not a static label.
// On first load with default model, it shows "ソナー" / "Sonar".
export const MODEL_PICKER_BUTTON_TEXTS = [
  "Sonar",
  "ソナー",
  "Best",
  "ベスト",
  "GPT-5.4",
  "Gemini 3.1 Pro",
  "Claude Sonnet 4.6",
  "Claude Opus 4.6",
  "Kimi K2.5",
  "Select model",
  "モデルを選択",
  "Model",
];

// --- Source filters (connectors & sources submenu) ---
// Access path: "ファイルまたはツールを追加する" button → "コネクタとソース" menuitem → checkboxes
// Source filters are [role="menuitemcheckbox"] with SVG icons for native sources.
// Using SVG icon #href is the most locale-independent, stable selector.
export const ADD_TOOLS_BUTTON_LABELS = [
  "ファイルまたはツールを追加する",
  "Add files or tools",
  "Attach",
  "Add tools",
  "ツールを追加",
];
export const CONNECTORS_MENUITEM_TEXTS = [
  "コネクタとソース",
  "Connectors and sources",
  "Connectors & Sources",
  "Sources",
];

// Native source icon IDs (inside <use xlink:href="..."> within menuitemcheckbox)
export const SOURCE_ICON_IDS: Record<string, string> = {
  web: "#pplx-icon-world",
  academic: "#pplx-icon-books",
  social: "#pplx-icon-social",
};

// Text-based fallback for source filter toggle (locale variants)
export const SOCIAL_SOURCE_TEXTS = ["Social", "ソーシャル", "X (Twitter)"];

// --- Deep Research toggle (same [+] menu, top-level menuitemradio) ---
// Activation: click "Add files or tools" button → click menuitemradio with telescope icon.
// NOT inside "Connectors & Sources" submenu — it's a direct child of the [+] menu.
// Icon: <use xlink:href="#pplx-icon-telescope"> inside a [role="menuitemradio"]
// State: aria-checked="true"/"false", data-state="checked"/"unchecked"
// Toolbar indicator when active: button containing <use xlink:href="#pplx-icon-telescope">
export const DEEP_RESEARCH_ICON_ID = "#pplx-icon-telescope";
export const DEEP_RESEARCH_TEXTS = ["Deep Research", "深い研究"];
