import { type GridPeriod, sampleAt } from '../data/series';
import { HALF_HOUR, londonDay, londonParts } from '../data/time';
import { type Bar, Conductor } from './conductor';
import { seedFor } from './day';
import { arrange } from './mapping';

/** A half-hour already past, as the bar the score engraves for it. */
export interface PastBar {
  bar: Bar;
  /** start of the half-hour it stands for */
  start: number;
}

/** Bar number within a London day, one bar a half-hour: 00:00 is bar 1, 17:00 is bar 35. */
export function halfHourNumber(t: number): number {
  return Math.round((t - londonDay(t).start) / HALF_HOUR) + 1;
}

const composed = new WeakMap<readonly GridPeriod[], Map<string, Map<number, Bar>>>();

/**
 * Every half-hour of one London day that the series reaches, one bar each,
 * composed from midnight in order with a seed from the day and the place. A
 * half-hour's bar therefore depends only on the figures and never on when it
 * is drawn: the page can move on without rewriting the past.
 */
function dayBars(series: readonly GridPeriod[], day: number, place: string): Map<number, Bar> {
  let byDay = composed.get(series);
  if (!byDay) {
    byDay = new Map();
    composed.set(series, byDay);
  }
  const key = `${place}|${day}`;
  const hit = byDay.get(key);
  if (hit) return hit;
  const { year, month, day: date } = londonParts(day);
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const conductor = new Conductor(seedFor(iso, `${place}|half-hours`));
  const last = series[series.length - 1]?.start ?? day;
  const end = Math.min(londonDay(day).end, last + HALF_HOUR);
  const bars = new Map<number, Bar>();
  for (let t = day, i = 0; t < end; t += HALF_HOUR, i++) {
    // A half-hour's own figures sit at its midpoint; a gap borrows the nearest.
    const snap = sampleAt(series, t + HALF_HOUR / 2);
    if (!snap) break;
    bars.set(t, conductor.bar(i, arrange(snap.mix, snap.intensity, conductor.currentMode ?? undefined)));
  }
  byDay.set(key, bars);
  return bars;
}

/**
 * The half-hours just before `current`, oldest first: up to `count` of them,
 * and only as far back as the series runs without a gap, so every bar shown
 * is a half-hour NESO actually published.
 */
export function composeBefore(series: readonly GridPeriod[], current: number, count: number, place: string): PastBar[] {
  const have = new Set(series.map((p) => p.start));
  const starts: number[] = [];
  for (let t = current - HALF_HOUR; starts.length < count && have.has(t); t -= HALF_HOUR) starts.unshift(t);
  const out: PastBar[] = [];
  for (const start of starts) {
    const bar = dayBars(series, londonDay(start).start, place).get(start);
    if (bar) out.push({ bar, start });
  }
  return out;
}
