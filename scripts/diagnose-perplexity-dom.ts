#!/usr/bin/env -S npx tsx
/**
 * Diagnostic script: launch Camoufox, navigate to perplexity.ai, dump DOM structure.
 * Usage: uv run -- npx tsx scripts/diagnose-perplexity-dom.ts
 *   or:  npx tsx scripts/diagnose-perplexity-dom.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  launchCamoufox,
  cdpCookiesToPlaywright,
} from "../src/perplexity-browser/camoufoxLifecycle.js";

const COOKIES_FILE = resolve(homedir(), ".oracle/perplexity-cookies.json");
const SCREENSHOT_PATH = resolve("tmp/perplexity-dom-diag.png");

const log = (msg: string) => console.log(msg);

async function main() {
  // 1. Launch Camoufox
  const { browser, context, page } = await launchCamoufox({ headless: true, log });

  try {
    // 2. Navigate FIRST without cookies (get Camoufox's own cf_clearance)
    log("Navigating to perplexity.ai (no cookies)...");
    await page.goto("https://www.perplexity.ai/", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    // 3. Now inject ONLY auth cookies (no cf_clearance) and reload
    try {
      const raw = JSON.parse(readFileSync(COOKIES_FILE, "utf-8")) as Array<Record<string, unknown>>;
      const authOnly = raw.filter(
        (c: any) =>
          c.name === "__Secure-next-auth.session-token" || c.name === "next-auth.csrf-token",
      );
      const cookies = cdpCookiesToPlaywright(authOnly);
      await context.addCookies(cookies);
      log(`Injected ${cookies.length} auth cookie(s), reloading...`);
    } catch (e) {
      log(`Warning: no cookies loaded (${e})`);
    }
    await page.goto("https://www.perplexity.ai/", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(3000); // React hydration

    // 4. Screenshot
    const { mkdirSync } = await import("node:fs");
    mkdirSync("tmp", { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    log(`Screenshot saved: ${SCREENSHOT_PATH}`);

    // 5. Dump DOM diagnostics
    const diag = await page.evaluate(() => {
      const results: Record<string, unknown> = {};

      // Check current PROMPT_SELECTORS
      const promptSelectors = [
        'div[data-lexical-editor][contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
      ];
      results["promptSelectors"] = promptSelectors.map((sel) => ({
        selector: sel,
        found: !!document.querySelector(sel),
        count: document.querySelectorAll(sel).length,
      }));

      // Find ALL contenteditable elements
      const editables = document.querySelectorAll('[contenteditable="true"]');
      results["allContenteditable"] = Array.from(editables).map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        classes: el.className?.toString().slice(0, 100),
        dataAttrs: Array.from(el.attributes)
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => `${a.name}="${a.value}"`),
        visible: el.getBoundingClientRect().height > 0,
        rect: el.getBoundingClientRect(),
        innerText: (el as HTMLElement).innerText?.slice(0, 50) || "(empty)",
        parentTag: el.parentElement?.tagName.toLowerCase(),
        parentClasses: el.parentElement?.className?.toString().slice(0, 80),
      }));

      // Find ALL textareas
      const textareas = document.querySelectorAll("textarea");
      results["allTextareas"] = Array.from(textareas).map((el) => ({
        name: el.name,
        placeholder: el.placeholder?.slice(0, 50),
        visible: el.getBoundingClientRect().height > 0,
        rect: el.getBoundingClientRect(),
        classes: el.className?.toString().slice(0, 100),
      }));

      // Find elements with role="textbox"
      const textboxes = document.querySelectorAll('[role="textbox"]');
      results["allTextboxes"] = Array.from(textboxes).map((el) => ({
        tag: el.tagName.toLowerCase(),
        contenteditable: el.getAttribute("contenteditable"),
        classes: el.className?.toString().slice(0, 100),
        dataAttrs: Array.from(el.attributes)
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => `${a.name}="${a.value}"`),
        visible: el.getBoundingClientRect().height > 0,
        rect: el.getBoundingClientRect(),
      }));

      // Model picker buttons
      const modelPickerSelectors = [
        'button[aria-label="Select model"]',
        'button[aria-label="モデルを選択"]',
        'button[aria-label="Model"]',
      ];
      results["modelPickerSelectors"] = modelPickerSelectors.map((sel) => ({
        selector: sel,
        found: !!document.querySelector(sel),
        count: document.querySelectorAll(sel).length,
      }));

      // ALL buttons near bottom of page (likely prompt area)
      const allButtons = Array.from(document.querySelectorAll("button"));
      const bottomButtons = allButtons.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.top > window.innerHeight * 0.5 && r.height > 0;
      });
      results["bottomButtons"] = bottomButtons.slice(0, 20).map((b) => ({
        ariaLabel: b.getAttribute("aria-label"),
        text: b.textContent?.trim().slice(0, 50),
        disabled: b.disabled,
        hasSvg: !!b.querySelector("svg"),
        rect: b.getBoundingClientRect(),
        classes: b.className?.toString().slice(0, 80),
      }));

      // Submit button selectors
      const submitSelectors = ['button[aria-label="Submit"]', 'button[aria-label="送信"]'];
      results["submitSelectors"] = submitSelectors.map((sel) => ({
        selector: sel,
        found: !!document.querySelector(sel),
      }));

      // Page title and URL
      results["pageTitle"] = document.title;
      results["pageUrl"] = window.location.href;

      // Check for Cloudflare challenge
      results["isCloudflare"] =
        document.title.toLowerCase().includes("just a moment") ||
        document.title.includes("しばらくお待ちください");

      // Check for login state
      const loginTexts = ["Continue with Google", "Googleで続ける"];
      results["hasLoginPrompt"] = loginTexts.some((t) => document.body.innerText.includes(t));

      return results;
    });

    console.log("\n=== DOM Diagnostics ===\n");
    console.log(JSON.stringify(diag, null, 2));

    // 6. Also dump outer HTML of the prompt area region
    const promptAreaHtml = await page.evaluate(() => {
      // Try to find the main input area by looking for large contenteditable or textareas
      const candidates = [
        ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
        ...Array.from(document.querySelectorAll("textarea")),
      ].filter((el) => el.getBoundingClientRect().height > 0);

      if (candidates.length === 0) return "(no prompt candidates found)";

      // Get the outerHTML of each candidate's parent container (up to 3 levels)
      return candidates
        .map((el) => {
          let container = el.parentElement?.parentElement?.parentElement || el.parentElement || el;
          return container.outerHTML.slice(0, 2000);
        })
        .join("\n\n---CANDIDATE---\n\n");
    });

    console.log("\n=== Prompt Area HTML ===\n");
    console.log(promptAreaHtml);
  } finally {
    await browser.close();
    log("\nBrowser closed.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
