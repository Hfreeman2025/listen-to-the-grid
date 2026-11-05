import type { Mix } from '../data/schema';
import { BAR_SECONDS } from '../music/conductor';
import { ossiaOf } from '../music/ossia';
import { integratedLoudness } from './loudness';
import { renderOffline } from './render';

/**
 * Loudness matching for a fair A/B. The ossia reshapes the orchestra (big
 * wind and solar parts, a brighter key), and louder sounds better to most
 * ears, so the ossia is trimmed to the real grid's loudness: each version of
 * the moment is rendered offline, here in the browser, and measured with
 * ITU-R BS.1770 integrated loudness. The real grid keeps its own level.
 */

/** Two phrases each way: two measurements of the same moment then agree within about 0.2 LU. */
export const MATCH_BARS = 16;
const MATCH_RATE = 48000;
/**
 * Until the moment is measured, the ossia is turned down by the typical gap:
 * 2.2 dB, the median over the bundled sample day (from
 * `scripts/measure-audio.mjs --loudness`). Always labelled provisional.
 */
export const PROVISIONAL_TRIM_DB = -2.2;
/** No measurement may move a version further than this. */
const LIMIT_DB = 12;

export interface Match {
  /** integrated loudness of each version, LUFS */
  real: number;
  ossia: number;
  /** gain for the ossia, dB, so it plays at the real grid's loudness */
  trimDb: number;
  /** wall-clock time the measurement took */
  ms: number;
}

/** The ossia's trim from the two loudnesses: the difference, rounded to 0.1 dB and kept within ±12 dB. Silence on either side trims nothing. */
export function ossiaTrim(realLufs: number, ossiaLufs: number): number {
  if (!Number.isFinite(realLufs) || !Number.isFinite(ossiaLufs)) return 0;
  const db = Math.max(-LIMIT_DB, Math.min(LIMIT_DB, realLufs - ossiaLufs));
  return Math.round(db * 10) / 10 || 0;
}

/** Render both versions of a moment offline and measure them. */
export async function measureMoment(g: { mix: Mix; grams: number }, seed = 11): Promise<Match> {
  const plan = { seconds: MATCH_BARS * BAR_SECONDS, sampleRate: MATCH_RATE, seed, every: 100, tau: 0.01 };
  const started = performance.now();
  const [real, ossia] = await Promise.all([renderOffline({ ...plan, at: () => g }), renderOffline({ ...plan, at: () => ossiaOf(g) })]);
  // Skip the first half-second, where every voice fades in from silence.
  const [r, o] = await Promise.all([loudnessOf(real.buffer, 0.5), loudnessOf(ossia.buffer, 0.5)]);
  return { real: r, ossia: o, trimDb: ossiaTrim(r, o), ms: performance.now() - started };
}

let meter: Worker | null | undefined;
let jobs = 0;

/**
 * Integrated loudness of a rendered buffer, measured in a worker (two 40 s
 * stereo renders are some 30 ms of arithmetic, which would make the cursor
 * stutter); on the main thread if a worker can't be had.
 */
function loudnessOf(buffer: AudioBuffer, from: number): Promise<number> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  if (meter === undefined) {
    try {
      meter = new Worker(new URL('./loudness.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      meter = null;
    }
  }
  const worker = meter;
  const here = (): number => integratedLoudness(channels, buffer.sampleRate, from).integrated;
  if (!worker) return Promise.resolve(here());
  const id = ++jobs;
  return new Promise((resolve) => {
    const done = (e: MessageEvent<{ id: number; integrated: number }>): void => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', done);
      worker.removeEventListener('error', failed);
      resolve(e.data.integrated);
    };
    const failed = (): void => {
      worker.removeEventListener('message', done);
      worker.removeEventListener('error', failed);
      meter = null;
      resolve(here());
    };
    worker.addEventListener('message', done);
    worker.addEventListener('error', failed);
    // Copied, not transferred, so the main thread can still measure if the worker fails.
    worker.postMessage({ id, channels, fs: buffer.sampleRate, from });
  });
}

/** Every record is pressed to the same loudness, so any two compare fairly. */
export const RECORD_TARGET_LUFS = -16;
/** ...unless that would put its highest sample above this. */
export const RECORD_CEILING_DB = -1;

/** Gain, dB, that brings a record to the target loudness without its peak passing the ceiling. */
export function recordGain(lufs: number, peakDb: number, target = RECORD_TARGET_LUFS, ceiling = RECORD_CEILING_DB): number {
  if (!Number.isFinite(lufs)) return 0;
  return Math.min(target - lufs, ceiling - peakDb);
}

/**
 * Measures moments one at a time, newest request first, and remembers what it
 * has measured. Rendering can't be cancelled, so a result for a moment that
 * is no longer wanted is kept for later and simply not applied now.
 */
export class LoudnessMatcher {
  private readonly done = new Map<string, Match>();
  private wanted: { key: string; g: { mix: Mix; grams: number } } | null = null;
  private running: string | null = null;

  constructor(
    private readonly onMatch: (key: string, match: Match) => void,
    private readonly onError: (key: string, error: unknown) => void,
    private readonly measure: (g: { mix: Mix; grams: number }) => Promise<Match> = (g) => measureMoment(g),
  ) {}

  get(key: string): Match | undefined {
    return this.done.get(key);
  }

  /** Whether `key` is measured or being measured. */
  has(key: string): boolean {
    return this.done.has(key) || this.running === key || this.wanted?.key === key;
  }

  request(key: string, g: { mix: Mix; grams: number }): void {
    const known = this.done.get(key);
    if (known) {
      this.onMatch(key, known);
      return;
    }
    if (this.running === key) return;
    this.wanted = { key, g };
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running !== null) return;
    while (this.wanted) {
      const job = this.wanted;
      this.wanted = null;
      this.running = job.key;
      try {
        const match = await this.measure(job.g);
        this.done.set(job.key, match);
        // Keep the memory small: the oldest moments go first.
        if (this.done.size > 96) this.done.delete(this.done.keys().next().value ?? '');
        this.onMatch(job.key, match);
      } catch (err) {
        this.onError(job.key, err);
      } finally {
        this.running = null;
      }
    }
  }
}
