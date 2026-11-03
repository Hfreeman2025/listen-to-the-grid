import { describe, expect, it } from 'vitest';
import { keySignature, ledgerLines, spellPitch, staffStep, stemUp } from '../src/notation/pitch';

describe('spellPitch', () => {
  it('spells each mode with its own letters', () => {
    // G sharp in D Lydian, not A flat.
    expect(spellPitch(68, 'lydian')).toEqual({ letter: 4, accidental: 1, octave: 4 });
    // E flat in D Phrygian, not D sharp.
    expect(spellPitch(63, 'phrygian')).toEqual({ letter: 2, accidental: -1, octave: 4 });
    // C natural in D Dorian, C sharp in D major.
    expect(spellPitch(60, 'dorian')).toEqual({ letter: 0, accidental: 0, octave: 4 });
    expect(spellPitch(61, 'ionian')).toEqual({ letter: 0, accidental: 1, octave: 4 });
  });

  it('keeps B sharp and C flat style octaves right at the octave line', () => {
    // B flat 3 in D minor sits in octave 3.
    expect(spellPitch(58, 'aeolian')).toEqual({ letter: 6, accidental: -1, octave: 3 });
  });
});

describe('staffStep', () => {
  it('places notes on the treble staff from the middle line', () => {
    expect(staffStep(71, 'ionian', 'treble')).toBe(0); // B4, middle line
    expect(staffStep(62, 'ionian', 'treble')).toBe(-5); // D4, below the bottom line
    expect(staffStep(77, 'phrygian', 'treble')).toBe(4); // F5, top line
    expect(staffStep(76, 'ionian', 'treble')).toBe(3); // E5, top space
    expect(staffStep(66, 'ionian', 'treble')).toBe(-3); // F#4, bottom space
  });

  it('places notes on the bass staff from D3', () => {
    expect(staffStep(50, 'dorian', 'bass')).toBe(0); // D3
    expect(staffStep(43, 'dorian', 'bass')).toBe(-4); // G2, bottom line
    expect(staffStep(57, 'dorian', 'bass')).toBe(4); // A3, top line
  });

  it('writes an octave clef an octave from where it sounds', () => {
    // the gas drone sounds D2 but sits on the middle line of a bass clef with an 8 below.
    expect(staffStep(38, 'dorian', 'bass8vb')).toBe(0);
    // bells sound D6 but sit on the treble staff as D5.
    expect(staffStep(86, 'dorian', 'treble8va')).toBe(staffStep(74, 'dorian', 'treble'));
  });
});

describe('keySignature', () => {
  it('turns each mode on D into the signature of its relative key', () => {
    expect(keySignature('lydian', 'treble')).toEqual({ kind: 'sharp', steps: [4, 1, 5] });
    expect(keySignature('ionian', 'bass')).toEqual({ kind: 'sharp', steps: [2, -1] });
    expect(keySignature('dorian', 'treble')).toEqual({ kind: 'none', steps: [] });
    expect(keySignature('aeolian', 'treble')).toEqual({ kind: 'flat', steps: [0] });
    expect(keySignature('phrygian', 'bass')).toEqual({ kind: 'flat', steps: [-2, 1] });
    expect(keySignature('lydian', 'percussion')).toEqual({ kind: 'none', steps: [] });
  });

  it('needs no accidentals for any note of the mode', () => {
    // Every pitch the conductor writes is in the mode, so spelled accidentals
    // always match the key signature.
    for (const m of [62, 64, 66, 68, 69, 71, 73]) {
      const s = spellPitch(m, 'lydian');
      expect(s.accidental === 0 || [3, 0, 4].includes(s.letter)).toBe(true); // F, C, G may be sharp
    }
  });
});

describe('ledgerLines and stems', () => {
  it('adds ledger lines beyond the staff', () => {
    expect(ledgerLines(4)).toEqual([]);
    expect(ledgerLines(6)).toEqual([6]);
    expect(ledgerLines(7)).toEqual([6]);
    expect(ledgerLines(-8)).toEqual([-6, -8]);
  });

  it('points stems away from the middle line', () => {
    expect(stemUp([-3])).toBe(true);
    expect(stemUp([0])).toBe(false);
    expect(stemUp([2])).toBe(false);
    expect(stemUp([-5, 1])).toBe(true);
    expect(stemUp([-1, 3])).toBe(false);
  });
});
