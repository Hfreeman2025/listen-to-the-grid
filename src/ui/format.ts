import { FUELS, type Fuel, type Mix } from '../data/schema';
import type { GridPeriod } from '../data/series';
import { londonParts, MINUTE } from '../data/time';
import { modeInfo } from '../music/harmony';
import type { Mode } from '../music/theory';

export const FUEL_NAMES: Record<Fuel, string> = {
  solar: 'Solar',
  wind: 'Wind',
  hydro: 'Hydro',
  biomass: 'Biomass',
  imports: 'Imports',
  nuclear: 'Nuclear',
  other: 'Other',
  coal: 'Coal',
  gas: 'Gas',
};

export const MODE_NAMES: Record<Mode, string> = {
  lydian: 'Lydian',
  ionian: 'major',
  mixolydian: 'Mixolydian',
  dorian: 'Dorian',
  aeolian: 'minor',
  phrygian: 'Phrygian',
};

const tz = 'Europe/London';
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
const weekdayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });
const dayOfMonthFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric' });

/** "10:30" */
export function clock(t: number): string {
  return clockFormat.format(t);
}

/**
 * "GMT" or "BST", from London's offset at that instant. Browsers' own zone
 * names vary (some print "GMT+0"), so the label is worked out, not looked up.
 */
export function zone(t: number): string {
  const p = londonParts(t);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(t / MINUTE) * MINUTE === 0 ? 'GMT' : 'BST';
}

/** "10:00–10:30 GMT", or "01:30 BST–01:00 GMT" across a clock change. */
export function periodLabel(p: { start: number; end: number }): string {
  const a = zone(p.start);
  const b = zone(p.end);
  return a === b ? `${clock(p.start)}–${clock(p.end)} ${a}` : `${clock(p.start)} ${a}–${clock(p.end)} ${b}`;
}

/** "Sunday 1 November 2026" (en-GB puts a comma after the weekday; drop it) */
export function longDay(t: number): string {
  return dayFormat.format(t).replace(',', '');
}

/** "Sun 1 Nov" */
export function shortDay(t: number): string {
  return shortDayFormat.format(t).replace(',', '');
}

/** "Sun" and "1", for the week ribbon */
export function weekday(t: number): string {
  return weekdayFormat.format(t);
}
export function dayOfMonth(t: number): string {
  return dayOfMonthFormat.format(t);
}

/** Whole-number percentage, with "<1%" for a sliver rather than a misleading 0%. */
export function percent(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.005) return '<1%';
  return `${Math.round(share * 100)}%`;
}

/** Fuels by share, largest first; ties keep score order. */
export function ranked(mix: Mix): Fuel[] {
  return [...FUELS].sort((a, b) => mix[b] - mix[a]);
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** "33% gas, 18% imports, 16% nuclear … and 1% other; no coal." */
export function describeMix(mix: Mix): string {
  const order = ranked(mix);
  const on = order.filter((f) => mix[f] >= 0.005).map((f) => `${percent(mix[f])} ${FUEL_NAMES[f].toLowerCase()}`);
  const off = order.filter((f) => mix[f] < 0.005 && mix[f] <= 0).map((f) => FUEL_NAMES[f].toLowerCase());
  const tail = off.length > 0 ? `; no ${list(off)}` : '';
  return `${list(on)}${tail}.`;
}

/** The headline sentence: what is mostly generating, and how that sounds. */
export function headline(mix: Mix, mode: Mode, place?: string): string {
  const [first, second] = ranked(mix);
  if (!first) return '';
  const lead = mix[first];
  const name = FUEL_NAMES[first].toLowerCase();
  const what =
    lead >= 0.5
      ? `running mostly on ${name}`
      : second && mix[second] >= lead * 0.8
        ? `running on ${name} and ${FUEL_NAMES[second].toLowerCase()}`
        : `leaning on ${name}`;
  const subject = place ? `In ${place} the grid is` : 'The grid is';
  return `${subject} ${what}, so it plays in D ${MODE_NAMES[mode]}, ${modeInfo(mode).gloss}.`;
}

/** "165 g of CO₂ per kWh, measured; NESO rates that moderate." */
export function describeIntensity(p: Pick<GridPeriod, 'intensity' | 'measured' | 'index'>, regional = false): string {
  const grams = p.intensity;
  const how = p.measured
    ? 'measured'
    : regional
      ? 'modelled (NESO estimates its regional figures)'
      : 'forecast (the measured figure is not out yet)';
  return `${Math.round(grams)} g of CO₂ per kWh, ${how}; NESO rates that ${p.index}.`;
}
