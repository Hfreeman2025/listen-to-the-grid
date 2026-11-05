import type { Mix } from '../data/schema';
import { type GridPeriod, sampleAt } from '../data/series';
import { HOUR, type Span } from '../data/time';
import { BAR_SECONDS, type Bar, Conductor } from './conductor';
import { arrange } from './mapping';

/** Seconds the hall rings on after the last bar of a record. */
export const TAIL_SECONDS = 3.5;

export interface DayScore {
  /** one bar for each hour of the day */
  bars: Bar[];
  /** length of the record, including the tail */
  seconds: number;
  /** the grid at `t` seconds into the record */
  at: (t: number) => { mix: Mix; grams: number };
}

/** A stable seed for a day and place, so a day always presses the same record. */
export function seedFor(isoDate: string, place: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${isoDate}|${place}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A whole day as music, one bar an hour (so 23, 24 or 25 bars, whatever the
 * clocks did). Composed without any audio, which makes the sleeve instant;
 * rendering the same bars later gives a record that matches it note for note.
 */
export function composeDay(
  series: readonly GridPeriod[],
  span: Span,
  seed: number,
  /** re-score each moment, as the ossia does; the figures as they are by default */
  version: (g: { mix: Mix; grams: number }) => { mix: Mix; grams: number } = (g) => g,
): DayScore {
  const hours = Math.round((span.end - span.start) / HOUR);
  const music = hours * BAR_SECONDS;
  const at = (t: number): { mix: Mix; grams: number } => {
    const d = span.start + (Math.min(music, Math.max(0, t)) / BAR_SECONDS) * HOUR;
    const snap = sampleAt(series, d);
    return version(
      snap
        ? { mix: snap.mix, grams: snap.intensity }
        : { mix: { solar: 0, wind: 0, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: 1 }, grams: 300 },
    );
  };
  const conductor = new Conductor(seed);
  const bars: Bar[] = [];
  for (let b = 0; b < hours; b++) {
    const g = at(b * BAR_SECONDS);
    bars.push(conductor.bar(b, arrange(g.mix, g.grams, conductor.currentMode ?? undefined)));
  }
  return { bars, seconds: music + TAIL_SECONDS, at };
}
