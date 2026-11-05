import { describe, expect, it } from 'vitest';
import type { Mix } from '../src/data/schema';
import { clock, describeIntensity, describeMix, headline, longDay, percent, periodLabel, ranked, shortDay, zone } from '../src/ui/format';

// The live mix on Sunday 1 November 2026, 10:00–10:30 GMT.
const sunday: Mix = {
  biomass: 0.102,
  coal: 0,
  imports: 0.177,
  gas: 0.326,
  nuclear: 0.156,
  other: 0.009,
  hydro: 0.021,
  solar: 0.115,
  wind: 0.095,
};

describe('UK time labels', () => {
  it('prints GMT in winter and BST in summer', () => {
    expect(periodLabel({ start: Date.UTC(2026, 10, 1, 10, 0), end: Date.UTC(2026, 10, 1, 10, 30) })).toBe('10:00–10:30 GMT');
    expect(periodLabel({ start: Date.UTC(2026, 6, 1, 10, 0), end: Date.UTC(2026, 6, 1, 10, 30) })).toBe('11:00–11:30 BST');
    expect(zone(Date.UTC(2026, 6, 1))).toBe('BST');
  });

  it('names both zones for the half-hour the clocks change in', () => {
    // 25 October 2026: 02:00 BST becomes 01:00 GMT.
    expect(periodLabel({ start: Date.UTC(2026, 9, 25, 0, 30), end: Date.UTC(2026, 9, 25, 1, 0) })).toBe('01:30 BST–01:00 GMT');
    // 29 March 2026: 01:00 GMT becomes 02:00 BST.
    expect(periodLabel({ start: Date.UTC(2026, 2, 29, 0, 30), end: Date.UTC(2026, 2, 29, 1, 0) })).toBe('00:30 GMT–02:00 BST');
  });

  it('writes dates the British way', () => {
    expect(longDay(Date.UTC(2026, 9, 28, 12))).toBe('Wednesday 28 October 2026');
    expect(shortDay(Date.UTC(2026, 9, 28, 12))).toBe('Wed 28 Oct');
    expect(clock(Date.UTC(2026, 9, 28, 23, 30))).toBe('23:30');
  });
});

describe('percent', () => {
  it('rounds to whole numbers but never hides a sliver as 0%', () => {
    expect(percent(0.326)).toBe('33%');
    expect(percent(0.003)).toBe('<1%');
    expect(percent(0)).toBe('0%');
  });
});

describe('plain-words mix', () => {
  it('ranks fuels by share', () => {
    expect(ranked(sunday).slice(0, 3)).toEqual(['gas', 'imports', 'nuclear']);
  });

  it('reads the whole mix as one sentence, naming what is off', () => {
    expect(describeMix(sunday)).toBe(
      '33% gas, 18% imports, 16% nuclear, 12% solar, 10% biomass, 10% wind, 2% hydro and 1% other; no coal.',
    );
  });

  it('writes a headline from the largest sources and the mode', () => {
    expect(headline(sunday, 'dorian')).toBe('The grid is leaning on gas, so it plays in D Dorian, pensively.');
    const windy: Mix = { ...sunday, wind: 0.6, gas: 0.08 };
    expect(headline(windy, 'lydian')).toBe('The grid is running mostly on wind, so it plays in D Lydian, luminously.');
    const split: Mix = { ...sunday, wind: 0.3, gas: 0.32 };
    expect(headline(split, 'mixolydian')).toBe('The grid is running on gas and wind, so it plays in D Mixolydian, plainly.');
  });

  it('names the region when listening from one', () => {
    const windy: Mix = { ...sunday, wind: 0.943, gas: 0, solar: 0.057 };
    expect(headline(windy, 'lydian', 'North Scotland')).toBe(
      'In North Scotland the grid is running mostly on wind, so it plays in D Lydian, luminously.',
    );
    expect(describeIntensity({ intensity: 0, measured: false, index: 'very low' }, true)).toBe(
      '0 g of CO₂ per kWh, modelled (NESO estimates its regional figures); NESO rates that very low.',
    );
  });

  it('says whether intensity is measured or forecast', () => {
    expect(describeIntensity({ intensity: 165, measured: true, index: 'moderate' })).toBe(
      '165 g of CO₂ per kWh, measured; NESO rates that moderate.',
    );
    expect(describeIntensity({ intensity: 173, measured: false, index: 'high' })).toBe(
      '173 g of CO₂ per kWh, forecast (the measured figure is not out yet); NESO rates that high.',
    );
  });
});
