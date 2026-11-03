// Performance in Chromium, WebKit and Firefox: when the engraved page first
// appears (the page's first meaningful paint), and frame cost during the
// heaviest animation (a replay: a page turn every 10 s, notes inked every
// frame, the arrangement changing ten times a second, audio playing).
//
//   npm run build && node scripts/perf.mjs
import { chromium, webkit, firefox } from 'playwright';
import { launchSilent, silentContext } from './silent.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { preview } from 'vite';

// Serves dist/ by default; DIST=dist-next tests a build made beside a dist/ that is in use.
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { host: '127.0.0.1', port: 4189, strictPort: true }, logLevel: 'warn' });
const cache = new Map();
const out = {};

const assets = new URL(`../${process.env.DIST ?? 'dist'}/assets/`, import.meta.url);
let js = 0;
let css = 0;
for (const f of await readdir(assets)) {
  const bytes = gzipSync(await readFile(new URL(f, assets))).length;
  if (f.endsWith('.js')) js += bytes;
  if (f.endsWith('.css')) css += bytes;
}
out.shipped = { jsGzipKB: +(js / 1024).toFixed(1), cssGzipKB: +(css / 1024).toFixed(1) };

for (const [name, engine] of Object.entries({ chromium, webkit, firefox })) {
  const browser = await launchSilent(engine, name, ['--autoplay-policy=no-user-gesture-required']);
  // Silent and device-free, so audio rendering costs nothing here: frame times are the page's own work.
  const page = await (await silentContext(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.route('https://api.carbonintensity.org.uk/**', async (route) => {
    const key = route.request().url();
    if (!cache.has(key)) cache.set(key, await (await fetch(key)).text());
    route.fulfill({ status: 200, contentType: 'application/json', body: cache.get(key), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__work = [];
    window.__gaps = [];
    let last = 0;
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        if (last) window.__gaps.push(t - last);
        last = t;
        const s = performance.now();
        cb(t);
        window.__work.push(performance.now() - s);
      });
  });
  await page.goto('http://127.0.0.1:4189/', { waitUntil: 'load' });
  await page.waitForFunction(() => performance.getEntriesByName('score:engraved').length > 0, null, { timeout: 30000 });
  const paint = await page.evaluate(() => ({
    firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    engravedPage: performance.getEntriesByName('score:engraved')[0]?.startTime ?? null,
  }));
  await page.click('#play');
  await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
  await page.click('#yesterday-quick');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__work = [];
    window.__gaps = [];
  });
  const sample = (seconds) =>
    page.evaluate((s) => {
      const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))] ?? 0;
      const w = window.__work;
      const g = window.__gaps;
      return {
        frames: w.length,
        fps: +(w.length / s).toFixed(1),
        workMedianMs: +pct(w, 0.5).toFixed(2),
        workP95Ms: +pct(w, 0.95).toFixed(2),
        workMaxMs: +Math.max(...w).toFixed(1),
        framesOver20ms: g.filter((x) => x > 20).length,
      };
    }, seconds);
  const reset = () =>
    page.evaluate(() => {
      window.__work = [];
      window.__gaps = [];
    });
  await page.waitForTimeout(30000);
  const frames = await sample(30);
  // The heaviest case since the ossia: a replay re-scored hour by hour, each
  // hour's loudness measured offline in the background (both versions
  // rendered, then metered in a worker).
  await page.click('#live-quick');
  await page.click('#ossia');
  await page.click('#yesterday-quick');
  await page.waitForTimeout(1000);
  await reset();
  await page.waitForTimeout(20000);
  const ossia = await sample(20);
  const worker = await page.evaluate(() => performance.getEntriesByType('resource').some((r) => /loudness\.worker/.test(r.name)));
  out[name] = { firstContentfulPaintMs: paint.firstContentfulPaint && Math.round(paint.firstContentfulPaint), engravedPageMs: paint.engravedPage && Math.round(paint.engravedPage), replay30s: frames, ossiaReplay20s: { ...ossia, loudnessWorker: worker } };
  await browser.close();
}
await new Promise((resolve) => server.httpServer.close(resolve));
console.log(JSON.stringify(out, null, 2));
