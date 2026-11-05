import { describe, expect, it } from 'vitest';
import {
  chordPitchClasses,
  degreeToMidi,
  inScale,
  midiToDegree,
  midiToHz,
  pitchClasses,
  quantise,
  stackChord,
  voiceLead,
} from '../src/music/theory';

describe('midiToHz', () => {
  it('tunes A4 to 440 Hz and D2, the drone, to 73.42 Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBe(880);
    expect(midiToHz(38)).toBeCloseTo(73.416, 3);
  });
});

describe('scales', () => {
  it('spells D Lydian with a G sharp and D Phrygian with E flat and B flat', () => {
    expect(pitchClasses('lydian')).toEqual([2, 4, 6, 8, 9, 11, 1]);
    expect(pitchClasses('phrygian')).toEqual([2, 3, 5, 7, 9, 10, 0]);
    expect(pitchClasses('dorian')).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  it('knows which notes belong', () => {
    expect(inScale(68, 'lydian')).toBe(true); // G#4
    expect(inScale(67, 'lydian')).toBe(false); // G4
    expect(inScale(63, 'phrygian')).toBe(true); // Eb4
  });
});

describe('quantise', () => {
  it('leaves scale notes alone', () => {
    expect(quantise(62, 'ionian')).toBe(62);
    expect(quantise(66, 'ionian')).toBe(66);
  });

  it('snaps to the nearest scale note, resolving exact halves downwards', () => {
    // D major: C# (61) is in, C (60) is not; 60 sits between B (59) and C# (61).
    expect(quantise(60, 'ionian')).toBe(59);
    expect(quantise(60.6, 'ionian')).toBe(61);
    // D Dorian has C natural, so 60 stays and 61 (C#) snaps down to C.
    expect(quantise(61, 'dorian')).toBe(60);
    // D Lydian: G (67) lies between F# (66) and G# (68).
    expect(quantise(67, 'lydian')).toBe(66);
    expect(quantise(67.2, 'lydian')).toBe(68);
  });

  it('only ever returns notes of the scale', () => {
    for (let m = 30; m <= 100; m += 0.25) {
      expect(inScale(quantise(m, 'aeolian'), 'aeolian')).toBe(true);
    }
  });
});

describe('degrees', () => {
  it('counts degrees from D in the given octave, wrapping both ways', () => {
    expect(degreeToMidi(0, 'ionian', 4)).toBe(62); // D4
    expect(degreeToMidi(2, 'ionian', 4)).toBe(66); // F#4
    expect(degreeToMidi(2, 'aeolian', 4)).toBe(65); // F4
    expect(degreeToMidi(7, 'ionian', 4)).toBe(74); // D5
    expect(degreeToMidi(-1, 'ionian', 4)).toBe(61); // C#4
    expect(degreeToMidi(-1, 'dorian', 4)).toBe(60); // C4
  });

  it('inverts degreeToMidi', () => {
    for (let d = -7; d <= 14; d++) {
      expect(midiToDegree(degreeToMidi(d, 'mixolydian', 4), 'mixolydian', 4)).toBe(d);
    }
  });
});

describe('chords', () => {
  it('builds the characteristic chord of each mode', () => {
    // Lydian II is major: E G# B
    expect(chordPitchClasses('lydian', 1, 'triad')).toEqual([4, 8, 11]);
    // Dorian IV is major: G B D
    expect(chordPitchClasses('dorian', 3, 'triad')).toEqual([7, 11, 2]);
    // Phrygian bII is major: Eb G Bb
    expect(chordPitchClasses('phrygian', 1, 'triad')).toEqual([3, 7, 10]);
    // Aeolian i7: D F A C
    expect(chordPitchClasses('aeolian', 0, 'seventh')).toEqual([2, 5, 9, 0]);
    // Ionian I add9: D F# A E
    expect(chordPitchClasses('ionian', 0, 'add9')).toEqual([2, 6, 9, 4]);
  });

  it('stacks a chord upwards from a floor', () => {
    expect(stackChord([2, 5, 9], 62)).toEqual([62, 65, 69]);
    expect(stackChord([7, 11, 2], 62)).toEqual([67, 71, 74]);
  });
});

describe('voiceLead', () => {
  it('moves each voice the shortest way: Dm7 to G7 in D Dorian', () => {
    // D F A C -> G B D F: D and F hold, A falls to G, C falls to B.
    const next = voiceLead([50, 53, 57, 60], [7, 11, 2, 5], 48, 74);
    expect(next).toEqual([50, 53, 55, 59]);
    expect(next.map((m) => m % 12).sort((a, b) => a - b)).toEqual([2, 5, 7, 11]);
  });

  it('doubles whichever note moves least when the chord has fewer notes than voices', () => {
    // D F# A D -> G major: both Ds hold, F# rises to G, A rises to B.
    const next = voiceLead([50, 54, 57, 62], [7, 11, 2], 48, 74);
    expect(next).toEqual([50, 55, 59, 62]);
  });

  it('avoids doubling the third when another doubling moves as little', () => {
    // E A D E -> D major: the low E can fall to D or rise to F#, two semitones
    // either way. Rising would double the third, so it falls.
    expect(voiceLead([52, 57, 62, 64], [2, 6, 9], 48, 74)).toEqual([50, 57, 62, 66]);
  });

  it('keeps every voice inside the range', () => {
    const next = voiceLead([72, 73, 74, 74], [2, 6, 9, 4], 48, 74);
    for (const m of next) {
      expect(m).toBeGreaterThanOrEqual(48);
      expect(m).toBeLessThanOrEqual(74);
    }
    expect(new Set(next.map((m) => m % 12))).toEqual(new Set([2, 6, 9, 4]));
  });
});
