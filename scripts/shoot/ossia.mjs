// The ossia: the same moment re-scored as a fully renewable grid, live, in a
// replay, on a sleeve and as a pressed record.
import { fonts, scoreData, text, weekReady } from './harness.mjs';

/** @param {{ browser: import('playwright').Browser, full: boolean, sizes: string[], h: Awaited<ReturnType<typeof import('./harness.mjs').createHarness>> }} run */
export async function shootOssia({ browser, full, sizes, h }) {
  const { session, check, wavLoudness, download } = h;
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
      check(
        `ossia/${size}: printed over the live bar, called hypothetical`,
        on.ossia === 'on' &&
          /hypothetical, fully renewable/.test(label ?? '') &&
          (await page.locator('#ossia').getAttribute('aria-pressed')) === 'true',
      );
      check(
        `ossia/${size}: switches the sound in place, no restart`,
        (await page.evaluate(() => window.__contexts())) === 1 && (await text(page, '#play')).trim() === 'Pause' && Number(on.bar) >= b0,
        `contexts ${await page.evaluate(() => window.__contexts())}, bars ${b0}→${on.bar}`,
      );
      const statusAfter = (await text(page, '#status')).trim();
      check(
        `ossia/${size}: never in the Live label, nor the live bar's cue`,
        statusAfter.replace(/\d\d:\d\d.*$/, '') === statusBefore.replace(/\d\d:\d\d.*$/, '') &&
          !/ossia|renewable|hypothetical|\b0 g CO/i.test(statusAfter) &&
          !/ossia/i.test(on.now),
        `${statusAfter} | ${on.now}`,
      );
      const table = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('#ossia-table tr')].map((tr) => [
            tr.querySelector('th')?.textContent ?? 'head',
            [...tr.querySelectorAll('td')].map((td) => td.textContent),
          ]),
        ),
      );
      const silenced = ['Gas', 'Coal', 'Nuclear', 'Biomass', 'Imports', 'Other'].every((f) => table[f]?.[1] === '0%');
      const kept = ['Wind', 'Solar', 'Hydro'].reduce((sum, f) => sum + Number((table[f]?.[1] ?? '0').replace(/[<%]/g, '')), 0);
      check(
        `ossia/${size}: shows its rule and numbers, real beside ossia`,
        (await page.locator('#ossia-notes').isVisible()) &&
          silenced &&
          kept >= 98 &&
          kept <= 102 &&
          table['Carbon intensity']?.[1] === '0 g CO₂/kWh' &&
          /Lydian/.test(table['Key']?.[1] ?? ''),
        JSON.stringify({ wind: table.Wind, gas: table.Gas, g: table['Carbon intensity'] }),
      );
      await page.locator('#ossia-notes').scrollIntoViewIfNeeded();
      await shot(`ossia-notes-${size}.png`);
      // Loudness: matched by the page's own BS.1770 measurement of both versions, rendered offline here.
      await page.waitForFunction(() => document.querySelector('#ossia-notes')?.dataset.match === 'matched', null, { timeout: 60000 });
      const m = await page.evaluate(() => ({
        trim: Number(document.querySelector('#ossia-notes')?.dataset.trim),
        line: document.querySelector('#ossia-loudness')?.textContent ?? '',
        cells: [...document.querySelectorAll('#ossia-table tr')]
          .filter((tr) => /Loudness|Level/.test(tr.querySelector('th')?.textContent ?? ''))
          .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)),
      }));
      const realL = Number((m.cells[0]?.[0] ?? '').replace('−', '-').replace(' LUFS', ''));
      const ossiaL = Number((m.cells[0]?.[1] ?? '').replace('−', '-').replace(' LUFS', ''));
      check(
        `ossia/${size}: measured in a worker, off the main thread`,
        await page.evaluate(() => performance.getEntriesByType('resource').some((r) => /loudness\.worker/.test(r.name))),
      );
      check(
        `ossia/${size}: loudness-matched with BS.1770, the trim equal to the measured gap`,
        /ITU-R BS\.1770/.test(m.line) && Math.abs(m.trim - (realL - ossiaL)) <= 0.11 && m.trim < 0 && m.trim > -6,
        `real ${realL}, ossia ${ossiaL}, trim ${m.trim} dB`,
      );
      await page.locator('#ossia-notes').scrollIntoViewIfNeeded();
      await shot(`ossia-loudness-${size}.png`);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('o');
      await page.waitForTimeout(400);
      check(
        `ossia/${size}: O switches it off again, still without a restart`,
        (await scoreData(page)).ossia === '' &&
          (await page.locator('#ossia-notes').isHidden()) &&
          (await page.evaluate(() => window.__contexts())) === 1,
      );
    });
    await session(browser, 'ossia-replay', size, {}, async (page, shot) => {
      await fonts(page);
      await weekReady(page);
      await page.click('#ossia');
      await page.click('#yesterday-quick');
      await page.waitForTimeout(9000);
      await shot(`ossia-replay-${size}.png`);
      const d = await scoreData(page);
      check(
        `ossia-replay/${size}: a replayed day carries the ossia over every bar`,
        d.page === 'flowing' && d.ossia === 'on' && /^Replaying/.test((await text(page, '#status')).trim()),
      );
    });
  }

  if (full) {
    await session(browser, 'ossia-sleeve', 'phone', {}, async (page, shot) => {
      await fonts(page);
      await weekReady(page);
      await page.click('#ossia');
      await page.locator('#record').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shot('ossia-record-ready-phone.png');
      check('ossia-sleeve/phone: the sleeve says ossia before pressing', /ossia sleeve/.test(await text(page, '#sleeve-caption')));
    });
  }

  await session(browser, 'ossia-record', 'desktop', {}, async (page, shot) => {
    await fonts(page);
    await weekReady(page);
    await page.click('#ossia');
    await page.locator('#record').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shot('ossia-record-ready-desktop.png');
    check(
      'ossia-record: the sleeve and the button say ossia before pressing',
      /ossia sleeve/.test(await text(page, '#sleeve-caption')) && (await text(page, '#record-press')).trim() === 'Press the ossia record',
    );
    await page.click('#record-press');
    await page.waitForSelector('#record-result:not([hidden])', { timeout: 180000 });
    await page.waitForTimeout(300);
    await shot('ossia-record-done-desktop.png');
    const wav = await download(page, '#record-wav');
    const png = await download(page, '#record-png');
    const ascii = Buffer.from(wav.bytes).toString('latin1');
    check(
      'ossia-record: its files and tags say ossia and hypothetical',
      /-ossia-fully-renewable-hypothetical\.wav$/.test(wav.name) &&
        /-ossia-fully-renewable-hypothetical-sleeve\.png$/.test(png.name) &&
        /ossia: fully renewable, hypothetical/.test(ascii),
      `${wav.name}, ${png.name}`,
    );
    check('ossia-record: its liner notes say what it is', /Ossia: fully renewable, a hypothetical/.test(await text(page, '#record-notes')));
    const lufs = wavLoudness(wav.bytes);
    check(
      'ossia-record: pressed to the same -16 LUFS as a real record, re-measured from the file',
      Math.abs(lufs + 16) <= 0.15,
      `${lufs.toFixed(2)} LUFS`,
    );
  });
}
