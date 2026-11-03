import { describe, expect, it } from 'vitest';
import { GB } from '../src/data/regions';
import type { GridPeriod } from '../src/data/series';
import { HALF_HOUR, HOUR, MINUTE } from '../src/data/time';
import type { Source } from '../src/feed';
import type { Position } from '../src/replay';
import { choosePage } from '../src/visual/page';
import type { Page } from '../src/visual/score';

// Sunday 1 November 2026 (GMT): the week up to the half-hour 17:00–17:30.
const LATEST = Date.UTC(2026, 10, 1, 17);
const series: GridPeriod[] = [];
for (let t = LATEST - 24 * HOUR; t <= LATEST; t += HALF_HOUR) {
  series.push({ start: t, end: t + HALF_HOUR, mix: { solar: 0, wind: 0.3, hydro: 0.02, biomass: 0.08, imports: 0.1, nuclear: 0.15, other: 0.02, coal: 0, gas: 0.33 }, intensity: 150, measured: true, index: 'moderate' });
}
const latest = series[series.length - 1] as GridPeriod;
const liveSource = (history: 'loading' | 'ok' | 'failed' = 'ok'): Source => ({ kind: 'live', region: GB, series: history === 'ok' ? series : [latest], latest, checkedAt: LATEST + 34 * MINUTE, failedSince: null, history });
const at = (now: number) => ({ origin: 100, version: 1, now });
const standing = (pos: Position, s: Source, now = LATEST + 34 * MINUTE): Extract<Page, { kind: 'standing' }> => {
  const page = choosePage(pos, s, at(now))?.page();
  if (page?.kind !== 'standing') throw new Error('expected a standing page');
  return page;
};

describe('choosePage', () => {
  it('opens live on the three half-hours before now, then the live half-hour, in red', () => {
    const page = standing({ kind: 'live' }, liveSource());
    expect(page.past.map((p) => p.label)).toEqual(['15:30', '16:00', '16:30']);
    expect(page.past.map((p) => p.number)).toEqual([32, 33, 34]);
    expect(page.now).toEqual({ label: '17:00 live', number: 35, live: true });
  });

  it('calls a late half-hour the latest, not live, and prints it in ink', () => {
    const page = standing({ kind: 'live' }, liveSource(), LATEST + 2 * HOUR);
    expect(page.now).toEqual({ label: '17:00 latest', number: 35, live: false });
  });

  it('labels a held moment with its time alone, the half-hours before it engraved', () => {
    const page = standing({ kind: 'replay', t: LATEST - 2 * HOUR + 15 * MINUTE, playing: false, startsAt: 0, span: null, stopAt: LATEST }, liveSource());
    expect(page.past.map((p) => p.label)).toEqual(['13:30', '14:00', '14:30']);
    expect(page.now).toEqual({ label: '15:00', number: 31, live: false });
  });

  it('never calls the recording live', () => {
    const sample: Source = { kind: 'sample', sample: { date: '2026-11-01', series, raw: {} as never }, series, reason: 'offline' };
    const page = standing({ kind: 'replay', t: LATEST - HOUR, playing: false, startsAt: 0, span: null, stopAt: LATEST }, sample);
    expect(page.now.label).toBe('16:00');
    expect(page.now.live).toBe(false);
  });

  it('says why the bars before are empty while the week loads, or after it fails', () => {
    expect(standing({ kind: 'live' }, liveSource('loading'))).toMatchObject({ past: [], note: 'the half-hours before are on their way' });
    expect(standing({ kind: 'live' }, liveSource('failed'))).toMatchObject({ past: [], note: 'the half-hours before are unavailable for now' });
  });

  it('writes a playing replay on pages of its own from its first downbeat', () => {
    const choice = choosePage({ kind: 'replay', t: 0, playing: true, startsAt: 100 + 12 * 2.5, span: null, stopAt: 1 }, liveSource(), at(LATEST));
    expect(choice?.page()).toEqual({ kind: 'flowing', key: 'flowing|12', from: 12 });
  });

  it('keeps its key while nothing changes, so the past is not recomposed every tick', () => {
    const a = choosePage({ kind: 'live' }, liveSource(), at(LATEST + 34 * MINUTE))?.key;
    const b = choosePage({ kind: 'live' }, liveSource(), at(LATEST + 40 * MINUTE))?.key;
    const c = choosePage({ kind: 'live' }, liveSource('loading'), at(LATEST + 40 * MINUTE))?.key;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
