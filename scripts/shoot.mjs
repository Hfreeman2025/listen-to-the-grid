// Every state of the page, at desktop (1440×900) and phone (390×844) sizes,
// into shots/v2/, with behaviour checks run in Chromium, WebKit and Firefox.
//
//   npm run build && npm run shots
//   node scripts/shoot.mjs --browsers chromium --only live,record
//
// Each API URL is fetched from NESO once per run and replayed from memory to
// every page and browser, so a full run costs NESO a handful of requests.
// Every browser is silent and opens no audio device (see silent.mjs).
import { chromium, webkit, firefox } from 'playwright';
import { launchSilent, silentContext } from './silent.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, preview } from 'vite';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = arg('--only')?.split(',') ?? null;
const browsers = (arg('--browsers') ?? 'chromium,webkit,firefox').split(',');
const ENGINES = { chromium, webkit, firefox };

// Serves dist/ by default; DIST=dist-next tests a build made beside a dist/ that is in use.
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { host: '127.0.0.1', port: 4189, strictPort: true }, logLevel: 'warn' });
const base = 'http://127.0.0.1:4189/';
// SHOTS=v3 writes this round's screenshots to shots/v3/.
const round = process.env.SHOTS ?? 'v2';
const outDir = new URL(`../shots/${round}/`, import.meta.url);
await mkdir(new URL('browsers/', outDir), { recursive: true });

// The page's own BS.1770 meter, loaded into Node, to re-measure the WAV files the page hands over.
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, logLevel: 'warn' });
const { integratedLoudness } = await vite.ssrLoadModule('/src/audio/loudness.ts');
await vite.close();
/** Integrated loudness of a 16-bit PCM WAV as the page writes it (fmt, then data at byte 36). */
function wavLoudness(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const channels = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const size = view.getUint32(40, true);
  const frames = size / (2 * channels);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = view.getInt16(44 + (i * channels + c) * 2, true) / 32768;
  return integratedLoudness(out, rate).integrated;
}

const cache = new Map();
const results = [];
/** Any request to Google's font servers, per browser: the type is served from the page itself. */
const fontRequests = new Map();
const problems = [];
let browserName = '';

function check(name, ok, detail = '') {
  results.push({ browser: browserName, name, ok: !!ok, detail });
}

async function routeApi(page, { offline = false, delay = 0, fail = null, slow = null } = {}) {
  await page.route('https://api.carbonintensity.org.uk/**', async (route) => {
    const key = route.request().url();
    if (offline) return route.abort('internetdisconnected');
    if (fail && fail.test(key)) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"500","message":"test"}}', headers: { 'access-control-allow-origin': '*' } });
    }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (slow && slow.test(key)) await new Promise((r) => setTimeout(r, 6000));
    if (!cache.has(key)) {
      const res = await fetch(key, { headers: { Accept: 'application/json' } });
      cache.set(key, { status: res.status, body: await res.text() });
    }
    const hit = cache.get(key);
    return route.fulfill({ status: hit.status, contentType: 'application/json', body: hit.body, headers: { 'access-control-allow-origin': '*' } });
  });
}

const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function session(browser, name, size, options, fn) {
  if (only && !only.includes(name)) return;
  const ctxOptions = { ...SIZES[size], ...(options.context ?? {}) };
  if (browserName === 'firefox') delete ctxOptions.isMobile;
  const context = await silentContext(browser, { ...ctxOptions, acceptDownloads: true });
  const page = await context.newPage();
  const expected = (text) =>
    ((options.offline || options.fail) && /carbonintensity|Failed to load resource|NetworkError|internet connection|ERR_INTERNET_DISCONNECTED|status of 500/i.test(text)) ||
    // Served by Vite's preview (Vary: Origin, no-cache), WebKit doesn't reuse
    // a `crossorigin` font preload, and fetches the three preloaded faces
    // twice; on a plain static server it does reuse them (see the README's
    // note on type). That message, for those three files, is allowed in
    // WebKit; any other warning still fails.
    (browserName === 'webkit' && /^The resource \S+\/fonts\/(ibm-plex-sans-latin-(400|500)-normal|ibm-plex-sans-condensed-latin-600-normal)\.woff2 was preloaded using link preload but not used/.test(text));
  page.on('pageerror', (e) => problems.push(`${browserName} ${name}/${size}: ${e.message}`));
  page.on('request', (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) fontRequests.set(browserName, [...(fontRequests.get(browserName) ?? []), r.url()]);
  });
  // Playwright's WebKit screenshotter (inPagePrepareForScreenshots, in
  // playwright-core's screenshotter.ts) injects <style>body {}</style> to sync
  // animations, and this page's Content-Security-Policy refuses it. That one
  // message, straight after our own screenshot, is the tool, not the page;
  // any other report still fails the run.
  let lastShot = 0;
  const ours = (text) => browserName === 'webkit' && Date.now() - lastShot < 2000 && /^Refused to apply a stylesheet/.test(text);
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !expected(m.text()) && !ours(m.text())) problems.push(`${browserName} ${name}/${size} console ${m.type()}: ${m.text()}`);
  });
  if (process.env.TRACE_CSP) {
    // Debugging aid: say exactly what a Content-Security-Policy report is about.
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.log(`CSP ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
      });
      new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) if (n.nodeName === 'STYLE') console.log(`CSP <style> added: ${(n.textContent ?? '').slice(0, 140)}`);
      }).observe(document, { childList: true, subtree: true });
    });
    page.on('console', (m) => {
      if (m.text().startsWith('CSP ')) console.log(`  ${browserName} ${name}: ${m.text()}`);
    });
  }
  if (!options.noRoute) await routeApi(page, options);
  if (options.init) await page.addInitScript(options.init);
  await page.goto(new URL(options.query ?? '', base).href, { waitUntil: options.delay || options.slow ? 'domcontentloaded' : 'networkidle' });
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

const text = (page, sel) => page.locator(sel).innerText();
const canvasHash = (page, sel = '#score') =>
  page.evaluate((s) => {
    const data = document.querySelector(s).toDataURL();
    let h = 0;
    for (let i = 0; i < data.length; i += 7) h = (h * 31 + data.charCodeAt(i)) | 0;
    return h;
  }, sel);
const fonts = (page) => page.evaluate(() => document.fonts.ready.then(() => true));
const scoreData = (page) => page.evaluate(() => ({ ...document.querySelector('#score').dataset }));
/** "17:30" → the n half-hours before it, as the page labels them. */
const halfHoursBefore = (hhmm, n) => {
  const [h, m] = hhmm.split(':').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = (((h * 60 + m - 30 * (n - i)) % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  });
};

for (const name of browsers) {
  browserName = name;
  const browser = await launchSilent(ENGINES[name], name, ['--autoplay-policy=no-user-gesture-required']);
  const full = name === 'chromium';
  const sizes = full ? ['desktop', 'phone'] : ['desktop'];

  for (const size of full ? ['desktop', 'phone'] : []) {
    await session(browser, 'loading', size, { delay: 4000 }, async (page, shot) => {
      await page.waitForTimeout(900);
      await shot(`loading-${size}.png`);
      check(`loading/${size}: says it is asking NESO`, /Asking NESO/.test(await text(page, '#status')));
    });
  }

  for (const size of sizes) {
    await session(browser, 'live', size, {}, async (page, shot) => {
      await fonts(page);
      await page.waitForTimeout(2600);
      await shot(`live-${size}.png`);
      const status = (await text(page, '#status')).trim();
      check(`live/${size}: status names a half-hour`, /^(Live|Latest available):? \d\d:\d\d–\d\d:\d\d (GMT|BST)/.test(status), status);
      // The first page is full: the half-hours before now, engraved, then the live bar.
      const start = status.match(/(\d\d:\d\d)–/)?.[1] ?? '';
      const opened = await scoreData(page);
      const want = halfHoursBefore(start, size === 'desktop' ? 3 : 1).join(',');
      check(`live/${size}: opens on a full page, the half-hours before now then the live bar`, opened.page === 'standing' && opened.past === want && opened.now === `${start} live`, `${opened.past} | ${opened.now}`);
      const a = await canvasHash(page);
      await page.waitForTimeout(700);
      check(`live/${size}: the score writes itself before sound starts`, a !== (await canvasHash(page)));
      // Layout shift is a Chromium measurement; the others don't report it.
      if (full) {
        const cls = await page.evaluate(
          () =>
            new Promise((resolve) => {
              let sum = 0;
              const moved = [];
              new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                  if (e.hadRecentInput) continue;
                  sum += e.value;
                  for (const src of e.sources) moved.push(`${Math.round(e.startTime)}ms ${src.node?.id ? '#' + src.node.id : (src.node?.nodeName ?? '?')} ${Math.round(src.previousRect.x)}->${Math.round(src.currentRect.x)}`);
                }
              }).observe({ type: 'layout-shift', buffered: true });
              setTimeout(() => resolve({ sum, moved }), 300);
            }),
        );
        check(`live/${size}: no layout shift as the page, its data and its type arrive`, cls.sum < 0.00005, `${cls.sum.toFixed(5)}${cls.moved.length ? `: ${cls.moved.slice(0, 4).join(', ')}` : ''}`);
      }
      if (size === 'desktop' && full) {
        await page.keyboard.press('m');
        check('keys: M mutes', (await page.locator('#mute').getAttribute('aria-pressed')) === 'true');
        await page.keyboard.press('m');
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(200);
        check('keys: ← scrubs back half an hour', /^Replaying/.test((await text(page, '#status')).trim()));
        const back = await scoreData(page);
        const earlier = halfHoursBefore(start, 4);
        check('keys: ← moves the page back a half-hour, the held bar not called live', back.past === earlier.slice(0, 3).join(',') && back.now === earlier[3], `${back.past} | ${back.now}`);
        await page.keyboard.press('l');
        await page.waitForTimeout(200);
        check('keys: L returns to live', !/^Replaying/.test((await text(page, '#status')).trim()));
        await page.focus('#region');
        await page.keyboard.press('y');
        await page.waitForTimeout(200);
        check('keys: typing in the region list is not a shortcut', !/^Replaying/.test((await text(page, '#status')).trim()));
        await page.evaluate(() => document.activeElement?.blur());
        await page.locator('#shortcuts').uncheck();
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('m');
        check('keys: single-key shortcuts can be switched off', (await page.locator('#mute').getAttribute('aria-pressed')) === 'false');
        await page.locator('#shortcuts').check();
      }
    });

    await session(browser, 'playing', size, {}, async (page, shot) => {
      await fonts(page);
      await page.click('#play');
      await page.waitForTimeout(6000);
      await shot(`playing-${size}.png`);
      check(`playing/${size}: the button now pauses`, (await text(page, '#play')).trim() === 'Pause');
      if (size === 'desktop') {
        await page.click('#play');
        await page.waitForTimeout(600);
        check('playing: pause works', (await text(page, '#play')).trim() === 'Resume');
        await page.click('#play');
        await page.waitForTimeout(400);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(200);
        await page.click('#onwards');
        await page.waitForTimeout(600);
        check('playing: "Play on from here" plays', (await text(page, '#play')).trim() === 'Pause');
      }
    });

    await session(browser, 'replay', size, {}, async (page, shot) => {
      await fonts(page);
      await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
      await page.click('#yesterday-quick');
      await page.waitForTimeout(18500);
      await shot(`replay-morning-${size}.png`);
      check(`replay/${size}: a running clock under the credit`, /\d\d:\d\d (GMT|BST)$/.test((await text(page, '#when-short')).trim()), await text(page, '#when-short'));
      check(`replay/${size}: the status names the day being replayed`, /^Replaying \w+day \d+ \w+ \d{4}$/.test((await text(page, '#status')).trim()), await text(page, '#status'));
      check(`replay/${size}: a replayed day is written on pages of its own`, (await scoreData(page)).page === 'flowing');
      if (size === 'desktop') {
        await page.waitForTimeout(13000);
        await shot(`replay-afternoon-${size}.png`);
      }
    });

    await session(browser, 'region', size, { query: '?region=north-scotland' }, async (page, shot) => {
      await fonts(page);
      await page.waitForTimeout(2600);
      await shot(`region-north-scotland-${size}.png`);
      const status = await text(page, '#status');
      check(`region/${size}: a region link opens that region, labelled modelled`, /North Scotland, live: .*\(modelled estimate\)/.test(status), status);
      if (size === 'desktop') {
        await page.selectOption('#region', 'south-wales');
        await page.waitForFunction(() => /South Wales/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 15000 });
        await page.waitForTimeout(3000);
        check('region: choosing one updates the address', new URL(page.url()).searchParams.get('region') === 'south-wales');
      }
    });

    await session(browser, 'offline', size, { offline: true }, async (page, shot) => {
      await fonts(page);
      await page.waitForTimeout(2600);
      await shot(`offline-${size}.png`);
      const status = await text(page, '#status');
      check(`offline/${size}: says so and dates the sample`, /Offline\. Playing a recorded sample: Wednesday 28 October 2026/.test(status), status);
      const held = await scoreData(page);
      check(`offline/${size}: never claims to be live, on the score either`, !/\bLive\b/.test(status + (await text(page, '#when'))) && !/live/i.test(held.now) && held.page === 'standing' && held.past.length > 0, `${held.past} | ${held.now}`);
    });
  }

  // The week (NESO's range requests) arriving late, or not at all: the bars
  // before the live one wait empty and say why, then fill when it comes.
  const WEEK = /\/(generation|intensity)\/\d{4}-/;
  await session(browser, 'week', 'desktop', { slow: WEEK }, async (page, shot) => {
    await fonts(page);
    await page.waitForFunction(() => document.querySelector('#score')?.dataset.page === 'standing', null, { timeout: 15000 });
    await page.waitForTimeout(600);
    if (full) await shot('week-loading-desktop.png');
    const waiting = await scoreData(page);
    check('week: while the week loads, the earlier bars wait and say so', waiting.past === '' && /on their way/.test(waiting.note) && / live$/.test(waiting.now), `${waiting.note} | ${waiting.now}`);
    await page.waitForFunction(() => (document.querySelector('#score')?.dataset.past ?? '').split(',').length === 3, null, { timeout: 15000 });
    check('week: and fill with the half-hours before when it arrives', true);
  });
  await session(browser, 'week-failed', 'desktop', { fail: WEEK }, async (page, shot) => {
    await fonts(page);
    await page.waitForFunction(() => /unavailable/.test(document.querySelector('#score')?.dataset.note ?? ''), null, { timeout: 15000 });
    if (full) await shot('week-unavailable-desktop.png');
    check('week-failed: a failed week leaves the earlier bars empty and says so', (await scoreData(page)).past === '');
  });

  for (const size of sizes) await session(browser, 'reduced', size, { context: { reducedMotion: 'reduce' } }, async (page, shot) => {
    await fonts(page);
    await page.waitForTimeout(2600);
    await shot(`reduced-motion-${size}.png`);
    check(`reduced/${size}: a full page too`, (await scoreData(page)).past.split(',').length === (size === 'desktop' ? 3 : 1));
    // Nothing moves within a bar: sample just after a bar line and again 1.6 s later.
    const bar = () => page.evaluate(() => Number(document.querySelector('#score')?.dataset.bar ?? '-1'));
    const b = await bar();
    await page.waitForFunction((k) => Number(document.querySelector('#score')?.dataset.bar) > k, b, { polling: 20 });
    await page.waitForTimeout(150);
    const b0 = await bar();
    const a = await canvasHash(page);
    await page.waitForTimeout(1600);
    const b1 = await bar();
    check(`reduced/${size}: the score holds still within a bar`, b0 === b1 && a === (await canvasHash(page)), `bars ${b0}/${b1}`);
  });

  await session(browser, 'background', 'desktop', {}, async (page) => {
    await page.click('#play');
    await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
    await page.evaluate(() => {
      window.__raf = window.requestAnimationFrame;
      window.__held = [];
      window.requestAnimationFrame = (cb) => (window.__held.push(cb), 0);
    });
    await page.waitForTimeout(300);
    await page.click('#yesterday-quick');
    await page.waitForTimeout(10500);
    await page.evaluate(() => {
      window.requestAnimationFrame = window.__raf;
      for (const cb of window.__held) window.requestAnimationFrame(cb);
    });
    await page.waitForTimeout(400);
    const clock = (await text(page, '#when-short')).trim();
    const hour = Number(clock.match(/(\d\d):\d\d/)?.[1]);
    check('background: a replay keeps time with no animation frames', hour >= 3 && hour <= 5, clock);
  });

  for (const size of sizes) {
    await session(browser, 'record', size, {}, async (page, shot) => {
      await fonts(page);
      await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
      await page.locator('#record').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shot(`record-ready-${size}.png`);
      check(`record/${size}: yesterday's sleeve is ready before pressing`, /The sleeve for/.test(await text(page, '#sleeve-caption')));
      const started = Date.now();
      await page.click('#record-press');
      if (size === 'desktop') {
        await page.waitForFunction(() => /Pressing .*: [1-9]\d?%/.test(document.querySelector('#record-status')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => undefined);
        await shot(`record-pressing-${size}.png`);
      }
      await page.waitForSelector('#record-result:not([hidden])', { timeout: 180000 });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      await page.waitForTimeout(300);
      await shot(`record-done-${size}.png`);
      // Download both files the way a listener would, and read them back.
      const save = async (sel) => {
        const [download] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
      };
      const wav = await save('#record-wav');
      // Keep yesterday's record from the desktop run, for listening.
      if (size === 'desktop' && full && round === 'v2') await writeFile(new URL('yesterday.wav', outDir), wav.bytes);
      const lufs = wavLoudness(wav.bytes);
      check(`record/${size}: the WAV itself measures -16 LUFS (BS.1770, re-measured in Node), as its notes say`, Math.abs(lufs + 16) <= 0.15 && /-16\.0 LUFS|−16\.0 LUFS/.test((await text(page, '#record-notes')).replace('−', '-')), `${lufs.toFixed(2)} LUFS`);
      check(`record/${size}: a real record never carries the ossia's name`, !/ossia/i.test(wav.name), wav.name);
      const png = await save('#record-png');
      const view = new DataView(wav.bytes.buffer, wav.bytes.byteOffset);
      const tag = (o) => String.fromCharCode(...wav.bytes.slice(o, o + 4));
      const file = { riff: tag(0), wave: tag(8), size: wav.bytes.length, rate: view.getUint32(24, true), name: wav.name, png: png.bytes.length, pngSig: png.bytes[1] === 0x50 && png.bytes[2] === 0x4e };
      check(
        `record/${size}: a valid WAV at 44.1 kHz, about a minute (pressed in ${seconds} s)`,
        file.riff === 'RIFF' && file.wave === 'WAVE' && file.rate === 44100 && file.size > 9e6 && file.size < 13e6,
        `${(file.size / 1e6).toFixed(1)} MB ${file.name}`,
      );
      check(`record/${size}: a PNG sleeve to download`, file.pngSig && file.png > 100000, `${(file.png / 1e6).toFixed(2)} MB`);
      if (size === 'desktop' && full) {
        await page.click('#record-play');
        await page.waitForTimeout(3500);
        await shot('record-playing-desktop.png');
        check('record: plays here, with a stop button', (await text(page, '#record-play')).trim() === 'Stop the record');
      }
    });
  }

  // Type: the three faces the first screen is set in are preloaded and used,
  // with nothing intercepted.
  await session(browser, 'preload', 'desktop', { noRoute: true }, async (page) => {
    await fonts(page);
    await page.waitForTimeout(6000);
    const used = await page.evaluate(() => ['IBM Plex Sans', 'IBM Plex Sans Condensed'].every((f) => document.fonts.check(`16px "${f}"`)) && [...document.fonts].some((f) => f.family.includes('Plex') && f.status === 'loaded'));
    const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="font"]')].length);
    check('type: three fonts preloaded and used, with no request intercepted', used && preloads === 3, `${preloads} preloads`);
  });

  // The ossia: the same moment re-scored as a fully renewable grid. Counts
  // AudioContexts to prove that switching it never restarts the sound.
  const countContexts = () => {
    const Base = window.AudioContext;
    let made = 0;
    window.__contexts = () => made;
    window.AudioContext = class extends Base {
      constructor(...args) {
        super(...args);
        made++;
      }
    };
  };
  for (const size of sizes) {
    await session(browser, 'ossia', size, { init: countContexts }, async (page, shot) => {
      await fonts(page);
      await page.click('#play');
      await page.waitForTimeout(1200);
      const statusBefore = (await text(page, '#status')).trim();
      const b0 = Number((await scoreData(page)).bar);
      await page.click('#ossia');
      await page.waitForTimeout(2600);
      await shot(`ossia-live-${size}.png`);
      const on = await scoreData(page);
      const label = await page.locator('#score').getAttribute('aria-label');
      check(`ossia/${size}: printed over the live bar, called hypothetical`, on.ossia === 'on' && /hypothetical, fully renewable/.test(label ?? '') && (await page.locator('#ossia').getAttribute('aria-pressed')) === 'true');
      check(`ossia/${size}: switches the sound in place, no restart`, (await page.evaluate(() => window.__contexts())) === 1 && (await text(page, '#play')).trim() === 'Pause' && Number(on.bar) >= b0, `contexts ${await page.evaluate(() => window.__contexts())}, bars ${b0}→${on.bar}`);
      const statusAfter = (await text(page, '#status')).trim();
      check(`ossia/${size}: never in the Live label, nor the live bar's cue`, statusAfter.replace(/\d\d:\d\d.*$/, '') === statusBefore.replace(/\d\d:\d\d.*$/, '') && !/ossia|renewable|hypothetical|\b0 g CO/i.test(statusAfter) && !/ossia/i.test(on.now), `${statusAfter} | ${on.now}`);
      const table = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ossia-table tr')].map((tr) => [tr.querySelector('th')?.textContent ?? 'head', [...tr.querySelectorAll('td')].map((td) => td.textContent)])));
      const silenced = ['Gas', 'Coal', 'Nuclear', 'Biomass', 'Imports', 'Other'].every((f) => table[f]?.[1] === '0%');
      const kept = ['Wind', 'Solar', 'Hydro'].reduce((sum, f) => sum + Number((table[f]?.[1] ?? '0').replace(/[<%]/g, '')), 0);
      check(`ossia/${size}: shows its rule and numbers, real beside ossia`, (await page.locator('#ossia-notes').isVisible()) && silenced && kept >= 98 && kept <= 102 && table['Carbon intensity']?.[1] === '0 g CO₂/kWh' && /Lydian/.test(table['Key']?.[1] ?? ''), JSON.stringify({ wind: table.Wind, gas: table.Gas, g: table['Carbon intensity'] }));
      await page.locator('#ossia-notes').scrollIntoViewIfNeeded();
      await shot(`ossia-notes-${size}.png`);
      // Loudness: matched by the page's own BS.1770 measurement of both versions, rendered offline here.
      await page.waitForFunction(() => document.querySelector('#ossia-notes')?.dataset.match === 'matched', null, { timeout: 60000 });
      const m = await page.evaluate(() => ({ trim: Number(document.querySelector('#ossia-notes')?.dataset.trim), line: document.querySelector('#ossia-loudness')?.textContent ?? '', cells: [...document.querySelectorAll('#ossia-table tr')].filter((tr) => /Loudness|Level/.test(tr.querySelector('th')?.textContent ?? '')).map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)) }));
      const realL = Number((m.cells[0]?.[0] ?? '').replace('−', '-').replace(' LUFS', ''));
      const ossiaL = Number((m.cells[0]?.[1] ?? '').replace('−', '-').replace(' LUFS', ''));
      check(`ossia/${size}: measured in a worker, off the main thread`, await page.evaluate(() => performance.getEntriesByType('resource').some((r) => /loudness\.worker/.test(r.name))));
      check(`ossia/${size}: loudness-matched with BS.1770, the trim equal to the measured gap`, /ITU-R BS\.1770/.test(m.line) && Math.abs(m.trim - (realL - ossiaL)) <= 0.11 && m.trim < 0 && m.trim > -6, `real ${realL}, ossia ${ossiaL}, trim ${m.trim} dB`);
      await page.locator('#ossia-notes').scrollIntoViewIfNeeded();
      await shot(`ossia-loudness-${size}.png`);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('o');
      await page.waitForTimeout(400);
      check(`ossia/${size}: O switches it off again, still without a restart`, (await scoreData(page)).ossia === '' && (await page.locator('#ossia-notes').isHidden()) && (await page.evaluate(() => window.__contexts())) === 1);
    });
    await session(browser, 'ossia-replay', size, {}, async (page, shot) => {
      await fonts(page);
      await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
      await page.click('#ossia');
      await page.click('#yesterday-quick');
      await page.waitForTimeout(9000);
      await shot(`ossia-replay-${size}.png`);
      const d = await scoreData(page);
      check(`ossia-replay/${size}: a replayed day carries the ossia over every bar`, d.page === 'flowing' && d.ossia === 'on' && /^Replaying/.test((await text(page, '#status')).trim()));
    });
  }
  if (full) {
    await session(browser, 'ossia-sleeve', 'phone', {}, async (page, shot) => {
      await fonts(page);
      await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
      await page.click('#ossia');
      await page.locator('#record').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shot('ossia-record-ready-phone.png');
      check('ossia-sleeve/phone: the sleeve says ossia before pressing', /ossia sleeve/.test(await text(page, '#sleeve-caption')));
    });
  }
  await session(browser, 'ossia-record', 'desktop', {}, async (page, shot) => {
    await fonts(page);
    await page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 20000 });
    await page.click('#ossia');
    await page.locator('#record').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shot('ossia-record-ready-desktop.png');
    check('ossia-record: the sleeve and the button say ossia before pressing', /ossia sleeve/.test(await text(page, '#sleeve-caption')) && (await text(page, '#record-press')).trim() === 'Press the ossia record');
    await page.click('#record-press');
    await page.waitForSelector('#record-result:not([hidden])', { timeout: 180000 });
    await page.waitForTimeout(300);
    await shot('ossia-record-done-desktop.png');
    const save = async (sel) => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
      return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
    };
    const wav = await save('#record-wav');
    const png = await save('#record-png');
    const ascii = Buffer.from(wav.bytes).toString('latin1');
    check(
      'ossia-record: its files and tags say ossia and hypothetical',
      /-ossia-fully-renewable-hypothetical\.wav$/.test(wav.name) && /-ossia-fully-renewable-hypothetical-sleeve\.png$/.test(png.name) && /ossia: fully renewable, hypothetical/.test(ascii),
      `${wav.name}, ${png.name}`,
    );
    check('ossia-record: its liner notes say what it is', /Ossia: fully renewable, a hypothetical/.test(await text(page, '#record-notes')));
    const lufs = wavLoudness(wav.bytes);
    check('ossia-record: pressed to the same -16 LUFS as a real record, re-measured from the file', Math.abs(lufs + 16) <= 0.15, `${lufs.toFixed(2)} LUFS`);
  });

  await session(browser, 'record-error', 'desktop', { fail: /2019-03-1/ }, async (page, shot) => {
    await fonts(page);
    await page.locator('#record').scrollIntoViewIfNeeded();
    await page.fill('#record-date', '2019-03-14');
    await page.click('#record-press');
    await page.waitForFunction(() => document.querySelector('#record-status')?.classList.contains('error'), null, { timeout: 20000 });
    await shot('record-error-desktop.png');
    check('record-error: a failed fetch says so and offers another try', /Couldn’t press that day/.test(await text(page, '#record-status')));
  });

  if (full) {
    for (const size of ['desktop', 'phone']) {
      await session(browser, 'notes', size, {}, async (page, shot) => {
        await fonts(page);
        await page.locator('#how').scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await shot(`how-it-sounds-${size}.png`);
        await page.screenshot({ path: new URL(`full-page-${size}.jpg`, outDir).pathname, fullPage: true, type: 'jpeg', quality: 80, caret: 'initial' });
      });
    }
    await session(browser, 'long', 'phone', { query: '?region=north-wales-merseyside' }, async (page, shot) => {
      await fonts(page);
      await page.waitForTimeout(2600);
      await shot('long-region-name-phone.png');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('long: the longest region name fits a phone without sideways scroll', overflow <= 0, `${overflow}px`);
    });
  }

  check('type: no request to Google Fonts, in any session', !fontRequests.has(name), (fontRequests.get(name) ?? []).slice(0, 2).join(' '));
  await browser.close();
}

await new Promise((resolve) => server.httpServer.close(resolve));

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
if (problems.length > 0 || results.some((r) => !r.ok)) process.exitCode = 1;
