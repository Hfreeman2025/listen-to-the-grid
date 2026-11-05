/**
 * Just enough music theory: six diatonic modes ordered from brightest to
 * darkest, a quantiser that snaps any pitch onto the current scale, chords
 * built inside the mode, and smooth voice leading between them.
 */

/** The modes the piece plays in, brightest to darkest. */
export type Mode = 'lydian' | 'ionian' | 'mixolydian' | 'dorian' | 'aeolian' | 'phrygian';

/** Semitones above the tonic for each mode. */
export const MODE_STEPS: Record<Mode, readonly number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** The piece is always in D: the gas drone holds D, the modes colour it. */
export const TONIC = 2;
export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'] as const;

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

export function pitchClasses(mode: Mode, tonic = TONIC): number[] {
  return MODE_STEPS[mode].map((s) => mod(tonic + s, 12));
}

export function inScale(midi: number, mode: Mode, tonic = TONIC): boolean {
  return pitchClasses(mode, tonic).includes(mod(Math.round(midi), 12));
}

/**
 * Snaps a (possibly fractional) MIDI pitch to the nearest note of the scale.
 * Exactly half-way between two scale notes resolves downwards.
 */
export function quantise(midi: number, mode: Mode, tonic = TONIC): number {
  const pcs = pitchClasses(mode, tonic);
  let best = Math.round(midi);
  let bestDistance = Infinity;
  const base = Math.floor(midi);
  for (let candidate = base - 2; candidate <= base + 3; candidate++) {
    if (!pcs.includes(mod(candidate, 12))) continue;
    const d = Math.abs(candidate - midi);
    if (d < bestDistance - 1e-9) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * MIDI note for a scale degree counted from the tonic in `octave` (degree 0 is
 * the tonic, 7 the tonic an octave up, -1 the leading note below).
 * Octave numbering follows MIDI: D4 = 62.
 */
export function degreeToMidi(degree: number, mode: Mode, octave: number, tonic = TONIC): number {
  const steps = MODE_STEPS[mode];
  const octaveShift = Math.floor(degree / 7);
  const step = steps[mod(degree, 7)] ?? 0;
  return 12 * (octave + 1) + tonic + 12 * octaveShift + step;
}

/** The degree of the scale nearest to a MIDI pitch, in the same numbering. */
export function midiToDegree(midi: number, mode: Mode, octave: number, tonic = TONIC): number {
  const q = quantise(midi, mode, tonic);
  // Search outwards; the scale is dense enough that this ends within a few steps.
  for (let d = -30; d <= 30; d++) {
    if (degreeToMidi(d, mode, octave, tonic) === q) return d;
  }
  throw new Error(`pitch ${midi} not reachable from octave ${octave}`);
}

export type ChordShape = 'triad' | 'seventh' | 'add9';

/** Pitch classes of the chord built on `degree` from the mode's own notes. */
export function chordPitchClasses(mode: Mode, degree: number, shape: ChordShape, tonic = TONIC): number[] {
  const offsets = shape === 'triad' ? [0, 2, 4] : shape === 'seventh' ? [0, 2, 4, 6] : [0, 2, 4, 8];
  return offsets.map((o) => mod(degreeToMidi(degree + o, mode, 4, tonic), 12));
}

/**
 * Chooses notes for the new chord as close as possible to the previous voicing,
 * so pads glide rather than jump. Movement is scored as the sum of squared
 * semitone moves, which prefers several small steps to one leap. Every pitch class in the chord is used at
 * least once and no two voices share a note. With more voices than chord notes
 * any tone may be doubled, though doubling the third costs a little extra (it
 * sounds heavy), so ties go to the root or fifth. Returns pitches sorted low to
 * high, each inside [low, high].
 */
export function voiceLead(previous: readonly number[], chord: readonly number[], low: number, high: number): number[] {
  const voices = previous.length;
  if (voices === 0 || chord.length === 0) return [];
  const third = chord[1];

  const nearest = (from: number, pc: number): number => {
    let candidate = from - mod(from - pc, 12);
    if (from - candidate > 6) candidate += 12;
    while (candidate < low) candidate += 12;
    while (candidate > high) candidate -= 12;
    return candidate;
  };

  let best: number[] = [];
  let bestCost = Infinity;
  const pick: number[] = [];
  const pickPc: number[] = [];

  const search = (voice: number, cost: number): void => {
    if (cost >= bestCost) return;
    if (voice === voices) {
      if (!chord.every((pc) => pickPc.includes(pc))) return;
      if (new Set(pick).size !== pick.length) return;
      const thirds = pickPc.filter((pc) => pc === third).length;
      const total = cost + (thirds > 1 ? 0.5 * (thirds - 1) : 0);
      if (total < bestCost) {
        bestCost = total;
        best = [...pick];
      }
      return;
    }
    const from = previous[voice] ?? low;
    for (const pc of chord) {
      const note = nearest(from, pc);
      pick.push(note);
      pickPc.push(pc);
      search(voice + 1, cost + (note - from) ** 2);
      pick.pop();
      pickPc.pop();
    }
  };
  search(0, 0);
  if (best.length === 0) {
    // Range too narrow for distinct notes: stack upwards instead.
    best = stackChord([...chord, ...chord].slice(0, voices), low).map((m) => Math.min(m, high));
  }
  return best.sort((a, b) => a - b);
}

/** Root position voicing of a chord starting at or above `low`. */
export function stackChord(chord: readonly number[], low: number): number[] {
  const out: number[] = [];
  let floor = low;
  for (const pc of chord) {
    const note = floor + mod(pc - floor, 12);
    out.push(note);
    floor = note + 1;
  }
  return out;
}
