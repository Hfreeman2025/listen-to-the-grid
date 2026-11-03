import { createRng } from '../music/rng';

export interface ImpulseOptions {
  sampleRate: number;
  /** seconds until the tail is 60 dB down */
  seconds: number;
  /** silence before the first reflection, in seconds */
  preDelay: number;
  seed: number;
}

/**
 * A synthetic hall: a few early reflections, then a stereo tail of decaying
 * noise that loses its treble as it fades, the way air and soft surfaces
 * absorb high frequencies first. Left and right use independent noise so the
 * reverb feels wide. Peak-normalised to 1.
 */
export function generateImpulse({ sampleRate, seconds, preDelay, seed }: ImpulseOptions): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  const pre = Math.round(sampleRate * preDelay);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  const decay = Math.log(1000) / seconds; // -60 dB at `seconds`

  channels.forEach((data, ch) => {
    const rng = createRng(seed * 2 + ch);
    let lp = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp(-decay * t);
      // One-pole low-pass that closes over the tail: bright at first, dark later.
      const coeff = 0.08 + 0.85 * Math.exp(-t * 2.2);
      lp += coeff * (rng() * 2 - 1 - lp);
      data[i] = lp * env;
    }
    // Early reflections: sparse taps in the first 80 ms.
    for (let k = 0; k < 7; k++) {
      const at = pre + Math.round(sampleRate * (0.007 + rng() * 0.075));
      if (at < length) data[at] = (data[at] ?? 0) + (rng() < 0.5 ? -1 : 1) * (0.5 - k * 0.05);
    }
  });

  let peak = 0;
  for (const data of channels) for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (const data of channels) for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) / peak;
  return channels;
}

/** tanh soft-clip curve: transparent at low level, rounding off toward ±1. */
export function softClipCurve(points = 2048, drive = 1.6): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const norm = Math.tanh(drive);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

/** A staircase curve for the coal voice: crushes a waveform to a few levels. */
export function crushCurve(levels: number, points = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}
