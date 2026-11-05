// Proves the automation is silent: opens the page in each browser exactly as
// the other scripts do, presses Listen and plays the ossia and a record,
// sampling macOS power assertions throughout. Any audio assertion created
// for a Playwright browser process fails the run.
//
//   DIST=dist-next node scripts/silence-check.mjs
import { execFileSync } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';
import { preview } from 'vite';
import { launchSilent, silentContext } from './silent.mjs';

const server = await preview({
  build: { outDir: process.env.DIST ?? 'dist' },
  preview: { host: '127.0.0.1', port: 4189, strictPort: true },
  logLevel: 'warn',
});

/** PIDs of the Playwright-managed browser processes running now. */
function browserPids() {
  try {
    return new Set(execFileSync('pgrep', ['-f', 'ms-playwright'], { encoding: 'utf8' }).split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Audio assertions held for any of `pids`, from pmset. */
function audioAssertions(pids) {
  const lines = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' }).split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (!/audio/i.test(line)) return;
    const owner = line.match(/pid (\d+)\(/)?.[1];
    const createdFor = (lines[i + 1] ?? '').match(/Created for PID: (\d+)/)?.[1];
    if ((owner && pids.has(owner)) || (createdFor && pids.has(createdFor))) hits.push(line.trim());
  });
  return hits;
}

let failed = false;
for (const [name, engine] of Object.entries({ chromium, webkit, firefox })) {
  const browser = await launchSilent(engine, name, ['--autoplay-policy=no-user-gesture-required']);
  const context = await silentContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4189/', { waitUntil: 'networkidle' });
  await page.click('#play');
  const seen = new Set();
  const sample = () => {
    for (const hit of audioAssertions(browserPids())) seen.add(hit);
  };
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    sample();
  }
  await page.click('#ossia');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    sample();
  }
  const device = await page.evaluate(() => new AudioContext().constructor.name);
  const playing = (await page.locator('#play').innerText()).trim();
  const running = await page.evaluate(() => document.querySelector('#score')?.dataset.bar);
  console.log(
    `${name}: ${seen.size === 0 ? 'no audio assertions' : 'AUDIO ASSERTION'} (live context: ${device}; button says ${playing}, bar ${running})`,
  );
  for (const s of seen) console.log(`  ${s}`);
  if (seen.size > 0) failed = true;
  await browser.close();
}
await new Promise((resolve) => server.httpServer.close(resolve));
if (failed) process.exitCode = 1;
