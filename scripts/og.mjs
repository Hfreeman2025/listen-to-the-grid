// The social preview (public/og.png, 1200×630) and touch icon
// (public/apple-touch-icon.png, 180×180), made from the real page and the
// real favicon. Run after a build; rebuild afterwards to ship them.
//
//   npm run build && node scripts/og.mjs && npm run build

import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { launchSilent, silentContext } from './silent.mjs';

// Serves dist/ by default; DIST=dist-next tests a build made beside a dist/ that is in use.
const server = await preview({
  build: { outDir: process.env.DIST ?? 'dist' },
  preview: { host: '127.0.0.1', port: 4189, strictPort: true },
  logLevel: 'warn',
});
const browser = await launchSilent(chromium, 'chromium');

const og = await (await silentContext(browser, { viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await og.goto('http://127.0.0.1:4189/', { waitUntil: 'networkidle' });
await og.evaluate(() => document.fonts.ready);
// The opening page: the half-hours just past, then the live bar caught late, when it is fullest.
await og.waitForFunction(() => (document.querySelector('#score')?.dataset.past ?? '').split(',').length === 3, null, { timeout: 20000 });
const bar = await og.evaluate(() => Number(document.querySelector('#score')?.dataset.bar ?? '0'));
await og.waitForFunction((k) => Number(document.querySelector('#score')?.dataset.bar) > k, bar, { timeout: 20000, polling: 20 });
await og.waitForTimeout(2000);
await og.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1200, height: 630 } });

const icon = await (await silentContext(browser, { viewport: { width: 180, height: 180 } })).newPage();
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
await icon.setContent(`<html><body style="margin:0">${svg.replace('<svg ', '<svg width="180" height="180" ')}</body></html>`);
await icon.screenshot({
  path: new URL('../public/apple-touch-icon.png', import.meta.url).pathname,
  clip: { x: 0, y: 0, width: 180, height: 180 },
});

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
console.log('wrote public/og.png and public/apple-touch-icon.png');
