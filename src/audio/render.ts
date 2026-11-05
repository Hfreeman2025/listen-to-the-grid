import type { Mix } from '../data/schema';
import { BAR_SECONDS, type Bar, barEvents, Conductor, STEP_SECONDS, STEPS_PER_BAR } from '../music/conductor';
import { type Arrangement, arrange } from '../music/mapping';
import { AudioEngine } from './engine';

export interface RenderPlan {
  seconds: number;
  sampleRate?: number;
  seed: number;
  /** the grid at `t` seconds into the render */
  at: (t: number) => { mix: Mix; grams: number };
  /** how often to re-read the grid, in seconds (the page uses 0.1) */
  every?: number;
  /** ramp time constant for data changes (the page's replay uses 0.35) */
  tau?: number;
  /** false renders held voices only (for the click test) */
  notes?: boolean;
  /** fade in at the start and out at the end, as a finished record should */
  fades?: boolean;
  /** bars already composed (a record whose sleeve is drawn); otherwise composed here */
  bars?: readonly Bar[];
  onProgress?: (fraction: number) => void;
}

export interface Rendered {
  buffer: AudioBuffer;
  bars: Bar[];
  /** wall-clock milliseconds the render took */
  ms: number;
}

/**
 * Renders the instrument offline, faster than real time, with exactly the
 * engine and conductor the page plays live: the measurement harness and the
 * "press a record" feature both come through here.
 */
export async function renderOffline(plan: RenderPlan): Promise<Rendered> {
  const rate = plan.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.round(plan.seconds * rate), rate);
  const engine = new AudioEngine(ctx);
  const conductor = new Conductor(plan.seed);
  const every = plan.every ?? 0.1;
  const tau = plan.tau ?? 0.35;
  if (plan.fades) {
    engine.setLevel(1, 0, 0.25);
    engine.setLevel(0, plan.seconds - 2.2, 0.45);
  } else {
    engine.setLevel(1, 0, 0.005);
  }

  let arr: Arrangement | null = null;
  const read = (t: number): Arrangement => {
    const state = plan.at(t);
    arr = arrange(state.mix, state.grams, conductor.currentMode ?? undefined);
    return arr;
  };
  engine.apply(read(0), 0, 0.005);
  for (let t = every; t < plan.seconds; t += every) engine.apply(read(t), t, tau);

  const bars: Bar[] = [];
  const barCount = Math.ceil(plan.seconds / BAR_SECONDS);
  for (let b = 0; b < barCount; b++) {
    const start = b * BAR_SECONDS;
    const given = plan.bars?.[b];
    if (plan.bars && !given) break;
    const bar = given ?? conductor.bar(b, read(start));
    bars.push(bar);
    engine.harmony(bar.pad, start);
    engine.phrase(bar.swell, start, BAR_SECONDS);
    if (plan.notes === false) continue;
    for (const n of barEvents(bar)) {
      const at = (n.step - b * STEPS_PER_BAR) * STEP_SECONDS + start;
      if (at < plan.seconds - 0.05) engine.note(n, at);
    }
  }

  // Progress: pause the render every few seconds of audio to report.
  const report = plan.onProgress;
  if (report) {
    for (let t = 2; t < plan.seconds; t += 2) {
      try {
        ctx.suspend(t).then(
          () => {
            report(t / plan.seconds);
            void ctx.resume();
          },
          () => undefined,
        );
      } catch {
        break; // a browser without offline suspend just renders without progress
      }
    }
  }

  const started = performance.now();
  const buffer = await ctx.startRendering();
  report?.(1);
  return { buffer, bars, ms: performance.now() - started };
}
