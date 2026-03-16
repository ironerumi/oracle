#!/usr/bin/env -S npx tsx
/**
 * Export Perplexity cookies from Chrome to ~/.oracle/perplexity-cookies.json
 * Usage: npx tsx scripts/export-perplexity-cookies.ts ["Profile 2"]
 */
import { getCookies } from '@steipete/sweet-cookie';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const profile = process.argv[2] || 'Profile 2';
const outPath = resolve(homedir(), '.oracle/perplexity-cookies.json');

async function main() {
  console.log(`Reading Perplexity cookies from Chrome profile: "${profile}"`);

  const { cookies, warnings } = await getCookies({
    url: 'https://www.perplexity.ai/',
    origins: ['https://www.perplexity.ai', 'https://perplexity.ai'],
    browsers: ['chrome'],
    mode: 'merge',
    chromeProfile: profile,
    timeoutMs: 10_000,
  });

  if (warnings.length) {
    console.log(`Warnings: ${warnings.join(', ')}`);
  }

  const mapped = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: c.secure ?? true,
    httpOnly: c.httpOnly ?? false,
    ...(c.sameSite && c.sameSite !== 'None' ? { sameSite: c.sameSite } : {}),
    ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
  }));

  // Deduplicate by domain:name
  const seen = new Map<string, typeof mapped[number]>();
  for (const c of mapped) {
    const key = `${c.domain}:${c.name}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  const deduped = Array.from(seen.values());

  mkdirSync(resolve(homedir(), '.oracle'), { recursive: true });
  writeFileSync(outPath, JSON.stringify(deduped, null, 2));

  const authToken = deduped.find(c => c.name === '__Secure-next-auth.session-token');
  const expDays = authToken?.expires ? ((authToken.expires - Date.now() / 1000) / 86400).toFixed(1) : 'N/A';

  console.log(`Exported ${deduped.length} cookies → ${outPath}`);
  console.log(`Auth token expires in: ${expDays} days`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
