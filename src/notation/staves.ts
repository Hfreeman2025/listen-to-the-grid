import type { Fuel } from '../data/schema';
import { RENEWABLES } from '../music/ossia';
import type { Clef } from './pitch';

/** The score's staves and how they stack: the system's full score and the ossia's few. */

export interface StaffDef {
  key: string;
  fuel: Fuel;
  clef: Clef;
  name: string;
  short: string;
  /** which notes of a chord this staff carries (the wind pad spans two staves) */
  split?: 'upper' | 'lower';
  /** text written over the part's first entry */
  entry?: string;
  /** space below this staff, in staff spaces */
  below: number;
}

/** Score order: highest voices at the top, the drone at the bottom. */
export const STAVES: readonly StaffDef[] = [
  { key: 'solar', fuel: 'solar', clef: 'treble8va', name: 'Solar', short: 'Sol.', entry: 'l.v.', below: 5 },
  { key: 'wind-hi', fuel: 'wind', clef: 'treble', name: 'Wind', short: 'Wind', split: 'upper', below: 6 },
  { key: 'wind-lo', fuel: 'wind', clef: 'bass', name: '', short: '', split: 'lower', below: 5 },
  { key: 'hydro', fuel: 'hydro', clef: 'percussion', name: 'Hydro', short: 'Hyd.', below: 4.2 },
  { key: 'biomass', fuel: 'biomass', clef: 'treble', name: 'Biomass', short: 'Bio.', below: 7.2 },
  { key: 'imports', fuel: 'imports', clef: 'treble', name: 'Imports', short: 'Imp.', entry: 'lontano', below: 5 },
  { key: 'nuclear', fuel: 'nuclear', clef: 'bass', name: 'Nuclear', short: 'Nuc.', below: 5 },
  { key: 'other', fuel: 'other', clef: 'treble', name: 'Other', short: 'Oth.', entry: 'pizz.', below: 4.6 },
  { key: 'coal', fuel: 'coal', clef: 'percussion', name: 'Coal', short: 'Coal', below: 4.2 },
  { key: 'gas', fuel: 'gas', clef: 'bass8vb', name: 'Gas', short: 'Gas', below: 4.5 },
];

export const lineCount = (s: StaffDef): number => (s.clef === 'percussion' ? 1 : 5);
export const halfHeight = (s: StaffDef): number => (lineCount(s) === 5 ? 2 : 0);

/** Room above the top staff for bar numbers, tempo and expression marks. */
const SYSTEM_TOP = 8;
/**
 * Text above the top staff sits on tiers, in staff spaces above its top
 * line. A part's own words (l.v. over the bells) sit closest, just over the
 * staff; bar numbers and time cues clear them; tempo and expression clear
 * the cues.
 */
export const TIER_1 = 2.7;
export const TIER_2 = 4.8;

/** Tempo and expression sit far enough above a cue of this size that neither touches the other. */
export function tierAbove(cueSize = 1.15): number {
  return Math.max(TIER_2, TIER_1 + 0.75 * cueSize + 1.25);
}

/** The parts a fully renewable grid plays: the ossia's, and an ossia record's sleeve. The others are tacet. */
export const RENEWABLE_STAVES: readonly StaffDef[] = STAVES.filter((s) => (RENEWABLES as readonly Fuel[]).includes(s.fuel));
/** The ossia's staves: the renewable parts, set closer together, as ossia staves are. */
export const OSSIA_STAVES: readonly StaffDef[] = RENEWABLE_STAVES.map((s) => ({
  ...s,
  below: s.fuel === 'solar' ? 4.2 : s.split === 'upper' ? 5.6 : 4.4,
}));
/** Ossia staves are engraved smaller than the system's, by this much. */
export const OSSIA_SCALE = 0.68;
/** Room above the ossia's top staff for its label, in its own staff spaces. */
export const OSSIA_TOP = 8.5;

/** Middle-line y of each staff, in staff spaces from the system top, and the total height. */
export function staffPositions(staves: readonly StaffDef[] = STAVES, top = SYSTEM_TOP): { ys: number[]; height: number } {
  const ys: number[] = [];
  let y = top;
  staves.forEach((s, i) => {
    y += halfHeight(s);
    ys.push(y);
    y += halfHeight(s) + s.below;
    // Below the last staff, keep room for its dynamic.
    if (i === staves.length - 1) y -= s.below - 4.6;
  });
  return { ys, height: y };
}

/** Height of the ossia block above a system, in the system's staff spaces. */
export function ossiaHeight(): number {
  return staffPositions(OSSIA_STAVES, OSSIA_TOP).height * OSSIA_SCALE;
}
