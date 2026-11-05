/**
 * The instruments. Continuous voices (drone, pad, water, air) run for the
 * whole piece and are only steered; note voices build a few nodes per note and
 * let them go when it ends. Every parameter change is a ramp, never a jump.
 */

import { createRng } from '../music/rng';
import { midiToHz } from '../music/theory';
import { crushCurve } from './impulse';

/**
 * Moves a parameter smoothly toward `value` with time constant `tau` seconds
 * (about 3 × tau to settle). A tau of 0 jumps instantly: only the click test
 * uses that, as its deliberately bad control.
 */
export function glide(param: AudioParam, value: number, at: number, tau: number): void {
  param.cancelScheduledValues(at);
  if (tau <= 0) param.setValueAtTime(value, at);
  else param.setTargetAtTime(value, at, Math.max(0.005, tau));
}

function stopAndRelease(nodes: AudioScheduledSourceNode[], others: AudioNode[], end: number): void {
  for (const n of nodes) n.stop(end);
  const first = nodes[0];
  if (first) {
    first.onended = () => {
      for (const n of [...nodes, ...others]) n.disconnect();
    };
  }
}

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = createRng(seed);
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

/** A looped buffer of slowly wandering values in [-1, 1], used as a random LFO. */
function wanderBuffer(ctx: BaseAudioContext, seconds: number, changesPerSecond: number, seed: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = createRng(seed);
  const points = Math.max(2, Math.round(seconds * changesPerSecond));
  const knots = Array.from({ length: points }, () => rng() * 2 - 1);
  for (let i = 0; i < data.length; i++) {
    const x = (i / data.length) * points;
    const k = Math.floor(x);
    const f = x - k;
    const a = knots[k % points] ?? 0;
    const b = knots[(k + 1) % points] ?? 0; // wraps, so the loop is seamless
    const s = f * f * (3 - 2 * f);
    data[i] = a + (b - a) * s;
  }
  return buffer;
}

/** Gas: a low D drone, three detuned saws under a slowly breathing low-pass. */
export class Drone {
  private readonly oscs: OscillatorNode[];
  private readonly filter: BiquadFilterNode;
  private readonly lfoDepth: GainNode;

  constructor(ctx: BaseAudioContext, out: AudioNode, at: number) {
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300, Q: 0.9 });
    const level = new GainNode(ctx, { gain: 0.32 });
    this.oscs = [
      new OscillatorNode(ctx, { type: 'sawtooth', frequency: midiToHz(38) }),
      new OscillatorNode(ctx, { type: 'sawtooth', frequency: midiToHz(38) }),
      new OscillatorNode(ctx, { type: 'sawtooth', frequency: midiToHz(45) }),
      new OscillatorNode(ctx, { type: 'triangle', frequency: midiToHz(50) }),
    ];
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.07 });
    this.lfoDepth = new GainNode(ctx, { gain: 90 });
    lfo.connect(this.lfoDepth).connect(this.filter.frequency);
    for (const o of this.oscs) o.connect(level);
    level.connect(this.filter).connect(out);
    for (const o of [...this.oscs, lfo]) o.start(at);
  }

  apply(cutoffHz: number, detuneCents: number, at: number, tau: number): void {
    glide(this.filter.frequency, cutoffHz, at, tau);
    glide(this.lfoDepth.gain, cutoffHz * 0.3, at, tau);
    const [a, b, c] = this.oscs;
    if (a) glide(a.detune, -detuneCents, at, tau);
    if (b) glide(b.detune, detuneCents, at, tau);
    if (c) glide(c.detune, detuneCents * 0.5, at, tau);
  }
}

/** Wind: a four-voice pad that glides between chords and swells with the breeze. */
export class Pad {
  private readonly voices: { oscs: OscillatorNode[]; pan: StereoPannerNode }[] = [];
  private readonly filter: BiquadFilterNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoDepth: GainNode;
  private readonly airFilter: BiquadFilterNode;
  private readonly airGain: GainNode;
  private readonly halo: OscillatorNode[] = [];
  private readonly haloGain: GainNode;
  private readonly spread = [-0.9, -0.3, 0.3, 0.9];

  constructor(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number) {
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1200, Q: 0.7 });
    this.filter.connect(out);
    const start = [50, 57, 62, 66];
    for (let i = 0; i < 4; i++) {
      const pan = new StereoPannerNode(ctx, { pan: (this.spread[i] ?? 0) * 0.5 });
      const g = new GainNode(ctx, { gain: 0.16 });
      const f = midiToHz(start[i] ?? 62);
      const oscs = [
        new OscillatorNode(ctx, { type: 'sawtooth', frequency: f, detune: -7 }),
        new OscillatorNode(ctx, { type: 'sawtooth', frequency: f, detune: 6 }),
        new OscillatorNode(ctx, { type: 'triangle', frequency: f / 2 }),
      ];
      for (const o of oscs) {
        o.connect(g);
        o.start(at);
      }
      g.connect(pan).connect(this.filter);
      this.voices.push({ oscs, pan });
    }
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.08 });
    this.lfoDepth = new GainNode(ctx, { gain: 300 });
    this.lfo.connect(this.lfoDepth).connect(this.filter.frequency);
    this.lfo.start(at);

    // The halo: soft partials an octave above the top two notes, which open up
    // over the chords when the grid is clean.
    this.haloGain = new GainNode(ctx, { gain: 0 });
    this.haloGain.connect(out);
    for (const m of [start[2] ?? 62, start[3] ?? 66]) {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: midiToHz(m) * 2 });
      o.connect(this.haloGain);
      o.start(at);
      this.halo.push(o);
    }
    const shimmer = new OscillatorNode(ctx, { type: 'sine', frequency: 0.23 });
    const shimmerDepth = new GainNode(ctx, { gain: 6 });
    shimmer.connect(shimmerDepth);
    for (const o of this.halo) shimmerDepth.connect(o.detune);
    shimmer.start(at);

    // The air itself: band-passed noise that sweeps slowly, like gusts.
    const air = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
    this.airFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.8 });
    this.airGain = new GainNode(ctx, { gain: 0 });
    const gust = new OscillatorNode(ctx, { type: 'sine', frequency: 0.045 });
    const gustDepth = new GainNode(ctx, { gain: 900 });
    gust.connect(gustDepth).connect(this.airFilter.frequency);
    air.connect(this.airFilter).connect(this.airGain).connect(out);
    air.start(at);
    gust.start(at);
  }

  chord(midis: readonly number[], at: number): void {
    this.voices.forEach((v, i) => {
      const m = midis[i];
      if (m === undefined) return;
      const f = midiToHz(m);
      const [a, b, sub] = v.oscs;
      // Portamento: each voice slides into its new note over about a second.
      if (a) glide(a.frequency, f, at, 0.32);
      if (b) glide(b.frequency, f, at, 0.36);
      if (sub) glide(sub.frequency, f / 2, at, 0.4);
    });
    this.halo.forEach((o, i) => {
      const m = midis[i + 2];
      if (m !== undefined) glide(o.frequency, midiToHz(m) * 2, at, 0.5);
    });
  }

  apply(cutoffHz: number, movement: number, width: number, brightness: number, at: number, tau: number): void {
    glide(this.filter.frequency, cutoffHz, at, tau);
    glide(this.haloGain.gain, 0.09 * brightness ** 2, at, tau);
    glide(this.lfoDepth.gain, cutoffHz * 0.55 * movement, at, tau);
    glide(this.lfo.frequency, 0.04 + 0.14 * movement, at, tau);
    glide(this.airGain.gain, 0.05 * movement, at, tau);
    this.voices.forEach((v, i) => {
      glide(v.pan.pan, (this.spread[i] ?? 0) * width, at, tau);
    });
  }
}

/** Hydro: running water from noise through two wandering band-pass filters. */
export function water(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number): void {
  const bands = [
    { centre: 700, depth: 380, Q: 7, rate: 11, seed: 21, level: 0.9 },
    { centre: 1900, depth: 900, Q: 10, rate: 17, seed: 22, level: 0.55 },
  ];
  for (const b of bands) {
    const src = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: b.centre, Q: b.Q });
    const lfo = new AudioBufferSourceNode(ctx, { buffer: wanderBuffer(ctx, 6, b.rate, b.seed), loop: true });
    const depth = new GainNode(ctx, { gain: b.depth });
    const level = new GainNode(ctx, { gain: b.level });
    lfo.connect(depth).connect(bp.frequency);
    src.connect(bp).connect(level).connect(out);
    src.start(at, b.seed % 3);
    lfo.start(at);
  }
}

/** Solar: an FM bell. A bright, inharmonic strike that settles into a pure tone. */
export function bell(
  ctx: BaseAudioContext,
  out: AudioNode,
  midi: number,
  velocity: number,
  duration: number,
  at: number,
  pan: number,
): void {
  const f = midiToHz(midi);
  const carrier = new OscillatorNode(ctx, { type: 'sine', frequency: f });
  const mod = new OscillatorNode(ctx, { type: 'sine', frequency: f * 3.5 });
  const index = new GainNode(ctx, { gain: 0 });
  index.gain.setValueAtTime(f * 1.6 * velocity, at);
  index.gain.setTargetAtTime(f * 0.04, at, 0.18);
  mod.connect(index).connect(carrier.frequency);
  const shimmer = new OscillatorNode(ctx, { type: 'sine', frequency: f * 2.005 });
  const shimmerGain = new GainNode(ctx, { gain: 0 });
  shimmerGain.gain.setValueAtTime(0, at);
  shimmerGain.gain.linearRampToValueAtTime(0.18 * velocity, at + 0.004);
  shimmerGain.gain.setTargetAtTime(0, at + 0.004, 0.25);
  const amp = new GainNode(ctx, { gain: 0 });
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(velocity, at + 0.003);
  amp.gain.setTargetAtTime(0, at + 0.003, duration / 5);
  const panner = new StereoPannerNode(ctx, { pan });
  carrier.connect(amp);
  shimmer.connect(shimmerGain).connect(amp);
  amp.connect(panner).connect(out);
  const end = at + duration + 0.2;
  for (const o of [carrier, mod, shimmer]) o.start(at);
  stopAndRelease([carrier, mod, shimmer], [index, shimmerGain, amp, panner], end);
}

/** Nuclear: a soft, round pulse, like a felt mallet on a low drum. */
export function pulse(ctx: BaseAudioContext, out: AudioNode, midi: number, velocity: number, at: number): void {
  const f = midiToHz(midi);
  const body = new OscillatorNode(ctx, { type: 'sine', frequency: f * 1.5 });
  body.frequency.setValueAtTime(f * 1.5, at);
  body.frequency.exponentialRampToValueAtTime(f, at + 0.045);
  const overtone = new OscillatorNode(ctx, { type: 'triangle', frequency: f * 2 });
  const overtoneGain = new GainNode(ctx, { gain: 0.22 });
  const amp = new GainNode(ctx, { gain: 0 });
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(velocity, at + 0.006);
  amp.gain.setTargetAtTime(0, at + 0.01, 0.1);
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900, Q: 0.5 });
  body.connect(amp);
  overtone.connect(overtoneGain).connect(amp);
  amp.connect(lp).connect(out);
  body.start(at);
  overtone.start(at);
  stopAndRelease([body, overtone], [overtoneGain, amp, lp], at + 0.9);
}

/** Biomass: one warm, sung line: saw and triangle through vowel formants. */
export class Singer {
  private readonly saw: OscillatorNode;
  private readonly tri: OscillatorNode;
  private readonly env: GainNode;

  constructor(ctx: BaseAudioContext, out: AudioNode, at: number) {
    this.saw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: midiToHz(62) });
    this.tri = new OscillatorNode(ctx, { type: 'triangle', frequency: midiToHz(62) });
    const vibrato = new OscillatorNode(ctx, { type: 'sine', frequency: 5.1 });
    const vibratoDepth = new GainNode(ctx, { gain: 9 });
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(this.saw.detune);
    vibratoDepth.connect(this.tri.detune);
    const source = new GainNode(ctx, { gain: 0.5 });
    this.saw.connect(source);
    this.tri.connect(source);
    this.env = new GainNode(ctx, { gain: 0 });
    const formants = [
      { f: 650, Q: 5, g: 1 },
      { f: 1080, Q: 7, g: 0.55 },
      { f: 2650, Q: 9, g: 0.18 },
    ];
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2600, Q: 0.4 });
    for (const fm of formants) {
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: fm.f, Q: fm.Q });
      const g = new GainNode(ctx, { gain: fm.g });
      source.connect(bp).connect(g).connect(this.env);
    }
    // Some of the raw tone under the formants keeps it from sounding thin.
    const body = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700, Q: 0.3 });
    const bodyGain = new GainNode(ctx, { gain: 0.25 });
    source.connect(body).connect(bodyGain).connect(this.env);
    this.env.connect(lp).connect(out);
    for (const o of [this.saw, this.tri, vibrato]) o.start(at);
  }

  note(midi: number, velocity: number, duration: number, at: number): void {
    const f = midiToHz(midi);
    glide(this.saw.frequency, f, at, 0.035);
    glide(this.tri.frequency, f, at, 0.035);
    const g = this.env.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(velocity, at, 0.06);
    g.setTargetAtTime(velocity * 0.72, at + 0.25, 0.4);
    g.setTargetAtTime(0, at + duration, 0.22);
  }
}

/** Imports: a soft, distant chord that swells in and fades away. */
export function distantChord(
  ctx: BaseAudioContext,
  out: AudioNode,
  midis: readonly number[],
  velocity: number,
  duration: number,
  at: number,
): void {
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1500, Q: 0.3 });
  const amp = new GainNode(ctx, { gain: 0 });
  const attack = Math.min(1.4, duration * 0.3);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(velocity * 0.32, at + attack);
  amp.gain.setTargetAtTime(0, at + duration - 1.6, 0.5);
  amp.connect(lp).connect(out);
  const oscs: OscillatorNode[] = [];
  midis.forEach((m, i) => {
    const f = midiToHz(m);
    oscs.push(new OscillatorNode(ctx, { type: 'triangle', frequency: f, detune: (i - 1) * 4 }));
    oscs.push(new OscillatorNode(ctx, { type: 'sine', frequency: f * 2, detune: -(i - 1) * 3 }));
  });
  for (const o of oscs) {
    o.connect(amp);
    o.start(at);
  }
  stopAndRelease(oscs, [amp, lp], at + duration + 1.5);
}

/** Hydro: a droplet, a short rising blip. */
export function droplet(ctx: BaseAudioContext, out: AudioNode, midi: number, velocity: number, at: number, pan: number): void {
  const f = midiToHz(midi);
  const osc = new OscillatorNode(ctx, { type: 'sine', frequency: f });
  osc.frequency.setValueAtTime(f, at);
  osc.frequency.exponentialRampToValueAtTime(f * 1.9, at + 0.06);
  const amp = new GainNode(ctx, { gain: 0 });
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(velocity, at + 0.004);
  amp.gain.setTargetAtTime(0, at + 0.01, 0.03);
  const panner = new StereoPannerNode(ctx, { pan });
  osc.connect(amp).connect(panner).connect(out);
  osc.start(at);
  stopAndRelease([osc], [amp, panner], at + 0.3);
}

/** Other: a plucked note, a click of noise ringing through a tuned filter. */
export function pluck(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  midi: number,
  velocity: number,
  at: number,
  pan: number,
): void {
  const f = midiToHz(midi);
  const src = new AudioBufferSourceNode(ctx, { buffer: noise });
  const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f, Q: 28 });
  const burst = new GainNode(ctx, { gain: 0 });
  burst.gain.setValueAtTime(0, at);
  burst.gain.linearRampToValueAtTime(velocity * 3, at + 0.002);
  burst.gain.setTargetAtTime(0, at + 0.004, 0.006);
  const tone = new OscillatorNode(ctx, { type: 'triangle', frequency: f });
  const toneGain = new GainNode(ctx, { gain: 0 });
  toneGain.gain.setValueAtTime(0, at);
  toneGain.gain.linearRampToValueAtTime(velocity * 0.35, at + 0.003);
  toneGain.gain.setTargetAtTime(0, at + 0.004, 0.12);
  const panner = new StereoPannerNode(ctx, { pan });
  src.connect(burst).connect(bp).connect(panner);
  tone.connect(toneGain).connect(panner);
  panner.connect(out);
  src.start(at, (midi * 0.037) % 1);
  tone.start(at);
  stopAndRelease([src, tone], [bp, burst, toneGain, panner], at + 0.8);
}

/** Coal: harsh grit, a crushed saw and a burst of noise. */
export function grit(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  midi: number,
  velocity: number,
  duration: number,
  at: number,
): void {
  const saw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: midiToHz(midi) });
  const crush = new WaveShaperNode(ctx, { curve: crushCurve(3) });
  const src = new AudioBufferSourceNode(ctx, { buffer: noise });
  const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 1.1 });
  const amp = new GainNode(ctx, { gain: 0 });
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(velocity, at + 0.003);
  amp.gain.setTargetAtTime(0, at + duration, 0.02);
  saw.connect(crush).connect(bp);
  src.connect(bp);
  bp.connect(amp).connect(out);
  saw.start(at);
  src.start(at, (midi * 0.11) % 1);
  stopAndRelease([saw, src], [crush, bp, amp], at + duration + 0.2);
}
