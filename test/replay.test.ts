import { describe, expect, it } from 'vitest';
import { REPLAY_SPEED, ReplayTrace, advance, nextDownbeat, sampleHold, type Replay } from '../src/replay';

const HOUR = 3_600_000;
const day = Date.UTC(2026, 9, 31);
const replay = (over: Partial<Replay> = {}): Replay => ({ kind: 'replay', t: day, playing: true, startsAt: 10, span: null, stopAt: day + 24 * HOUR, ...over });

describe('advance', () => {
  it('plays a day in a minute: 2.5 s of music is one hour of data', () => {
    expect(REPLAY_SPEED).toBe(1440);
    // Ticks arrive every 100 ms; step through one bar of them.
    const r = replay();
    for (let m = 10; m < 12.5 - 1e-9; m += 0.1) r.t = advance(r, m, m + 0.1);
    expect(r.t).toBeCloseTo(day + HOUR, 3);
  });

  it('waits for its downbeat, then counts only from it', () => {
    expect(advance(replay(), 8, 9.9)).toBe(day);
    expect(advance(replay(), 9, 10.25)).toBe(day + HOUR / 10);
  });

  it('does not move while paused', () => {
    expect(advance(replay({ playing: false }), 10, 20)).toBe(day);
  });

  it('caps a long gap, such as waking from sleep, at two seconds', () => {
    expect(advance(replay(), 10, 500)).toBe(day + 0.8 * HOUR);
  });

  it('stops at the end of the span', () => {
    expect(advance(replay({ t: day + 23.9 * HOUR }), 10, 12)).toBe(day + 24 * HOUR);
  });
});

describe('nextDownbeat', () => {
  it('lands on a bar line at least the margin ahead', () => {
    expect(nextDownbeat(100, 101)).toBe(102.5);
    expect(nextDownbeat(100, 102.3)).toBe(105);
  });
});

describe('sampleHold', () => {
  it('holds the recorded day at the same time of day as now', () => {
    const hold = sampleHold(Date.UTC(2026, 9, 28), Date.UTC(2026, 10, 1, 13, 20));
    expect(hold.t).toBe(Date.UTC(2026, 9, 28, 13, 20));
    expect(hold.playing).toBe(false);
    expect(hold.stopAt).toBe(Date.UTC(2026, 9, 29));
  });
});

describe('ReplayTrace', () => {
  it('interpolates the data time at a bar line, and knows nothing outside it', () => {
    const tr = new ReplayTrace();
    tr.add(10, day);
    tr.add(12.5, day + HOUR);
    expect(tr.at(11.25)).toBe(day + HOUR / 2);
    expect(tr.at(9)).toBeNull();
    tr.forget(11);
    expect(tr.at(12.5)).toBe(day + HOUR);
  });
});
