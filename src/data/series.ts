import { FUELS, toMix, type GenerationPeriod, type IntensityIndex, type IntensityPeriod, type Mix, type RegionalPeriod } from './schema';
import { HOUR } from './time';

/** One half-hour of the grid: what generated the power and how clean it was. */
export interface GridPeriod {
  start: number;
  end: number;
  mix: Mix;
  /** grams of CO2 per kWh */
  intensity: number;
  /** true when NESO has published the measured value, false for its forecast */
  measured: boolean;
  index: IntensityIndex;
}

/** The grid at an instant, interpolated between half-hours for smooth playback. */
export interface GridSnapshot {
  t: number;
  mix: Mix;
  intensity: number;
  /** the half-hour whose figures this instant is mostly made of */
  period: GridPeriod;
}

/**
 * Joins generation and intensity rows by period start. Rows missing from either
 * side are dropped rather than guessed; duplicates keep the later row.
 */
export function mergeSeries(
  generation: readonly GenerationPeriod[],
  intensity: readonly IntensityPeriod[],
): GridPeriod[] {
  const byStart = new Map<number, IntensityPeriod>();
  for (const row of intensity) byStart.set(row.from, row);
  const out = new Map<number, GridPeriod>();
  for (const row of generation) {
    const i = byStart.get(row.from);
    if (!i) continue;
    const measured = i.intensity.actual !== null;
    const value = i.intensity.actual ?? i.intensity.forecast;
    if (value === null) continue;
    out.set(row.from, {
      start: row.from,
      end: row.to,
      mix: toMix(row.generationmix),
      intensity: value,
      measured,
      index: i.intensity.index,
    });
  }
  return [...out.values()].sort((a, b) => a.start - b.start);
}

/** Regional rows: mix and forecast intensity together, never measured. */
export function regionalSeries(rows: readonly RegionalPeriod[]): GridPeriod[] {
  const out = new Map<number, GridPeriod>();
  for (const row of rows) {
    out.set(row.from, {
      start: row.from,
      end: row.to,
      mix: toMix(row.generationmix),
      intensity: row.intensity.forecast,
      measured: false,
      index: row.intensity.index,
    });
  }
  return [...out.values()].sort((a, b) => a.start - b.start);
}

/** Adds newer periods to a series, replacing any with the same start. */
export function upsertPeriods(series: readonly GridPeriod[], fresh: readonly GridPeriod[], keepFrom: number): GridPeriod[] {
  const byStart = new Map<number, GridPeriod>();
  for (const p of series) byStart.set(p.start, p);
  for (const p of fresh) byStart.set(p.start, p);
  return [...byStart.values()].filter((p) => p.end > keepFrom).sort((a, b) => a.start - b.start);
}

const mid = (p: GridPeriod): number => (p.start + p.end) / 2;

function lerpMix(a: Mix, b: Mix, f: number): Mix {
  const out = { ...a };
  for (const fuel of FUELS) out[fuel] = a[fuel] + (b[fuel] - a[fuel]) * f;
  return out;
}

/**
 * The grid at time `t`. Values glide linearly from one half-hour's midpoint to
 * the next, so a replay sounds continuous; across a gap in the data longer than
 * an hour the nearer period is held instead of inventing a ramp. Times outside
 * the series clamp to its ends.
 */
export function sampleAt(series: readonly GridPeriod[], t: number): GridSnapshot | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return null;
  if (t <= mid(first)) return { t, mix: { ...first.mix }, intensity: first.intensity, period: first };
  if (t >= mid(last)) return { t, mix: { ...last.mix }, intensity: last.intensity, period: last };

  // Largest i with mid(series[i]) <= t.
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    const p = series[m];
    if (p && mid(p) <= t) lo = m;
    else hi = m;
  }
  const a = series[lo];
  const b = series[hi];
  if (!a || !b) return null;
  const span = mid(b) - mid(a);
  const f = (t - mid(a)) / span;
  const period = f < 0.5 ? a : b;
  if (span > HOUR) {
    return { t, mix: { ...period.mix }, intensity: period.intensity, period };
  }
  return {
    t,
    mix: lerpMix(a.mix, b.mix, f),
    intensity: a.intensity + (b.intensity - a.intensity) * f,
    period,
  };
}

/** The period containing `t`, if the series has one. */
export function periodAt(series: readonly GridPeriod[], t: number): GridPeriod | undefined {
  return series.find((p) => p.start <= t && t < p.end);
}
