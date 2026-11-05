/**
 * Offline measurements of the instrument (dev only: served at /measure.html,
 * driven by scripts/measure-audio.mjs, never part of the build). Renders the
 * real engine and conductor into an OfflineAudioContext and reports levels,
 * clipping, clicks and brightness, so the sound can be checked by numbers as
 * well as by ear.
 */

import { centroid, clickScore, contour, correlation, energyAbove, levels, RATE, spectrogram } from './audio/analysis';
import { integratedLoudness } from './audio/loudness';
import { measureMoment } from './audio/match';
import { renderOffline } from './audio/render';
import { encodeWav } from './audio/wav';
import { loadSample } from './data/api';
import { FUELS, type Fuel, type Mix } from './data/schema';
import { sampleAt } from './data/series';
import { type Bar, SWELL } from './music/conductor';
import { ossiaOf } from './music/ossia';

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
  const finals = bars
    .filter((b) => b.phrasePos === 7 && b.parts.biomass.length > 0)
    .map((b) => b.parts.biomass[b.parts.biomass.length - 1]?.midis[0] ?? 0);
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

/** A render as a WAV file for listening to, base64 for the trip out of the page; the same writer as the records. */
function wavBase64(buffer: AudioBuffer, title: string, date: string): string {
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const tags = { title, artist: 'Listen to the Grid', album: 'Measurement renders', date, comment: 'Rendered offline by measure.html' };
  const bytes = encodeWav({ sampleRate: buffer.sampleRate, channels }, tags);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
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
  const noon = await render({
    seconds: 20,
    every: 100,
    tau: 0.01,
    at: () => ossiaOf({ mix: { ...zero(), solar: 0.3, wind: 0.25, hydro: 0.02, gas: 0.43 }, grams: 200 }),
  });
  const allWind = await render({
    seconds: 20,
    every: 100,
    tau: 0.01,
    at: () => ossiaOf({ mix: { ...zero(), gas: 0.7, nuclear: 0.3 }, grams: 300 }),
  });

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
      followsSwell: correlation(
        perBar.slice(1),
        perBar.slice(1).map((_, i) => 20 * Math.log10(((SWELL[(i + 1) % 8] ?? 1) + (SWELL[((i + 1) % 8) + 1] ?? 1)) / 2)),
      ),
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
    wav: {
      day: wavBase64(day.buffer, 'The sample day in 60 seconds', sample.date),
      ossia: wavBase64(ossiaDay.buffer, 'The sample day in 60 seconds, ossia (hypothetical)', sample.date),
    },
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
