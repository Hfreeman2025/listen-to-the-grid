/** Time helpers. All instants are epoch milliseconds; the grid runs on UK time. */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const HALF_HOUR = 30 * MINUTE;

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function londonParts(t: number): LondonParts {
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = partsFormat.formatToParts(t).find((p) => p.type === type);
    if (!part) throw new Error(`no ${type} in London time for ${t}`);
    return Number(part.value);
  };
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/**
 * The instant of 00:00 in London on the calendar day that contains `t`.
 * UK clocks change at 01:00 UTC, so local midnight always exists and is either
 * 00:00 UTC (GMT) or 23:00 UTC the evening before (BST).
 */
export function londonDayStart(t: number): number {
  const { year, month, day } = londonParts(t);
  for (const offsetHours of [0, 1]) {
    const candidate = Date.UTC(year, month - 1, day) - offsetHours * HOUR;
    const p = londonParts(candidate);
    if (p.year === year && p.month === month && p.day === day && p.hour === 0 && p.minute === 0) {
      return candidate;
    }
  }
  throw new Error(`no London midnight found for ${new Date(t).toISOString()}`);
}

export interface Span {
  start: number;
  end: number;
}

/** The London calendar day containing `t`: 23, 24 or 25 hours long. */
export function londonDay(t: number): Span {
  const start = londonDayStart(t);
  // 26 hours on always lands inside the next day, whatever the clocks did.
  return { start, end: londonDayStart(start + 26 * HOUR) };
}

/** Yesterday in London, relative to `now`. */
export function londonYesterday(now: number): Span {
  return londonDay(londonDayStart(now) - 1);
}

/** Start of the half-hour settlement period containing `t`. */
export function halfHourFloor(t: number): number {
  return Math.floor(t / HALF_HOUR) * HALF_HOUR;
}

/** The API's own timestamp format, e.g. `2026-11-01T10:00Z`. */
export function apiTimestamp(t: number): string {
  return new Date(t).toISOString().slice(0, 16) + 'Z';
}

/**
 * The API's "current" endpoints, national and regional alike, return the
 * most recent *completed* half-hour, a few minutes after it ends.
 */
function expectedLatest(now: number): number {
  return halfHourFloor(now) - HALF_HOUR;
}

/**
 * When to ask the API again: once we hold the newest period it should have,
 * wait for the next half-hour boundary plus a margin; if we are behind, check
 * back in five minutes.
 */
export function nextPollDelay(now: number, latestPeriodStart: number): number {
  const margin = 4 * MINUTE;
  if (latestPeriodStart < expectedLatest(now)) return 5 * MINUTE;
  return halfHourFloor(now) + HALF_HOUR + margin - now;
}

/**
 * Whether what we hold still counts as live: the newest completed half-hour,
 * or the one before it while the next is being published (allowing a quarter
 * of an hour for that).
 */
export function isFresh(now: number, latestPeriodStart: number): boolean {
  return latestPeriodStart >= expectedLatest(now - 15 * MINUTE);
}

/** When the half-hour after `latest` should be published. */
export function nextExpected(latest: { end: number }): number {
  return latest.end + HALF_HOUR;
}
