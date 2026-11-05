import { GB, type Region } from '../data/regions';
import type { Fuel } from '../data/schema';
import type { GridPeriod, GridSnapshot } from '../data/series';
import { isFresh, MINUTE, nextExpected } from '../data/time';
import type { Source } from '../feed';
import { modeInfo } from '../music/harmony';
import type { Mode } from '../music/theory';
import type { Position } from '../replay';
import type { Elements } from './elements';
import { clock, describeIntensity, describeMix, headline, longDay, MODE_NAMES, periodLabel, shortDay, zone } from './format';
import { renderLadder, updateVoiceShares } from './notes';
import { fillOssiaTable, type OssiaTable } from './ossia';

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
      statusHtml:
        playback === 'replay-playing'
          ? `<strong>Replaying</strong> ${day}`
          : `<strong>Replaying</strong> ${esc(shortDay(p.start))}, ${label}`,
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

/** Everything the readouts describe, as of this frame. */
export interface Moment {
  snap: GridSnapshot;
  source: Source;
  position: Position;
  /** the mode the music is playing in */
  mode: Mode;
  /** the feed's version, which changes whenever its figures do */
  version: number;
  ossia: boolean;
}

/**
 * What the page says about what is playing: the masthead status, the key,
 * the reading in plain words, the shares in the programme notes and, with the
 * ossia on, its table. Each frame asks; they are rewritten only when what
 * they say would change.
 */
export class Readouts {
  private key = '';
  private clockText = '';
  private readonly ladder: Map<Mode, HTMLElement>;

  constructor(
    private readonly el: Elements,
    private readonly voices: Map<Fuel, { share: HTMLElement }>,
    private readonly ossiaTable: OssiaTable,
  ) {
    this.ladder = renderLadder(el.ladder);
  }

  /** Rewrite them all on the next update. */
  invalidate(): void {
    this.key = '';
  }

  /** A replay has started: write its clock afresh. */
  restartClock(): void {
    this.clockText = '';
  }

  update({ snap, source: s, position: pos, mode, version, ossia }: Moment): void {
    const fresh = s.kind === 'live' && isFresh(Date.now(), s.latest.start);
    const playing = pos.kind === 'replay' && pos.playing;
    const key = [
      version,
      snap.period.start,
      mode,
      s.kind,
      s.kind === 'live' ? `${s.region.slug}|${s.failedSince}|${s.checkedAt}|${fresh}` : s.reason,
      pos.kind,
      playing,
      ossia,
    ].join('|');
    if (key === this.key) return;
    this.key = key;
    const p = snap.period;
    const el = this.el;
    const region = s.kind === 'live' ? s.region : GB;
    const regional = region.id !== null;
    el.headline.textContent = headline(p.mix, mode, regional ? region.name : undefined);
    el.mixline.textContent = `${pos.kind === 'live' ? 'Generating now' : 'Generating then'}: ${describeMix(p.mix)}`;
    el.intensityline.textContent = `Carbon intensity: ${describeIntensity(p, regional)}`;
    el.key.textContent = `D ${MODE_NAMES[mode]}, ${modeInfo(mode).marking}`;
    for (const [m, li] of this.ladder) li.classList.toggle('current', m === mode);

    const r = describeState({
      period: p,
      source:
        s.kind === 'sample'
          ? { kind: 'sample', reason: s.reason }
          : { kind: 'live', region: s.region, fresh, failedSince: s.failedSince, checkedAt: s.checkedAt },
      playback: pos.kind === 'live' ? 'live' : playing ? 'replay-playing' : 'replay-held',
    });
    el.status.className = r.offline ? 'status offline' : 'status';
    if (el.status.innerHTML !== r.statusHtml) el.status.innerHTML = r.statusHtml;
    el.when.innerHTML = r.whenHtml;
    el.whenShort.textContent = r.whenShort;
    this.clockText = ''; // a playing replay's clock rewrites the line straight after
    el.credit.classList.toggle('replaying', pos.kind === 'replay' && s.kind === 'live');
    updateVoiceShares(this.voices, p.mix, r.sharesLabel);
    if (ossia) {
      const when =
        s.kind === 'sample'
          ? `recorded sample, ${shortDay(p.start)}, ${periodLabel(p)}`
          : pos.kind === 'live'
            ? periodLabel(p)
            : `${shortDay(p.start)}, ${periodLabel(p)}`;
      el.ossiaFallback.hidden = !fillOssiaTable(this.ossiaTable, p, mode, when, regional);
    }
  }

  /**
   * During a replay the date line under the credit becomes a running clock,
   * set large, so a replayed day reads at a glance.
   */
  updateClock(pos: Position): void {
    if (pos.kind !== 'replay' || !pos.playing) {
      if (this.clockText) {
        this.clockText = '';
        this.key = '';
      }
      return;
    }
    const text = `${longDay(pos.t).replace(/ \d{4}$/, '')}, ${clock(Math.floor(pos.t / (10 * MINUTE)) * 10 * MINUTE)} ${zone(pos.t)}`;
    if (text === this.clockText) return;
    this.clockText = text;
    this.el.whenShort.textContent = text;
  }
}
