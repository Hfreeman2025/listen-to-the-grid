/**
 * Measurements of rendered audio, for the measurement page (measure.html):
 * levels and clipping, how the loudness moves, clicks at control changes,
 * brightness and a spectrogram. Never part of the page's own bundle.
 */

/** The rate every measurement render uses. */
export const RATE = 48000;

const db = (x: number): number => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);

export function levels(buffer: AudioBuffer, from = 1, to = buffer.duration) {
  let sum = 0;
  let peak = 0;
  let hot = 0;
  let n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = Math.floor(from * RATE); i < Math.min(d.length, to * RATE); i++) {
      const v = d[i] ?? 0;
      if (!Number.isFinite(v)) return { rmsDb: NaN, peakDb: NaN, overPoint98: NaN, nonFinite: true };
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
      if (Math.abs(v) > 0.98) hot++;
      n++;
    }
  }
  return { rmsDb: db(Math.sqrt(sum / n)), peakDb: db(peak), overPoint98: hot, nonFinite: false };
}

/**
 * Phrasing, from the loudness contour: RMS in 400 ms frames, in dB. A drone
 * sits within a dB or two; phrased music swells and breathes. Reports the
 * 10th-90th percentile spread and how much of the change happens at phrase
 * scale (2.5-20 s) rather than note to note.
 */
export function contour(buffer: AudioBuffer, from = 2) {
  const d = buffer.getChannelData(0);
  const win = Math.round(0.4 * RATE);
  const db: number[] = [];
  for (let w = Math.floor(from * RATE); w + win <= d.length; w += win) {
    let e = 0;
    for (let i = w; i < w + win; i++) e += (d[i] ?? 0) ** 2;
    db.push(10 * Math.log10(e / win + 1e-12));
  }
  const sorted = [...db].sort((a, b) => a - b);
  const pct = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  // Smooth over ~2.4 s to keep only phrase-scale motion.
  const smooth = db.map((_, i) => {
    const part = db.slice(Math.max(0, i - 3), i + 3);
    return part.reduce((a, b) => a + b, 0) / part.length;
  });
  const mean = smooth.reduce((a, b) => a + b, 0) / smooth.length;
  const sd = Math.sqrt(smooth.reduce((a, b) => a + (b - mean) ** 2, 0) / smooth.length);
  const r = (x: number): number => Math.round(x * 10) / 10;
  return { spreadP10toP90Db: r(pct(0.9) - pct(0.1)), phraseScaleSdDb: r(sd) };
}

export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db2 = 0;
  for (let i = 0; i < n; i++) {
    num += ((a[i] ?? 0) - ma) * ((b[i] ?? 0) - mb);
    da += ((a[i] ?? 0) - ma) ** 2;
    db2 += ((b[i] ?? 0) - mb) ** 2;
  }
  return Math.round((num / Math.sqrt(da * db2)) * 100) / 100;
}

/** RBJ high-pass biquad, run in JS over one channel. */
function highpass(data: Float32Array, hz: number): Float32Array {
  const w = (2 * Math.PI * hz) / RATE;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(data.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i] ?? 0;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/**
 * Clicks are broadband, so a click shows up as a sudden burst of energy above
 * 6 kHz. Score: the loudest 5 ms of that band in the 40 ms after a change,
 * over the median 5 ms of its neighbourhood (200 ms before the change and
 * 100-400 ms after it). A smooth transition scores about 1; a click scores
 * far higher. Reported as the worst change in the render.
 */
export function clickScore(buffer: AudioBuffer, changes: number[]): number {
  const hf = highpass(buffer.getChannelData(0), 6000);
  const win = Math.round(0.005 * RATE);
  const energy: number[] = [];
  for (let w = 0; w + win <= hf.length; w += win) {
    let e = 0;
    for (let i = w; i < w + win; i++) e += (hf[i] ?? 0) ** 2;
    energy.push(e / win);
  }
  let worst = 0;
  for (const c of changes) {
    const i = Math.round(c / 0.005);
    const around = [...energy.slice(i - 40, i - 4), ...energy.slice(i + 20, i + 80)].sort((a, b) => a - b);
    const median = around[Math.floor(around.length / 2)] ?? 1e-12;
    const peak = Math.max(...energy.slice(i, i + 8));
    worst = Math.max(worst, peak / Math.max(median, 1e-12));
  }
  return Math.round(worst * 10) / 10;
}

/** Share of the signal's energy above `hz`, in per cent. */
export function energyAbove(buffer: AudioBuffer, hz: number, from = 2): number {
  const d = buffer.getChannelData(0).subarray(Math.floor(from * RATE));
  const hf = highpass(d, hz);
  let total = 0;
  let high = 0;
  for (let i = 0; i < d.length; i++) {
    total += (d[i] ?? 0) ** 2;
    high += (hf[i] ?? 0) ** 2;
  }
  return Math.round((high / total) * 1000) / 10;
}

/** Power-weighted mean frequency, from 4096-point FFTs every quarter second. */
export function centroid(buffer: AudioBuffer, from = 2): number {
  const d = buffer.getChannelData(0);
  const N = 4096;
  let num = 0;
  let den = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let start = Math.floor(from * RATE); start + N < d.length; start += RATE / 4) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = (d[start + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
      num += p * ((k * RATE) / N);
      den += p;
    }
  }
  return Math.round(num / den);
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

/** A log-frequency spectrogram (30 Hz to 16 kHz) as a PNG data URL, ink on paper. */
export function spectrogram(buffer: AudioBuffer, width = 1400, height = 420): string {
  const d = buffer.getChannelData(0);
  const N = 4096;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(width, height);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const lo = Math.log(30);
  const hi = Math.log(16000);
  const dbs = new Float32Array(width * height);
  let top = -Infinity;
  for (let x = 0; x < width; x++) {
    const start = Math.floor((x / width) * (d.length - N));
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = (d[start + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < height; y++) {
      const f = Math.exp(hi - (y / height) * (hi - lo));
      const k = Math.min(N / 2 - 1, Math.round((f * N) / RATE));
      const v = 20 * Math.log10(Math.sqrt((re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2) + 1e-9);
      dbs[y * width + x] = v;
      top = Math.max(top, v);
    }
  }
  // 80 dB of range below the loudest bin.
  for (let i = 0; i < dbs.length; i++) {
    const level = Math.min(1, Math.max(0, ((dbs[i] ?? -200) - (top - 80)) / 80)) ** 1.6;
    img.data[i * 4] = 243 - level * 214;
    img.data[i * 4 + 1] = 238 - level * 212;
    img.data[i * 4 + 2] = 228 - level * 206;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
