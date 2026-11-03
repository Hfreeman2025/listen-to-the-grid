/** Where to listen from: Great Britain as a whole, or one of NESO's regions. */
export interface Region {
  /** NESO region id; null for the national (GB) figures */
  id: number | null;
  slug: string;
  name: string;
}

export const GB: Region = { id: null, slug: 'gb', name: 'Great Britain' };

/** NESO's regions, as listed on the API's front page. */
export const REGIONS: readonly Region[] = [
  GB,
  { id: 16, slug: 'scotland', name: 'Scotland' },
  { id: 15, slug: 'england', name: 'England' },
  { id: 17, slug: 'wales', name: 'Wales' },
  { id: 1, slug: 'north-scotland', name: 'North Scotland' },
  { id: 2, slug: 'south-scotland', name: 'South Scotland' },
  { id: 3, slug: 'north-west-england', name: 'North West England' },
  { id: 4, slug: 'north-east-england', name: 'North East England' },
  { id: 5, slug: 'yorkshire', name: 'Yorkshire' },
  { id: 6, slug: 'north-wales-merseyside', name: 'North Wales and Merseyside' },
  { id: 7, slug: 'south-wales', name: 'South Wales' },
  { id: 8, slug: 'west-midlands', name: 'West Midlands' },
  { id: 9, slug: 'east-midlands', name: 'East Midlands' },
  { id: 10, slug: 'east-england', name: 'East England' },
  { id: 11, slug: 'south-west-england', name: 'South West England' },
  { id: 12, slug: 'south-england', name: 'South England' },
  { id: 13, slug: 'london', name: 'London' },
  { id: 14, slug: 'south-east-england', name: 'South East England' },
];

export function regionFromSlug(slug: string | null): Region {
  return REGIONS.find((r) => r.slug === slug) ?? GB;
}
