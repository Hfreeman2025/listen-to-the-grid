import { LoudnessMatcher, MATCH_BARS, type Match, PROVISIONAL_TRIM_DB } from './audio/match';
import { describeError } from './data/api';
import type { Mix } from './data/schema';
import { type GridSnapshot, sampleAt } from './data/series';
import { HOUR } from './data/time';
import type { Source } from './feed';
import type { Player } from './player';
import type { Position } from './replay';
import { clock, periodLabel } from './ui/format';
import { type OssiaTable, showLoudness } from './ui/ossia';

/** A moment to match: what sounds, under a key that changes when it does. */
interface Moment {
  key: string;
  g: { mix: Mix; grams: number };
  /** "17:00–17:30 GMT", or the replayed hour */
  label: string;
}

export type MatchState =
  | { kind: 'off' }
  | { kind: 'measuring'; label: string; trimDb: number; from: { label: string; match: Match } | null }
  | { kind: 'matched'; label: string; match: Match }
  | { kind: 'failed'; label: string; reason: string; trimDb: number };

/**
 * Keeps the ossia at the real grid's loudness, moment by moment. While the
 * ossia is on it measures the moment sounding (a replay hour by hour, one
 * ahead), and while the real grid plays it measures the live half-hour in
 * the background, so switching is usually matched at once. Until a moment is
 * measured, the last trim carries over, or, before any, the typical one,
 * labelled provisional.
 */
export class OssiaLoudness {
  private readonly matcher: LoudnessMatcher;
  private moment: Moment | null = null;
  private applied: { label: string; match: Match } | null = null;
  private failed: string | null = null;
  private on = false;
  private listeningSince: number | null = null;

  constructor(
    private readonly player: Player,
    private readonly view: { notes: HTMLElement; line: HTMLElement; table: OssiaTable },
  ) {
    this.matcher = new LoudnessMatcher(
      (key, match) => {
        if (key !== this.moment?.key) return;
        this.failed = null;
        this.applied = { label: this.moment.label, match };
        this.player.setTrim('ossia', match.trimDb);
        this.render();
      },
      (key, err) => {
        if (key !== this.moment?.key) return;
        this.failed = describeError(err);
        this.render();
      },
    );
    this.player.setTrim('ossia', PROVISIONAL_TRIM_DB);
  }

  setOn(on: boolean): void {
    this.on = on;
    this.render();
  }

  /** Called every tick with where playback is. */
  follow(pos: Position, s: Source, snap: GridSnapshot | null, now: number): void {
    const replaying = pos.kind === 'replay' && pos.playing;
    // Listening to the real grid: measure in the background after a few seconds, ready for the switch.
    if (this.player.started && !this.player.isPaused) this.listeningSince ??= now;
    else this.listeningSince = null;
    const prefetch = !replaying && this.listeningSince !== null && now - this.listeningSince > 5000;
    if (!this.on && !prefetch) return;
    const place = s.kind === 'live' ? s.region.slug : 'sample';
    let moment: Moment | null = null;
    let next: Moment | null = null;
    if (replaying) {
      // A replay moves an hour a bar: match it hour by hour, measuring the next one ahead.
      const hour = Math.floor(pos.t / HOUR) * HOUR;
      const at = (h: number): Moment | null => {
        const snapAt = sampleAt(s.series, h + HOUR / 2);
        return snapAt ? { key: `${place}|hour|${h}`, g: { mix: snapAt.mix, grams: snapAt.intensity }, label: clock(h) } : null;
      };
      moment = at(hour);
      if (hour + HOUR < pos.stopAt) next = at(hour + HOUR);
    } else if (snap) {
      moment = {
        key: `${place}|${snap.period.start}|${snap.t}`,
        g: { mix: snap.mix, grams: snap.intensity },
        label: periodLabel(snap.period),
      };
    }
    if (!moment) return;
    if (moment.key !== this.moment?.key) {
      this.moment = moment;
      this.failed = null;
      const known = this.matcher.get(moment.key);
      if (known) {
        this.applied = { label: moment.label, match: known };
        this.player.setTrim('ossia', known.trimDb);
      } else {
        this.matcher.request(moment.key, moment.g);
      }
      this.render();
    } else if (next && this.matcher.get(moment.key) && !this.matcher.has(next.key)) {
      this.matcher.request(next.key, next.g);
    }
  }

  get state(): MatchState {
    if (!this.on) return { kind: 'off' };
    const label = this.moment?.label ?? '';
    const known = this.moment ? this.matcher.get(this.moment.key) : undefined;
    if (known) return { kind: 'matched', label, match: known };
    const trimDb = this.applied?.match.trimDb ?? PROVISIONAL_TRIM_DB;
    if (this.failed) return { kind: 'failed', label, reason: this.failed, trimDb };
    return { kind: 'measuring', label, trimDb, from: this.applied };
  }

  private render(): void {
    const state = this.state;
    showLoudness(this.view, state, MATCH_BARS);
  }
}
