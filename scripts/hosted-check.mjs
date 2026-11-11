// The built piece as Cloudflare Pages serves it, checked in Chromium, WebKit and Firefox. wrangler's own Pages
// emulation (tools/deploy) serves dist/ with its _headers and its 404 page; a thin front before it collects the
// Content-Security-Policy's reports. NESO's figures are real, fetched once per run and replayed to every page.
//
//   npm run check:hosted -- measure [browsers…]   every request reported under default-src 'none', report-only:
//                                                 the origins and kinds the policy must allow, and nothing else
//   npm run check:hosted [browsers…]              the policy in _headers enforced: zero violations, every part
//                                                 of the piece working
//
// Needs `npm run build` first. One browser at a time; every browser is silent (silent.mjs). Writes
// shots/hosted/<mode>-<browser>.json (git-ignored).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { root } from './hosting/load.mjs';
import { launchSilent, silentContext } from './silent.mjs';

const args = process.argv.slice(2);
const mode = args[0] === 'measure' ? 'measure' : 'enforce';
const ENGINES = { chromium, webkit, firefox };
const browsers = args.filter((a) => a in ENGINES);
if (browsers.length === 0) browsers.push('chromium', 'webkit', 'firefox');
/** Measuring: every load of every kind is a would-be violation, so each one is reported with its directive. */
const MEASURE_POLICY = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const work = join(root, '.cache/hosted-check');
const out = join(root, 'shots/hosted');
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function startPages(port) {
  const bin = join(root, 'tools/deploy/node_modules/.bin/wrangler');
  if (!existsSync(bin)) throw new Error('no wrangler in tools/deploy: run npm ci --prefix tools/deploy');
  // From .cache/hosted-check, so wrangler's own .wrangler/ state stays out of the repository.
  const args = ['pages', 'dev', join(root, 'dist'), '--ip', '127.0.0.1', '--port', String(port)];
  args.push('--inspector-port', String(await freePort()), '--compatibility-date', '2026-11-01');
  const child = spawn(bin, args, { cwd: work, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    if (/Ready on http/.test(log)) return child;
    if (child.exitCode !== null) throw new Error(`wrangler pages dev exited: ${log.slice(-500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('wrangler pages dev did not start');
}

/**
 * WebKit's native <select> sets a style attribute inside itself, and reports it under style-src-attr with no
 * file, line or sample; the piece sets none. Refused, it changes nothing a visitor sees (README, Hosting), so
 * the enforced run lists it apart, in WebKit only, exactly that report, and fails on anything else.
 */
function webkitSelect(browser, r) {
  const directive = r['effective-directive'] ?? r['violated-directive'] ?? '';
  return (
    browser === 'webkit' &&
    directive.startsWith('style-src-attr') &&
    r['blocked-uri'] === 'inline' &&
    !r['source-file'] &&
    !r['script-sample']
  );
}
/** How WebKit logs that refusal (it names style-src); the run checks for exactly one line a report. */
const WEBKIT_SELECT_MESSAGE =
  /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src(?:-attr)? directive of the Content Security Policy\.$/;

/** The front: passes everything to wrangler, sets the run's policy mode, and collects reports. */
function startFront(pagesPort, record) {
  const server = http.createServer((req, res) => {
    if (req.url === '/__csp-report' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          for (const r of Array.isArray(parsed) ? parsed : [parsed]) {
            const report = { ...(r['csp-report'] ?? r.body ?? r), part: record.part };
            if (mode === 'enforce' && webkitSelect(record.browser, report)) record.browserOwn.push(report);
            else record.reports.push(report);
          }
        } catch {
          record.reports.push({ unparsed: body.slice(0, 300), part: record.part });
        }
        res.writeHead(204).end();
      });
      return;
    }
    const upstream = http.request({ host: '127.0.0.1', port: pagesPort, method: req.method, path: req.url, headers: req.headers }, (up) => {
      const headers = { ...up.headers };
      const csp = headers['content-security-policy'];
      if (csp) {
        delete headers['content-security-policy'];
        if (mode === 'measure') headers['content-security-policy-report-only'] = `${MEASURE_POLICY}; report-uri /__csp-report`;
        else headers['content-security-policy'] = `${csp}; report-uri /__csp-report`;
      }
      record.served.push({ path: req.url, status: up.statusCode, csp: Boolean(csp) });
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    });
    upstream.on('error', (e) => res.writeHead(502).end(String(e)));
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** The headers as Pages serves them, straight from wrangler: the page, an asset, robots.txt and a missing path. */
async function servedHeaders(base) {
  const page = await fetch(`${base}/`);
  const index = await page.text();
  const asset = /src="\.\/(assets\/index-[^"]+\.js)"/.exec(index)?.[1];
  const assetRes = asset ? await fetch(`${base}/${asset}`) : null;
  const missing = await fetch(`${base}/no/such/page`);
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  const h = (r, n) => r?.headers.get(n) ?? null;
  return {
    page: Object.fromEntries(
      [
        'content-security-policy',
        'x-robots-tag',
        'referrer-policy',
        'x-content-type-options',
        'permissions-policy',
        'strict-transport-security',
        'access-control-allow-origin',
      ].map((n) => [n, h(page, n)]),
    ),
    assetCacheControl: h(assetRes, 'cache-control'),
    missing: {
      status: missing.status,
      notFoundPage: /There is nothing at this address/.test(await missing.text()),
      csp: Boolean(h(missing, 'content-security-policy')),
    },
    robots,
  };
}

const cache = new Map();
async function routeNeso(context) {
  await context.route('https://api.carbonintensity.org.uk/**', async (route) => {
    const key = route.request().url();
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

/** Every request a page or its worker makes, by origin and kind. */
function watch(context, page, record, part) {
  const seen = (r, from) => {
    const url = new URL(r.url());
    // The policy's own reports go to the front, not anywhere the piece asked for.
    if (url.pathname === '/__csp-report') return;
    record.requests.push({
      part,
      path: url.pathname,
      origin: url.protocol.startsWith('http') ? (url.origin === record.base ? "'self'" : url.origin) : url.protocol,
      type: r.resourceType(),
      from,
    });
  };
  page.on('request', (r) => seen(r, 'page'));
  context.on('request', (r) => {
    if (!r.frame?.()) seen(r, 'worker');
  });
  page.on('worker', (w) => record.workers.push(w.url().replace(record.base, "'self'")));
  page.on('console', (m) => {
    // The missing page's own 404 is the point of that part, not a problem.
    if (part === 'a missing page' && /status of 404/.test(m.text())) return;
    // The same refusal, as WebKit logs it.
    if (mode === 'enforce' && record.browser === 'webkit' && WEBKIT_SELECT_MESSAGE.test(m.text())) return void record.browserOwnLogged++;
    // WebKit and Firefox echo each report-only report to the console; the reports themselves are counted.
    if (mode === 'measure' && /^\[Report Only\]|\(Report-Only policy\)/.test(m.text())) return;
    if (m.type() === 'error' || m.type() === 'warning') record.console.push({ part, type: m.type(), text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => record.console.push({ part, type: 'pageerror', text: e.message.slice(0, 300) }));
}

const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};
const text = (page, sel) => page.locator(sel).innerText();
const weekReady = (page) => page.waitForFunction(() => !document.querySelector('#yesterday-quick')?.disabled, null, { timeout: 30000 });

const PARTS = [
  {
    name: 'the score: live, then listening; the ossia A/B, loudness-matched in its worker, on and off',
    async run(page, base) {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#score')?.dataset.page === 'standing', null, { timeout: 30000 });
      const status = (await text(page, '#status')).trim();
      expect(/^(Live|Latest available)/.test(status), `status: ${status}`);
      await page.click('#play');
      await page.waitForFunction(() => document.querySelector('#play-label')?.textContent === 'Pause', null, { timeout: 15000 });
      await page.click('#ossia');
      await page.waitForFunction(() => document.querySelector('#ossia-notes')?.dataset.match === 'matched', null, { timeout: 90000 });
      const trim = await page.evaluate(() => document.querySelector('#ossia-notes')?.dataset.trim);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('o');
      await page.waitForFunction(() => document.querySelector('#score')?.dataset.ossia === '', null, { timeout: 5000 });
      await page.keyboard.press('o');
      await page.waitForTimeout(1500);
      return { status, trimDb: trim };
    },
  },
  {
    name: 'a replayed day, then a region',
    async run(page, base) {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await weekReady(page);
      await page.click('#yesterday-quick');
      await page.waitForFunction(() => document.querySelector('#score')?.dataset.page === 'flowing', null, { timeout: 15000 });
      await page.waitForTimeout(4000);
      await page.selectOption('#region', 'north-scotland');
      await page.waitForFunction(() => /^North Scotland, (live|latest)/i.test(document.querySelector('#status')?.textContent ?? ''), null, {
        timeout: 20000,
      });
      return { status: (await text(page, '#status')).trim().slice(0, 80) };
    },
  },
  {
    name: 'a record: pressed, played, and both files downloaded',
    async run(page, base) {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await weekReady(page);
      await page.locator('#record').scrollIntoViewIfNeeded();
      await page.click('#record-press');
      await page.waitForSelector('#record-result:not([hidden])', { timeout: 240000 });
      await page.click('#record-play');
      await page.waitForTimeout(2500);
      expect((await text(page, '#record-play')).trim() === 'Stop the record', 'the record did not play');
      const save = async (sel) => {
        const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        return new Uint8Array(readFileSync(await d.path()));
      };
      const wav = await save('#record-wav');
      const png = await save('#record-png');
      expect(String.fromCharCode(...wav.slice(0, 4)) === 'RIFF' && png[1] === 0x50, 'the downloads are not a WAV and a PNG');
      return { wavMB: +(wav.length / 1e6).toFixed(1), pngMB: +(png.length / 1e6).toFixed(2) };
    },
  },
  {
    name: 'a missing page',
    async run(page, base) {
      const res = await page.goto(`${base}/no/such/page`, { waitUntil: 'networkidle' });
      expect(res?.status() === 404, `status ${res?.status()}`);
      expect(/There is nothing at this address/.test(await text(page, 'body')), 'not the 404 page');
      return { status: res?.status() };
    },
  },
];

function summarise(record) {
  const byOrigin = {};
  for (const r of record.requests) {
    byOrigin[r.origin] ??= {};
    const kind = `${r.type}${r.from === 'worker' ? ' (worker)' : ''}`;
    byOrigin[r.origin][kind] = (byOrigin[r.origin][kind] ?? 0) + 1;
  }
  const reports = {};
  /** Where each inline report came from, so a browser's own markup can be told from the piece's. */
  const inline = [];
  for (const r of record.reports) {
    const directive = r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? '?';
    const blocked = String(r['blocked-uri'] ?? r.blockedURL ?? '?').replace(record.base, "'self'");
    const key = `${directive} ← ${blocked.replace(/^('self'\/fonts\/)[^/]*\.woff2$/, '$1*.woff2')}`;
    reports[key] = (reports[key] ?? 0) + 1;
    if (blocked === 'inline' || blocked === 'eval') {
      const sample = String(r['script-sample'] ?? r.sample ?? '').slice(0, 80);
      inline.push(
        `${key} @ ${String(r['source-file'] ?? r.sourceFile ?? '').replace(record.base, "'self'")}:${r['line-number'] ?? r.lineNumber ?? ''} ${sample}`,
      );
    }
  }
  const selfPaths = [...new Set(record.requests.filter((r) => r.origin === "'self'").map((r) => `${r.type} ${r.path}`))].sort();
  return { byOrigin, selfPaths, workers: [...new Set(record.workers)], reports, inline: [...new Set(inline)] };
}

let pages;
let failed = 0;
try {
  if (!existsSync(join(root, 'dist/_headers'))) throw new Error('dist/ has no _headers: run npm run build first');
  const pagesPort = await freePort();
  pages = await startPages(pagesPort);
  const served = await servedHeaders(`http://127.0.0.1:${pagesPort}`);
  console.log(`headers as served: ${JSON.stringify(served)}`);
  for (const name of browsers) {
    const record = {
      browser: name,
      requests: [],
      workers: [],
      console: [],
      reports: [],
      browserOwn: [],
      browserOwnLogged: 0,
      served: [],
      part: '',
    };
    const front = await startFront(pagesPort, record);
    const base = `http://127.0.0.1:${front.address().port}`;
    record.base = base;
    console.log(`${name} (${mode === 'measure' ? `measuring: ${MEASURE_POLICY}, report-only` : 'the policy in _headers, enforced'})`);
    const browser = await launchSilent(ENGINES[name], name);
    const results = [];
    try {
      for (const part of PARTS) {
        const context = await silentContext(browser, { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
        await routeNeso(context);
        const page = await context.newPage();
        record.part = part.name;
        watch(context, page, record, part.name);
        const before = record.reports.length;
        const started = Date.now();
        try {
          const detail = await part.run(page, base);
          await page.waitForTimeout(800); // late reports
          results.push({ part: part.name, ok: true, ms: Date.now() - started, reports: record.reports.length - before, detail });
          console.log(
            `  ok   ${part.name} (${Date.now() - started} ms, ${record.reports.length - before} reports) ${JSON.stringify(detail)}`,
          );
        } catch (error) {
          const message = String(error instanceof Error ? error.message : error).split('\n')[0];
          results.push({ part: part.name, ok: false, error: message });
          console.log(`  FAIL ${part.name}: ${message}`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      front.close();
    }
    const summary = summarise(record);
    // The missing page's own 404 is expected; any other is not.
    const notFound = record.served.filter((s) => s.status === 404 && s.path !== '/no/such/page');
    writeFileSync(
      join(out, `${mode}-${name}.json`),
      `${JSON.stringify({ browser: name, mode, at: new Date().toISOString(), served, results, ...summary, notFound, console: record.console }, null, 2)}\n`,
    );
    console.log(`  requests by origin and kind: ${JSON.stringify(summary.byOrigin)}`);
    console.log(`  the piece's own files, by kind: ${summary.selfPaths.join(', ')}`);
    console.log(`  workers: ${summary.workers.join(', ') || 'none'}`);
    console.log(`  ${mode === 'measure' ? 'reported (what the policy must allow)' : 'violations'}: ${JSON.stringify(summary.reports)}`);
    if (record.browserOwn.length)
      console.log(
        `  WebKit's own <select> style, refused and listed apart: ${record.browserOwn.length} reports, ${record.browserOwnLogged} console lines`,
      );
    if (summary.inline.length) console.log(`  inline, where: ${summary.inline.join(' | ')}`);
    console.log(
      `  console errors and warnings: ${record.console.length ? JSON.stringify(record.console) : 'none'}; unexpected 404s: ${notFound.length}`,
    );
    failed += results.filter((r) => !r.ok).length + notFound.length;
    if (mode === 'enforce')
      failed += record.reports.length + record.console.length + Math.abs(record.browserOwnLogged - record.browserOwn.length);
  }
} finally {
  pages?.kill();
}
process.exit(failed ? 1 : 0);
