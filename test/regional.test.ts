import { describe, expect, it } from 'vitest';
import { regionalCurrentResponse, regionalRangeResponse } from '../src/data/schema';
import { regionalSeries } from '../src/data/series';
import { GB, REGIONS, regionFromSlug } from '../src/data/regions';

// Shapes copied from real responses on 1 November 2026.
const southWales = {
  data: [
    {
      regionid: 7,
      dnoregion: 'WPD South Wales',
      shortname: 'South Wales',
      data: [
        {
          from: '2026-11-01T11:00Z',
          to: '2026-11-01T11:30Z',
          intensity: { forecast: 332, index: 'very high' },
          generationmix: [
            { fuel: 'biomass', perc: 0 },
            { fuel: 'coal', perc: 0 },
            { fuel: 'imports', perc: 0 },
            { fuel: 'gas', perc: 84.3 },
            { fuel: 'nuclear', perc: 0 },
            { fuel: 'other', perc: 0 },
            { fuel: 'hydro', perc: 0 },
            { fuel: 'solar', perc: 12.9 },
            { fuel: 'wind', perc: 2.8 },
          ],
        },
      ],
    },
  ],
};

const northScotlandWeek = {
  data: {
    regionid: 1,
    dnoregion: 'Scottish Hydro Electric Power Distribution',
    shortname: 'North Scotland',
    data: [
      {
        from: '2026-11-01T11:30Z',
        to: '2026-11-01T12:00Z',
        intensity: { forecast: 0, index: 'very low' },
        generationmix: [
          { fuel: 'solar', perc: 5.7 },
          { fuel: 'wind', perc: 94.3 },
        ],
      },
      {
        from: '2026-11-01T11:00Z',
        to: '2026-11-01T11:30Z',
        intensity: { forecast: 2, index: 'very low' },
        generationmix: [
          { fuel: 'solar', perc: 5.1 },
          { fuel: 'wind', perc: 94.9 },
        ],
      },
    ],
  },
};

describe('regional schemas', () => {
  it('parses the current forecast for one region', () => {
    const parsed = regionalCurrentResponse.parse(southWales);
    expect(parsed.data[0]?.data[0]?.intensity.forecast).toBe(332);
    expect(parsed.data[0]?.data[0]?.from).toBe(Date.UTC(2026, 10, 1, 11, 0));
  });

  it('rejects a response holding more than the one region asked for', () => {
    const two = { data: [southWales.data[0], southWales.data[0]] };
    expect(regionalCurrentResponse.safeParse(two).success).toBe(false);
  });

  it('rejects a regional row without a forecast', () => {
    const missing = structuredClone(southWales);
    const row = missing.data[0]?.data[0] as { intensity: Record<string, unknown> } | undefined;
    if (row) delete row.intensity.forecast;
    expect(regionalCurrentResponse.safeParse(missing).success).toBe(false);
  });
});

describe('regionalSeries', () => {
  it('sorts rows and marks every intensity as a forecast', () => {
    const series = regionalSeries(regionalRangeResponse.parse(northScotlandWeek).data.data);
    expect(series.map((p) => p.start)).toEqual([Date.UTC(2026, 10, 1, 11, 0), Date.UTC(2026, 10, 1, 11, 30)]);
    expect(series.every((p) => !p.measured)).toBe(true);
    expect(series[1]?.mix.wind).toBeCloseTo(0.943, 10);
    expect(series[0]?.intensity).toBe(2);
  });
});

describe('regions', () => {
  it('lists Great Britain and all seventeen NESO regions once each', () => {
    expect(REGIONS).toHaveLength(18);
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(18);
    expect(new Set(REGIONS.map((r) => r.slug)).size).toBe(18);
  });

  it('reads a region from a link, falling back to Great Britain', () => {
    expect(regionFromSlug('north-scotland').id).toBe(1);
    expect(regionFromSlug('atlantis')).toBe(GB);
    expect(regionFromSlug(null)).toBe(GB);
  });
});
