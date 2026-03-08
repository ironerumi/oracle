# CLAUDE.md

version_id: 260309.1

## Browser Engine Development

### Perplexity engine: Camoufox (headless)
- Perplexity browser engine uses **Camoufox** (Firefox fork) + Playwright, NOT Chrome/CDP
- Headless by default — no visible browser window
- ChatGPT/Gemini engines still use Chrome/CDP (`src/browser/chromeLifecycle.ts`)
- `src/perplexity-browser/camoufoxLifecycle.ts` — launch, cookie normalization, signal hooks
- Cookie injection: `context.addCookies()` (Playwright), NOT `Network.setCookie` (CDP)
- Cookie write-back: `context.cookies()` → filter perplexity.ai → write to inline cookies file
- Binary auto-downloads on first run via `CamoufoxFetcher.install()`
- `browser.process()` does NOT exist on Camoufox — `chromePid` etc. are omitted from result
- Default viewport: 1280x720 (no override needed)
- `camoufox-js` v0.9.1 + `playwright-core` — cross-platform (mac/linux/win)

### Chrome profile management (ChatGPT/Gemini only)
- **NEVER use personal profiles** (Default, Profile 2/Yifu) for oracle CLI or CDP inspection
- Preferred: export cookies once, use `--browser-inline-cookies-file` at runtime (zero profile access)
- Cookie file: `~/.oracle/perplexity-cookies.json` — auto-refreshed after each successful run
- Export: `npx tsx export-cookies-script "Profile 2"` from oracle repo (sweet-cookie reads Chrome DB)
- `__Secure-next-auth.session-token` expires ~monthly; auto-refresh keeps it alive with regular use

### Starting Chrome for CDP inspection (ChatGPT/Gemini only)
Cloudflare blocks ALL headless Chrome. Only real headed Chrome with a user profile bypasses it.

```bash
# Launch Chrome with remote debugging (user manages this manually)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9333 --profile-directory="Profile 2" \
  "https://www.perplexity.ai/" &
```

Then use `agent-browser --cdp 9333` to connect. Never use `agent-browser --headed` (broken).

### agent-browser gotchas
- `click @ref` often fails with "os error 35" — use `eval` with full pointer event sequence instead
- Tab switching (React/Radix) needs: `pointerdown → mousedown → pointerup → mouseup → click` with `{bubbles:true, cancelable:true, clientX, clientY}`. Plain `.click()` does NOT work.
- Shell escaping kills complex `eval` — keep JS one-liners simple, no nested quotes
- Refs change between snapshots — always take fresh `snapshot -i` before clicking
- Page runs at 1x1 viewport by default — may need `Emulation.setDeviceMetricsOverride`
- Command is `eval` not `execute`

### Perplexity web UI facts (verified 2026-03-04, JP locale)
- Prompt input: Lexical editor (`div[data-lexical-editor][contenteditable="true"]`), NOT `<textarea>`
- All aria-labels are locale-dependent (JP: "送信", EN: "Submit"). Use structural selectors.
- Model picker is a flat cross-provider list (ソナー, Gemini, GPT, Claude, Grok, Kimi), NOT tier-based. All sonar API models map to single "ソナー"/"Sonar" entry.
- Citation URLs are NOT in inline `span.citation.inline` (those are popover triggers). Real URLs only in "リンク" (Links) tab panel.
- Space landing page has prompt input directly — no "New thread" click needed.

### Perplexity source filters (verified 2026-03-09)
- Source filters are behind: "Add tools" [+] button → "Connectors & Sources" submenu → toggle
- Social source always enabled by default (`sourceFilter.ts`)
- **All Radix menu clicks require pointer event sequences** (pointerdown→mousedown→pointerup→mouseup→click with coordinates). Plain `.click()` does NOT open menus.
- Primary selector: SVG icon `<use xlink:href="#pplx-icon-social">` (locale-independent)
- Fallback: text match ("Social", "ソーシャル") on buttons/checkboxes in menu
- State: `aria-checked="true"` / `data-state="checked"`
- Toggle (not radio): multiple sources can be active simultaneously
- Dismissing Radix menus: click on `<main>` with pointer events, NOT Escape on `document`

### Cookie sync
- Chrome cookie DBs are Keychain-encrypted — `cp` between profiles doesn't transfer auth
- `syncCookies()` in `src/browser/cookies.ts` accepts `extraOrigins` option to override ChatGPT's hardcoded `COOKIE_URLS`
- Perplexity cookie format: CDP-shaped JSON normalized to Playwright via `cdpCookiesToPlaywright()` in `camoufoxLifecycle.ts`
- Cookie write-back: after successful run, Perplexity executor dumps fresh cookies from Playwright context back to the inline cookies file

### Architecture
- Executor pattern: `createXxxExecutor(config) => (runOptions) => Promise<BrowserRunResult>`
- `isBrowserCompatible()` exists in TWO places: `src/cli/runOptions.ts:60` AND `bin/oracle-cli.ts:1006`. Both must be updated together.
- Engine resolution: Perplexity uses explicit `'browser'` return when no `PERPLEXITY_API_KEY` (never falls through to OpenAI check)
- Perplexity action files accept `Page` (Playwright), ChatGPT action files accept `ChromeClient` (CDP)
- `browserConfig.desiredModel`: ChatGPT gets browser label (`'GPT-5.2 Pro'`), Perplexity gets raw model name (`'sonar-deep-research'`). Perplexity executor derives the browser label internally via `PERPLEXITY_MODEL_LABELS`.
