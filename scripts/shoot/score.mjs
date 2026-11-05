// The score page: loading, live, playing, replays, regions, offline, the week
// arriving late or not at all, reduced motion, a background tab, the type,
// the programme notes and a long region name on a phone.
import { canvasHash, fonts, halfHoursBefore, scoreData, text, weekReady } from './harness.mjs';

/** @param {{ browser: import('playwright').Browser, full: boolean, sizes: string[], h: Awaited<ReturnType<typeof import('./harness.mjs').createHarness>> }} run */
export async function shootScore({ browser, full, sizes, h }) {
  const { session, check, outDir } = h;
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
      check(
        `live/${size}: opens on a full page, the half-hours before now then the live bar`,
        opened.page === 'standing' && opened.past === want && opened.now === `${start} live`,
        `${opened.past} | ${opened.now}`,
      );
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
                  for (const src of e.sources)
                    moved.push(
                      `${Math.round(e.startTime)}ms ${src.node?.id ? '#' + src.node.id : (src.node?.nodeName ?? '?')} ${Math.round(src.previousRect.x)}->${Math.round(src.currentRect.x)}`,
                    );
                }
              }).observe({ type: 'layout-shift', buffered: true });
              setTimeout(() => resolve({ sum, moved }), 300);
            }),
        );
        check(
          `live/${size}: no layout shift as the page, its data and its type arrive`,
          cls.sum < 0.00005,
          `${cls.sum.toFixed(5)}${cls.moved.length ? `: ${cls.moved.slice(0, 4).join(', ')}` : ''}`,
        );
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
        check(
          'keys: ← moves the page back a half-hour, the held bar not called live',
          back.past === earlier.slice(0, 3).join(',') && back.now === earlier[3],
          `${back.past} | ${back.now}`,
        );
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
      await weekReady(page);
      await page.click('#yesterday-quick');
      await page.waitForTimeout(18500);
      await shot(`replay-morning-${size}.png`);
      check(
        `replay/${size}: a running clock under the credit`,
        /\d\d:\d\d (GMT|BST)$/.test((await text(page, '#when-short')).trim()),
        await text(page, '#when-short'),
      );
      check(
        `replay/${size}: the status names the day being replayed`,
        /^Replaying \w+day \d+ \w+ \d{4}$/.test((await text(page, '#status')).trim()),
        await text(page, '#status'),
      );
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
      check(
        `region/${size}: a region link opens that region, labelled modelled`,
        /North Scotland, live: .*\(modelled estimate\)/.test(status),
        status,
      );
      if (size === 'desktop') {
        await page.selectOption('#region', 'south-wales');
        await page.waitForFunction(() => /South Wales/.test(document.querySelector('#status')?.textContent ?? ''), null, {
          timeout: 15000,
        });
        await page.waitForTimeout(3000);
        check('region: choosing one updates the address', new URL(page.url()).searchParams.get('region') === 'south-wales');
      }
    });

    await session(browser, 'offline', size, { offline: true }, async (page, shot) => {
      await fonts(page);
      await page.waitForTimeout(2600);
      await shot(`offline-${size}.png`);
      const status = await text(page, '#status');
      check(
        `offline/${size}: says so and dates the sample`,
        /Offline\. Playing a recorded sample: Wednesday 28 October 2026/.test(status),
        status,
      );
      const held = await scoreData(page);
      check(
        `offline/${size}: never claims to be live, on the score either`,
        !/\bLive\b/.test(status + (await text(page, '#when'))) &&
          !/live/i.test(held.now) &&
          held.page === 'standing' &&
          held.past.length > 0,
        `${held.past} | ${held.now}`,
      );
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
    check(
      'week: while the week loads, the earlier bars wait and say so',
      waiting.past === '' && /on their way/.test(waiting.note) && / live$/.test(waiting.now),
      `${waiting.note} | ${waiting.now}`,
    );
    await page.waitForFunction(() => (document.querySelector('#score')?.dataset.past ?? '').split(',').length === 3, null, {
      timeout: 15000,
    });
    check('week: and fill with the half-hours before when it arrives', true);
  });
  await session(browser, 'week-failed', 'desktop', { fail: WEEK }, async (page, shot) => {
    await fonts(page);
    await page.waitForFunction(() => /unavailable/.test(document.querySelector('#score')?.dataset.note ?? ''), null, { timeout: 15000 });
    if (full) await shot('week-unavailable-desktop.png');
    check('week-failed: a failed week leaves the earlier bars empty and says so', (await scoreData(page)).past === '');
  });

  for (const size of sizes)
    await session(browser, 'reduced', size, { context: { reducedMotion: 'reduce' } }, async (page, shot) => {
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
    await weekReady(page);
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

  // Type: the three faces the first screen is set in are preloaded and used,
  // with nothing intercepted.
  await session(browser, 'preload', 'desktop', { noRoute: true }, async (page) => {
    await fonts(page);
    await page.waitForTimeout(6000);
    const used = await page.evaluate(
      () =>
        ['IBM Plex Sans', 'IBM Plex Sans Condensed'].every((f) => document.fonts.check(`16px "${f}"`)) &&
        [...document.fonts].some((f) => f.family.includes('Plex') && f.status === 'loaded'),
    );
    const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="font"]')].length);
    check('type: three fonts preloaded and used, with no request intercepted', used && preloads === 3, `${preloads} preloads`);
  });

  if (full) {
    for (const size of ['desktop', 'phone']) {
      await session(browser, 'notes', size, {}, async (page, shot) => {
        await fonts(page);
        await page.locator('#how').scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await shot(`how-it-sounds-${size}.png`);
        await page.screenshot({
          path: new URL(`full-page-${size}.jpg`, outDir).pathname,
          fullPage: true,
          type: 'jpeg',
          quality: 80,
          caret: 'initial',
        });
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
}
