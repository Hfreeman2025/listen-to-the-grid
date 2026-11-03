// Renders the instrument offline in headless Chromium and prints measurements:
// per-voice balance, levels and clipping across the sample day, a click test
// with an unramped control, brightness for clean versus dirty grids, and the
// same day as the fully renewable ossia.
// Also writes the sample day, played in 60 seconds, to renders/sample-day.wav.
//
//   npm run measure
//
// Makes no network requests: the sample day is bundled.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { launchSilent, silentContext } from './silent.mjs';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'warn' });
await server.listen();
// Renders are offline, to memory; the browser is silent all the same.
const browser = await launchSilent(chromium, 'chromium');
const page = await (await silentContext(browser)).newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.route('https://**', (route) => route.abort());
const study = process.argv.includes('--loudness');
await page.goto(`http://localhost:5199/measure.html${study ? '?loudness' : ''}`);
await page.waitForFunction(() => 'result' in window, null, { timeout: 300_000 });
const result = await page.evaluate(() => window.result);
await browser.close();
await server.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (study) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const { wav, spectrogram, ...numbers } = result;
const dir = new URL('../renders/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('sample-day.wav', dir), Buffer.from(wav.day, 'base64'));
await writeFile(new URL('sample-day-ossia.wav', dir), Buffer.from(wav.ossia, 'base64'));
await writeFile(new URL('../shots/v2/spectrogram-sample-day.png', import.meta.url), Buffer.from(spectrogram.split(',')[1], 'base64'));
console.log(JSON.stringify(numbers, null, 2));
console.log('wrote renders/sample-day.wav, renders/sample-day-ossia.wav and shots/v2/spectrogram-sample-day.png');
