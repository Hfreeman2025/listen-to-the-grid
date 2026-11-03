import { MODE_STEPS, TONIC, type Mode } from '../music/theory';

/**
 * Where notes sit on a staff. Positions are staff steps from the middle line:
 * 0 is the middle line, +1 the space above it, +2 the next line up; the five
 * lines are at -4, -2, 0, 2 and 4.
 */

export type Clef = 'treble' | 'treble8va' | 'bass' | 'bass8vb' | 'percussion';

/** Natural pitch classes of C D E F G A B. */
const NATURAL = [0, 2, 4, 5, 7, 9, 11] as const;
/** D is letter 1 (C = 0); every mode on D uses each letter once, from D. */
const D_LETTER = 1;

/** Diatonic number of the middle line: B4 for treble, D3 for bass (C4 = 28). */
const MIDDLE: Record<Exclude<Clef, 'percussion'>, number> = {
  treble: 4 * 7 + 6,
  treble8va: 5 * 7 + 6,
  bass: 3 * 7 + 1,
  bass8vb: 2 * 7 + 1,
};

export interface Spelled {
  /** letter, C = 0 … B = 6 */
  letter: number;
  /** -1 flat, 0 natural, +1 sharp */
  accidental: number;
  /** scientific octave: C4 is middle C */
  octave: number;
}

/**
 * Spells a MIDI note in a mode on D: scale degree k takes the k-th letter
 * from D, so D Lydian's raised fourth is G sharp and D Phrygian's lowered
 * second is E flat. Notes outside the mode are spelled with sharps.
 */
export function spellPitch(midi: number, mode: Mode): Spelled {
  const pc = ((midi % 12) + 12) % 12;
  const degree = MODE_STEPS[mode].findIndex((s) => (TONIC + s) % 12 === pc);
  let letter: number;
  let accidental: number;
  if (degree >= 0) {
    letter = (D_LETTER + degree) % 7;
    accidental = pc - (NATURAL[letter] ?? 0);
    if (accidental > 6) accidental -= 12;
    if (accidental < -6) accidental += 12;
  } else {
    const natural = NATURAL.indexOf(pc as (typeof NATURAL)[number]);
    letter = natural >= 0 ? natural : NATURAL.indexOf((pc - 1) as (typeof NATURAL)[number]);
    accidental = natural >= 0 ? 0 : 1;
  }
  const octave = Math.round((midi - accidental - (NATURAL[letter] ?? 0)) / 12) - 1;
  return { letter, accidental, octave };
}

/** Staff step of a note on a clef. Percussion notes all sit on the one line. */
export function staffStep(midi: number, mode: Mode, clef: Clef): number {
  if (clef === 'percussion') return 0;
  const s = spellPitch(midi, mode);
  return s.octave * 7 + s.letter - MIDDLE[clef];
}

export interface KeySignature {
  kind: 'sharp' | 'flat' | 'none';
  /** staff steps of each accidental, in the order they are written */
  steps: number[];
}

/** How many sharps (positive) or flats (negative) each mode on D carries. */
export const KEY_ACCIDENTALS: Record<Mode, number> = {
  lydian: 3,
  ionian: 2,
  mixolydian: 1,
  dorian: 0,
  aeolian: -1,
  phrygian: -2,
};

/** Standard positions: treble sharps F C G, flats B E; bass a third lower. */
const SHARP_STEPS = { treble: [4, 1, 5], bass: [2, -1, 3] } as const;
const FLAT_STEPS = { treble: [0, 3], bass: [-2, 1] } as const;

export function keySignature(mode: Mode, clef: Clef): KeySignature {
  const n = KEY_ACCIDENTALS[mode];
  if (n === 0 || clef === 'percussion') return { kind: 'none', steps: [] };
  const family = clef === 'bass' || clef === 'bass8vb' ? 'bass' : 'treble';
  return n > 0 ? { kind: 'sharp', steps: SHARP_STEPS[family].slice(0, n) } : { kind: 'flat', steps: FLAT_STEPS[family].slice(0, -n) };
}

/** Ledger lines a note at `step` needs: the even steps beyond the staff. */
export function ledgerLines(step: number): number[] {
  const out: number[] = [];
  for (let s = 6; s <= step; s += 2) out.push(s);
  for (let s = -6; s >= step; s -= 2) out.push(s);
  return out;
}

/**
 * Stem direction for a note or chord: away from the middle line, decided by
 * whichever note is furthest from it; a note on the middle line points down.
 */
export function stemUp(steps: readonly number[]): boolean {
  let far = 0;
  for (const s of steps) if (Math.abs(s) > Math.abs(far) || (Math.abs(s) === Math.abs(far) && s > far)) far = s;
  return far < 0;
}
