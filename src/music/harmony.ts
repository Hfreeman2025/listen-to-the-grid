import { type ChordShape, chordPitchClasses, type Mode } from './theory';

/**
 * Carbon intensity picks the mode. The ladder runs from Lydian, the brightest
 * of the diatonic modes, to Phrygian, the darkest one still usable as a home
 * key. Thresholds are grams of CO2 per kWh; each band starts at its `from`.
 */
export const MODE_LADDER: readonly { mode: Mode; from: number; marking: string; gloss: string }[] = [
  { mode: 'lydian', from: 0, marking: 'luminoso', gloss: 'luminously' },
  { mode: 'ionian', from: 60, marking: 'dolce', gloss: 'sweetly' },
  { mode: 'mixolydian', from: 110, marking: 'semplice', gloss: 'plainly' },
  { mode: 'dorian', from: 150, marking: 'pensieroso', gloss: 'pensively' },
  { mode: 'aeolian', from: 190, marking: 'mesto', gloss: 'mournfully' },
  { mode: 'phrygian', from: 240, marking: 'inquieto', gloss: 'restlessly' },
];

/** How far past a threshold the intensity must move before the mode changes. */
const HYSTERESIS = 5;

export function modeInfo(mode: Mode): (typeof MODE_LADDER)[number] {
  const info = MODE_LADDER.find((m) => m.mode === mode);
  if (!info) throw new Error(`unknown mode ${mode}`);
  return info;
}

/**
 * The mode for an intensity. Pass the mode currently playing to get a little
 * stickiness at the band edges, so a value wobbling around 150 g does not
 * flip the harmony every half-hour.
 */
export function modeForIntensity(grams: number, current?: Mode): Mode {
  let plain: Mode = 'lydian';
  for (const band of MODE_LADDER) if (grams >= band.from) plain = band.mode;
  if (!current || current === plain) return plain;

  const ci = MODE_LADDER.findIndex((b) => b.mode === current);
  const band = MODE_LADDER[ci];
  const next = MODE_LADDER[ci + 1];
  if (!band) return plain;
  const lowerEdge = band.from - HYSTERESIS;
  const upperEdge = next ? next.from + HYSTERESIS : Infinity;
  return grams >= lowerEdge && grams < upperEdge ? current : plain;
}

/** 0 for a dirty grid, 1 for a clean one: drives tone colour and space. */
export function brightness(grams: number): number {
  return Math.min(1, Math.max(0, 1 - (grams - 40) / 220));
}

/**
 * Eight-bar phrases, one chord a bar, as scale degrees (0 = tonic). Each is a
 * question and an answer: bar 4 stops on a half cadence away from home, bar 8
 * comes home to D. Each mode leans on the chord that gives it its character:
 * Lydian's major II, Mixolydian's flat VII, Dorian's major IV, Aeolian's flat
 * VI and Phrygian's flat II.
 */
const PROGRESSIONS: Record<Mode, readonly number[]> = {
  lydian: [0, 1, 0, 1, 6, 1, 4, 0],
  ionian: [0, 3, 1, 4, 0, 5, 4, 0],
  mixolydian: [0, 6, 3, 4, 0, 6, 3, 0],
  dorian: [0, 3, 0, 6, 0, 3, 6, 0],
  aeolian: [0, 5, 3, 4, 0, 5, 6, 0],
  phrygian: [0, 1, 0, 6, 0, 1, 6, 0],
};

export const PHRASE_BARS = 8;

export interface Chord {
  degree: number;
  pitchClasses: number[];
}

/** The chord for a bar. Clean grids get open add9 voicings, dirtier ones sevenths. */
export function chordForBar(mode: Mode, bar: number, bright: number): Chord {
  const cycle = PROGRESSIONS[mode];
  const degree = cycle[((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS] ?? 0;
  const shape: ChordShape = bright >= 0.5 ? 'add9' : 'seventh';
  return { degree, pitchClasses: chordPitchClasses(mode, degree, shape) };
}
