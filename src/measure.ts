/**
 * Offline measurements of the instrument (dev only: served at /measure.html,
 * driven by scripts/measure-audio.mjs, never part of the build). Renders the
 * real engine and conductor into an OfflineAudioContext and reports levels,
 * clipping, clicks and brightness, so the sound can be checked by numbers as
 * well as by ear.
 */
import { loadSample } from './data/api';
import { FUELS, type Fuel, type Mix } from './data/schema';
import { sampleAt } from './data/series';
import { renderOffline } from './audio/render';
import { SWELL, type Bar } from './music/conductor';
import { ossiaOf } from './music/ossia';
import { integratedLoudness } from './audio/loudness';
import { measureMoment } from './audio/match';

const RATE = 48000;

const zero = (): Mix => ({ solar: 0, wind: 0, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: 0 });

interface Plan {
  seconds: number;
  at: (t: number) => { mix: Mix; grams: number };
  every: number;
  tau: number;
  notes?: boolean;
  seed?: number;
}

async function render(plan: Plan): Promise<{ buffer: AudioBuffer; ms: number; bars: Bar[] }> {
  return renderOffline({ ...plan, seed: plan.seed ?? 3, sampleRate: RATE });
}

/** Phrasing in the notes themselves: does the sung line breathe and come home? */
function melodyStats(bars: readonly Bar[]) {
  const sung = bars.map((b) => b.parts.biomass);
  const singing = sung.filter((n) => n.length > 0);
  const restSteps = singing.map((notes) => 16 - notes.reduce((a, n) => a + n.length, 0));
  const finals = bars.filter((b) => b.phrasePos === 7 && b.parts.biomass.length > 0).map((b) => b.parts.biomass[b.parts.biomass.length - 1]?.midis[0] ?? 0);
  const all = singing.flat().map((n) => n.midis[0] ?? 0);
  let steps = 0;
  for (let i = 1; i < all.length; i++) if (Math.abs((all[i] ?? 0) - (all[i - 1] ?? 0)) <= 2) steps++;
  const r = (x: number): number => Math.round(x * 100) / 100;
  return {
    barsWithMelody: `${singing.length} of ${bars.length}`,
    barsThatBreathe: r(restSteps.filter((x) => x >= 4).length / Math.max(1, singing.length)),
    phrasesEndingOnD: `${finals.filter((m) => m % 12 === 2).length} of ${finals.length}`,
    stepwiseMotion: r(steps / Math.max(1, all.length - 1)),
    rangeSemitones: all.length ? Math.max(...all) - Math.min(...all) : 0,
  };
}

const db = (x: number): number => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);

function levels(buffer: AudioBuffer, from = 1, to = buffer.duration) {
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
function contour(buffer: AudioBuffer, from = 2) {
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

function correlation(a: readonly number[], b: readonly number[]): number {
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
function clickScore(buffer: AudioBuffer, changes: number[]): number {
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
function energyAbove(buffer: AudioBuffer, hz: number, from = 2): number {
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
function centroid(buffer: AudioBuffer, from = 2): number {
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
function spectrogram(buffer: AudioBuffer, width = 1400, height = 420): string {
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

function wav(buffer: AudioBuffer): string {
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * 4));
  const text = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  bytes.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 2, true);
  bytes.setUint32(24, RATE, true);
  bytes.setUint32(28, RATE * 4, true);
  bytes.setUint16(32, 4, true);
  bytes.setUint16(34, 16, true);
  text(36, 'data');
  bytes.setUint32(40, frames * 4, true);
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  for (let i = 0; i < frames; i++) {
    bytes.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i] ?? 0)) * 32767, true);
    bytes.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i] ?? 0)) * 32767, true);
  }
  let binary = '';
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function measure(): Promise<unknown> {
  const sample = loadSample();
  const series = sample.series;
  const first = series[0];
  if (!first) throw new Error('empty sample');

  // 1. Each voice alone at a 30% share: how loud is it?
  const balance: Partial<Record<Fuel, ReturnType<typeof levels>>> = {};
  for (const fuel of FUELS) {
    const mix = zero();
    mix[fuel] = 0.3;
    mix.other = fuel === 'other' ? 0.3 : 0;
    const { buffer } = await render({ seconds: 14, at: () => ({ mix, grams: 150 }), every: 100, tau: 0.01 });
    balance[fuel] = levels(buffer, 2);
  }

  // 2. The sample day in 60 seconds, as the page plays it.
  const dayStart = first.start;
  const dayLength = (series[series.length - 1]?.end ?? dayStart) - dayStart;
  const day = await render({
    seconds: 62,
    every: 0.1,
    tau: 0.35,
    at: (t) => {
      const snap = sampleAt(series, dayStart + (Math.min(60, t) / 60) * dayLength);
      return snap ? { mix: snap.mix, grams: snap.intensity } : { mix: zero(), grams: 150 };
    },
  });
  const perSecond: number[] = [];
  for (let s = 1; s < 61; s += 5) perSecond.push(levels(day.buffer, s, s + 5).rmsDb);

  // 2a. The same day as the ossia plays it: fully renewable, at 0 g.
  const ossiaDay = await render({
    seconds: 62,
    every: 0.1,
    tau: 0.35,
    at: (t) => {
      const snap = sampleAt(series, dayStart + (Math.min(60, t) / 60) * dayLength);
      return ossiaOf(snap ? { mix: snap.mix, grams: snap.intensity } : { mix: zero(), grams: 150 });
    },
  });
  const ossiaPerSecond: number[] = [];
  for (let s = 1; s < 61; s += 5) ossiaPerSecond.push(levels(ossiaDay.buffer, s, s + 5).rmsDb);
  // The ossia's loudest likely moments: a bright windy noon (bells and pad at
  // large shares), and the all-wind fallback.
  const noon = await render({ seconds: 20, every: 100, tau: 0.01, at: () => ossiaOf({ mix: { ...zero(), solar: 0.3, wind: 0.25, hydro: 0.02, gas: 0.43 }, grams: 200 }) });
  const allWind = await render({ seconds: 20, every: 100, tau: 0.01, at: () => ossiaOf({ mix: { ...zero(), gas: 0.7, nuclear: 0.3 }, grams: 300 }) });

  // 2b. The phrase itself: a steady mix for two phrases, loudness bar by bar.
  const steadyMix = series[24]?.mix ?? zero();
  const steady = await render({ seconds: 40, every: 100, tau: 0.01, at: () => ({ mix: steadyMix, grams: 120 }), seed: 4 });
  const perBar: number[] = [];
  for (let b = 0; b < 16; b++) perBar.push(levels(steady.buffer, b * 2.5, (b + 1) * 2.5).rmsDb);

  // 3. Clicks: swing between a windy, clean grid and a gassy, dirty one every
  //    2 s, held voices only, with the page's replay and live ramps and, as a
  //    control, with no ramp at all.
  const swing = (t: number): { mix: Mix; grams: number } => {
    const mix = zero();
    const a = Math.floor(t / 2) % 2 === 0;
    mix.wind = a ? 0.6 : 0.1;
    mix.gas = a ? 0.2 : 0.8;
    mix.hydro = a ? 0.2 : 0.1;
    return { mix, grams: a ? 40 : 300 };
  };
  const changes = Array.from({ length: 9 }, (_, i) => 2 * (i + 1));
  const replayRamps = await render({ seconds: 20, every: 2, tau: 0.35, at: swing, notes: false });
  const liveRamps = await render({ seconds: 20, every: 2, tau: 2.5, at: swing, notes: false });
  const abrupt = await render({ seconds: 20, every: 2, tau: 0, at: swing, notes: false });

  // 4. Brightness: the same evening mix, clean versus dirty.
  const evening = series[36]?.mix ?? zero();
  const clean = await render({ seconds: 16, every: 100, tau: 0.01, at: () => ({ mix: evening, grams: 40 }), seed: 5 });
  const dirty = await render({ seconds: 16, every: 100, tau: 0.01, at: () => ({ mix: evening, grams: 260 }), seed: 5 });

  // 5. Worst case for level: every voice at once, at full tilt.
  const all = zero();
  for (const f of FUELS) all[f] = 1 / FUELS.length;
  all.coal = 0.3;
  const loud = await render({ seconds: 20, every: 100, tau: 0.01, at: () => ({ mix: all, grams: 300 }) });

  return {
    sampleRate: RATE,
    balanceAt30Percent: balance,
    sampleDayIn60s: {
      date: sample.date,
      ...levels(day.buffer),
      phrasing: contour(day.buffer),
      melody: melodyStats(day.bars),
      rmsEvery5s: perSecond,
      renderMs: Math.round(day.ms),
      realtimeFactor: Math.round((62_000 / day.ms) * 10) / 10,
    },
    ossia: {
      note: 'the same sample day re-scored as the fully renewable ossia (0 g, D Lydian); then its loudest likely moments',
      sampleDayIn60s: { ...levels(ossiaDay.buffer), rmsEvery5s: ossiaPerSecond, phrasing: contour(ossiaDay.buffer) },
      sunnyWindyNoon: levels(noon.buffer, 2),
      allWindFallback: levels(allWind.buffer, 2),
    },
    phraseProfile: {
      note: 'loudness of each bar, steady mix, two eight-bar phrases; correlation with the intended swell',
      perBarDb: perBar,
      rangeDb: Math.round((Math.max(...perBar.slice(1)) - Math.min(...perBar.slice(1))) * 10) / 10,
      followsSwell: correlation(perBar.slice(1), perBar.slice(1).map((_, i) => 20 * Math.log10(((SWELL[(i + 1) % 8] ?? 1) + (SWELL[((i + 1) % 8) + 1] ?? 1)) / 2))),
    },
    clicks: {
      note: 'loudest 5 ms above 6 kHz in the 40 ms after a change, over the median 5 ms around it (1 = smooth)',
      replayRamps: clickScore(replayRamps.buffer, changes),
      liveRamps: clickScore(liveRamps.buffer, changes),
      noRampControl: clickScore(abrupt.buffer, changes),
    },
    brightness: {
      note: 'the same evening mix played as if clean and as if dirty',
      percentEnergyAbove2kHz: { clean40g: energyAbove(clean.buffer, 2000), dirty260g: energyAbove(dirty.buffer, 2000) },
      spectralCentroidHz: { clean40g: centroid(clean.buffer), dirty260g: centroid(dirty.buffer) },
    },
    everythingAtOnce: levels(loud.buffer),
    wav: { day: wav(day.buffer), ossia: wav(ossiaDay.buffer) },
    spectrogram: spectrogram(day.buffer),
  };
}

/**
 * The loudness match, checked. At every other half-hour of the sample day the
 * page's own measurement (measureMoment: 16 bars of each version at 48 kHz,
 * ITU-R BS.1770) sets the ossia's trim; then an independent render of the same
 * moment (another seed, so other notes) checks the trimmed ossia against the
 * real grid. The residual is how fair the A/B is.
 */
async function loudnessStudy(): Promise<unknown> {
  const series = loadSample().series;
  const rows: { at: string; realLufs: number; ossiaLufs: number; trimDb: number; residualLu: number; ms: number }[] = [];
  for (let i = 1; i < series.length; i += 2) {
    const p = series[i];
    if (!p) continue;
    const g = { mix: p.mix, grams: p.intensity };
    const set = await measureMoment(g, 11);
    const check = await measureMoment(g, 12);
    rows.push({
      at: new Date(p.start).toISOString().slice(11, 16),
      realLufs: +set.real.toFixed(2),
      ossiaLufs: +set.ossia.toFixed(2),
      trimDb: set.trimDb,
      residualLu: +Math.abs(check.ossia + set.trimDb - check.real).toFixed(2),
      ms: Math.round(set.ms),
    });
  }
  const sorted = (xs: number[]): number[] => [...xs].sort((x, y) => x - y);
  const stats = (xs: number[]) => {
    const s2 = sorted(xs);
    return { min: s2[0], median: s2[Math.floor(s2.length / 2)], max: s2[s2.length - 1] };
  };
  return {
    note: 'trim set by the page’s own measurement (16 bars each way, 48 kHz, BS.1770), checked against an independent render of the same moment',
    gapLu: stats(rows.map((r) => -r.trimDb)),
    residualLu: stats(rows.map((r) => r.residualLu)),
    measureMs: stats(rows.map((r) => r.ms)),
    rows,
  };
}

/** Wall-clock cost, in this browser, of measuring one moment both ways: a 16-bar pair at 48 kHz. */
async function timing(): Promise<unknown> {
  const p = loadSample().series[30];
  if (!p) throw new Error('empty sample');
  const g = { mix: p.mix, grams: p.intensity };
  const plan = { seconds: 40, every: 100, tau: 0.01, seed: 11, sampleRate: 48000 };
  const t0 = performance.now();
  const [real, ossia] = await Promise.all([renderOffline({ ...plan, at: () => g }), renderOffline({ ...plan, at: () => ossiaOf(g) })]);
  const ms = performance.now() - t0;
  const lufs = (b: AudioBuffer): number => integratedLoudness([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 0.5).integrated;
  return { pairMs: Math.round(ms), gap: +(lufs(ossia.buffer) - lufs(real.buffer)).toFixed(2) };
}

const out = document.getElementById('out');
(location.search.includes('loudness') ? loudnessStudy() : location.search.includes('timing') ? timing() : measure())
  .then((result) => {
    (window as unknown as { result: unknown }).result = result;
    if (out) out.textContent = 'done';
  })
  .catch((err: unknown) => {
    (window as unknown as { result: unknown }).result = { error: String(err) };
    if (out) out.textContent = String(err);
  });
