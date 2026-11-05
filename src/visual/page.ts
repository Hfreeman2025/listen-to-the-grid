import { periodAt, sampleAt } from '../data/series';
import { isFresh } from '../data/time';
import type { Source } from '../feed';
import { BAR_SECONDS, type Bar } from '../music/conductor';
import { composeBefore, halfHourNumber } from '../music/context';
import type { Position } from '../replay';
import { clock } from '../ui/format';

/** The most half-hours a page engraves before the live bar: a desktop system holds four bars. */
const PAST_BARS = 3;

/** A bar engraved before the music reaches it: a half-hour already past. */
export interface PageBar {
  bar: Bar;
  /** its time, printed over the bar: "16:30" */
  label: string;
  /** its number in the day's score, one bar a half-hour */
  number: number;
}

/**
 * What the page shows.
 *
 * `standing`: a moment, live or held. The half-hours before it are engraved
 * from their own figures, and the system's last bar is the music playing now,
 * inked as it sounds and written afresh each bar until the moment moves on.
 *
 * `flowing`: a day being replayed, an hour a bar, written as it sounds from
 * music bar `from`, turning the page at the end of each system.
 */
export type Page =
  | { kind: 'standing'; key: string; past: readonly PageBar[]; now: { label: string; number: number; live: boolean }; note: string }
  | { kind: 'flowing'; key: string; from: number };

export interface PageChoice {
  /** changes only when the moment or the figures do, so the past is recomposed only then */
  key: string;
  page: () => Page;
}

/**
 * Which page the score shows. A replay that is playing writes its day on
 * flowing pages from its first downbeat. Anything else is a moment, live or
 * held, on a standing page: the half-hours before it engraved from their own
 * figures, then the music playing now. The last bar is called live, and
 * printed red, only while it is the newest half-hour NESO should have; a
 * held moment or a recording is labelled with its time alone.
 */
export function choosePage(pos: Position, s: Source, at: { origin: number; version: number; now: number }): PageChoice | null {
  if (pos.kind === 'replay' && pos.playing) {
    const from = Math.round((pos.startsAt - at.origin) / BAR_SECONDS);
    const key = `flowing|${from}`;
    return { key, page: () => ({ kind: 'flowing', key, from }) };
  }
  const current =
    pos.kind === 'live' ? (s.kind === 'live' ? s.latest : undefined) : (periodAt(s.series, pos.t) ?? sampleAt(s.series, pos.t)?.period);
  if (!current) return null;
  const live = pos.kind === 'live' && s.kind === 'live';
  const fresh = live && isFresh(at.now, current.start);
  const place = s.kind === 'live' ? s.region.slug : 'sample';
  const history = s.kind === 'live' ? s.history : 'ok';
  const key = [
    'standing',
    place,
    at.version,
    current.start,
    s.series.length,
    s.series[s.series.length - 1]?.start,
    history,
    live,
    fresh,
  ].join('|');
  return {
    key,
    page: () => {
      const past = composeBefore(s.series, current.start, PAST_BARS, place).map((p) => ({
        bar: p.bar,
        label: clock(p.start),
        number: halfHourNumber(p.start),
      }));
      const time = clock(current.start);
      return {
        kind: 'standing',
        key,
        past,
        now: { label: live ? `${time} ${fresh ? 'live' : 'latest'}` : time, number: halfHourNumber(current.start), live: fresh },
        note:
          history === 'loading'
            ? 'the half-hours before are on their way'
            : history === 'failed'
              ? 'the half-hours before are unavailable for now'
              : 'no earlier half-hours in the data',
      };
    },
  };
}
