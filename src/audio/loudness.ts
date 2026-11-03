/**
 * Integrated loudness, as ITU-R BS.1770-4 defines it (the measure behind EBU
 * R 128 and streaming services' loudness normalisation):
 *
 *   1. K-weighting: a high shelf (+4 dB above ~1.7 kHz, for the head) and a
 *      high pass at ~38 Hz (the "RLB" curve), applied to each channel.
 *   2. Mean square of each channel over 400 ms blocks, overlapping by 75%.
 *   3. Block loudness l = -0.691 + 10 log10(sum of channel mean squares).
 *   4. Gating: drop blocks below -70 LUFS (silence), then drop blocks more than
 *      10 LU below the loudness of those that remain.
 *   5. Integrated loudness: -0.691 + 10 log10 of the mean of the gated blocks.
 *
 * https://www.itu.int/rec/R-REC-BS.1770 . The filters are derived for any
 * sample rate from the analogue prototype (as libebur128 and pyloudnorm do),
 * which reproduces the standard's 48 kHz coefficients.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The K-weighting pair for a sample rate: the head's high shelf, then the RLB high pass. */
export function kWeighting(fs: number): [Biquad, Biquad] {
  return [highShelf(fs), highPass(fs)];
}

/** Stage 1: a high shelf of about +4 dB, for the acoustic effect of the head. */
function highShelf(fs: number): Biquad {
  const f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / fs);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** Stage 2: the RLB high pass, at about 38 Hz. */
function highPass(fs: number): Biquad {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + k / q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}

/** Both stages over one channel, returning the squared K-weighted signal's running sum (for block means). */
function weightedEnergy(x: Float32Array, fs: number): Float64Array {
  const [s, h] = kWeighting(fs);
  const sum = new Float64Array(x.length + 1);
  let s1 = 0;
  let s2 = 0;
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < x.length; i++) {
    // Transposed direct form II, in double precision.
    const v = x[i] ?? 0;
    const y = s.b0 * v + s1;
    s1 = s.b1 * v - s.a1 * y + s2;
    s2 = s.b2 * v - s.a2 * y;
    const z = h.b0 * y + h1;
    h1 = h.b1 * y - h.a1 * z + h2;
    h2 = h.b2 * y - h.a2 * z;
    sum[i + 1] = (sum[i] ?? 0) + z * z;
  }
  return sum;
}

export interface Loudness {
  /** integrated loudness in LUFS; -Infinity when everything is gated out (silence) */
  integrated: number;
  /** 400 ms blocks measured, and how many passed both gates */
  blocks: number;
  gated: number;
}

/**
 * BS.1770-4 integrated loudness of a recording, from its channels (all
 * weighted 1, as for left and right). `from` and `to` (seconds) limit the
 * span measured.
 */
export function integratedLoudness(channels: readonly Float32Array[], fs: number, from = 0, to = Infinity): Loudness {
  const first = Math.max(0, Math.round(from * fs));
  const last = Math.min(channels[0]?.length ?? 0, Math.round(to * fs));
  const span = channels.map((c) => c.subarray(first, last));
  const energies = span.map((c) => weightedEnergy(c, fs));
  const size = Math.round(0.4 * fs);
  const step = Math.round(0.1 * fs);
  const length = span[0]?.length ?? 0;
  const z: number[] = [];
  for (let start = 0; start + size <= length; start += step) {
    let sum = 0;
    for (const e of energies) sum += ((e[start + size] ?? 0) - (e[start] ?? 0)) / size;
    z.push(sum);
  }
  const lufs = (power: number): number => -0.691 + 10 * Math.log10(power);
  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const absolute = z.filter((p) => lufs(p) > -70);
  if (absolute.length === 0) return { integrated: -Infinity, blocks: z.length, gated: 0 };
  const relative = lufs(mean(absolute)) - 10;
  const gated = absolute.filter((p) => lufs(p) > relative);
  return { integrated: lufs(mean(gated)), blocks: z.length, gated: gated.length };
}

/** The largest absolute sample, in dBFS. */
export function samplePeakDb(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i] ?? 0));
  return 20 * Math.log10(peak);
}
