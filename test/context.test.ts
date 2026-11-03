import { describe, expect, it } from 'vitest';
import type { GridPeriod } from '../src/data/series';
import { HALF_HOUR, HOUR } from '../src/data/time';
import { composeBefore, halfHourNumber } from '../src/music/context';

/** Half-hours from `from` for `hours` hours, the wind easing off as gas comes on. */
function week(from: number, hours: number, skip: number[] = []): GridPeriod[] {
  const out: GridPeriod[] = [];
  for (let t = from, i = 0; t < from + hours * HOUR; t += HALF_HOUR, i++) {
    if (skip.includes(t)) continue;
    const k = (i % 48) / 48;
    out.push({ start: t, end: t + HALF_HOUR, mix: { solar: 0, wind: 0.6 - 0.4 * k, hydro: 0.02, biomass: 0.08, imports: 0.1, nuclear: 0.12, other: 0.02, coal: 0, gas: 0.06 + 0.4 * k }, intensity: 30 + 240 * k, measured: true, index: 'moderate' });
  }
  return out;
}

// Sunday 1 November 2026 is GMT, so London midnight is 00:00 UTC.
const MIDNIGHT = Date.UTC(2026, 10, 1);

describe('halfHourNumber', () => {
  it('numbers the bars of a London day one a half-hour, from 1 at midnight', () => {
    expect(halfHourNumber(MIDNIGHT)).toBe(1);
    expect(halfHourNumber(MIDNIGHT + 17 * HOUR)).toBe(35);
    expect(halfHourNumber(MIDNIGHT + 23.5 * HOUR)).toBe(48);
    // 29 March 2026: the clocks go forward at 01:00 GMT, and 02:00 BST is the third half-hour.
    expect(halfHourNumber(Date.UTC(2026, 2, 29, 1))).toBe(3);
  });
});

describe('composeBefore', () => {
  const series = week(MIDNIGHT - 24 * HOUR, 48);
  const now = MIDNIGHT + 17 * HOUR;

  it('engraves the half-hours just before now, oldest first', () => {
    const past = composeBefore(series, now, 3, 'gb');
    expect(past.map((p) => p.start)).toEqual([now - 3 * HALF_HOUR, now - 2 * HALF_HOUR, now - HALF_HOUR]);
  });

  it('keeps a half-hour’s bar the same when the page moves on', () => {
    const before = composeBefore(series, now, 3, 'gb');
    const after = composeBefore(series, now + HALF_HOUR, 3, 'gb');
    expect(after[0]?.bar).toEqual(before[1]?.bar);
    expect(after[1]?.bar).toEqual(before[2]?.bar);
    // and when the newest figures arrive as a new series
    const grown = [...series, ...week(MIDNIGHT + 24 * HOUR, 1)];
    expect(composeBefore(grown, now, 3, 'gb')).toEqual(before);
  });

  it('crosses midnight into the day before', () => {
    const past = composeBefore(series, MIDNIGHT + HALF_HOUR, 3, 'gb');
    expect(past.map((p) => halfHourNumber(p.start))).toEqual([47, 48, 1]);
  });

  it('composes from each half-hour’s own figures: a dirty evening is written in a darker key than a clean night', () => {
    const night = composeBefore(series, MIDNIGHT + 2 * HOUR, 1, 'gb')[0];
    const evening = composeBefore(series, MIDNIGHT + 23 * HOUR, 1, 'gb')[0];
    expect(night?.bar.mode).toBe('lydian');
    expect(['aeolian', 'phrygian']).toContain(evening?.bar.mode);
  });

  it('never bridges a gap in the data, and gives what there is', () => {
    const gappy = week(MIDNIGHT, 24, [MIDNIGHT + 16 * HOUR]);
    const past = composeBefore(gappy, MIDNIGHT + 17 * HOUR, 3, 'gb');
    expect(past.map((p) => p.start)).toEqual([MIDNIGHT + 16.5 * HOUR]);
    expect(composeBefore(gappy, MIDNIGHT, 3, 'gb')).toEqual([]);
  });

  it('writes a different score for a different place', () => {
    const gb = composeBefore(series, now, 3, 'gb');
    const wales = composeBefore(series, now, 3, 'south-wales');
    expect(wales.map((p) => p.start)).toEqual(gb.map((p) => p.start));
    expect(wales.map((p) => p.bar.parts)).not.toEqual(gb.map((p) => p.bar.parts));
  });
});
