import { HOUR, londonDay, londonDayStart, type Span } from './data/time';
import { BAR_SECONDS } from './music/conductor';

/** "Play yesterday in 60 seconds": one day of data per minute of music. */
export const REPLAY_SPEED = (24 * HOUR) / 60_000;

/** Longest step one tick may take, so waking from sleep does not leap through the day. */
const MAX_STEP_SECONDS = 2;

/**
 * Where playback is. A replay that is playing advances `t` (data time, epoch
 * ms) once music time reaches `startsAt`, which is always a bar line: so a day
 * starts on a downbeat and, at a day a minute, every bar is exactly one hour.
 */
export type Position = { kind: 'live' } | Replay;
export interface Replay {
  kind: 'replay';
  t: number;
  playing: boolean;
  startsAt: number;
  span: Span | null;
  stopAt: number;
}

/** Data time after music time moves from `last` to `heard` (both seconds). */
export function advance(r: Replay, last: number, heard: number): number {
  if (!r.playing || heard <= r.startsAt) return r.t;
  const from = Math.max(last, r.startsAt);
  const seconds = Math.min(MAX_STEP_SECONDS, Math.max(0, heard - from));
  return Math.min(r.stopAt, r.t + seconds * 1000 * REPLAY_SPEED);
}

/** Music time of the next bar line at least `margin` seconds after `heard`. */
export function nextDownbeat(origin: number, heard: number, margin = 0.4): number {
  return origin + Math.ceil((heard - origin + margin) / BAR_SECONDS) * BAR_SECONDS;
}

/** Offline, the recorded day is held at the same time of day as now. */
export function sampleHold(sampleStart: number, now: number): Replay {
  const day = londonDay(sampleStart);
  const t = Math.min(day.end - 1, day.start + (now - londonDayStart(now)));
  return { kind: 'replay', t, playing: false, startsAt: 0, span: null, stopAt: day.end };
}

/**
 * Which data time was playing at each moment of music, so bar lines drawn
 * during a replay can be labelled with the hour they stand for.
 */
export class ReplayTrace {
  private points: { m: number; d: number }[] = [];

  add(m: number, d: number): void {
    this.points.push({ m, d });
  }

  /** Forget everything older than music time `before`. */
  forget(before: number): void {
    const cut = this.points.findIndex((p) => p.m >= before);
    if (cut > 0) this.points.splice(0, cut);
    else if (cut < 0) this.points = [];
  }

  /** The data time at music time `m`, interpolated; null outside the trace. */
  at(m: number): number | null {
    const p = this.points;
    const first = p[0];
    const last = p[p.length - 1];
    if (!first || !last || first.m > m + 0.05 || last.m < m - 0.05) return null;
    let lo = 0;
    let hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((p[mid]?.m ?? 0) <= m) lo = mid;
      else hi = mid;
    }
    const a = p[lo];
    const b = p[hi];
    if (!a || !b) return null;
    return b.m > a.m && m > a.m ? a.d + ((m - a.m) * (b.d - a.d)) / (b.m - a.m) : a.d;
  }
}
