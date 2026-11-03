import { describe, expect, it } from 'vitest';
import { mergeSeries, periodAt, sampleAt, upsertPeriods, type GridPeriod } from '../src/data/series';
import type { GenerationPeriod, IntensityPeriod, Mix } from '../src/data/schema';
import {
  HALF_HOUR,
  apiTimestamp,
  halfHourFloor,
  londonDay,
  londonDayStart,
  londonParts,
  londonYesterday,
  isFresh,
  nextPollDelay,
} from '../src/data/time';

const t0 = Date.UTC(2026, 9, 31, 12, 0);

const gen = (from: number, wind: number, gas: number): GenerationPeriod => ({
  from,
  to: from + HALF_HOUR,
  generationmix: [
    { fuel: 'wind', perc: wind },
    { fuel: 'gas', perc: gas },
  ],
});
const int = (from: number, actual: number | null, forecast: number): IntensityPeriod => ({
  from,
  to: from + HALF_HOUR,
  intensity: { actual, forecast, index: 'moderate' },
});

describe('mergeSeries', () => {
  it('joins rows on period start and prefers measured intensity', () => {
    const series = mergeSeries([gen(t0, 40, 60), gen(t0 + HALF_HOUR, 20, 80)], [int(t0, 150, 160), int(t0 + HALF_HOUR, null, 210)]);
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ start: t0, intensity: 150, measured: true });
    expect(series[1]).toMatchObject({ start: t0 + HALF_HOUR, intensity: 210, measured: false });
    expect(series[1]?.mix.gas).toBeCloseTo(0.8, 10);
  });

  it('drops periods missing from either side and sorts by time', () => {
    const series = mergeSeries([gen(t0 + HALF_HOUR, 1, 99), gen(t0, 1, 99), gen(t0 + 2 * HALF_HOUR, 1, 99)], [int(t0, 100, 100), int(t0 + HALF_HOUR, 100, 100)]);
    expect(series.map((p) => p.start)).toEqual([t0, t0 + HALF_HOUR]);
  });
});

const period = (start: number, wind: number, intensity: number): GridPeriod => {
  const mix: Mix = { solar: 0, wind, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: 1 - wind };
  return { start, end: start + HALF_HOUR, mix, intensity, measured: true, index: 'moderate' };
};

describe('sampleAt', () => {
  const series = [period(t0, 0.6, 80), period(t0 + HALF_HOUR, 0.2, 200)];
  const midA = t0 + HALF_HOUR / 2;

  it('returns null for an empty series', () => {
    expect(sampleAt([], t0)).toBeNull();
  });

  it('interpolates between half-hour midpoints', () => {
    const s = sampleAt(series, midA + HALF_HOUR / 4);
    expect(s?.mix.wind).toBeCloseTo(0.5, 10);
    expect(s?.intensity).toBeCloseTo(110, 10);
    expect(s?.period.start).toBe(t0);
  });

  it('labels an instant with the half-hour it falls in', () => {
    expect(sampleAt(series, t0 + HALF_HOUR + 1)?.period.start).toBe(t0 + HALF_HOUR);
  });

  it('clamps outside the series', () => {
    expect(sampleAt(series, t0 - 10 * HALF_HOUR)?.intensity).toBe(80);
    expect(sampleAt(series, t0 + 10 * HALF_HOUR)?.intensity).toBe(200);
  });

  it('holds values across a gap instead of inventing a ramp', () => {
    const gappy = [period(t0, 0.6, 80), period(t0 + 6 * HALF_HOUR, 0.2, 200)];
    expect(sampleAt(gappy, t0 + HALF_HOUR)?.intensity).toBe(80);
    expect(sampleAt(gappy, t0 + 5 * HALF_HOUR)?.intensity).toBe(200);
  });

  it('finds the containing period', () => {
    expect(periodAt(series, t0 + 100)?.start).toBe(t0);
    expect(periodAt(series, t0 + 2 * HALF_HOUR)).toBeUndefined();
  });
});

describe('upsertPeriods', () => {
  it('replaces matching periods, appends new ones and trims old ones', () => {
    const merged = upsertPeriods([period(t0, 0.1, 100), period(t0 + HALF_HOUR, 0.1, 100)], [period(t0 + HALF_HOUR, 0.3, 90), period(t0 + 2 * HALF_HOUR, 0.4, 80)], t0 + HALF_HOUR);
    expect(merged.map((p) => [p.start - t0, p.intensity])).toEqual([
      [HALF_HOUR, 90],
      [2 * HALF_HOUR, 80],
    ]);
  });
});

describe('London time', () => {
  it('reads wall-clock time in GMT and BST', () => {
    expect(londonParts(Date.UTC(2026, 0, 15, 12, 0))).toMatchObject({ hour: 12, minute: 0 });
    expect(londonParts(Date.UTC(2026, 6, 15, 12, 0))).toMatchObject({ hour: 13, minute: 0 });
  });

  it('finds local midnight in winter and summer', () => {
    expect(londonDayStart(Date.UTC(2026, 10, 1, 10, 54))).toBe(Date.UTC(2026, 10, 1, 0, 0));
    // 00:30 BST on 15 July is still the evening of the 14th in UTC.
    expect(londonDayStart(Date.UTC(2026, 6, 14, 23, 30))).toBe(Date.UTC(2026, 6, 14, 23, 0));
  });

  it('makes the spring-forward day 23 hours and the fall-back day 25', () => {
    const spring = londonDay(Date.UTC(2026, 2, 29, 12));
    expect((spring.end - spring.start) / HALF_HOUR).toBe(46);
    const autumn = londonDay(Date.UTC(2026, 9, 25, 12));
    expect((autumn.end - autumn.start) / HALF_HOUR).toBe(50);
    expect(autumn.start).toBe(Date.UTC(2026, 9, 24, 23, 0));
    expect(autumn.end).toBe(Date.UTC(2026, 9, 26, 0, 0));
  });

  it('knows yesterday, even just after midnight', () => {
    const y = londonYesterday(Date.UTC(2026, 10, 1, 0, 5));
    expect(y).toEqual({ start: Date.UTC(2026, 9, 31, 0, 0), end: Date.UTC(2026, 10, 1, 0, 0) });
  });

  it('formats API timestamps and half-hours', () => {
    expect(apiTimestamp(Date.UTC(2026, 10, 1, 10, 0))).toBe('2026-11-01T10:00Z');
    expect(halfHourFloor(Date.UTC(2026, 10, 1, 10, 54, 31))).toBe(Date.UTC(2026, 10, 1, 10, 30));
  });
});

describe('nextPollDelay', () => {
  // Nationally, the API's latest period is the last completed half-hour.
  const now = Date.UTC(2026, 10, 1, 10, 54);
  it('waits for the next half-hour boundary plus four minutes when up to date', () => {
    expect(nextPollDelay(now, Date.UTC(2026, 10, 1, 10, 0))).toBe(10 * 60_000);
  });
  it('checks again in five minutes when the last completed period is missing', () => {
    expect(nextPollDelay(now, Date.UTC(2026, 10, 1, 9, 30))).toBe(5 * 60_000);
  });
  it('treats a period that has only just been published as up to date', () => {
    expect(nextPollDelay(Date.UTC(2026, 10, 1, 11, 3), Date.UTC(2026, 10, 1, 10, 30))).toBe(31 * 60_000);
  });
});

describe('isFresh', () => {
  const at = (h: number, m: number): number => Date.UTC(2026, 10, 1, h, m);
  // Observed on 1 November 2026: at 12:20 both /generation and
  // /regional/regionid/{id} returned 11:30-12:00.
  it('keeps data live until the next completed half-hour is a quarter of an hour late', () => {
    expect(isFresh(at(11, 10), at(10, 30))).toBe(true);
    expect(isFresh(at(11, 44), at(10, 30))).toBe(true);
    expect(isFresh(at(11, 46), at(10, 30))).toBe(false);
  });
  it('counts the period that ended at the last boundary as live, with 15 minutes grace for the next', () => {
    expect(isFresh(at(12, 20), at(11, 30))).toBe(true);
    expect(isFresh(at(12, 14), at(11, 0))).toBe(true);
    expect(isFresh(at(12, 16), at(11, 0))).toBe(false);
  });
});
