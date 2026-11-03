/**
 * Rhythm spelling for 4/4 on a sixteenth-note grid (16 steps a bar): how a
 * copyist writes a sound of a given start and length. Values follow the
 * common-practice rules: show the middle of the bar and the beats, never
 * hide a beat inside a syncopated long note, tie across where needed, and
 * fill silence with undotted rests.
 */

export type Value = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

export interface Piece {
  start: number;
  length: number;
  value: Value;
  dotted: boolean;
}

const STEPS: Record<Value, number> = { whole: 16, half: 8, quarter: 4, eighth: 2, sixteenth: 1 };

/** Every value we write, longest first, with where in the bar it may start. */
const CHOICES: readonly { value: Value; dotted: boolean; starts: (pos: number) => boolean }[] = [
  { value: 'whole', dotted: false, starts: (p) => p === 0 },
  { value: 'half', dotted: true, starts: (p) => p === 0 },
  { value: 'half', dotted: false, starts: (p) => p === 0 || p === 8 },
  { value: 'quarter', dotted: true, starts: (p) => p === 0 || p === 8 },
  { value: 'quarter', dotted: false, starts: (p) => p % 4 === 0 },
  { value: 'eighth', dotted: true, starts: (p) => p % 4 === 0 },
  { value: 'eighth', dotted: false, starts: (p) => p % 2 === 0 },
  { value: 'sixteenth', dotted: false, starts: () => true },
];

export function stepsOf(value: Value, dotted: boolean): number {
  return STEPS[value] * (dotted ? 1.5 : 1);
}

/**
 * The pieces a sound from `start` lasting `length` steps is written as. More
 * than one piece means they are tied. Rests use the same rules but are never
 * dotted.
 */
export function spell(start: number, length: number, rest = false): Piece[] {
  const end = Math.min(16, start + length);
  const out: Piece[] = [];
  let pos = Math.max(0, start);
  while (pos < end) {
    const choice = CHOICES.find((c) => (!rest || !c.dotted) && c.starts(pos) && pos + stepsOf(c.value, c.dotted) <= end);
    const pick = choice ?? { value: 'sixteenth' as const, dotted: false };
    const len = stepsOf(pick.value, pick.dotted);
    out.push({ start: pos, length: len, value: pick.value, dotted: pick.dotted });
    pos += len;
  }
  return out;
}

export interface Sound {
  start: number;
  length: number;
}

/**
 * Rests for the silences in one part's bar: a whole-bar rest if it is empty,
 * otherwise rests spelled into each gap.
 */
export function rests(sounds: readonly Sound[]): Piece[] {
  if (sounds.length === 0) return [{ start: 0, length: 16, value: 'whole', dotted: false }];
  const sorted = [...sounds].sort((a, b) => a.start - b.start);
  const out: Piece[] = [];
  let pos = 0;
  for (const s of sorted) {
    if (s.start > pos) out.push(...spell(pos, s.start - pos, true));
    pos = Math.max(pos, s.start + s.length);
  }
  if (pos < 16) out.push(...spell(pos, 16 - pos, true));
  return out;
}

/**
 * Groups of notes to beam: consecutive quavers or shorter, within the same
 * beat, unbroken by a rest. Each group is a list of indexes into `pieces`
 * (which must be sorted by start); single notes keep their flags.
 */
export function beamGroups(pieces: readonly (Piece & { rest?: boolean })[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let beat = -1;
  const flush = (): void => {
    if (current.length > 1) groups.push(current);
    current = [];
  };
  pieces.forEach((p, i) => {
    const short = p.length < 4 && (p.value === 'eighth' || p.value === 'sixteenth');
    const b = Math.floor(p.start / 4);
    if (!short || p.rest || b !== beat) flush();
    if (short && !p.rest) {
      if (current.length === 0) beat = b;
      current.push(i);
    }
  });
  flush();
  return groups;
}
