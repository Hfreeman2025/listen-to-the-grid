import { describe, expect, it } from 'vitest';
import type { Mix } from '../src/data/schema';
import { brightness, chordForBar, modeForIntensity } from '../src/music/harmony';
import { arrange, density, dynamicFor, shareToAmp } from '../src/music/mapping';

// Two real half-hours from the bundled sample, Wednesday 28 October 2026.
const noon: Mix = {
  biomass: 0.082,
  coal: 0,
  imports: 0.122,
  gas: 0.121,
  nuclear: 0.133,
  other: 0.013,
  hydro: 0.026,
  solar: 0.116,
  wind: 0.387,
};
const evening: Mix = {
  biomass: 0.078,
  coal: 0,
  imports: 0.042,
  gas: 0.408,
  nuclear: 0.127,
  other: 0.076,
  hydro: 0.049,
  solar: 0,
  wind: 0.22,
};

describe('shareToAmp', () => {
  it('plays a quarter share at half amplitude and silences nothing', () => {
    expect(shareToAmp(0.25)).toBe(0.5);
    expect(shareToAmp(0.01)).toBe(0.1);
    expect(shareToAmp(1)).toBe(1);
    expect(shareToAmp(0)).toBe(0);
    expect(shareToAmp(-0.1)).toBe(0);
  });
});

describe('density', () => {
  it('scales with share up to a ceiling', () => {
    expect(density(0.1, 0.2)).toBe(0.5);
    expect(density(0.3, 0.2)).toBe(1);
    expect(density(0, 0.2)).toBe(0);
  });
});

describe('modeForIntensity', () => {
  it('climbs from Lydian to Phrygian as the grid gets dirtier', () => {
    expect(modeForIntensity(30)).toBe('lydian');
    expect(modeForIntensity(74)).toBe('ionian');
    expect(modeForIntensity(113)).toBe('mixolydian');
    expect(modeForIntensity(165)).toBe('dorian');
    expect(modeForIntensity(194)).toBe('aeolian');
    expect(modeForIntensity(260)).toBe('phrygian');
  });

  it('holds the current mode within 5 g of a threshold', () => {
    expect(modeForIntensity(194, 'dorian')).toBe('dorian');
    expect(modeForIntensity(195, 'dorian')).toBe('aeolian');
    expect(modeForIntensity(146, 'dorian')).toBe('dorian');
    expect(modeForIntensity(144, 'dorian')).toBe('mixolydian');
    expect(modeForIntensity(20, 'phrygian')).toBe('lydian');
  });
});

describe('brightness', () => {
  it('is 1 at 40 g and below, 0 at 260 g and above', () => {
    expect(brightness(40)).toBe(1);
    expect(brightness(150)).toBe(0.5);
    expect(brightness(260)).toBe(0);
    expect(brightness(500)).toBe(0);
  });
});

describe('chordForBar', () => {
  it('moves one chord a bar through an eight-bar phrase that comes home to D', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((bar) => chordForBar('dorian', bar, 0.3).degree)).toEqual([0, 3, 0, 6, 0, 3, 6, 0, 0]);
  });

  it('ends every phrase on the tonic and half-way through on something else', () => {
    for (const mode of ['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian'] as const) {
      expect(chordForBar(mode, 7, 0.5).degree).toBe(0);
      expect(chordForBar(mode, 3, 0.5).degree).not.toBe(0);
    }
  });

  it('voices clean grids as add9 and dirty ones as sevenths', () => {
    expect(chordForBar('ionian', 0, 0.8).pitchClasses).toEqual([2, 6, 9, 4]);
    expect(chordForBar('aeolian', 0, 0.2).pitchClasses).toEqual([2, 5, 9, 0]);
  });
});

describe('arrange: a windy, sunny noon at 74 g', () => {
  const a = arrange(noon, 74);
  it('plays bright and open in D major', () => {
    expect(a.mode).toBe('ionian');
    expect(a.brightness).toBe(0.8455);
    expect(a.toneHz).toBe(14527);
    expect(a.space).toBe(0.3722);
  });
  it('gives wind a big, moving pad', () => {
    expect(a.wind.amp).toBe(0.6221);
    expect(a.wind.cutoffHz).toBe(2307);
    expect(a.wind.movement).toBe(0.716);
  });
  it('rings plenty of solar bells', () => {
    expect(a.solar.amp).toBe(0.3406);
    expect(a.solar.density).toBe(0.5497);
  });
  it('keeps gas low and nearly in tune', () => {
    expect(a.gas.amp).toBe(0.3479);
    expect(a.gas.cutoffHz).toBe(388);
    expect(a.gas.detuneCents).toBe(4.85);
  });
});

describe('arrange: a calm evening peak at 194 g', () => {
  const a = arrange(evening, 194);
  it('turns minor and darker', () => {
    expect(a.mode).toBe('aeolian');
    expect(a.brightness).toBe(0.3);
    expect(a.toneHz).toBe(4963);
  });
  it('silences the bells after dark', () => {
    expect(a.solar.amp).toBe(0);
    expect(a.solar.density).toBe(0);
  });
  it('lets the gas drone fill in, wider and more beating', () => {
    expect(a.gas.amp).toBe(0.6387);
    expect(a.gas.cutoffHz).toBe(434);
    expect(a.gas.detuneCents).toBe(11.4);
  });
  it('stays Dorian if that was already playing', () => {
    expect(arrange(evening, 194, 'dorian').mode).toBe('dorian');
  });
});

describe('dynamicFor', () => {
  it('prints a dynamic for each share, and tacet for silence', () => {
    expect(['gas', 'wind', 'nuclear', 'biomass', 'hydro', 'solar'].map((f) => dynamicFor(evening[f as keyof Mix]))).toEqual([
      'f',
      'mf',
      'mp',
      'p',
      'pp',
      'tacet',
    ]);
    expect(dynamicFor(0.5)).toBe('ff');
    expect(dynamicFor(0.01)).toBe('ppp');
  });
});
