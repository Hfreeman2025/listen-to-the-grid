import { describe, expect, it, vi } from 'vitest';
import { LoudnessMatcher, type Match, ossiaTrim, recordGain } from '../src/audio/match';

describe('ossiaTrim', () => {
  it('turns the ossia down by exactly the gap, to a tenth of a dB', () => {
    expect(ossiaTrim(-14.53, -12.31)).toBe(-2.2);
    expect(ossiaTrim(-14.5, -15.2)).toBe(0.7);
    expect(ossiaTrim(-14, -14)).toBe(0);
  });

  it('never trims more than 12 dB, and trims nothing against silence', () => {
    expect(ossiaTrim(-60, -10)).toBe(-12);
    expect(ossiaTrim(-Infinity, -12)).toBe(0);
    expect(ossiaTrim(-14, -Infinity)).toBe(0);
  });
});

describe('recordGain', () => {
  it('brings any record to -16 LUFS', () => {
    expect(recordGain(-14.2, -6)).toBeCloseTo(-1.8, 10);
    expect(recordGain(-19, -8)).toBeCloseTo(3, 10);
  });

  it('stops short of the target rather than let the peak pass -1 dBFS', () => {
    expect(recordGain(-19, -3)).toBeCloseTo(2, 10);
  });

  it('leaves silence alone', () => {
    expect(recordGain(-Infinity, -Infinity)).toBe(0);
  });
});

describe('LoudnessMatcher', () => {
  const match = (trimDb: number): Match => ({ real: -14, ossia: -14 - trimDb, trimDb, ms: 1 });
  const g = { mix: { solar: 0, wind: 1, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: 0 }, grams: 0 };

  it('measures the newest moment wanted, one at a time, and remembers it', async () => {
    const results: string[] = [];
    const resolvers: ((m: Match) => void)[] = [];
    const measure = vi.fn(() => new Promise<Match>((resolve) => resolvers.push(resolve)));
    const m = new LoudnessMatcher(
      (key) => results.push(key),
      () => undefined,
      measure,
    );
    m.request('a', g);
    m.request('b', g);
    m.request('c', g); // b is superseded before it starts
    expect(measure).toHaveBeenCalledTimes(1);
    resolvers[0]?.(match(-2));
    await vi.waitFor(() => {
      expect(measure).toHaveBeenCalledTimes(2);
    });
    resolvers[1]?.(match(-1.5));
    await vi.waitFor(() => {
      expect(results).toEqual(['a', 'c']);
    });
    m.request('a', g); // already known: answered at once, not measured again
    expect(results).toEqual(['a', 'c', 'a']);
    expect(measure).toHaveBeenCalledTimes(2);
    expect(m.get('c')?.trimDb).toBe(-1.5);
  });

  it('says so when a measurement fails, and can try again', async () => {
    const errors: string[] = [];
    let fail = true;
    const m = new LoudnessMatcher(
      () => undefined,
      (key) => errors.push(key),
      () => (fail ? Promise.reject(new Error('no audio')) : Promise.resolve(match(-2))),
    );
    m.request('x', g);
    await vi.waitFor(() => {
      expect(errors).toEqual(['x']);
    });
    fail = false;
    m.request('x', g);
    await vi.waitFor(() => {
      expect(m.get('x')?.trimDb).toBe(-2);
    });
  });
});
