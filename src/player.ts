import { AudioEngine } from './audio/engine';
import type { Fuel } from './data/schema';
import { BAR_SECONDS, Conductor, STEP_SECONDS, STEPS_PER_BAR, barEvents, type Bar, type NoteEvent } from './music/conductor';
import type { Arrangement } from './music/mapping';
import type { Mode } from './music/theory';

/** Which version of the music sounds: the grid as it is, or the ossia's fully renewable re-scoring. */
export type Version = 'real' | 'ossia';

/** One bar in both versions, composed together so either can sound from any moment. */
export interface BarPair {
  real: Bar;
  ossia: Bar;
}

/** Called once per bar, as it is composed (a little before it sounds), with its start in music time. */
export type BarListener = (bars: BarPair, start: number) => void;

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * Keeps time and feeds the conductor. Before sound is allowed it runs on the
 * page clock so the score is already moving; once the listener presses play it
 * switches to the audio clock and every note is scheduled a little ahead on it
 * (the "two clocks" lookahead pattern), so timing never depends on timers.
 *
 * "Music time" is one continuous timeline in seconds shared by sound and
 * picture; it stops while paused.
 */
export class Player {
  private readonly seed = Math.floor(Math.random() * 2 ** 31);
  /** Two conductors, one for each version, so each keeps its own phrasing and voice leading. */
  private readonly conductors: Record<Version, Conductor> = { real: new Conductor(this.seed), ossia: new Conductor(this.seed) };
  private readonly perfBase = performance.now() / 1000;
  private ctx: AudioContext | null = null;
  private engine: AudioEngine | null = null;
  private offset = 0;
  private readonly origin: number;
  private step = 0;
  private arrangements: Record<Version, Arrangement>;
  private version: Version = 'real';
  /** each version's loudness-matching gain, dB: the real grid keeps its level, the ossia is matched to it */
  private readonly trims: Record<Version, number> = { real: 0, ossia: 0 };
  private paused = false;
  private volume = 0.75;
  private muted = false;
  private bars: BarPair | null = null;
  private due: Record<Version, Map<number, NoteEvent[]>> = { real: new Map(), ossia: new Map() };

  constructor(
    arrangements: Record<Version, Arrangement>,
    private readonly onBar: BarListener,
    preRollSeconds: number,
  ) {
    this.arrangements = arrangements;
    const steps = Math.ceil(preRollSeconds / STEP_SECONDS);
    this.origin = this.now() - steps * STEP_SECONDS;
  }

  /** Start keeping time, `preRollSeconds` in: the bar under way is composed at once, so the score opens mid-bar. */
  begin(): void {
    this.advance(this.now());
    setInterval(this.tick, 25);
  }

  get started(): boolean {
    return this.engine !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** The real grid's key, for the arrangement's hysteresis. */
  get mode(): Mode | null {
    return this.conductors.real.currentMode;
  }

  get ossiaMode(): Mode | null {
    return this.conductors.ossia.currentMode;
  }

  /** Which version is sounding. */
  get sounding(): Version {
    return this.version;
  }

  /** Music time of step 0, for drawing bar lines. */
  get startTime(): number {
    return this.origin;
  }

  /** Scheduling clock: where notes are being written. */
  now(): number {
    if (!this.ctx) return performance.now() / 1000 - this.perfBase;
    return this.ctx.currentTime - this.offset;
  }

  /** Listening clock: what is coming out of the speakers right now. */
  heardNow(): number {
    const ctx = this.ctx;
    if (!ctx) return this.now();
    if (ctx.state === 'running') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
        const since = Math.min(0.1, Math.max(0, (performance.now() - ts.performanceTime) / 1000));
        return ts.contextTime + since - this.offset;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - this.offset;
  }

  setArrangement(arr: Record<Version, Arrangement>, tau: number): void {
    this.arrangements = arr;
    if (this.engine && this.ctx) this.engine.apply(arr[this.version], this.ctx.currentTime, tau);
  }

  /**
   * Switch which version sounds, at once and without stopping: levels and
   * the pad's chord glide to the other version, and the rest of the bar
   * plays its notes. Both are always composed, so A/B is the same moment.
   */
  setVersion(v: Version): void {
    if (v === this.version) return;
    this.version = v;
    if (!this.engine || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.engine.apply(this.arrangements[v], now, 0.12);
    this.engine.setTrim(this.trims[v], now, 0.12);
    if (this.bars) this.engine.harmony(this.bars[v].pad, now);
  }

  /** Set a version's loudness-matching trim; heard at once (gliding) if that version is sounding. */
  setTrim(v: Version, db: number): void {
    this.trims[v] = db;
    if (this.engine && this.ctx && v === this.version) this.engine.setTrim(db, this.ctx.currentTime, 0.25);
  }

  private starting: Promise<void> | null = null;

  /**
   * Must be called from a click or key press: browsers only allow sound after
   * a gesture. Calls made while starting share the first one, so a double
   * click never builds two instruments.
   */
  start(): Promise<void> {
    if (this.ctx) return Promise.resolve();
    this.starting ??= this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async open(): Promise<void> {
    const nav = navigator as Navigator & AudioSessionNavigator;
    // iOS: play through the silent switch, like a music app.
    if (nav.audioSession) nav.audioSession.type = 'playback';
    const ctx = new AudioContext({ latencyHint: 'playback' });
    await ctx.resume();
    const musicNow = this.now();
    this.offset = ctx.currentTime - musicNow;
    this.ctx = ctx;
    const engine = new AudioEngine(ctx);
    engine.apply(this.arrangements[this.version], ctx.currentTime, 0.02);
    engine.setTrim(this.trims[this.version], ctx.currentTime, 0.01);
    if (this.bars) engine.harmony(this.bars[this.version].pad, ctx.currentTime);
    this.engine = engine;
    this.paused = false;
    this.applyLevel(1.4);
  }

  async pause(): Promise<void> {
    if (!this.ctx || !this.engine || this.paused) return;
    this.paused = true;
    this.engine.setLevel(0, this.ctx.currentTime, 0.06);
    const ctx = this.ctx;
    await new Promise((resolve) => setTimeout(resolve, 260));
    // The listener may have pressed play again during the fade.
    if (this.isPaused) await ctx.suspend();
  }

  async resume(): Promise<void> {
    if (!this.ctx || !this.engine) return;
    await this.ctx.resume();
    this.paused = false;
    this.applyLevel(0.25);
  }

  /** Browsers can suspend audio on their own (iOS calls, other tabs). */
  get interrupted(): boolean {
    return this.ctx !== null && this.ctx.state !== 'running' && !this.paused;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyLevel(0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyLevel(0.03);
  }

  solo(fuel: Fuel | null): void {
    if (this.engine && this.ctx) this.engine.solo(fuel, this.ctx.currentTime);
  }

  private record: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

  /**
   * Play a pressed record through the same speakers. The live orchestra holds
   * silent until the record ends or is stopped; volume and mute apply to both.
   */
  playRecord(buffer: AudioBuffer, onEnded: () => void): { stop: () => void; startsAt: number } {
    const ctx = this.ctx;
    if (!ctx) throw new Error('sound has not started');
    this.stopRecord();
    const gain = new GainNode(ctx, { gain: this.muted ? 0 : this.volume ** 2 });
    const source = new AudioBufferSourceNode(ctx, { buffer });
    source.connect(gain).connect(ctx.destination);
    const startsAt = ctx.currentTime + 0.12;
    source.start(startsAt);
    this.record = { source, gain };
    this.applyLevel(0.05);
    source.onended = () => {
      if (this.record?.source !== source) return;
      source.disconnect();
      gain.disconnect();
      this.record = null;
      this.applyLevel(0.6);
      onEnded();
    };
    return {
      stop: () => {
        this.stopRecord();
      },
      startsAt,
    };
  }

  /** Seconds into the record now playing, or null. */
  recordTime(startsAt: number): number | null {
    return this.record && this.ctx ? Math.max(0, this.ctx.currentTime - startsAt) : null;
  }

  private stopRecord(): void {
    if (!this.record) return;
    this.record.source.stop();
  }

  private applyLevel(tau: number): void {
    if (!this.engine || !this.ctx) return;
    // Squared slider position tracks loudness better than a straight line.
    const level = this.muted || this.paused || this.record ? 0 : this.volume ** 2;
    this.engine.setLevel(level, this.ctx.currentTime, tau);
    if (this.record) this.record.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume ** 2, this.ctx.currentTime, 0.03);
  }

  private readonly tick = (): void => {
    if (this.paused) return;
    const now = this.now();
    // After a stall (a sleeping laptop, a throttled tab) skip to the present
    // rather than firing a burst of late notes.
    if (this.origin + this.step * STEP_SECONDS < now - 0.25) {
      this.step = Math.ceil((now - this.origin) / STEP_SECONDS);
    }
    // Hidden tabs get slow timers, so schedule further ahead there.
    this.advance(now + (document.hidden ? 1.2 : 0.16));
  };

  /**
   * Write steps up to music time `until`. A bar is composed whole at its first
   * step, so the score can engrave it before it sounds; its notes are then
   * scheduled step by step on the audio clock.
   */
  private advance(until: number): void {
    while (this.origin + this.step * STEP_SECONDS < until) {
      const t = this.origin + this.step * STEP_SECONDS;
      const barIndex = Math.floor(this.step / STEPS_PER_BAR);
      if (this.bars?.real.index !== barIndex) {
        const pair: BarPair = {
          real: this.conductors.real.bar(barIndex, this.arrangements.real),
          ossia: this.conductors.ossia.bar(barIndex, this.arrangements.ossia),
        };
        this.bars = pair;
        this.due = { real: byStep(barEvents(pair.real)), ossia: byStep(barEvents(pair.ossia)) };
        const barStart = this.origin + barIndex * STEPS_PER_BAR * STEP_SECONDS;
        this.onBar(pair, barStart);
        if (this.engine && this.ctx) {
          const at = Math.max(barStart + this.offset, this.ctx.currentTime);
          const bar = pair[this.version];
          this.engine.harmony(bar.pad, at);
          this.engine.phrase(bar.swell, at, BAR_SECONDS);
        }
      }
      if (this.engine && this.ctx) {
        // A stalled main thread can leave steps slightly in the audio clock's
        // past: notes more than 30 ms late are dropped rather than played out
        // of time.
        const at = t + this.offset;
        const current = this.ctx.currentTime;
        if (at >= current - 0.03) for (const n of this.due[this.version].get(this.step) ?? []) this.engine.note(n, Math.max(at, current));
      }
      this.step++;
    }
  }
}

function byStep(events: readonly NoteEvent[]): Map<number, NoteEvent[]> {
  const due = new Map<number, NoteEvent[]>();
  for (const n of events) due.set(n.step, [...(due.get(n.step) ?? []), n]);
  return due;
}
