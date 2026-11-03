import type { Fuel, Mix } from '../data/schema';

/**
 * The ossia: an engraver's alternative passage, printed small above the
 * staff. Here it answers "what would this half-hour sound like on a fully
 * renewable grid?". It is a hypothetical, never a reading: every figure it
 * produces is labelled as such wherever it appears.
 */

/** The sources the ossia keeps: NESO counts all three as zero-carbon. */
export const RENEWABLES = ['wind', 'solar', 'hydro'] as const satisfies readonly Fuel[];
/** The sources the ossia silences, whatever their carbon: it asks about wind, sun and water alone. */
export const SILENCED = ['gas', 'coal', 'nuclear', 'biomass', 'imports', 'other'] as const satisfies readonly Fuel[];

/** NESO's intensity factors for wind, solar and hydro are all 0 g CO₂/kWh, so the ossia's grid is too. */
export const OSSIA_GRAMS = 0;

/**
 * When a half-hour had no wind, sun or water at all (a still night in some
 * regions), there are no real shares to scale up, so the ossia gives the
 * whole grid to wind: the one renewable that can run at any hour.
 */
export const FALLBACK: Readonly<Record<(typeof RENEWABLES)[number], number>> = { wind: 1, solar: 0, hydro: 0 };

/**
 * A fully renewable version of a mix: gas, coal, nuclear, biomass, imports
 * and other set to zero, and their share handed to wind, solar and hydro in
 * proportion to each one's real share. The result always sums to 1.
 */
export function renewableMix(mix: Mix): Mix {
  const out: Mix = { solar: 0, wind: 0, hydro: 0, biomass: 0, imports: 0, nuclear: 0, other: 0, coal: 0, gas: 0 };
  const total = RENEWABLES.reduce((sum, f) => sum + Math.max(0, mix[f]), 0);
  for (const f of RENEWABLES) out[f] = total > 0 ? Math.max(0, mix[f]) / total : FALLBACK[f];
  return out;
}

/** The ossia of a moment of the grid: its renewable mix and its intensity. */
export function ossiaOf(g: { mix: Mix; grams: number }): { mix: Mix; grams: number } {
  return { mix: renewableMix(g.mix), grams: OSSIA_GRAMS };
}

/** True when a mix had no wind, sun or water, so the ossia used the fallback. */
export function usesFallback(mix: Mix): boolean {
  return RENEWABLES.every((f) => mix[f] <= 0);
}
