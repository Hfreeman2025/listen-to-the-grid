import { FUELS, type Fuel } from '../data/schema';
import type { NoteEvent } from '../music/conductor';
import type { Arrangement } from '../music/mapping';
import { createRng } from '../music/rng';
import { generateImpulse, softClipCurve } from './impulse';
import { bell, Drone, distantChord, droplet, glide, grit, noiseBuffer, Pad, pluck, pulse, Singer, water } from './voices';

/**
 * Balance: what each voice is multiplied by at full share. Set by rendering
 * every voice alone at full share and matching their loudness (see
 * scripts/measure-audio.mjs), then nudged by ear so the drone and pulse sit
 * underneath rather than on top.
 */
const TRIM: Record<Fuel, number> = {
  solar: 0.5,
  wind: 0.46,
  hydro: 0.89,
  biomass: 0.6,
  imports: 0.8,
  nuclear: 0.34,
  other: 1.75,
  coal: 1.05,
  gas: 0.21,
};

/** How much of each voice goes to the hall rather than straight out. */
const SEND: Record<Fuel, { dry: number; wet: number }> = {
  solar: { dry: 0.75, wet: 0.7 },
  wind: { dry: 0.8, wet: 0.55 },
  hydro: { dry: 0.8, wet: 0.5 },
  biomass: { dry: 0.85, wet: 0.4 },
  imports: { dry: 0.3, wet: 1 },
  nuclear: { dry: 0.95, wet: 0.18 },
  other: { dry: 0.8, wet: 0.5 },
  coal: { dry: 1, wet: 0.1 },
  gas: { dry: 0.95, wet: 0.2 },
};

interface Bus {
  level: GainNode;
  /** the phrase's swell, ramped across each bar */
  expr: GainNode;
  solo: GainNode;
  wet: GainNode;
}

/** How much each voice follows the phrase's swell (0 = not at all). */
const PHRASED: Partial<Record<Fuel, number>> = { wind: 1, biomass: 0.9, imports: 0.8, gas: 0.6, hydro: 0.45, nuclear: 0.3 };

/**
 * The whole instrument. Works on a live AudioContext or an OfflineAudioContext
 * (for measurement), and takes explicit times so changes can be scheduled.
 *
 *   voices -> per-fuel level -> solo -> dry + reverb send
 *   sum -> high-pass -> tone -> glue compressor -> limiter -> soft clip -> master
 */
export class AudioEngine {
  readonly ctx: BaseAudioContext;
  private readonly buses = {} as Record<Fuel, Bus>;
  private readonly master: GainNode;
  /** a version's loudness-matching gain, after the dynamics so it is a pure level change */
  private readonly trim: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly reverbReturn: GainNode;
  private readonly noise: AudioBuffer;
  private readonly drone: Drone;
  private readonly pad: Pad;
  private readonly singer: Singer;
  private readonly rng = createRng(99);
  private soloed: Fuel | null = null;
  private last: Arrangement | null = null;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const at = ctx.currentTime;
    this.noise = noiseBuffer(ctx, 4, 7);

    this.master = new GainNode(ctx, { gain: 0 });
    this.trim = new GainNode(ctx, { gain: 1 });
    const clip = new WaveShaperNode(ctx, { curve: softClipCurve(), oversample: '2x' });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -4, knee: 0, ratio: 20, attack: 0.002, release: 0.12 });
    // Gentle glue only: a slow, light compressor that leaves the phrase's swell intact.
    const glue = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 10, ratio: 1.8, attack: 0.05, release: 0.6 });
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 12000, Q: 0.5 });
    const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 32, Q: 0.6 });
    const sum = new GainNode(ctx, { gain: 0.88 });
    sum
      .connect(highpass)
      .connect(this.tone)
      .connect(glue)
      .connect(limiter)
      .connect(clip)
      .connect(this.trim)
      .connect(this.master)
      .connect(ctx.destination);

    const [left, right] = generateImpulse({ sampleRate: ctx.sampleRate, seconds: 4.2, preDelay: 0.025, seed: 5 });
    const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
    ir.copyToChannel(left, 0);
    ir.copyToChannel(right, 1);
    const reverb = new ConvolverNode(ctx, { buffer: ir });
    const reverbSend = new GainNode(ctx, { gain: 1 });
    this.reverbReturn = new GainNode(ctx, { gain: 0.3 });
    reverbSend.connect(reverb).connect(this.reverbReturn).connect(sum);

    for (const fuel of FUELS) {
      const level = new GainNode(ctx, { gain: 0 });
      const expr = new GainNode(ctx, { gain: 1 });
      const solo = new GainNode(ctx, { gain: 1 });
      const dry = new GainNode(ctx, { gain: SEND[fuel].dry });
      const wet = new GainNode(ctx, { gain: SEND[fuel].wet });
      level.connect(expr).connect(solo);
      solo.connect(dry).connect(sum);
      solo.connect(wet).connect(reverbSend);
      this.buses[fuel] = { level, expr, solo, wet };
    }

    this.drone = new Drone(ctx, this.buses.gas.level, at);
    this.pad = new Pad(ctx, this.buses.wind.level, this.noise, at);
    this.singer = new Singer(ctx, this.buses.biomass.level, at);
    water(ctx, this.buses.hydro.level, this.noise, at);
  }

  /** Loudness-match trim, in dB, gliding over roughly 3 × tau seconds. */
  setTrim(db: number, at: number, tau: number): void {
    glide(this.trim.gain, 10 ** (db / 20), at, tau);
  }

  /** Steer every voice toward an arrangement, over roughly 3 × tau seconds. */
  apply(arr: Arrangement, at: number, tau: number): void {
    for (const fuel of FUELS) {
      glide(this.buses[fuel].level.gain, arr[fuel].amp * TRIM[fuel], at, tau);
      glide(this.buses[fuel].wet.gain, SEND[fuel].wet * (arr.space / 0.3), at, tau);
    }
    glide(this.tone.frequency, arr.toneHz, at, tau);
    glide(this.reverbReturn.gain, 0.22 + 0.25 * arr.brightness, at, tau);
    this.drone.apply(arr.gas.cutoffHz, arr.gas.detuneCents, at, tau);
    this.pad.apply(arr.wind.cutoffHz, arr.wind.movement, arr.wind.width, arr.brightness, at, tau);
    this.last = arr;
  }

  /** Move the pad to a new chord voicing. */
  harmony(pad: readonly number[], at: number): void {
    this.pad.chord(pad, at);
  }

  /**
   * Shape a bar of the phrase: each phrased voice's expression moves in a
   * straight line from `from` to `to` across the bar. A swell of 0.7 to 1 is
   * about 3 dB, enough to hear a phrase breathe without anyone reaching for
   * the volume.
   */
  phrase(swell: { from: number; to: number }, at: number, seconds: number): void {
    for (const fuel of FUELS) {
      const depth = PHRASED[fuel];
      if (depth === undefined) continue;
      const g = this.buses[fuel].expr.gain;
      const level = (x: number): number => 1 - depth * (1 - x);
      // Ramp (never jump) to the bar's starting level, so a skipped bar after
      // a stall still cannot click, then across the bar.
      g.cancelScheduledValues(at);
      g.linearRampToValueAtTime(level(swell.from), at + 0.05);
      g.linearRampToValueAtTime(level(swell.to), at + seconds);
    }
  }

  note(n: NoteEvent, at: number): void {
    const out = this.buses[n.voice].level;
    const pan = (this.rng() * 2 - 1) * 0.6;
    switch (n.voice) {
      case 'solar':
        for (const m of n.midis) bell(this.ctx, out, m, n.velocity * 0.5, n.duration, at, pan);
        break;
      case 'nuclear':
        for (const m of n.midis) pulse(this.ctx, out, m, n.velocity, at);
        break;
      case 'biomass': {
        const m = n.midis[0];
        if (m !== undefined) this.singer.note(m, n.velocity * 0.9, n.duration, at);
        break;
      }
      case 'imports':
        distantChord(this.ctx, out, n.midis, n.velocity, n.duration, at);
        break;
      case 'hydro':
        for (const m of n.midis) droplet(this.ctx, out, m, n.velocity * 0.35, at, pan);
        break;
      case 'other':
        for (const m of n.midis) pluck(this.ctx, out, this.noise, m, n.velocity * 0.7, at, pan);
        break;
      case 'coal':
        for (const m of n.midis) grit(this.ctx, out, this.noise, m, n.velocity * 0.6, n.duration, at);
        break;
      case 'wind':
      case 'gas':
        break;
    }
  }

  /** Hear one voice alone (null restores the full arrangement). */
  solo(fuel: Fuel | null, at: number): void {
    this.soloed = fuel;
    for (const f of FUELS) glide(this.buses[f].solo.gain, fuel === null || f === fuel ? 1 : 0, at, 0.12);
  }

  get soloVoice(): Fuel | null {
    return this.soloed;
  }

  get arrangement(): Arrangement | null {
    return this.last;
  }

  /** Master level, including volume, mute and fades. */
  setLevel(value: number, at: number, tau: number): void {
    glide(this.master.gain, value, at, tau);
  }
}
