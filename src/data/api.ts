import { z } from 'zod';
import { GB, type Region } from './regions';
import {
  currentGenerationResponse,
  generationRangeResponse,
  intensityResponse,
  regionalCurrentResponse,
  regionalRangeResponse,
  sampleDay,
  type SampleDay,
} from './schema';
import sampleJson from './sample-day.json';
import { mergeSeries, regionalSeries, type GridPeriod } from './series';
import { HALF_HOUR, HOUR, MINUTE, apiTimestamp, halfHourFloor, londonDay, type Span } from './time';

export const API_BASE = 'https://api.carbonintensity.org.uk';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'schema';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A short, plain-English reason for a failed request, for the page to show. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'timeout':
        return 'the request timed out';
      case 'network':
        return 'no network connection';
      case 'http':
        return err.message.replace(/^.*: /, 'the API answered ');
      case 'schema':
        return 'the API sent something unexpected';
    }
  }
  return 'an unexpected error';
}

async function getJson<S extends z.ZodType>(path: string, schema: S, timeoutMs = 10_000): Promise<z.output<S>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch (err) {
    throw controller.signal.aborted
      ? new ApiError('timeout', `${path} took longer than ${timeoutMs / 1000}s`)
      : new ApiError('network', `${path}: ${err instanceof Error ? err.message : 'request failed'}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError('http', `${path}: HTTP ${res.status}`);
  const body: unknown = await res.json().catch(() => {
    throw new ApiError('schema', `${path}: response was not JSON`);
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('schema', `${path}: unexpected response (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return parsed.data;
}

/**
 * The latest half-hour: the last completed one, which is what the "current"
 * endpoints return, nationally and per region. Regional rows carry only
 * NESO's modelled (forecast) intensity.
 */
export async function fetchCurrent(region: Region = GB): Promise<GridPeriod> {
  if (region.id !== null) {
    const res = await getJson(`/regional/regionid/${region.id}`, regionalCurrentResponse);
    const period = regionalSeries(res.data[0]?.data ?? []).at(-1);
    if (!period) throw new ApiError('schema', `no current data for ${region.name}`);
    return period;
  }
  const [gen, int] = await Promise.all([getJson('/generation', currentGenerationResponse), getJson('/intensity', intensityResponse)]);
  const [period] = mergeSeries([gen.data], int.data);
  if (!period) throw new ApiError('schema', 'current generation and intensity are for different half-hours');
  return period;
}

const cacheKey = (region: Region): string => `listen-to-the-grid:history:v2:${region.slug}`;
const CACHE_TTL = 25 * MINUTE;

/** Only the envelope is checked here; the payloads go through the API schemas. */
const cachedHistory = z.object({
  savedAt: z.number(),
  generation: z.unknown(),
  intensity: z.unknown(),
});
type CachedHistory = z.infer<typeof cachedHistory>;

function readCache(region: Region, now: number): CachedHistory | null {
  try {
    const raw = localStorage.getItem(cacheKey(region));
    if (!raw) return null;
    const cached = cachedHistory.safeParse(JSON.parse(raw));
    if (!cached.success || now - cached.data.savedAt > CACHE_TTL || cached.data.savedAt > now) return null;
    return cached.data;
  } catch {
    return null; // storage blocked or corrupt JSON: just ask the API
  }
}

function writeCache(region: Region, entry: CachedHistory): void {
  try {
    localStorage.setItem(cacheKey(region), JSON.stringify(entry));
  } catch {
    // Private mode or full storage: caching is a courtesy, not a requirement.
  }
}

/**
 * The last seven days, half-hour by half-hour. Kept in localStorage for 25
 * minutes so reloading the page does not hit the API again; cached copies are
 * re-validated with the same schemas as fresh ones.
 */
export async function fetchHistory(now: number, region: Region = GB, days = 7): Promise<GridPeriod[]> {
  const to = halfHourFloor(now) + HALF_HOUR;
  const from = to - days * 24 * HOUR;
  const keep = (p: GridPeriod): boolean => p.start >= from;
  const cached = readCache(region, now);
  // The API returns the periods whose end falls in [from, to].
  const range = `${apiTimestamp(from)}/${apiTimestamp(to)}`;

  if (region.id !== null) {
    if (cached) {
      const hit = regionalRangeResponse.safeParse(cached.generation);
      if (hit.success) return regionalSeries(hit.data.data.data).filter(keep);
    }
    const res = await getJson(`/regional/intensity/${range}/regionid/${region.id}`, regionalRangeResponse);
    writeCache(region, { savedAt: now, generation: { data: { ...res.data, data: res.data.data.map(wireRow) } }, intensity: null });
    return regionalSeries(res.data.data).filter(keep);
  }

  if (cached) {
    const gen = generationRangeResponse.safeParse(cached.generation);
    const int = intensityResponse.safeParse(cached.intensity);
    if (gen.success && int.success) return mergeSeries(gen.data.data, int.data.data).filter(keep);
  }
  const [genRaw, intRaw] = await Promise.all([
    getJson(`/generation/${range}`, generationRangeResponse),
    getJson(`/intensity/${range}`, intensityResponse),
  ]);
  writeCache(region, { savedAt: now, generation: toWire(genRaw), intensity: toWire(intRaw) });
  return mergeSeries(genRaw.data, intRaw.data).filter(keep);
}

const wireRow = <T extends { from: number; to: number }>(row: T): Omit<T, 'from' | 'to'> & { from: string; to: string } => ({
  ...row,
  from: apiTimestamp(row.from),
  to: apiTimestamp(row.to),
});

/** Parsed rows hold epoch numbers; write them back in the API's own format so the cache re-parses. */
function toWire(parsed: { data: { from: number; to: number }[] }): unknown {
  return { data: parsed.data.map(wireRow) };
}

/** The first UK day with every half-hour of generation data. */
export const FIRST_DAY = '2018-05-12';

export interface Day {
  span: Span;
  series: GridPeriod[];
  /** half-hours the day should have (46, 48 or 50) */
  expected: number;
}

const days = new Map<string, Promise<Day>>();

/**
 * One whole UK calendar day, by its ISO date: two requests nationally, one
 * for a region. Asked once per page visit; a failure is forgotten so the
 * listener can try again.
 */
export function fetchDay(isoDate: string, region: Region = GB): Promise<Day> {
  const key = `${region.slug}:${isoDate}`;
  const hit = days.get(key);
  if (hit) return hit;
  const job = loadDay(isoDate, region);
  days.set(key, job);
  job.catch(() => days.delete(key));
  return job;
}

async function loadDay(isoDate: string, region: Region): Promise<Day> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new ApiError('schema', `not a date: ${isoDate}`);
  const [y, m, d] = isoDate.split('-').map(Number);
  const span = londonDay(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 12));
  const range = `${apiTimestamp(span.start)}/${apiTimestamp(span.end)}`;
  const inDay = (p: GridPeriod): boolean => p.start >= span.start && p.start < span.end;
  let series: GridPeriod[];
  if (region.id !== null) {
    const res = await getJson(`/regional/intensity/${range}/regionid/${region.id}`, regionalRangeResponse);
    series = regionalSeries(res.data.data).filter(inDay);
  } else {
    const [gen, int] = await Promise.all([getJson(`/generation/${range}`, generationRangeResponse), getJson(`/intensity/${range}`, intensityResponse)]);
    series = mergeSeries(gen.data, int.data).filter(inDay);
  }
  if (series.length === 0) throw new ApiError('schema', 'NESO has no figures for that day');
  return { span, series, expected: Math.round((span.end - span.start) / HALF_HOUR) };
}

export interface Sample {
  date: string;
  series: GridPeriod[];
  raw: SampleDay;
}

/** The bundled recording, validated like any API response. */
export function loadSample(): Sample {
  const raw = sampleDay.parse(sampleJson);
  return { date: raw.date, series: mergeSeries(raw.generation.data, raw.intensity.data), raw };
}
