// Pressing a record: ready before pressing, pressed, played, downloaded and
// re-measured; and a day NESO can't supply.
import { writeFile } from 'node:fs/promises';
import { fonts, text, weekReady } from './harness.mjs';

/** @param {{ browser: import('playwright').Browser, full: boolean, sizes: string[], h: Awaited<ReturnType<typeof import('./harness.mjs').createHarness>> }} run */
export async function shootRecord({ browser, full, sizes, h }) {
  const { session, check, outDir, wavLoudness, download } = h;
  for (const size of sizes) {
    await session(browser, 'record', size, {}, async (page, shot) => {
      await fonts(page);
      await weekReady(page);
      await page.locator('#record').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shot(`record-ready-${size}.png`);
      check(`record/${size}: yesterday's sleeve is ready before pressing`, /The sleeve for/.test(await text(page, '#sleeve-caption')));
      const started = Date.now();
      await page.click('#record-press');
      if (size === 'desktop') {
        await page
          .waitForFunction(() => /Pressing .*: [1-9]\d?%/.test(document.querySelector('#record-status')?.textContent ?? ''), null, {
            timeout: 60000,
          })
          .catch(() => undefined);
        await shot(`record-pressing-${size}.png`);
      }
      await page.waitForSelector('#record-result:not([hidden])', { timeout: 180000 });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      await page.waitForTimeout(300);
      await shot(`record-done-${size}.png`);
      const wav = await download(page, '#record-wav');
      // Keep yesterday's record from the desktop run, for listening.
      if (size === 'desktop' && full) await writeFile(new URL('yesterday.wav', outDir), wav.bytes);
      const lufs = wavLoudness(wav.bytes);
      check(
        `record/${size}: the WAV itself measures -16 LUFS (BS.1770, re-measured in Node), as its notes say`,
        Math.abs(lufs + 16) <= 0.15 && /-16\.0 LUFS|−16\.0 LUFS/.test((await text(page, '#record-notes')).replace('−', '-')),
        `${lufs.toFixed(2)} LUFS`,
      );
      check(`record/${size}: a real record never carries the ossia's name`, !/ossia/i.test(wav.name), wav.name);
      const png = await download(page, '#record-png');
      const view = new DataView(wav.bytes.buffer, wav.bytes.byteOffset);
      const tag = (o) => String.fromCharCode(...wav.bytes.slice(o, o + 4));
      const file = {
        riff: tag(0),
        wave: tag(8),
        size: wav.bytes.length,
        rate: view.getUint32(24, true),
        name: wav.name,
        png: png.bytes.length,
        pngSig: png.bytes[1] === 0x50 && png.bytes[2] === 0x4e,
      };
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

  await session(browser, 'record-error', 'desktop', { fail: /2019-03-1/ }, async (page, shot) => {
    await fonts(page);
    await page.locator('#record').scrollIntoViewIfNeeded();
    await page.fill('#record-date', '2019-03-14');
    await page.click('#record-press');
    await page.waitForFunction(() => document.querySelector('#record-status')?.classList.contains('error'), null, { timeout: 20000 });
    await shot('record-error-desktop.png');
    check(
      'record-error: a failed fetch says so and offers another try',
      /Couldn’t press that day/.test(await text(page, '#record-status')),
    );
  });
}
