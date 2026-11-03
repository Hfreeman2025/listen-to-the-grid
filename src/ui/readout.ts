import type { Region } from '../data/regions';
import type { GridPeriod } from '../data/series';
import { nextExpected } from '../data/time';
import { clock, longDay, periodLabel, shortDay, zone } from './format';

/** Everything that decides how the page describes what is playing. */
export interface ReadoutState {
  period: Pick<GridPeriod, 'start' | 'end'>;
  source:
    | { kind: 'sample'; reason: string }
    | { kind: 'live'; region: Region; fresh: boolean; failedSince: number | null; checkedAt: number };
  playback: 'live' | 'replay-playing' | 'replay-held';
}

export interface Readout {
  /** the masthead status line, a polite live region */
  statusHtml: string;
  offline: boolean;
  /** the longer note under the plain-words reading */
  whenHtml: string;
  /** the date line under the composer credit */
  whenShort: string;
  /** how the programme notes describe the shares: "right now", "in the recorded sample" … */
  sharesLabel: string;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const mark = '<span class="live-mark"></span>';

/**
 * The page's honesty rules in one place: a recording is never called live,
 * stale data says how stale, regional figures say they are modelled, and a
 * replay names the day it is replaying.
 */
export function describeState({ period: p, source: s, playback }: ReadoutState): Readout {
  const label = esc(periodLabel(p));
  const day = esc(longDay(p.start));
  if (s.kind === 'sample') {
    return {
      statusHtml: `${mark}<strong>Offline.</strong> Playing a recorded sample: ${day}.`,
      offline: true,
      whenHtml: `<strong>Recorded sample: ${day}</strong>, half-hour ${label}. NESO couldn’t be reached (${esc(s.reason)}), so nothing here is live. The page will keep trying every few minutes.`,
      whenShort: `Recorded sample, ${shortDay(p.start)}, ${clock(p.start)} ${zone(p.start)}`,
      sharesLabel: 'in the recorded sample',
    };
  }
  const regional = s.region.id !== null;
  const name = esc(s.region.name);
  if (playback !== 'live') {
    const record = regional ? `NESO’s modelled estimates for ${name}` : 'NESO’s published record';
    return {
      // While a replay plays, name only the day, so screen readers are not
      // interrupted every 1.25 seconds.
      statusHtml: playback === 'replay-playing' ? `<strong>Replaying</strong> ${day}` : `<strong>Replaying</strong> ${esc(shortDay(p.start))}, ${label}`,
      offline: false,
      whenHtml: `<strong>Replaying ${day}</strong>, half-hour ${label}, from ${record}.${playback === 'replay-playing' ? ' One day of data a minute.' : ''}`,
      whenShort: `${shortDay(p.start)}, ${clock(p.start)} ${zone(p.start)} (replay)`,
      sharesLabel: `at ${clock(p.start)} on ${shortDay(p.start)}`,
    };
  }
  const checked = esc(clock(s.checkedAt));
  const due = esc(clock(nextExpected(p)));
  const whenShort = `${longDay(p.start)}, ${periodLabel(p)}`;
  if (s.failedSince !== null) {
    return {
      statusHtml: `${mark}<strong>Can’t reach NESO.</strong> Holding ${label}.`,
      offline: true,
      whenHtml: `<strong>Not live.</strong> The API hasn’t answered since ${esc(clock(s.failedSince))}, so this is still the last half-hour received: ${label}, ${day}. Trying again every five minutes.`,
      whenShort,
      sharesLabel: 'in the last half-hour received',
    };
  }
  if (!s.fresh) {
    return {
      statusHtml: `${mark}<strong>Latest available:</strong> ${label}`,
      offline: true,
      whenHtml: `<strong>Not quite live.</strong> NESO hasn’t published anything newer than ${label}, ${day}. Checked at ${checked}; checking again every five minutes.`,
      whenShort,
      sharesLabel: 'in the latest half-hour available',
    };
  }
  if (regional) {
    return {
      statusHtml: `${mark}<strong>${name}, live:</strong> ${label} (modelled estimate)`,
      offline: false,
      whenHtml: `<strong>Live, modelled.</strong> NESO estimates regional figures with a model rather than measuring them. This is its latest for ${name}: ${label}, ${day}. Checked at ${checked}; the next is due shortly after ${due}.`,
      whenShort,
      sharesLabel: 'right now',
    };
  }
  return {
    statusHtml: `${mark}<strong>Live:</strong> ${label}`,
    offline: false,
    whenHtml: `<strong>Live.</strong> The latest half-hour NESO has published: ${label}, ${day}. Checked at ${checked}; the next is due shortly after ${due}.`,
    whenShort,
    sharesLabel: 'right now',
  };
}
