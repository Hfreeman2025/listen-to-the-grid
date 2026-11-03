import { describe, expect, it } from 'vitest';
import { composeDay, seedFor, TAIL_SECONDS } from '../src/music/day';
import type { GridPeriod } from '../src/data/series';
import { HALF_HOUR, londonDay } from '../src/data/time';
import { sleeveRows } from '../src/visual/sleeve';

function day(t: number): { span: { start: number; end: number }; series: GridPeriod[] } {
  const span = londonDay(t);
  const series: GridPeriod[] = [];
  for (let s = span.start; s < span.end; s += HALF_HOUR) {
    const k = (s - span.start) / (span.end - span.start);
    series.push({ start: s, end: s + HALF_HOUR, mix: { solar: 0, wind: 1 - k, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: k }, intensity: 40 + 220 * k, measured: true, index: 'moderate' });
  }
  return { span, series };
}

describe('composeDay', () => {
  it('writes one bar an hour, whatever the clocks did', () => {
    for (const [date, bars] of [
      [Date.UTC(2026, 9, 28, 12), 24],
      [Date.UTC(2026, 2, 29, 12), 23],
      [Date.UTC(2026, 9, 25, 12), 25],
    ] as const) {
      const d = day(date);
      const score = composeDay(d.series, d.span, 1);
      expect(score.bars).toHaveLength(bars);
      expect(score.seconds).toBe(bars * 2.5 + TAIL_SECONDS);
    }
  });

  it('follows the day from clean to dirty: bright modes first, dark ones last', () => {
    const d = day(Date.UTC(2026, 9, 28, 12));
    const score = composeDay(d.series, d.span, 1);
    expect(score.bars[0]?.mode).toBe('lydian');
    expect(score.bars[23]?.mode).toBe('phrygian');
  });

  it('presses the same day the same way every time, and a different day differently', () => {
    const d = day(Date.UTC(2026, 9, 28, 12));
    const a = composeDay(d.series, d.span, seedFor('2026-10-28', 'gb'));
    const b = composeDay(d.series, d.span, seedFor('2026-10-28', 'gb'));
    expect(a.bars).toEqual(b.bars);
    expect(seedFor('2026-10-28', 'gb')).not.toBe(seedFor('2026-10-29', 'gb'));
    expect(seedFor('2026-10-28', 'gb')).not.toBe(seedFor('2026-10-28', 'london'));
  });
});

describe('sleeveRows', () => {
  it('lays a day out as three systems of about eight bars', () => {
    expect(sleeveRows(24)).toEqual([8, 8, 8]);
    expect(sleeveRows(23)).toEqual([8, 8, 7]);
    expect(sleeveRows(25)).toEqual([9, 8, 8]);
  });
});
