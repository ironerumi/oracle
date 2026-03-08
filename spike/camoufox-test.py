"""
Spike: Can Camoufox headless bypass Perplexity's Cloudflare?

Run: uv run --with camoufox spike/camoufox-test.py

If camoufox binary not yet fetched:
  uv run --with camoufox python -c "from camoufox import Camoufox; print('ready')"
  (auto-downloads on first import)
"""

import sys
import json
from pathlib import Path

from camoufox.sync_api import Camoufox

PERPLEXITY_URL = "https://www.perplexity.ai/"
CLOUDFLARE_TITLES = ["just a moment", "しばらくお待ちください"]
COOKIE_FILE = Path.home() / ".oracle" / "perplexity-cookies.json"


def test_cloudflare_bypass(headless: bool = True) -> bool:
    """Phase A: just hit perplexity.ai and check if Cloudflare blocks."""
    mode = "headless" if headless else "headed"
    print(f"\n--- Phase A: Cloudflare bypass test ({mode}) ---")

    with Camoufox(headless=headless) as browser:
        page = browser.new_page()
        print(f"Navigating to {PERPLEXITY_URL} ...")
        page.goto(PERPLEXITY_URL, wait_until="domcontentloaded", timeout=30000)

        # Wait a bit for any Cloudflare challenge to resolve or block
        page.wait_for_timeout(5000)

        title = page.title()
        url = page.url
        print(f"Title: {title}")
        print(f"URL:   {url}")

        blocked = any(t in title.lower() for t in CLOUDFLARE_TITLES)
        if blocked:
            print("RESULT: BLOCKED by Cloudflare")
            return False
        else:
            print("RESULT: PASSED Cloudflare")
            return True


def test_authenticated(headless: bool = True) -> bool:
    """Phase B: inject cookies and verify logged-in state."""
    print(f"\n--- Phase B: Authenticated flow test ---")

    if not COOKIE_FILE.exists():
        print(f"Cookie file not found: {COOKIE_FILE}")
        print("Skipping Phase B.")
        return False

    cookies_raw = json.loads(COOKIE_FILE.read_text())
    # Convert oracle cookie format to Playwright format
    pw_cookies = []
    for c in cookies_raw:
        pw_cookie = {
            "name": c.get("name", ""),
            "value": c.get("value", ""),
            "domain": c.get("domain", ".perplexity.ai"),
            "path": c.get("path", "/"),
        }
        if c.get("secure"):
            pw_cookie["secure"] = True
        if c.get("httpOnly"):
            pw_cookie["httpOnly"] = True
        if c.get("sameSite"):
            ss = c["sameSite"].capitalize()
            if ss in ("Strict", "Lax", "None"):
                pw_cookie["sameSite"] = ss
        pw_cookies.append(pw_cookie)

    with Camoufox(headless=headless) as browser:
        context = browser.new_context()
        context.add_cookies(pw_cookies)
        page = context.new_page()

        print(f"Navigating to {PERPLEXITY_URL} with cookies...")
        page.goto(PERPLEXITY_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        title = page.title()
        url = page.url
        print(f"Title: {title}")
        print(f"URL:   {url}")

        blocked = any(t in title.lower() for t in CLOUDFLARE_TITLES)
        if blocked:
            print("RESULT: BLOCKED by Cloudflare (even with cookies)")
            return False

        # Check if logged in by looking for user-specific elements
        logged_in = page.evaluate("""() => {
            // Check for profile/settings indicators
            const hasProfile = !!document.querySelector('[data-testid="user-menu"]') ||
                               !!document.querySelector('img[alt*="avatar"]') ||
                               !!document.querySelector('button[aria-label*="settings"]');
            // Check for login button (indicates NOT logged in)
            const hasLogin = !!document.querySelector('a[href*="login"]') ||
                             !![...document.querySelectorAll('button')].some(b => b.textContent.includes('Sign'));
            return { hasProfile, hasLogin };
        }""")
        print(f"Profile indicators: {logged_in}")

        if logged_in.get("hasProfile") or not logged_in.get("hasLogin"):
            print("RESULT: Logged in successfully")
            return True
        else:
            print("RESULT: Cloudflare passed but NOT logged in (cookie issue?)")
            return False


if __name__ == "__main__":
    headless = "--headed" not in sys.argv

    phase_a = test_cloudflare_bypass(headless=headless)

    if phase_a:
        test_authenticated(headless=headless)
    else:
        print("\nPhase A failed. Try with --headed to confirm it's a headless-specific block:")
        print("  uv run --with camoufox spike/camoufox-test.py --headed")
