import { z } from 'zod';

// Interpret schemas rather than compiling them: no eval, so the page's
// Content-Security-Policy can forbid it.
z.config({ jitless: true });

/**
 * Fuels in score order: highest voice at the top of the page, bass at the
 * bottom, the way an orchestral score is laid out.
 */
export const FUELS = ['solar', 'wind', 'hydro', 'biomass', 'imports', 'nuclear', 'other', 'coal', 'gas'] as const;
export type Fuel = (typeof FUELS)[number];

/** Generation shares as fractions of 1 (the API reports percentages). */
export type Mix = Record<Fuel, number>;

function isFuel(s: string): s is Fuel {
  return (FUELS as readonly string[]).includes(s);
}

/**
 * The API writes times as `2026-11-01T10:00Z` (no seconds). Accept that and the
 * longer ISO forms, always in UTC, and turn them into epoch milliseconds.
 */
const apiTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/, 'expected a UTC timestamp like 2026-11-01T10:00Z')
  .transform((s, ctx) => {
    const t = Date.parse(s);
    if (Number.isNaN(t)) {
      ctx.addIssue({ code: 'custom', message: `unparseable time ${s}` });
      return z.NEVER;
    }
    return t;
  });

const mixEntry = z.object({
  fuel: z.string().min(1),
  perc: z.number().min(0).max(100),
});

const generationPeriod = z
  .object({
    from: apiTime,
    to: apiTime,
    generationmix: z.array(mixEntry).min(1),
  })
  .refine((p) => p.to > p.from, 'period ends before it starts');

const intensityIndex = z.enum(['very low', 'low', 'moderate', 'high', 'very high']);
export type IntensityIndex = z.infer<typeof intensityIndex>;

const intensityPeriod = z
  .object({
    from: apiTime,
    to: apiTime,
    intensity: z.object({
      forecast: z.number().min(0).max(2000).nullable(),
      actual: z.number().min(0).max(2000).nullable(),
      index: intensityIndex,
    }),
  })
  .refine((p) => p.to > p.from, 'period ends before it starts')
  .refine((p) => p.intensity.actual !== null || p.intensity.forecast !== null, 'no intensity value');

/** GET /generation */
export const currentGenerationResponse = z.object({ data: generationPeriod });
/** GET /generation/{from}/{to} */
export const generationRangeResponse = z.object({ data: z.array(generationPeriod) });
/** GET /intensity and GET /intensity/{from}/{to} */
export const intensityResponse = z.object({ data: z.array(intensityPeriod) });

export type GenerationPeriod = z.infer<typeof generationPeriod>;
export type IntensityPeriod = z.infer<typeof intensityPeriod>;

/**
 * Regional rows carry the mix and a forecast intensity: NESO models regional
 * figures rather than measuring them, so there is no `actual`.
 */
const regionalPeriod = z
  .object({
    from: apiTime,
    to: apiTime,
    intensity: z.object({ forecast: z.number().min(0).max(2000), index: intensityIndex }),
    generationmix: z.array(mixEntry).min(1),
  })
  .refine((p) => p.to > p.from, 'period ends before it starts');

const regionBlock = z.object({
  regionid: z.number().int().positive(),
  shortname: z.string(),
  data: z.array(regionalPeriod),
});

/** GET /regional/regionid/{id} */
export const regionalCurrentResponse = z.object({ data: z.array(regionBlock).length(1) });
/** GET /regional/intensity/{from}/{to}/regionid/{id} */
export const regionalRangeResponse = z.object({ data: regionBlock });

export type RegionalPeriod = z.infer<typeof regionalPeriod>;

/** The bundled offline recording (see scripts/record-sample.mjs). */
export const sampleDay = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recordedAt: z.string(),
  source: z.string(),
  generation: generationRangeResponse,
  intensity: intensityResponse,
});
export type SampleDay = z.infer<typeof sampleDay>;

/**
 * Turns the API's list of `{fuel, perc}` into a share for every fuel we voice.
 * A fuel the API adds in future is counted as "other" rather than dropped, so
 * the shares still describe the whole grid.
 */
export function toMix(entries: readonly { fuel: string; perc: number }[]): Mix {
  const mix: Mix = {
    solar: 0,
    wind: 0,
    hydro: 0,
    biomass: 0,
    imports: 0,
    nuclear: 0,
    other: 0,
    coal: 0,
    gas: 0,
  };
  for (const { fuel, perc } of entries) {
    const key = fuel.toLowerCase();
    const target: Fuel = isFuel(key) ? key : 'other';
    mix[target] += perc / 100;
  }
  return mix;
}
