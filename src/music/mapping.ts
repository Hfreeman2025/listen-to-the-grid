import type { Fuel, Mix } from '../data/schema';
import { brightness, modeForIntensity } from './harmony';
import type { Mode } from './theory';

/**
 * Everything the audio engine and the conductor need to know about the grid,
 * as plain numbers. Amplitudes are 0..1 before each voice's own balance trim;
 * densities are probabilities per rhythmic slot.
 */
export interface Arrangement {
  mode: Mode;
  /** 1 = clean and open, 0 = dirty and closed */
  brightness: number;
  /** master tone: low-pass cutoff in Hz */
  toneHz: number;
  /** share of the signal sent to the reverb */
  space: number;
  shares: Mix;
  gas: { amp: number; cutoffHz: number; detuneCents: number };
  wind: { amp: number; cutoffHz: number; movement: number; width: number };
  solar: { amp: number; density: number };
  nuclear: { amp: number };
  hydro: { amp: number; dropDensity: number };
  biomass: { amp: number; density: number };
  imports: { amp: number; density: number };
  coal: { amp: number; drive: number };
  other: { amp: number; density: number };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round = (x: number, places = 4): number => Number(x.toFixed(places));

/**
 * Loudness follows share: amplitude is the square root of the share, so a
 * fuel supplying a quarter of the grid plays at half amplitude (-6 dB) and one
 * supplying 1% sits 20 dB down. Nothing generating means silence.
 */
export function shareToAmp(share: number): number {
  return share <= 0 ? 0 : round(Math.sqrt(clamp01(share)));
}

/** How busy a voice is: 0 at no share, 1 once the share reaches `full`. */
export function density(share: number, full: number): number {
  return share <= 0 ? 0 : round(clamp01(share / full));
}

export function arrange(mix: Mix, grams: number, currentMode?: Mode): Arrangement {
  const b = brightness(grams);
  const tension = 1 - b;
  const s = (f: Fuel): number => Math.max(0, mix[f]);
  const windFull = density(s('wind'), 0.6);

  return {
    mode: modeForIntensity(grams, currentMode),
    brightness: round(b),
    toneHz: Math.round(2400 + 15600 * b ** 1.5),
    space: round(0.22 + 0.18 * b),
    shares: { ...mix },
    gas: {
      amp: shareToAmp(s('gas')),
      cutoffHz: Math.round((150 + 520 * Math.sqrt(s('gas'))) * (0.75 + 0.5 * b)),
      detuneCents: round(3 + 12 * tension, 2),
    },
    wind: {
      amp: shareToAmp(s('wind')),
      cutoffHz: Math.round((400 + 2400 * windFull) * (0.55 + 0.75 * b)),
      movement: round(0.2 + 0.8 * windFull),
      width: round(0.25 + 0.65 * windFull),
    },
    solar: {
      amp: shareToAmp(s('solar')),
      density: round(0.85 * density(s('solar'), 0.2) ** 0.8),
    },
    nuclear: { amp: shareToAmp(s('nuclear')) },
    hydro: {
      amp: shareToAmp(s('hydro')),
      dropDensity: round(0.6 * density(s('hydro'), 0.08)),
    },
    biomass: {
      amp: shareToAmp(s('biomass')),
      density: s('biomass') > 0 ? round(0.35 + 0.65 * density(s('biomass'), 0.15)) : 0,
    },
    imports: {
      amp: shareToAmp(s('imports')),
      density: density(s('imports'), 0.15),
    },
    coal: { amp: shareToAmp(s('coal')), drive: density(s('coal'), 0.2) },
    other: { amp: shareToAmp(s('other')), density: round(0.5 * density(s('other'), 0.05)) },
  };
}

/** Dynamic marking for a share, as printed next to each voice in the score. */
export function dynamicFor(share: number): string {
  if (share <= 0) return 'tacet';
  if (share < 0.02) return 'ppp';
  if (share < 0.05) return 'pp';
  if (share < 0.1) return 'p';
  if (share < 0.18) return 'mp';
  if (share < 0.28) return 'mf';
  if (share < 0.42) return 'f';
  return 'ff';
}
