import { describeError, fetchCurrent, fetchHistory, type Sample } from './data/api';
import type { Region } from './data/regions';
import { upsertPeriods, type GridPeriod } from './data/series';
import { HOUR, MINUTE, isFresh, nextPollDelay } from './data/time';

const WEEK = 7 * 24 * HOUR;

/** Where the figures come from: NESO, or the bundled recording when NESO can't be reached. */
export type Source =
  | { kind: 'live'; region: Region; series: GridPeriod[]; latest: GridPeriod; checkedAt: number; failedSince: number | null; history: 'loading' | 'ok' | 'failed' }
  | { kind: 'sample'; sample: Sample; series: GridPeriod[]; reason: string };

/** A live source for `region`: just its latest half-hour, or with the week already in hand. */
export function liveSource(region: Region, latest: GridPeriod, week?: readonly GridPeriod[]): Source {
  const now = Date.now();
  return { kind: 'live', region, series: week ? upsertPeriods(week, [latest], now - WEEK - HOUR) : [latest], latest, checkedAt: now, failedSince: null, history: week ? 'ok' : 'loading' };
}

export type FeedEvent =
  /** new figures, or a change in whether NESO is answering */
  | { type: 'updated' }
  /** the week's history arrived or failed */
  | { type: 'history' }
  | { type: 'region'; region: Region }
  | { type: 'region-failed'; region: Region; previous: Region; reason: string }
  /** NESO answered again after the page fell back to the recording */
  | { type: 'reconnected'; region: Region };

/**
 * Keeps the figures current. Polls gently (a few minutes after each half-hour
 * is due, every five minutes when late or failing), loads the week once per
 * region, switches region on request and reconnects after an outage. Races
 * are settled by identity: a reply for a source that has since been replaced
 * is ignored.
 */
export class LiveFeed {
  /** Bumped whenever the data behind "now" changes. */
  version = 0;
  private pollTimer = 0;
  private lastPollAt = 0;
  private polling = false;
  private deferred = false;
  private stopped = false;
  /** A week already asked for, alongside the latest half-hour, so a page can open full. */
  private week: { region: Region; promise: Promise<GridPeriod[]> } | null;

  constructor(
    public source: Source,
    /** the region asked for in the address, used again when reconnecting */
    private readonly wanted: Region,
    /** whether anyone is listening or looking; polls wait otherwise */
    private readonly active: () => boolean,
    private readonly notify: (e: FeedEvent) => void,
    /** the wanted region's week, if the page already asked for it */
    week: Promise<GridPeriod[]> | null = null,
  ) {
    this.week = week ? { region: wanted, promise: week } : null;
  }

  start(): void {
    this.stopped = false;
    this.schedulePoll();
    if (this.source.kind === 'live' && this.source.history !== 'ok') void this.loadHistory();
    else this.week = null;
  }

  /** Stop polling. Anything in flight is let finish and ignored. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.pollTimer);
  }

  /** Listen from somewhere else: fetch that region's latest half-hour and, alongside, its week. */
  async setRegion(region: Region): Promise<void> {
    const previous = this.source;
    if (previous.kind !== 'live' || previous.region === region) return;
    const week = fetchHistory(Date.now(), region);
    week.catch(() => undefined); // settled by loadHistory, or dropped if the region fails
    try {
      const latest = await fetchCurrent(region);
      this.source = liveSource(region, latest);
      this.week = { region, promise: week };
      this.version++;
      this.notify({ type: 'region', region });
      void this.loadHistory();
      this.schedulePoll();
    } catch (err) {
      this.notify({ type: 'region-failed', region, previous: previous.region, reason: describeError(err) });
    }
  }

  /** After a sleep or a long hidden spell, timers can be late: catch up. */
  pollIfOverdue(): void {
    const s = this.source;
    if (this.polling || document.hidden) return;
    const stale = s.kind === 'live' ? !isFresh(Date.now(), s.latest.start) : true;
    if ((this.deferred || stale) && Date.now() - this.lastPollAt > 5 * MINUTE) void this.poll();
  }

  private async loadHistory(): Promise<void> {
    const s = this.source;
    if (s.kind !== 'live') return;
    // A week asked for early answers once, and only for its own region.
    const asked = this.week?.region === s.region ? this.week.promise : null;
    this.week = null;
    try {
      const history = await (asked ?? fetchHistory(Date.now(), s.region));
      if (s !== this.source) return; // the listener moved to another region meanwhile
      s.series = upsertPeriods(history, [s.latest], Date.now() - WEEK - HOUR);
      s.history = 'ok';
    } catch {
      if (s !== this.source) return;
      s.history = 'failed';
      setTimeout(() => {
        if (s === this.source) void this.loadHistory();
      }, 2 * MINUTE);
    }
    this.notify({ type: 'history' });
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    if (this.stopped) return;
    const s = this.source;
    const jitter = Math.random() * 40_000;
    const delay = s.kind === 'live' && !s.failedSince ? nextPollDelay(Date.now(), s.latest.start) : 5 * MINUTE;
    this.pollTimer = window.setTimeout(() => void this.poll(), delay + jitter);
  }

  private async poll(): Promise<void> {
    // Nobody looking and nothing playing: wait until that changes.
    if (document.hidden && !this.active()) {
      this.deferred = true;
      return;
    }
    if (this.polling) return;
    this.polling = true;
    this.deferred = false;
    this.lastPollAt = Date.now();
    const s = this.source;
    try {
      const latest = await fetchCurrent(s.kind === 'live' ? s.region : this.wanted);
      if (this.stopped || s !== this.source) return; // stopped, or superseded by a region change, which polls for itself
      if (s.kind === 'live') {
        if (latest.start >= s.latest.start) s.latest = latest;
        s.series = upsertPeriods(s.series, [latest], Date.now() - WEEK - HOUR);
        s.checkedAt = Date.now();
        s.failedSince = null;
        this.version++;
        this.notify({ type: 'updated' });
      } else {
        this.source = liveSource(this.wanted, latest);
        this.version++;
        this.notify({ type: 'reconnected', region: this.wanted });
        void this.loadHistory();
      }
    } catch (err) {
      if (s !== this.source) return;
      if (s.kind === 'live') s.failedSince ??= Date.now();
      else s.reason = describeError(err);
      this.notify({ type: 'updated' });
    } finally {
      this.polling = false;
      this.schedulePoll();
    }
  }
}
