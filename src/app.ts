import { GB, type Region } from './data/regions';
import type { Fuel } from './data/schema';
import { type GridPeriod, type GridSnapshot, sampleAt } from './data/series';
import { HALF_HOUR, HOUR, londonDay, londonYesterday } from './data/time';
import { type FeedEvent, LiveFeed, type Source } from './feed';
import { BAR_SECONDS } from './music/conductor';
import { arrange } from './music/mapping';
import { arrangementsFor } from './music/versions';
import { OssiaLoudness } from './ossia-loudness';
import { Player, type Version } from './player';
import { RecordPress } from './record';
import { advance, nextDownbeat, type Position, REPLAY_SPEED, ReplayTrace, sampleHold } from './replay';
import { type ControlActions, wireControls } from './ui/controls';
import type { Elements } from './ui/elements';
import { clock, longDay, shortDay } from './ui/format';
import { installShortcuts } from './ui/keys';
import { keyRule, renderVoices } from './ui/notes';
import { buildOssiaTable } from './ui/ossia';
import { Readouts } from './ui/readout';
import { store } from './ui/store';
import { Transport } from './ui/transport';
import { refreshWeekControls } from './ui/week';
import { choosePage } from './visual/page';
import { Ribbon } from './visual/ribbon';
import { Score } from './visual/score';

export type { Source } from './feed';

/**
 * The page: wires the data feed, the player, the score and the controls
 * together, and keeps every readout honest about what is playing.
 */
export class App {
  private readonly player: Player;
  private readonly score: Score;
  private readonly ribbon: Ribbon;
  private position: Position;
  private tickHeard: number;
  private lastApply = 0;
  private readonly feed: LiveFeed;
  private readonly record: RecordPress;
  private readonly transport: Transport;
  private shortcuts = store.get('shortcuts') !== 'off';
  private appliedKey = '';
  private pageKey = '';
  private audition: { fuel: Fuel; timer: number } | null = null;
  private readonly trace = new ReplayTrace();
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly voiceRefs: ReturnType<typeof renderVoices>;
  /** The ossia: hear (and see) the same moment as a fully renewable grid. Off on every visit: it is a what-if. */
  private ossia = false;
  private readonly readouts: Readouts;
  private readonly loudness: OssiaLoudness;

  constructor(
    private readonly el: Elements,
    source: Source,
    /** the region asked for in the address, used again when reconnecting */
    wanted: Region = GB,
    /** the week for that region, if already asked for */
    week: Promise<GridPeriod[]> | null = null,
  ) {
    this.feed = new LiveFeed(source, wanted, () => this.player.started && !this.player.isPaused, this.onFeed, week);
    this.position = source.kind === 'live' ? { kind: 'live' } : sampleHold(source.series[0]?.start ?? Date.now(), Date.now());
    const snap = this.snapshot();
    if (!snap) throw new Error('no data to play');
    this.player = new Player(
      arrangementsFor(snap.mix, snap.intensity, null, null),
      (bars, start) => {
        this.score.addBar(bars, start);
      },
      // Open part-way through a bar, so the live bar is already half written.
      0.6 * BAR_SECONDS,
    );
    this.score = new Score(el.scoreCanvas, el.cursorCanvas, this.player.startTime, { reduced: () => this.reduced.matches, cue: this.cue });
    this.ribbon = new Ribbon(el.ribbonCanvas);
    this.tickHeard = this.player.heardNow();
    this.voiceRefs = renderVoices(el.voices);
    el.keyRule.textContent = keyRule();
    const ossiaTable = buildOssiaTable(el.ossiaTable);
    this.readouts = new Readouts(el, this.voiceRefs, ossiaTable);
    this.loudness = new OssiaLoudness(this.player, { notes: el.ossiaNotes, line: el.ossiaLoudness, table: ossiaTable });
    el.region.value = (source.kind === 'live' ? source.region : wanted).slug;
    el.play.disabled = false;
    el.region.disabled = source.kind !== 'live';
    if (source.kind !== 'live') el.region.title = 'Regions need a connection to NESO';

    this.transport = new Transport(el, this.player, (text) => {
      this.announce(text);
    });
    this.record = new RecordPress(el, {
      region: () => (this.source.kind === 'live' ? this.source.region : GB),
      known: () => this.source.series,
      offline: () => this.source.kind === 'sample',
      sampleDate: source.kind === 'sample' ? source.sample.date : '',
      ossia: () => this.ossia,
      player: this.player,
      ensurePlaying: () => this.transport.ensurePlaying(),
      announce: (text) => {
        this.announce(text);
      },
    });
    this.wire();
  }

  run(): void {
    this.player.begin();
    this.updatePage();
    // Data and harmony advance on a timer, which keeps running in a background
    // tab that is playing; the animation frame only draws.
    setInterval(this.tick, 100);
    requestAnimationFrame(this.frame);
    this.feed.start();
    this.refreshWeek();
  }

  private get source(): Source {
    return this.feed.source;
  }

  // ---------- data ----------

  private snapshot(): GridSnapshot | null {
    const s = this.source;
    if (this.position.kind === 'live' && s.kind === 'live') {
      return { t: s.latest.start, mix: s.latest.mix, intensity: s.latest.intensity, period: s.latest };
    }
    if (this.position.kind === 'replay') return sampleAt(s.series, this.position.t);
    return null;
  }

  /** Listen from somewhere else. The feed fetches; the page shows it is tuning. */
  private async setRegion(region: Region): Promise<void> {
    this.el.region.disabled = true;
    this.el.status.textContent = `Tuning to ${region.name}…`;
    await this.feed.setRegion(region);
    this.el.region.disabled = false;
  }

  private readonly onFeed = (e: FeedEvent): void => {
    const el = this.el;
    this.readouts.invalidate();
    switch (e.type) {
      case 'region': {
        this.position = { kind: 'live' };
        const url = new URL(window.location.href);
        if (e.region === GB) url.searchParams.delete('region');
        else url.searchParams.set('region', e.region.slug);
        window.history.replaceState(null, '', url);
        this.announce(`Now listening from ${e.region.name}.`);
        break;
      }
      case 'region-failed':
        el.region.value = e.previous.slug;
        this.announce(`Couldn’t reach NESO for ${e.region.name} (${e.reason}). Still listening from ${e.previous.name}.`);
        break;
      case 'reconnected':
        // The recording's replay cannot continue over live data, so go live and say so.
        el.region.disabled = false;
        el.region.title = '';
        el.region.value = e.region.slug;
        this.position = { kind: 'live' };
        this.announce(`Reconnected to NESO: now playing ${e.region.name} live.`);
        break;
      case 'updated':
        break;
      case 'history':
        this.record.preview();
        break;
    }
    if (e.type === 'region' || e.type === 'reconnected') this.record.preview();
    this.refreshWeek();
    this.updatePage();
  };

  // ---------- the loop ----------

  /** Advance a playing replay and keep the music in step with the data. */
  private readonly tick = (): void => {
    const heard = this.player.heardNow();
    const last = this.tickHeard;
    this.tickHeard = heard;
    const pos = this.position;
    if (pos.kind === 'replay' && pos.playing && heard > pos.startsAt) {
      if (last <= pos.startsAt) this.trace.add(pos.startsAt, pos.t);
      pos.t = advance(pos, last, heard);
      this.trace.add(heard, pos.t);
      if (pos.t >= pos.stopAt) this.endReplay();
    }
    this.trace.forget(heard - 60);
    const snap = this.snapshot();
    if (snap) this.applyArrangement(snap);
    this.updatePage();
    this.loudness.follow(this.position, this.source, snap, performance.now());
  };

  private updatePage(): void {
    const choice = choosePage(this.position, this.source, { origin: this.player.startTime, version: this.feed.version, now: Date.now() });
    if (!choice || choice.key === this.pageKey) return;
    this.pageKey = choice.key;
    this.score.setPage(choice.page());
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    this.score.draw(this.player.heardNow());
    const snap = this.snapshot();
    if (!snap) return;
    const mode = this.player.mode ?? arrange(snap.mix, snap.intensity).mode;
    this.readouts.update({ snap, source: this.source, position: this.position, mode, version: this.feed.version, ossia: this.ossia });
    this.readouts.updateClock(this.position);
    this.drawRibbon(snap);
  };

  /** Music time of the next bar line, at least a beat away. */
  private nextDownbeat(): number {
    return nextDownbeat(this.player.startTime, this.player.heardNow());
  }

  /** Bring the score into view when a replay starts from further down the page. */
  private revealStage(): void {
    const r = this.el.stage.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    this.el.stage.scrollIntoView({ behavior: this.reduced.matches ? 'auto' : 'smooth', block: 'center' });
  }

  private applyArrangement(snap: GridSnapshot): void {
    const replay = this.position.kind === 'replay';
    const now = performance.now();
    const solo = this.audition?.fuel ?? null;
    const key = `${this.feed.version}|${snap.period.start}|${solo ?? ''}|${this.player.mode ?? ''}`;
    if (!(replay ? now - this.lastApply > 100 : key !== this.appliedKey)) return;
    const mix = solo ? { ...snap.mix, [solo]: Math.max(snap.mix[solo], 0.3) } : snap.mix;
    const playing = this.position.kind === 'replay' && this.position.playing;
    this.player.setArrangement(
      arrangementsFor(mix, snap.intensity, this.player.mode, this.player.ossiaMode),
      replay ? (playing ? 0.35 : 0.2) : 2.5,
    );
    this.lastApply = now;
    this.appliedKey = key;
  }

  /**
   * During a replay each bar line is labelled with the hour it stands for, as
   * a film score prints timecode. Bars are written a moment before they sound,
   * so a bar not yet heard is labelled from where the replay will be by then.
   */
  private readonly cue = (_bar: number, start: number): string | undefined => {
    let d = this.trace.at(start);
    const pos = this.position;
    if (d === null && pos.kind === 'replay' && pos.playing && start >= pos.startsAt) {
      const from = Math.max(this.player.heardNow(), pos.startsAt);
      d = pos.t + Math.max(0, start - from) * 1000 * REPLAY_SPEED;
    }
    return d === null ? undefined : clock(Math.round(d / HALF_HOUR) * HALF_HOUR);
  };

  /**
   * The ossia on or off. The sound switches at once, mid-bar, without a
   * restart (both versions are always composed), so the same moment can be
   * heard both ways; the score prints the ossia above the live bar, and the
   * rule and its numbers appear under the controls.
   */
  private setOssia(on: boolean): void {
    this.ossia = on;
    const version: Version = on ? 'ossia' : 'real';
    this.player.setVersion(version);
    this.score.setOssia(on);
    const el = this.el;
    el.ossia.setAttribute('aria-pressed', String(on));
    el.ossiaNotes.hidden = !on;
    el.ossiaKey.hidden = !on;
    el.ossiaKey.textContent = on ? '; ossia in D Lydian' : '';
    this.loudness.setOn(on);
    this.readouts.invalidate();
    this.record.versionChanged();
    this.announce(
      on
        ? 'Ossia on: this moment re-scored for a fully renewable grid, a hypothetical. Press O again for the real grid.'
        : 'Ossia off: the real grid again.',
    );
  }

  private drawRibbon(snap: GridSnapshot): void {
    const pos = this.position;
    const cursor = pos.kind === 'replay' ? pos.t : snap.period.start + HALF_HOUR / 2;
    this.ribbon.follow(
      { series: this.source.series, cursor, span: pos.kind === 'replay' ? pos.span : null, live: pos.kind === 'live' },
      this.el.scrub,
    );
  }

  private refreshWeek(): void {
    refreshWeekControls(this.el, this.source, this.position);
    this.ribbon.invalidate();
  }

  // ---------- actions ----------

  private async playDay(): Promise<void> {
    const s = this.source;
    const first = s.series[0];
    const last = s.series[s.series.length - 1];
    if (!first || !last) return;
    let span = s.kind === 'sample' ? londonDay(first.start) : londonYesterday(Date.now());
    span = { start: Math.max(span.start, first.start), end: Math.min(span.end, last.end) };
    if (span.end - span.start < HOUR) return;
    this.position = { kind: 'replay', t: span.start, playing: true, startsAt: this.nextDownbeat(), span, stopAt: span.end };
    this.refreshWeek();
    this.readouts.restartClock();
    this.revealStage();
    await this.transport.ensurePlaying();
    this.announce(`Playing ${longDay(span.start)}, one hour every 2.5 seconds.`);
  }

  private async playOnwards(): Promise<void> {
    const pos = this.position;
    const last = this.source.series[this.source.series.length - 1];
    if (pos.kind !== 'replay' || !last) return;
    if (pos.t >= last.end - HALF_HOUR) pos.t = this.source.series[0]?.start ?? pos.t;
    this.position = { kind: 'replay', t: pos.t, playing: true, startsAt: this.nextDownbeat(), span: null, stopAt: last.end };
    this.refreshWeek();
    this.readouts.restartClock();
    this.revealStage();
    await this.transport.ensurePlaying();
    this.announce(`Playing on from ${clock(pos.t)}, ${shortDay(pos.t)}.`);
  }

  private endReplay(): void {
    const pos = this.position;
    if (pos.kind !== 'replay') return;
    pos.playing = false;
    this.refreshWeek();
    this.announce(`That was ${longDay(pos.t - 1)}. Scrub the week, play on, or go back to live.`);
  }

  private goLive(): void {
    if (this.source.kind !== 'live') return;
    this.position = { kind: 'live' };
    this.refreshWeek();
    this.announce('Back to live.');
  }

  private scrubTo(index: number): void {
    const p = this.source.series[index];
    if (!p) return;
    const last = this.source.series[this.source.series.length - 1];
    if (this.source.kind === 'live' && last && p.start === last.start) {
      this.goLive();
      return;
    }
    this.position = { kind: 'replay', t: p.start + HALF_HOUR / 2, playing: false, startsAt: 0, span: null, stopAt: last?.end ?? p.end };
    this.refreshWeek();
  }

  private step(periods: number): void {
    const s = this.source;
    const pos = this.position;
    const cursor = pos.kind === 'replay' ? pos.t : s.kind === 'live' ? s.latest.start : 0;
    const idx = s.series.findIndex((p) => p.start <= cursor && cursor < p.end);
    const next = Math.min(s.series.length - 1, Math.max(0, (idx < 0 ? s.series.length - 1 : idx) + periods));
    this.scrubTo(next);
  }

  private async toggleAudition(fuel: Fuel): Promise<void> {
    await this.transport.ensurePlaying();
    const current = this.audition;
    if (current) {
      clearTimeout(current.timer);
      this.voiceRefs.get(current.fuel)?.button.setAttribute('aria-pressed', 'false');
      this.audition = null;
      this.player.solo(null);
      if (current.fuel === fuel) return;
    }
    const timer = window.setTimeout(() => void this.toggleAudition(fuel), 8000);
    this.audition = { fuel, timer };
    this.player.solo(fuel);
    this.voiceRefs.get(fuel)?.button.setAttribute('aria-pressed', 'true');
    this.announce(`Playing ${fuel} on its own for eight seconds.`);
  }

  private announce(text: string): void {
    this.el.announcer.textContent = text;
  }

  // ---------- wiring ----------

  private wire(): void {
    const el = this.el;
    const actions: ControlActions = {
      togglePlay: () => void this.transport.togglePlay(),
      toggleMute: () => {
        this.transport.toggleMute();
      },
      toggleOssia: () => {
        this.setOssia(!this.ossia);
      },
      playYesterday: () => void this.playDay(),
      goLive: () => {
        this.goLive();
      },
      step: (periods) => {
        this.step(periods);
      },
      nudgeVolume: (delta) => {
        this.transport.nudgeVolume(delta);
      },
      setVolume: (percent) => {
        this.transport.setVolume(percent);
      },
      scrubTo: (index) => {
        this.scrubTo(index);
      },
      setRegion: (region) => void this.setRegion(region),
      playOnwards: () => void this.playOnwards(),
      audition: (fuel) => void this.toggleAudition(fuel),
    };
    wireControls(el, this.voiceRefs, actions);
    el.shortcuts.checked = this.shortcuts;
    el.shortcuts.addEventListener('change', () => {
      this.shortcuts = el.shortcuts.checked;
      store.set('shortcuts', this.shortcuts ? 'on' : 'off');
    });
    installShortcuts(() => this.shortcuts, actions);
    document.addEventListener('visibilitychange', () => {
      this.feed.pollIfOverdue();
    });

    const resize = new ResizeObserver(() => {
      this.score.resize();
      this.ribbon.resize();
    });
    resize.observe(el.scoreCanvas);
    resize.observe(el.ribbonCanvas);
    this.reduced.addEventListener('change', () => {
      this.score.resize();
    });
    void document.fonts.ready.then(() => {
      this.ribbon.invalidate();
    });
    setInterval(() => {
      this.transport.updatePlayButton();
      this.feed.pollIfOverdue();
    }, 1000);
  }
}
