import { describe, expect, it } from 'vitest';
import sample from '../src/data/sample-day.json';
import { currentGenerationResponse, generationRangeResponse, intensityResponse, sampleDay, toMix } from '../src/data/schema';

// Shapes copied from real responses on 1 November 2026.
const generation = {
  data: {
    from: '2026-11-01T10:00Z',
    to: '2026-11-01T10:30Z',
    generationmix: [
      { fuel: 'biomass', perc: 10.2 },
      { fuel: 'coal', perc: 0 },
      { fuel: 'imports', perc: 17.7 },
      { fuel: 'gas', perc: 32.6 },
      { fuel: 'nuclear', perc: 15.6 },
      { fuel: 'other', perc: 0.9 },
      { fuel: 'hydro', perc: 2.1 },
      { fuel: 'solar', perc: 11.5 },
      { fuel: 'wind', perc: 9.5 },
    ],
  },
};
const intensity = {
  data: [{ from: '2026-11-01T10:00Z', to: '2026-11-01T10:30Z', intensity: { forecast: 173, actual: 165, index: 'moderate' } }],
};

describe('generation schema', () => {
  it('parses the current mix and turns times into epoch milliseconds', () => {
    const parsed = currentGenerationResponse.parse(generation);
    expect(parsed.data.from).toBe(Date.UTC(2026, 10, 1, 10, 0));
    expect(parsed.data.to).toBe(Date.UTC(2026, 10, 1, 10, 30));
    expect(parsed.data.generationmix).toHaveLength(9);
  });

  it('rejects a percentage sent as a string', () => {
    const bad = structuredClone(generation) as { data: { generationmix: { fuel: string; perc: unknown }[] } };
    const first = bad.data.generationmix[0];
    if (first) first.perc = '10.2';
    expect(currentGenerationResponse.safeParse(bad).success).toBe(false);
  });

  it('rejects impossible percentages and malformed times', () => {
    const over = structuredClone(generation);
    over.data.generationmix[0] = { fuel: 'wind', perc: 140 };
    expect(currentGenerationResponse.safeParse(over).success).toBe(false);

    const time = structuredClone(generation);
    time.data.from = '01/11/2026 10:00';
    expect(currentGenerationResponse.safeParse(time).success).toBe(false);
  });

  it('rejects a period that ends before it starts', () => {
    const backwards = structuredClone(generation);
    backwards.data.to = '2026-11-01T09:30Z';
    expect(currentGenerationResponse.safeParse(backwards).success).toBe(false);
  });

  it('rejects an error body in place of data', () => {
    expect(generationRangeResponse.safeParse({ error: { code: '400 Bad Request', message: 'Invalid range' } }).success).toBe(false);
  });
});

describe('intensity schema', () => {
  it('accepts a missing actual while a forecast exists', () => {
    const pending = structuredClone(intensity);
    (pending.data[0]?.intensity as { actual: number | null }).actual = null;
    expect(intensityResponse.parse(pending).data[0]?.intensity.actual).toBeNull();
  });

  it('rejects a period with neither actual nor forecast', () => {
    const empty = {
      data: [{ from: '2026-11-01T10:00Z', to: '2026-11-01T10:30Z', intensity: { forecast: null, actual: null, index: 'low' } }],
    };
    expect(intensityResponse.safeParse(empty).success).toBe(false);
  });

  it('rejects an unknown index word', () => {
    const odd = structuredClone(intensity);
    (odd.data[0]?.intensity as { index: string }).index = 'filthy';
    expect(intensityResponse.safeParse(odd).success).toBe(false);
  });
});

describe('toMix', () => {
  it('converts percentages to shares for every fuel', () => {
    const mix = toMix(generation.data.generationmix);
    expect(mix.gas).toBeCloseTo(0.326, 10);
    expect(mix.wind).toBeCloseTo(0.095, 10);
    expect(mix.coal).toBe(0);
    expect(Object.keys(mix)).toHaveLength(9);
  });

  it('counts a fuel the API adds later as other, so nothing goes missing', () => {
    const mix = toMix([
      { fuel: 'wind', perc: 50 },
      { fuel: 'storage', perc: 3 },
      { fuel: 'other', perc: 1 },
    ]);
    expect(mix.other).toBeCloseTo(0.04, 10);
    expect(mix.wind).toBe(0.5);
  });
});

describe('bundled sample', () => {
  it('is a real, complete day that passes the live schemas', () => {
    const parsed = sampleDay.parse(sample);
    expect(parsed.date).toBe('2026-10-28');
    expect(parsed.generation.data).toHaveLength(48);
    expect(parsed.intensity.data).toHaveLength(48);
    expect(parsed.generation.data[0]?.from).toBe(Date.UTC(2026, 9, 28, 0, 0));
  });
});
