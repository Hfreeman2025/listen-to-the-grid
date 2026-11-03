import { describe, expect, it } from 'vitest';
import { BAR_SECONDS, Conductor, STEP_SECONDS, barEvents, type Bar } from '../src/music/conductor';
import { arrange } from '../src/music/mapping';
import { inScale } from '../src/music/theory';
import { FUELS, type Mix } from '../src/data/schema';

const mix = (over: Partial<Mix>): Mix => ({ solar: 0, wind: 0, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: 0, ...over });
const busy = mix({ solar: 0.15, wind: 0.3, hydro: 0.05, biomass: 0.12, imports: 0.1, nuclear: 0.15, other: 0.05, coal: 0.02, gas: 0.06 });

function play(seed: number, bars: number, grams: (bar: number) => number, m: Mix = busy): Bar[] {
  const c = new Conductor(seed);
  return Array.from({ length: bars }, (_, b) => c.bar(b, arrange(m, grams(b), c.currentMode ?? undefined)));
}

const LENGTHS = new Set([1, 2, 3, 4, 6, 8, 12, 16]);

describe('timing', () => {
  it('plays andante: 96 crotchets a minute, 2.5 s a bar', () => {
    expect(STEP_SECONDS).toBe(0.15625);
    expect(BAR_SECONDS).toBe(2.5);
  });
});

describe('Conductor', () => {
  const sweep = play(7, 64, (b) => 30 + (b / 64) * 260);

  it('keeps every note in the key of its bar, across all six modes', () => {
    for (const bar of sweep) for (const f of FUELS) for (const n of bar.parts[f]) for (const m of n.midis) expect(inScale(m, bar.mode), `${f} ${m} in ${bar.mode}`).toBe(true);
    expect(new Set(sweep.map((b) => b.mode))).toEqual(new Set(['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian']));
  });

  it('writes only rhythms an engraver can spell, inside the bar', () => {
    for (const bar of sweep) {
      for (const f of FUELS) {
        for (const n of bar.parts[f]) {
          expect(n.start).toBeGreaterThanOrEqual(0);
          expect(n.start + n.length).toBeLessThanOrEqual(16);
          expect(LENGTHS.has(n.length), `${f} length ${n.length}`).toBe(true);
        }
      }
      // The sung line and the bells never overlap themselves.
      for (const f of ['biomass', 'solar'] as const) {
        const notes = [...bar.parts[f]].sort((a, b) => a.start - b.start);
        for (let i = 1; i < notes.length; i++) expect(notes[i]?.start ?? 0).toBeGreaterThanOrEqual((notes[i - 1]?.start ?? 0) + (notes[i - 1]?.length ?? 0));
      }
    }
  });

  it('marks a key change exactly where the mode changes', () => {
    sweep.forEach((bar, i) => {
      expect(bar.keyChange).toBe(i === 0 || bar.mode !== sweep[i - 1]?.mode);
    });
  });

  it('pulses nuclear on every beat, accenting the downbeat', () => {
    const bar = play(1, 1, () => 120)[0];
    expect(bar?.parts.nuclear.map((n) => [n.start, n.length, n.velocity])).toEqual([
      [0, 4, 1],
      [4, 4, 0.72],
      [8, 4, 0.72],
      [12, 4, 0.72],
    ]);
  });

  it('writes no part for a fuel that is not generating', () => {
    const night = mix({ wind: 0.4, gas: 0.4, nuclear: 0.2 });
    const bars = play(9, 32, () => 150, night);
    const sounding = new Set(bars.flatMap((b) => FUELS.filter((f) => b.parts[f].length > 0)));
    expect(sounding).toEqual(new Set(['wind', 'gas', 'nuclear']));
  });

  it('rings more bells the more solar there is', () => {
    const count = (solar: number) => play(11, 32, () => 100, mix({ solar, gas: 1 - solar })).reduce((n, b) => n + b.parts.solar.length, 0);
    expect(count(0.01)).toBeGreaterThan(0);
    expect(count(0.2)).toBeGreaterThan(count(0.01) * 4);
  });

  it('shapes phrases: every phrase the voice sings ends on D', () => {
    const bars = play(3, 48, () => 140);
    const finals = bars.filter((b) => b.phrasePos === 7 && b.parts.biomass.length > 0);
    expect(finals.length).toBe(6);
    for (const b of finals) expect((b.parts.biomass[b.parts.biomass.length - 1]?.midis[0] ?? 0) % 12).toBe(2);
    // and the half-way bar stops on a note of its chord
    for (const b of bars.filter((x) => x.phrasePos === 3 && x.parts.biomass.length > 0)) {
      const last = b.parts.biomass[b.parts.biomass.length - 1]?.midis[0] ?? 0;
      expect(b.chord.pitchClasses).toContain(last % 12);
    }
  });

  it('lets the voice breathe at every half-way pause', () => {
    const bars = play(3, 48, () => 140);
    const pauses = bars.filter((b) => b.phrasePos === 3 && b.parts.biomass.length > 0);
    expect(pauses.length).toBe(6);
    for (const b of pauses) {
      const sung = b.parts.biomass.reduce((a, n) => Math.max(a, n.start + n.length), 0);
      expect(sung).toBeLessThanOrEqual(12); // at least a crotchet's rest before bar 5
    }
  });

  it('repeats exactly for the same seed', () => {
    expect(play(42, 16, () => 140)).toEqual(play(42, 16, () => 140));
  });

  it('voice-leads the pad: no voice jumps more than a fourth between chords', () => {
    for (let i = 1; i < sweep.length; i++) {
      const prev = sweep[i - 1]?.pad ?? [];
      const next = sweep[i]?.pad ?? [];
      expect(Math.max(...next.map((m, v) => Math.abs(m - (prev[v] ?? m))))).toBeLessThanOrEqual(5);
    }
  });
});

describe('barEvents', () => {
  it('turns a bar into audio events on the global grid, skipping held notes', () => {
    const bar = play(5, 3, () => 120)[2];
    if (!bar) throw new Error('no bar');
    const events = barEvents(bar);
    expect(events.every((e) => e.step >= 32 && e.step < 48)).toBe(true);
    expect(events.some((e) => e.voice === 'wind' || e.voice === 'gas')).toBe(false);
    expect(events.filter((e) => e.voice === 'nuclear').map((e) => e.step)).toEqual([32, 36, 40, 44]);
  });
});
