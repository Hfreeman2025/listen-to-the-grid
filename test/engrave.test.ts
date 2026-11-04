import { describe, expect, it } from 'vitest';
import type { Mix } from '../src/data/schema';
import { Conductor, type Bar } from '../src/music/conductor';
import { arrange } from '../src/music/mapping';
import { engraveBar, engraveFrame, type Engraved, type Frame, type Mark, type Tail } from '../src/notation/engrave';

const mix = (wind: number): Mix => ({ solar: 0, wind, hydro: 0.03, biomass: 0.1, imports: 0.1, nuclear: 0.15, other: 0.02, coal: 0, gas: 0.6 - wind });

/** Eight bars of one phrase, the wind's share given bar by bar. */
function phrase(winds: number[]): Bar[] {
  const c = new Conductor(5);
  return winds.map((w, i) => c.bar(i, arrange(mix(w), 140, c.currentMode ?? undefined)));
}

function engraveSystem(bars: Bar[], frame: Frame, restartAt = -1): Engraved[] {
  let tails: (Tail | null)[] = [];
  return bars.map((bar, slot) => {
    const e = engraveBar(bar, { frame, slot, previous: bars[slot - 1] ?? null, tails, firstInSystem: slot === 0, whole: true, restart: slot === restartAt });
    tails = e.tails;
    return e;
  });
}

const hairpins = (e: Engraved) => e.marks.filter((m): m is Extract<Mark, { k: 'hairpin' }> => m.k === 'hairpin');
const dynamicsAt = (e: Engraved, y: number) => e.marks.filter((m) => m.k === 'glyph' && m.glyph === 'dynamic' && Math.abs(m.y - y) < 1e-6);

describe('hairpins', () => {
  const frame = engraveFrame({ sp: 8, top: 0, width: 1600, bars: 4, mode: 'mixolydian', short: false, time: true }).frame;

  it('carry one wedge across a bar line, the two lengths meeting exactly', () => {
    // Bars 0 and 1 of a phrase swell together; the wind holds its dynamic.
    const [a, b] = engraveSystem(phrase([0.3, 0.3]), frame);
    const [first] = hairpins(a as Engraved);
    const [second] = hairpins(b as Engraved);
    expect(first?.open1).toBe(0);
    expect(first?.x2).toBeCloseTo(frame.firstBarX + frame.barWidth);
    expect(second?.x1).toBeCloseTo(frame.firstBarX + frame.barWidth);
    expect(second?.open1).toBeCloseTo(first?.open2 ?? -1);
    expect(second?.open2).toBeCloseTo(1.1 * 8);
  });

  it('stop at a newly printed dynamic, which starts a wedge of its own after it', () => {
    // The wind's share jumps from mf to ff at bar 1, mid-swell.
    const [a, b] = engraveSystem(phrase([0.2, 0.5]), frame);
    const [first] = hairpins(a as Engraved);
    const [second] = hairpins(b as Engraved);
    const barLine = frame.firstBarX + frame.barWidth;
    expect(first?.x2).toBeLessThanOrEqual(barLine + 1e-6);
    const ff = dynamicsAt(b as Engraved, second?.y ?? NaN)[0];
    expect(ff && ff.k === 'glyph' ? ff.text : '').toBe('ff');
    expect(second?.open1).toBe(0);
    expect(second?.x1 ?? 0).toBeGreaterThan(ff?.k === 'glyph' ? ff.x : Infinity);
  });

  it('close within a live bar that does not follow the bar before it', () => {
    const bars = phrase([0.3, 0.3]);
    const [, live] = engraveSystem(bars, frame, 1);
    const [wedge] = hairpins(live as Engraved);
    // Bar 1 is the second half of a swell, but restarted it is a whole wedge of its own.
    expect(wedge?.open1).toBe(0);
    expect(wedge?.open2).toBeCloseTo(1.1 * 8);
    expect(wedge?.x2 ?? Infinity).toBeLessThan(frame.firstBarX + 2 * frame.barWidth);
    // and nothing is tied into it
    const tiesBack = (live as Engraved).marks.filter((m) => m.k === 'tie' && m.x1 < frame.firstBarX + frame.barWidth);
    expect(tiesBack).toEqual([]);
  });

  it('tie held notes across an ordinary bar line', () => {
    const [, b] = engraveSystem(phrase([0.3, 0.3]), frame);
    const tiesBack = (b as Engraved).marks.filter((m) => m.k === 'tie' && m.x1 < frame.firstBarX + frame.barWidth);
    expect(tiesBack.length).toBeGreaterThan(0);
  });
});

describe('words over the staff', () => {
  it('lifts a part’s entry word (l.v.) clear of the stems and beams beneath it', () => {
    const frame = engraveFrame({ sp: 8, top: 0, width: 1600, bars: 4, mode: 'lydian', short: false, time: true }).frame;
    const c = new Conductor(21);
    const sunny: Mix = { solar: 0.35, wind: 0.3, hydro: 0.05, biomass: 0.1, imports: 0.1, nuclear: 0.1, other: 0, coal: 0, gas: 0 };
    let checked = 0;
    for (let i = 0; i < 48; i++) {
      const bar = c.bar(i, arrange(sunny, 40, c.currentMode ?? undefined));
      const e = engraveBar(bar, { frame, slot: 0, previous: null, tails: [], firstInSystem: true, whole: true });
      for (const word of e.marks.filter((m): m is Extract<Mark, { k: 'text' }> => m.k === 'text' && m.text === 'l.v.')) {
        checked++;
        const right = word.x + 4 * 0.55 * 1.5 * 8;
        const under = e.marks.filter((m): m is Extract<Mark, { k: 'line' }> => m.k === 'line' && Math.max(m.x1, m.x2) > word.x && Math.min(m.x1, m.x2) < right && Math.min(m.y1, m.y2) < word.y + 8);
        for (const line of under) expect(Math.min(line.y1, line.y2) - line.w / 2).toBeGreaterThanOrEqual(word.y + 0.4 * 8 - 1e-6);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
