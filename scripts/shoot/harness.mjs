// The browser harness for scripts/shoot.mjs: NESO's API replayed from memory,
// one silent browser context per session, a running list of checks, and the
// page's own BS.1770 meter to re-measure the files it hands over.
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { silentContext } from '../silent.mjs';

const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/**
 * @param {{ base: string, outDir: URL, only: string[] | null }} options
 *   base: where the built page is served; outDir: where screenshots go;
 *   only: run just these sessions, by name.
 */
export async function createHarness({ base, outDir, only }) {
  // The page's own meter, loaded into Node through Vite.
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, entries: [] },
    logLevel: 'warn',
  });
  const { integratedLoudness } = await vite.ssrLoadModule('/src/audio/loudness.ts');
  await vite.close();

  /** Each NESO URL, fetched once per run and replayed to every page and browser. */
  const cache = new Map();
  const results = [];
  const problems = [];
  /** Any request to Google's font servers, per browser: the type is served from the page itself. */
  const fontRequests = new Map();
  let browserName = '';

  function check(name, ok, detail = '') {
    results.push({ browser: browserName, name, ok: !!ok, detail });
  }

  async function routeApi(page, { offline = false, delay = 0, fail = null, slow = null } = {}) {
    await page.route('https://api.carbonintensity.org.uk/**', async (route) => {
      const key = route.request().url();
      if (offline) return route.abort('internetdisconnected');
      if (fail?.test(key)) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":{"code":"500","message":"test"}}',
          headers: { 'access-control-allow-origin': '*' },
        });
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (slow?.test(key)) await new Promise((r) => setTimeout(r, 6000));
      if (!cache.has(key)) {
        const res = await fetch(key, { headers: { Accept: 'application/json' } });
        cache.set(key, { status: res.status, body: await res.text() });
      }
      const hit = cache.get(key);
      return route.fulfill({
        status: hit.status,
        contentType: 'application/json',
        body: hit.body,
        headers: { 'access-control-allow-origin': '*' },
      });
    });
  }

  /**
   * Opens the page in a fresh context at `size`, runs `fn(page, shot)`, and
   * records any page error or console error or warning as a problem. Options:
   * offline, delay, fail and slow shape the API (see routeApi); noRoute leaves
   * it alone; context, init and query shape the page.
   */
  async function session(browser, name, size, options, fn) {
    if (only && !only.includes(name)) return;
    const ctxOptions = { ...SIZES[size], ...(options.context ?? {}) };
    if (browserName === 'firefox') delete ctxOptions.isMobile;
    const context = await silentContext(browser, { ...ctxOptions, acceptDownloads: true });
    const page = await context.newPage();
    const expected = (text) =>
      ((options.offline || options.fail) &&
        /carbonintensity|Failed to load resource|NetworkError|internet connection|ERR_INTERNET_DISCONNECTED|status of 500/i.test(text)) ||
      // Served by Vite's preview (Vary: Origin, no-cache), WebKit doesn't reuse
      // a `crossorigin` font preload, and fetches the three preloaded faces
      // twice; on a plain static server it does reuse them (see the README's
      // note on type). That message, for those three files, is allowed in
      // WebKit; any other warning still fails.
      (browserName === 'webkit' &&
        /^The resource \S+\/fonts\/(ibm-plex-sans-latin-(400|500)-normal|ibm-plex-sans-condensed-latin-600-normal)\.woff2 was preloaded using link preload but not used/.test(
          text,
        )) ||
      // WebKit's native <select> sets a style attribute inside itself, which the
      // policy's style-src-attr 'none' refuses with no visible change. The hosted
      // check (scripts/hosted-check.mjs) proves that is the only such refusal, from
      // the policy's own reports; here, without reports, the message is allowed.
      (browserName === 'webkit' &&
        /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy\.$/.test(
          text,
        ));
    page.on('pageerror', (e) => problems.push(`${browserName} ${name}/${size}: ${e.message}`));
    page.on('request', (r) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(r.url()))
        fontRequests.set(browserName, [...(fontRequests.get(browserName) ?? []), r.url()]);
    });
    // Playwright's WebKit screenshotter (inPagePrepareForScreenshots, in
    // playwright-core's screenshotter.ts) injects <style>body {}</style> to sync
    // animations, and this page's Content-Security-Policy refuses it. That one
    // message, straight after our own screenshot, is the tool, not the page;
    // any other report still fails the run.
    let lastShot = 0;
    const ours = (text) => browserName === 'webkit' && Date.now() - lastShot < 2000 && /^Refused to apply a stylesheet/.test(text);
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !expected(m.text()) && !ours(m.text()))
        problems.push(`${browserName} ${name}/${size} console ${m.type()}: ${m.text()}`);
    });
    if (!options.noRoute) await routeApi(page, options);
    if (options.init) await page.addInitScript(options.init);
    await page.goto(new URL(options.query ?? '', base).href, {
      waitUntil: options.delay || options.slow ? 'domcontentloaded' : 'networkidle',
    });
    const shot = async (file, opts = {}) => {
      const path = browserName === 'chromium' ? new URL(file, outDir) : new URL(`browsers/${browserName}-${file}`, outDir);
      // caret: 'initial' stops Playwright injecting a style of its own, which
      // the page's Content-Security-Policy would (rightly) refuse.
      lastShot = Date.now();
      await page.screenshot({ path: path.pathname, caret: 'initial', ...opts });
      lastShot = Date.now();
    };
    try {
      await fn(page, shot);
    } catch (err) {
      check(`${name}/${size} ran`, false, err.message.split('\n')[0]);
    }
    await context.close();
  }

  /** Integrated loudness of a 16-bit PCM WAV as the page writes it (fmt, then data at byte 36). */
  function wavLoudness(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const channels = view.getUint16(22, true);
    const rate = view.getUint32(24, true);
    const size = view.getUint32(40, true);
    const frames = size / (2 * channels);
    const out = Array.from({ length: channels }, () => new Float32Array(frames));
    for (let i = 0; i < frames; i++)
      for (let c = 0; c < channels; c++) out[c][i] = view.getInt16(44 + (i * channels + c) * 2, true) / 32768;
    return integratedLoudness(out, rate).integrated;
  }

  /** Download a file the way a listener would, and read it back. */
  async function download(page, selector) {
    const [file] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
    return { name: file.suggestedFilename(), bytes: new Uint8Array(await readFile(await file.path())) };
  }

  return {
    outDir,
    session,
    check,
    wavLoudness,
    download,
    /** Sessions and checks from here on belong to this browser. */
    useBrowser(name) {
      browserName = name;
    },
    /** Print every check by browser, then any problems; returns whether everything passed. */
    report(browsers) {
      for (const b of browsers) {
        const mine = results.filter((r) => r.browser === b);
        console.log(`\n${b}: ${mine.filter((r) => r.ok).length}/${mine.length} checks pass`);
        for (const r of mine) console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
      }
      console.log(`\nAPI requests made: ${cache.size}`);
      if (problems.length > 0) {
        console.log('\nconsole errors and warnings:');
        for (const p of problems) console.log(`  ${p}`);
      }
      return problems.length === 0 && results.every((r) => r.ok);
    },
    fontRequests,
  };
}

export const text = (page, sel) => page.locator(sel).innerText();
export const fonts = (page) => page.evaluate(() => document.fonts.ready.then(() => true));
export const scoreData = (page) => page.evaluate(() => ({ ...document.querySelector('#score').dataset }));
/** A cheap fingerprint of a canvas, to tell whether it has changed. */
export const canvasHash = (page, sel = '#score') =>
  page.evaluate((s) => {
    const data = document.querySelector(s).toDataURL();
    let h = 0;
    for (let i = 0; i < data.length; i += 7) h = (h * 31 + data.charCodeAt(i)) | 0;
    return h;
  }, sel);
/** "17:30" → the n half-hours before it, as the page labels them. */
export const halfHoursBefore = (hhmm, n) => {
  const [h, m] = hhmm.split(':').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = (((h * 60 + m - 30 * (n - i)) % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  });
};
/** Wait until the week has arrived, so a replay or a record can begin. */
export const weekReady = (page) =>
  page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
