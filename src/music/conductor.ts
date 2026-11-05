import { FUELS, type Fuel, type Mix } from '../data/schema';
import { type Chord, chordForBar, PHRASE_BARS } from './harmony';
import type { Arrangement } from './mapping';
import { createRng, type Rng } from './rng';
import { degreeToMidi, type Mode, midiToDegree, quantise, stackChord, voiceLead } from './theory';

/** Andante in common time: one bar is exactly 2.5 seconds. */
const BPM = 96;
const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
export const STEP_SECONDS = 60 / BPM / STEPS_PER_BEAT;
export const BAR_SECONDS = STEP_SECONDS * STEPS_PER_BAR;

/**
 * One note (or chord) in one part, inside one bar, on the sixteenth-note grid.
 * `held` marks notation for a sound that is continuous in the audio (the pad,
 * the drone, the water): the score shows it, the engine does not retrigger it.
 */
export interface PartNote {
  start: number;
  length: number;
  midis: number[];
  velocity: number;
  held?: boolean;
}

/** A bar of the score: everything the engraver and the engine need. */
export interface Bar {
  index: number;
  mode: Mode;
  /** the mode changed at this bar line (or it is the first bar) */
  keyChange: boolean;
  chord: Chord;
  /** position in the eight-bar phrase, 0-7 */
  phrasePos: number;
  /** the four notes of the wind pad */
  pad: number[];
  /** phrase shape: expression level at the start and end of the bar */
  swell: { from: number; to: number };
  /** generation shares at the bar line, for the dynamics */
  shares: Mix;
  parts: Record<Fuel, PartNote[]>;
}

/** An event for the audio engine, on the global sixteenth-note grid. */
export interface NoteEvent {
  voice: Fuel;
  step: number;
  midis: number[];
  velocity: number;
  /** seconds */
  duration: number;
}

/**
 * Expression across the phrase, at each bar line: rising to a half cadence,
 * easing, then rising to the peak in bar 7 and falling away home.
 */
export const SWELL = [0.5, 0.68, 0.88, 0.66, 0.56, 0.8, 1, 0.78, 0.5] as const;

/** Rhythm cells for the sung line: [start, length] in sixteenths, gaps are rests. */
const MOTIFS: readonly (readonly [number, number])[][] = [
  [
    [0, 4],
    [4, 4],
    [8, 8],
  ], // crotchet crotchet minim
  [
    [0, 6],
    [6, 2],
    [8, 8],
  ], // dotted crotchet quaver minim
  [
    [0, 2],
    [2, 2],
    [4, 4],
    [8, 8],
  ], // quaver quaver crotchet minim
  [
    [0, 8],
    [8, 4],
    [12, 4],
  ], // minim crotchet crotchet
  [
    [0, 4],
    [4, 2],
    [6, 2],
    [8, 4],
    [12, 4],
  ], // crotchet quaver quaver crotchet crotchet
  [
    [0, 4],
    [4, 4],
    [8, 4],
  ], // three crotchets, then breathe
];
const HALF_CADENCES: readonly (readonly [number, number])[][] = [
  [[0, 12]], // dotted minim, crotchet rest
  [
    [0, 4],
    [4, 8],
  ], // crotchet, minim, crotchet rest
  [[0, 8]], // minim, minim rest
];
const FINAL_CADENCES: readonly (readonly [number, number])[][] = [
  [[0, 16]],
  [[0, 12]],
  [
    [0, 4],
    [4, 12],
  ],
];

/** Registers, as MIDI note ranges. D4 = 62. */
const PAD = { low: 48, high: 74 };
const PULSE = { low: 45, high: 56 };
const MELODY = { low: 57, high: 76 };
const BELLS = { low: 74, high: 93 };

/**
 * Composes the music a bar at a time from the current arrangement, in
 * eight-bar phrases: a sung motif that repeats and answers itself, bells that
 * reply in the melody's gaps, chords that move every bar to a half cadence and
 * home again. Harmony only moves at a bar line, so however fast the data
 * changes the music stays in time and in key. Seeded: the same seed and the
 * same arrangements always give the same notes.
 */
export class Conductor {
  private readonly rng: Rng;
  private mode: Mode | null = null;
  private chord: Chord | null = null;
  private pad: number[] = [50, 57, 62, 66];
  private melody = 69;
  private motif = 0;
  private variation = 1;
  private contour = 1;

  constructor(seed = 1) {
    this.rng = createRng(seed);
  }

  get currentMode(): Mode | null {
    return this.mode;
  }

  get currentChord(): Chord | null {
    return this.chord;
  }

  get currentPad(): number[] {
    return [...this.pad];
  }

  bar(index: number, arr: Arrangement): Bar {
    const r = this.rng;
    const pos = ((index % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
    const mode = arr.mode;
    const keyChange = mode !== this.mode;
    this.mode = mode;
    const chord = chordForBar(mode, pos, arr.brightness);
    this.chord = chord;
    this.pad = voiceLead(this.pad, chord.pitchClasses, PAD.low, PAD.high);
    if (pos === 0) {
      this.motif = Math.floor(r() * MOTIFS.length);
      this.variation = (this.motif + 1 + Math.floor(r() * (MOTIFS.length - 1))) % MOTIFS.length;
      this.contour = r() < 0.5 ? 1 : -1;
    }

    const parts = emptyParts();
    const s = arr.shares;

    // Held sounds: notated, continuous in the audio.
    if (s.gas > 0) parts.gas.push({ start: 0, length: 16, midis: [38, 45], velocity: 1, held: true });
    if (s.wind > 0) parts.wind.push({ start: 0, length: 16, midis: [...this.pad], velocity: 1, held: true });
    if (s.hydro > 0) parts.hydro.push({ start: 0, length: 16, midis: [86], velocity: 1, held: true });

    // Nuclear: the steady pulse, a crotchet on every beat, on the chord's root.
    if (arr.nuclear.amp > 0) {
      const root = rootIn(chord, PULSE.low, PULSE.high);
      for (let beat = 0; beat < 4; beat++)
        parts.nuclear.push({ start: beat * 4, length: 4, midis: [root], velocity: beat === 0 ? 1 : 0.72 });
    }

    parts.biomass = this.sing(pos, mode, chord, arr.biomass.density);
    parts.solar = this.ring(parts.biomass, mode, chord, arr.solar.density);

    // Imports: distant chords at the start of each half-phrase.
    if (arr.imports.density > 0) {
      const triad = stackChord(chord.pitchClasses.slice(0, 3), 62);
      if ((pos === 0 || pos === 4) && r() < 0.35 + 0.65 * arr.imports.density) {
        parts.imports.push({ start: 0, length: 16, midis: triad, velocity: 0.75 });
      } else if ((pos === 2 || pos === 6) && r() < arr.imports.density) {
        parts.imports.push({ start: 0, length: 8, midis: triad, velocity: 0.6 });
      }
    }

    // Hydro: droplets over the running water, never on the downbeat.
    if (arr.hydro.dropDensity > 0) {
      for (let step = 2; step < 16; step += 2) {
        if (r() < arr.hydro.dropDensity * 0.3)
          parts.hydro.push({ start: step, length: 2, midis: [quantise(79 + r() * 17, mode)], velocity: 0.4 + r() * 0.4 });
      }
    }

    // Other: the odd plucked crotchet on beat 2 or 4.
    if (arr.other.density > 0) {
      for (const step of [4, 12]) {
        if (r() < arr.other.density * 0.7)
          parts.other.push({ start: step, length: 4, midis: [quantise(64 + r() * 17, mode)], velocity: 0.5 + r() * 0.3 });
      }
    }

    // Coal: crackling grit in semiquavers.
    if (arr.coal.drive > 0) {
      for (let step = 0; step < 16; step++) {
        if (r() < arr.coal.drive * 0.5)
          parts.coal.push({ start: step, length: 1, midis: [rootIn(chord, 38, 49)], velocity: 0.5 + r() * 0.5 });
      }
    }

    return {
      index,
      mode,
      keyChange,
      chord,
      phrasePos: pos,
      pad: [...this.pad],
      swell: { from: SWELL[pos] ?? 0.8, to: SWELL[pos + 1] ?? 0.8 },
      shares: { ...s },
      parts,
    };
  }

  /**
   * Biomass: the sung line. Fewer bars sing when biomass is small, but the
   * cadence bars always do, so the phrase still lands.
   */
  private sing(pos: number, mode: Mode, chord: Chord, density: number): PartNote[] {
    if (density <= 0) return [];
    const r = this.rng;
    const half = pos % 4;
    const active = Math.max(1, Math.min(4, 1 + Math.round(3 * density)));
    const sings = half === 3 || half < active - 1;
    if (!sings) return [];
    const cells = half === 3 ? (pos === 7 ? FINAL_CADENCES : HALF_CADENCES) : MOTIFS;
    const cellIndex = half === 3 ? Math.floor(r() * cells.length) : half === 2 ? this.variation : this.motif;
    const cell = cells[cellIndex] ?? MOTIFS[0] ?? [];
    // Sequence: each new bar of the motif starts a step higher or lower.
    if (half === 1 || half === 2) this.melody = this.step(this.melody, mode, this.contour);
    const notes: PartNote[] = [];
    cell.forEach(([start, length], i) => {
      let midi = i === 0 ? this.melody : this.step(this.melody, mode, i % 3 === 2 ? -this.contour : this.contour);
      const strong = start === 0 || start === 8;
      if (strong) midi = nearestOf(midi, chord.pitchClasses);
      if (half === 3 && i === cell.length - 1) {
        // Cadence: the last note settles on the chord, and at the end of the
        // phrase on D itself.
        midi = pos === 7 ? nearestOf(midi, [2]) : nearestOf(midi, chord.pitchClasses);
      }
      midi = clamp(midi, mode);
      this.melody = midi;
      notes.push({ start, length, midis: [midi], velocity: strong ? 0.9 : 0.72 });
    });
    if (pos === 7) this.contour = -this.contour;
    return notes;
  }

  /** Solar: bell figures that answer in the beats where the voice is not starting a note. */
  private ring(melody: readonly PartNote[], mode: Mode, chord: Chord, density: number): PartNote[] {
    if (density <= 0) return [];
    const r = this.rng;
    const busy = new Set(melody.map((n) => Math.floor(n.start / 4)));
    const notes: PartNote[] = [];
    for (let beat = 0; beat < 4; beat++) {
      if (busy.has(beat) || r() >= density) continue;
      const sixteenths = density > 0.55 && r() < 0.45;
      const count = sixteenths ? 4 : 2;
      const length = sixteenths ? 1 : 2;
      const up = r() < 0.6;
      const startPc = chord.pitchClasses[Math.floor(r() * chord.pitchClasses.length)] ?? 2;
      let midi = BELLS.low + ((((startPc - BELLS.low) % 12) + 12) % 12) + (r() < 0.5 ? 0 : 12);
      let degree = midiToDegree(midi, mode, 5);
      for (let i = 0; i < count; i++) {
        midi = degreeToMidi(degree, mode, 5);
        if (midi > BELLS.high) midi -= 12;
        if (midi < BELLS.low) midi += 12;
        notes.push({ start: beat * 4 + i * length, length, midis: [midi], velocity: Math.max(0.4, 0.95 - i * 0.14) });
        degree += up ? 1 : -1;
      }
    }
    return notes;
  }

  private step(midi: number, mode: Mode, direction: number): number {
    return degreeToMidi(midiToDegree(midi, mode, 4) + direction, mode, 4);
  }
}

function emptyParts(): Record<Fuel, PartNote[]> {
  return { solar: [], wind: [], hydro: [], biomass: [], imports: [], nuclear: [], other: [], coal: [], gas: [] };
}

function clamp(midi: number, mode: Mode): number {
  let m = midi;
  while (m > MELODY.high) m -= 12;
  while (m < MELODY.low) m += 12;
  return quantise(m, mode);
}

function rootIn(chord: Chord, low: number, high: number): number {
  const root = chord.pitchClasses[0] ?? 2;
  let midi = low + ((((root - low) % 12) + 12) % 12);
  if (midi > high) midi -= 12;
  return midi;
}

/** The nearest pitch to `midi` whose pitch class is one of `pcs`. */
function nearestOf(midi: number, pcs: readonly number[]): number {
  let best = midi;
  let bestDistance = Infinity;
  for (let candidate = midi - 6; candidate <= midi + 6; candidate++) {
    if (!pcs.includes(((candidate % 12) + 12) % 12)) continue;
    const d = Math.abs(candidate - midi);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** Audio events for a bar: held notation is skipped, it is already sounding. */
export function barEvents(bar: Bar): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const voice of FUELS) {
    for (const n of bar.parts[voice]) {
      if (n.held) continue;
      out.push({
        voice,
        step: bar.index * STEPS_PER_BAR + n.start,
        midis: n.midis,
        velocity: n.velocity,
        duration:
          voice === 'solar'
            ? 2.4
            : voice === 'nuclear'
              ? 0.42
              : voice === 'hydro'
                ? 0.14
                : voice === 'other'
                  ? 0.5
                  : n.length * STEP_SECONDS * (voice === 'imports' ? 0.95 : 1),
      });
    }
  }
  return out.sort((a, b) => a.step - b.step);
}
