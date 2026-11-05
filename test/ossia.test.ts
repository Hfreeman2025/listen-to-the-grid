import { describe, expect, it } from 'vitest';
import { FUELS, type Mix } from '../src/data/schema';
import { arrange } from '../src/music/mapping';
import { FALLBACK, OSSIA_GRAMS, ossiaOf, renewableMix, SILENCED, usesFallback } from '../src/music/ossia';

const mix = (over: Partial<Mix>): Mix => ({
  solar: 0,
  wind: 0,
  hydro: 0,
  biomass: 0,
  imports: 0,
  nuclear: 0,
  other: 0,
  coal: 0,
  gas: 0,
  ...over,
});
const sum = (m: Mix): number => FUELS.reduce((s, f) => s + m[f], 0);

// A real-looking autumn evening: 31% wind, 2% hydro, no sun, the rest fossil, nuclear and imports.
const evening = mix({ wind: 0.31, hydro: 0.02, gas: 0.38, nuclear: 0.13, biomass: 0.06, imports: 0.09, other: 0.01 });

describe('renewableMix', () => {
  it('sums to 1', () => {
    expect(sum(renewableMix(evening))).toBeCloseTo(1, 12);
    expect(sum(renewableMix(mix({ solar: 0.2, wind: 0.05, gas: 0.75 })))).toBeCloseTo(1, 12);
    // even when NESO's own shares don't quite add up
    expect(sum(renewableMix(mix({ wind: 0.4, solar: 0.1, gas: 0.45 })))).toBeCloseTo(1, 12);
  });

  it('zeroes gas, coal, nuclear, biomass, imports and other', () => {
    const o = renewableMix(
      mix({ wind: 0.2, solar: 0.1, hydro: 0.02, gas: 0.3, coal: 0.01, nuclear: 0.15, biomass: 0.08, imports: 0.1, other: 0.04 }),
    );
    for (const f of SILENCED) expect(o[f]).toBe(0);
  });

  it('shares the freed generation in proportion to each renewable’s real share', () => {
    const o = renewableMix(evening);
    expect(o.wind).toBeCloseTo(0.31 / 0.33, 12);
    expect(o.hydro).toBeCloseTo(0.02 / 0.33, 12);
    expect(o.solar).toBe(0);
    // the ratio between them is kept exactly
    const sunny = renewableMix(mix({ wind: 0.1, solar: 0.3, hydro: 0.05, gas: 0.55 }));
    expect(sunny.solar / sunny.wind).toBeCloseTo(3, 12);
    expect(sunny.wind / sunny.hydro).toBeCloseTo(2, 12);
  });

  it('leaves an already renewable mix as it was', () => {
    const green = mix({ wind: 0.7, solar: 0.2, hydro: 0.1 });
    const o = renewableMix(green);
    for (const f of FUELS) expect(o[f]).toBeCloseTo(green[f], 12);
  });

  it('falls back to all wind when there was no wind, sun or water at all', () => {
    const still = mix({ gas: 0.6, nuclear: 0.3, imports: 0.1 });
    expect(usesFallback(still)).toBe(true);
    expect(usesFallback(evening)).toBe(false);
    const o = renewableMix(still);
    expect({ wind: o.wind, solar: o.solar, hydro: o.hydro }).toEqual(FALLBACK);
    expect(sum(o)).toBe(1);
  });
});

describe('ossiaOf', () => {
  it('runs at 0 g, so the key ladder lands on D Lydian, luminoso', () => {
    const o = ossiaOf({ mix: evening, grams: 231 });
    expect(o.grams).toBe(OSSIA_GRAMS);
    expect(o.grams).toBe(0);
    expect(arrange(o.mix, o.grams).mode).toBe('lydian');
    // whatever key the real grid was in, hysteresis included
    expect(arrange(o.mix, o.grams, 'phrygian').mode).toBe('lydian');
  });
});

describe('keyRule', () => {
  it('states the key ladder in one plain sentence, with its thresholds', async () => {
    const { keyRule } = await import('../src/ui/notes');
    expect(keyRule()).toBe(
      'The cleaner the grid, the brighter the key: D Lydian below 60 g CO₂/kWh, D major from 60 g, D Mixolydian from 110 g, D Dorian from 150 g, D minor from 190 g and D Phrygian from 240 g.',
    );
  });
});
