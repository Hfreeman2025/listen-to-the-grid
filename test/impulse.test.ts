import { describe, expect, it } from 'vitest';
import { crushCurve, generateImpulse, softClipCurve } from '../src/audio/impulse';

const rms = (data: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (data[i] ?? 0) ** 2;
  return Math.sqrt(sum / (to - from));
};

describe('generateImpulse', () => {
  const sampleRate = 48000;
  const [left, right] = generateImpulse({ sampleRate, seconds: 4, preDelay: 0.02, seed: 3 });

  it('is the requested length in both channels', () => {
    expect(left.length).toBe(192000);
    expect(right.length).toBe(192000);
  });

  it('is silent during the pre-delay and peak-normalised to 1', () => {
    expect(rms(left, 0, 960)).toBe(0);
    let peak = 0;
    for (const v of [...left, ...right]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(1, 6);
  });

  it('decays by about 60 dB over its length', () => {
    const early = rms(left, 960, 960 + 4800);
    const late = rms(left, 192000 - 4800, 192000);
    const db = 20 * Math.log10(late / early);
    expect(db).toBeLessThan(-50);
    expect(db).toBeGreaterThan(-75);
  });

  it('has decorrelated channels for width', () => {
    let dot = 0;
    let l2 = 0;
    let r2 = 0;
    for (let i = 960; i < 48000; i++) {
      const l = left[i] ?? 0;
      const r = right[i] ?? 0;
      dot += l * r;
      l2 += l * l;
      r2 += r * r;
    }
    expect(Math.abs(dot / Math.sqrt(l2 * r2))).toBeLessThan(0.2);
  });

  it('contains only finite samples and repeats for a seed', () => {
    expect(left.every(Number.isFinite)).toBe(true);
    const [again] = generateImpulse({ sampleRate, seconds: 4, preDelay: 0.02, seed: 3 });
    expect(again[5000]).toBe(left[5000]);
  });
});

describe('waveshaper curves', () => {
  it('soft clip passes zero, stays odd and never exceeds ±1', () => {
    const c = softClipCurve(2049);
    expect(c[1024]).toBeCloseTo(0, 10);
    expect(c[0]).toBeCloseTo(-1, 10);
    expect(c[2048]).toBeCloseTo(1, 10);
    expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-6);
    expect(c[1536]).toBeCloseTo(-(c[512] ?? 0), 6);
  });

  it('crush snaps to the requested number of levels', () => {
    const c = crushCurve(3, 7);
    expect([...c].map((v) => Math.round(v * 3))).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });
});
