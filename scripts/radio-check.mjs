// Checks the radio (dist-radio/) the way a page embeds it: vendored under
// /vendor/radio/, behind a strict Content-Security-Policy. Proves that
// play() is the only path to sound: nothing is fetched, made or opened before
// it; it refuses without a click; stop() lets the device go; when NESO can't
// be reached it fails and makes no sound; the ossia is loudness-matched; and
// it fetches only what the piece fetches. Silent, like every script here
// (see silent.mjs), one browser at a time.
//
//   npm run build:radio && node scripts/radio-check.mjs [--browsers chromium,webkit,firefox]
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';
import { launchSilent, silentContext } from './silent.mjs';

const args = process.argv.slice(2);
const browsers = (args.includes('--browsers') ? args[args.indexOf('--browsers') + 1] : 'chromium,webkit,firefox').split(',');
const ENGINES = { chromium, webkit, firefox };
const root = new URL('../dist-radio/', import.meta.url);
const PORT = 4189;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>radio check</title><link rel="icon" href="data:,"></head><body>
<button id="play">play</button> <button id="stop">stop</button> <button id="ossia">play the ossia</button>
<script type="module" src="/embed.js"></script></body></html>`;
const EMBED = `import { createRadio } from '/vendor/radio/listen-to-the-grid-radio.js';
const watch = (radio, into) => { window[into] = []; radio.on('state', (s) => window[into].push(s)); return radio; };
window.radio = watch(createRadio(), 'states');
document.getElementById('play').addEventListener('click', () => void window.radio.play());
document.getElementById('stop').addEventListener('click', () => void window.radio.stop());
document.getElementById('ossia').addEventListener('click', () => { window.ossia = watch(createRadio({ version: 'ossia' }), 'ossiaStates'); void window.ossia.play(); });
// A page trying to start the radio on its own, with no click or key press at all.
if (location.hash === '#autoplay') setTimeout(() => void window.radio.play(), 1500);
window.ready = true;`;
// What an embedding page would need: NESO for data, its own origin for the worker. Nothing else.
const CSP = "default-src 'none'; script-src 'self'; connect-src https://api.carbonintensity.org.uk; worker-src 'self'; img-src data:";

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': type, 'content-security-policy': CSP });
    res.end(body);
  };
  if (path === '/') return send('text/html', PAGE);
  if (path === '/embed.js') return send('text/javascript', EMBED);
  if (path.startsWith('/vendor/radio/') && !path.includes('..')) {
    try {
      return send(path.endsWith('.js') ? 'text/javascript' : 'text/plain', await readFile(new URL(path.slice('/vendor/radio/'.length), root)));
    } catch {
      // falls through to 404
    }
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

/** Counts every live AudioContext the page makes, and every audio node made on one. Runs before the page's scripts. */
function watchAudio() {
  window.__made = { contexts: [], nodes: 0 };
  const Live = window.AudioContext;
  window.AudioContext = class extends Live {
    constructor(...a) {
      super(...a);
      window.__made.contexts.push(this);
    }
  };
  for (const name of ['GainNode', 'OscillatorNode', 'AudioBufferSourceNode', 'BiquadFilterNode', 'ConvolverNode', 'DynamicsCompressorNode', 'WaveShaperNode', 'StereoPannerNode']) {
    const Node = window[name];
    if (!Node) continue;
    window[name] = class extends Node {
      constructor(ctx, ...rest) {
        super(ctx, ...rest);
        if (window.__made.contexts.includes(ctx)) window.__made.nodes++;
      }
    };
  }
}

const cache = new Map();
const results = [];
const problems = [];
const check = (browser, name, ok, detail = '') => results.push({ browser, name, ok: !!ok, detail });
const PIECE_PATHS = /^\/(intensity|generation|regional\/regionid\/\d+)$/;

for (const name of browsers) {
  const browser = await launchSilent(ENGINES[name], name);
  const open = async ({ neso = 'ok', hash = '', touch = true } = {}) => {
    const context = await silentContext(browser, { viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const requests = [];
    page.on('request', (r) => requests.push(new URL(r.url())));
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !(neso !== 'ok' && /carbonintensity|Failed to load resource|status of 500|NetworkError|network connection/i.test(m.text()))) problems.push(`${name}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
    await page.addInitScript(watchAudio);
    await page.route('https://api.carbonintensity.org.uk/**', async (route) => {
      if (neso !== 'ok') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"500","message":"test"}}', headers: { 'access-control-allow-origin': '*' } });
      const key = route.request().url();
      if (!cache.has(key)) cache.set(key, await (await fetch(key)).text());
      return route.fulfill({ status: 200, contentType: 'application/json', body: cache.get(key), headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(`http://127.0.0.1:${PORT}/${hash}`);
    if (touch) await page.waitForFunction(() => window.ready === true);
    return { context, page, requests };
  };
  const made = (page) => page.evaluate(() => ({ contexts: window.__made.contexts.length, closed: window.__made.contexts.filter((c) => c.state === 'closed').length, nodes: window.__made.nodes }));
  const state = (page, which = 'radio') => page.evaluate((w) => window[w]?.state ?? null, which);

  try {
    {
      const { context, page, requests } = await open();
      await page.waitForTimeout(3000);
      const m = await made(page);
      check(name, 'before play(): no audio context, no audio node, no request, state off', m.contexts === 0 && m.nodes === 0 && !requests.some((u) => u.host !== `127.0.0.1:${PORT}`) && (await state(page)).status === 'off', JSON.stringify(m));

      await page.click('#play');
      await page.waitForFunction(() => window.radio.state.status === 'playing' || window.radio.state.status === 'failed', null, { timeout: 30000 });
      const playing = await state(page);
      const m2 = await made(page);
      check(name, 'play() from a click: one audio context, the orchestra built, the half-hour named', playing.status === 'playing' && m2.contexts === 1 && m2.nodes > 10 && /^\d\d:\d\d–\d\d:\d\d (GMT|BST)/.test(playing.halfHour.label), `${playing.reason} | ${JSON.stringify(m2)}`);
      const neso = requests.filter((u) => u.host !== `127.0.0.1:${PORT}`);
      check(name, 'fetches only from NESO, only what the piece fetches', neso.length > 0 && neso.every((u) => u.host === 'api.carbonintensity.org.uk' && PIECE_PATHS.test(u.pathname)), [...new Set(neso.map((u) => u.pathname))].join(' '));

      await page.waitForTimeout(1500);
      await page.click('#stop');
      await page.waitForFunction(() => window.radio.state.status === 'off');
      const m3 = await made(page);
      await page.waitForTimeout(1500);
      const m4 = await made(page);
      check(name, 'stop() closes the audio context and the orchestra stops', m3.closed === m3.contexts && m3.contexts === 1 && m4.nodes === m3.nodes, `${JSON.stringify(m3)} then ${m4.nodes} nodes`);

      await page.click('#ossia');
      await page.waitForFunction(() => window.ossia?.state.status === 'playing' && window.ossia.state.loudness && 'trimDb' in window.ossia.state.loudness, null, { timeout: 90000 }).catch(() => undefined);
      const o = await state(page, 'ossia');
      const worker = await page.evaluate(() => performance.getEntriesByType('resource').some((r) => /\/vendor\/radio\/assets\/loudness\.worker-[\w-]+\.js$/.test(r.name)));
      check(name, 'the ossia, loudness-matched with BS.1770 as in the piece, its worker found beside the module', o?.status === 'playing' && o.loudness?.trimDb < 0 && o.loudness.trimDb > -6 && worker && /hypothetical/.test(o.reason), o ? `${o.loudness ? JSON.stringify(o.loudness) : 'unmatched'}, worker ${worker}` : 'no state');
      await page.evaluate(() => window.ossia?.stop());
      await context.close();
    }
    {
      // Without a click: the page tries to start it from a timer. Playwright's evaluate() and
      // waitForFunction() count as gestures, so nothing touches the page until the attempt is over.
      const { context, page } = await open({ hash: '#autoplay', touch: false });
      await page.waitForTimeout(3000);
      const gesture = await page.evaluate(() => 'userActivation' in navigator);
      const s = await state(page);
      const m = await made(page);
      if (gesture) check(name, 'play() without a click or key press is refused, and makes nothing', s.status === 'failed' && /click or key press/.test(s.reason) && m.contexts === 0, `${s.reason} | ${JSON.stringify(m)}`);
      else check(name, 'play() without a click: no userActivation here, so the browser’s own autoplay rule applies', true, `${s.status}: ${s.reason}`);
      await context.close();
    }
    {
      const { context, page } = await open({ neso: 'failing' });
      await page.click('#play');
      await page.waitForFunction(() => window.radio.state.status !== 'loading' && window.radio.state.status !== 'off', null, { timeout: 30000 });
      await page.waitForTimeout(500);
      const failed = await state(page);
      const m = await made(page);
      check(name, 'no live figures: fails, says why, and makes no sound', failed.status === 'failed' && /NESO/.test(failed.reason) && m.nodes === 0 && m.closed === m.contexts, `${failed.reason} | ${JSON.stringify(m)}`);
      await context.close();
    }
  } catch (err) {
    check(name, 'ran', false, err.message.split('\n')[0]);
  }
  await browser.close();
}
await new Promise((resolve) => server.close(resolve));

for (const b of browsers) {
  const mine = results.filter((r) => r.browser === b);
  console.log(`\n${b}: ${mine.filter((r) => r.ok).length}/${mine.length} checks pass`);
  for (const r of mine) console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
if (problems.length) {
  console.log('\nconsole errors and warnings:');
  for (const p of problems) console.log(`  ${p}`);
}
if (problems.length || results.some((r) => !r.ok)) process.exitCode = 1;
