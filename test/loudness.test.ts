import { describe, expect, it } from 'vitest';
import { integratedLoudness, kWeighting, samplePeakDb } from '../src/audio/loudness';

/** A sine in each of `channels`, `dbfs` peak, joined end to end from segments of [seconds, dBFS]. */
function tone(fs: number, segments: [number, number][], channels = 2, hz = 1000): Float32Array[] {
  const length = segments.reduce((n, [s]) => n + Math.round(s * fs), 0);
  const out = Array.from({ length: channels }, () => new Float32Array(length));
  let i = 0;
  for (const [seconds, dbfs] of segments) {
    const amp = 10 ** (dbfs / 20);
    for (let n = 0; n < Math.round(seconds * fs); n++, i++) {
      const v = amp * Math.sin((2 * Math.PI * hz * i) / fs);
      for (const c of out) c[i] = v;
    }
  }
  return out;
}

describe('K-weighting', () => {
  it('reproduces the 48 kHz coefficients printed in ITU-R BS.1770-4', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 8);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 8);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 8);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 8);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 8);
    expect([hp.b0, hp.b1, hp.b2]).toEqual([1, -2, 1]);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 8);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 8);
  });
});

describe('integratedLoudness (EBU Tech 3341 minimum requirements)', () => {
  for (const fs of [48000, 44100]) {
    it(`case 1 at ${fs} Hz: a stereo 1 kHz sine at -23 dBFS is -23.0 LUFS`, () => {
      expect(integratedLoudness(tone(fs, [[20, -23]]), fs).integrated).toBeCloseTo(-23, 1);
    });
  }

  it('case 2: at -33 dBFS it is -33.0 LUFS', () => {
    expect(integratedLoudness(tone(48000, [[20, -33]]), 48000).integrated).toBeCloseTo(-33, 1);
  });

  it('case 3: the relative gate ignores quiet passages 13 LU down', () => {
    const l = integratedLoudness(tone(48000, [[10, -36], [60, -23], [10, -36]]), 48000);
    expect(Math.abs(l.integrated + 23)).toBeLessThanOrEqual(0.1);
  });

  it('case 4: the absolute gate drops near-silence, the relative gate the rest', () => {
    const l = integratedLoudness(tone(48000, [[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]]), 48000);
    expect(Math.abs(l.integrated + 23)).toBeLessThanOrEqual(0.1);
  });

  it('a full-scale sine in one channel of two reads -3.01 LKFS, as BS.1770 states', () => {
    const [left] = tone(48000, [[10, 0]], 1, 997);
    if (!left) throw new Error('no channel');
    expect(integratedLoudness([left, new Float32Array(left.length)], 48000).integrated).toBeCloseTo(-3.01, 1);
  });

  it('moves exactly with gain: 6 dB down reads 6 LU quieter', () => {
    const loud = tone(48000, [[8, -12]]);
    const soft = loud.map((c) => c.map((v) => v * 10 ** (-6 / 20)));
    const diff = integratedLoudness(loud, 48000).integrated - integratedLoudness(soft, 48000).integrated;
    expect(diff).toBeCloseTo(6, 6);
  });

  it('calls silence -Infinity rather than a number', () => {
    expect(integratedLoudness([new Float32Array(48000), new Float32Array(48000)], 48000).integrated).toBe(-Infinity);
  });

  it('weights a low tone down and a high one up, as K-weighting should', () => {
    const at = (hz: number): number => integratedLoudness(tone(48000, [[5, -20]], 2, hz), 48000).integrated;
    expect(at(30)).toBeLessThan(at(1000) - 1);
    expect(at(8000)).toBeGreaterThan(at(1000) + 3);
  });
});

describe('samplePeakDb', () => {
  it('reads a -6 dBFS sine as -6 dB', () => {
    expect(samplePeakDb(tone(48000, [[1, -6]]))).toBeCloseTo(-6, 2);
  });
});
