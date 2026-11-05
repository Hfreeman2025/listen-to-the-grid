// Every state of the page, at desktop (1440×900) and phone (390×844) sizes,
// with behaviour checks, in Chromium, WebKit and Firefox, one browser at a
// time. Screenshots go to shots/ (not kept in the repository).
//
//   npm run build && npm run shots
//   node scripts/shoot.mjs --browsers chromium --only live,record
//
// Each API URL is fetched from NESO once per run and replayed from memory to
// every page and browser, so a full run costs NESO a handful of requests.
// Every browser is silent and opens no audio device (see silent.mjs).

import { mkdir } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';
import { preview } from 'vite';
import { createHarness } from './shoot/harness.mjs';
import { shootOssia } from './shoot/ossia.mjs';
import { shootRecord } from './shoot/record.mjs';
import { shootScore } from './shoot/score.mjs';
import { launchSilent } from './silent.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = arg('--only')?.split(',') ?? null;
const browsers = (arg('--browsers') ?? 'chromium,webkit,firefox').split(',');
const ENGINES = { chromium, webkit, firefox };

// Serves dist/ by default; DIST=dist-next tests a build made beside a dist/ that is being served.
const server = await preview({
  build: { outDir: process.env.DIST ?? 'dist' },
  preview: { host: '127.0.0.1', port: 4189, strictPort: true },
  logLevel: 'warn',
});
// SHOTS=name keeps a run's screenshots apart, in shots/name/.
const outDir = new URL(`../shots/${process.env.SHOTS ? `${process.env.SHOTS}/` : ''}`, import.meta.url);
await mkdir(new URL('browsers/', outDir), { recursive: true });
const h = await createHarness({ base: 'http://127.0.0.1:4189/', outDir, only });

for (const name of browsers) {
  h.useBrowser(name);
  const browser = await launchSilent(ENGINES[name], name, ['--autoplay-policy=no-user-gesture-required']);
  // Chromium runs every session at both sizes; WebKit and Firefox at the desktop size.
  const full = name === 'chromium';
  const run = { browser, full, sizes: full ? ['desktop', 'phone'] : ['desktop'], h };
  await shootScore(run);
  await shootRecord(run);
  await shootOssia(run);
  h.check(
    'type: no request to Google Fonts, in any session',
    !h.fontRequests.has(name),
    (h.fontRequests.get(name) ?? []).slice(0, 2).join(' '),
  );
  await browser.close();
}

await new Promise((resolve) => server.httpServer.close(resolve));
if (!h.report(browsers)) process.exitCode = 1;
