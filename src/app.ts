import { GB, REGIONS, type Region } from './data/regions';
import type { Fuel } from './data/schema';
import { sampleAt, type GridPeriod, type GridSnapshot } from './data/series';
import { HALF_HOUR, HOUR, MINUTE, isFresh, londonDay, londonYesterday } from './data/time';
import { LiveFeed, type FeedEvent, type Source } from './feed';
import { BAR_SECONDS } from './music/conductor';
import { modeInfo } from './music/harmony';
import { arrange } from './music/mapping';
import { arrangementsFor } from './music/versions';
import type { Mode } from './music/theory';
import { OssiaLoudness } from './ossia-loudness';
import { Player, type Version } from './player';
import { RecordPress } from './record';
import { REPLAY_SPEED, ReplayTrace, advance, nextDownbeat, sampleHold, type Position } from './replay';
import type { Elements } from './ui/elements';
import { clock, describeIntensity, describeMix, headline, longDay, MODE_NAMES, periodLabel, shortDay, zone } from './ui/format';
import { installShortcuts } from './ui/keys';
import { keyRule, renderLadder, renderVoices, updateVoiceShares } from './ui/notes';
import { buildOssiaTable, fillOssiaTable, type OssiaTable } from './ui/ossia';
import { describeState } from './ui/readout';
import { store } from './ui/store';
import { Ribbon } from './visual/ribbon';
import { choosePage } from './visual/page';
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
  private heard: number;
  private tickHeard: number;
  private lastApply = 0;
  private readonly feed: LiveFeed;
  private readonly record: RecordPress;
  private starting: Promise<void> | null = null;
  private shortcuts = store.get('shortcuts') !== 'off';
  private appliedKey = '';
  private readoutKey = '';
  private ribbonKey = '';
  private pageKey = '';
  private audition: { fuel: Fuel; timer: number } | null = null;
  private readonly trace = new ReplayTrace();
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly voiceRefs: ReturnType<typeof renderVoices>;
  private readonly ladderItems: ReturnType<typeof renderLadder>;
  private muted = store.get('muted') === '1';
  /** The ossia: hear (and see) the same moment as a fully renewable grid. Off on every visit: it is a what-if. */
  private ossia = false;
  private readonly ossiaTable: OssiaTable;
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
    this.heard = this.player.heardNow();
    this.tickHeard = this.heard;
    this.voiceRefs = renderVoices(el.voices);
    this.ladderItems = renderLadder(el.ladder);
    el.keyRule.textContent = keyRule();
    this.ossiaTable = buildOssiaTable(el.ossiaTable);
    this.loudness = new OssiaLoudness(this.player, { notes: el.ossiaNotes, line: el.ossiaLoudness, table: this.ossiaTable });
    el.region.value = (source.kind === 'live' ? source.region : wanted).slug;
    el.play.disabled = false;
    el.region.disabled = source.kind !== 'live';
    if (source.kind !== 'live') el.region.title = 'Regions need a connection to NESO';

    const savedVolume = Number(store.get('volume') ?? '75');
    el.volume.value = String(Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 75);
    this.player.setVolume(Number(el.volume.value) / 100);
    this.player.setMuted(this.muted);
    el.mute.setAttribute('aria-pressed', String(this.muted));
    this.record = new RecordPress(el, {
      region: () => (this.source.kind === 'live' ? this.source.region : GB),
      known: () => this.source.series,
      offline: () => this.source.kind === 'sample',
      sampleDate: source.kind === 'sample' ? source.sample.date : '',
      ossia: () => this.ossia,
      player: this.player,
      ensurePlaying: () => this.ensurePlaying(),
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
    this.refreshMachine();
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
    this.readoutKey = '';
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
    this.refreshMachine();
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
    const heard = this.player.heardNow();
    this.heard = heard;
    this.score.draw(heard);
    const snap = this.snapshot();
    if (!snap) return;
    this.updateReadout(snap);
    this.updateClock();
    this.drawRibbon(snap);
  };

  private clockText = '';

  /**
   * During a replay the date line under the credit becomes a running clock,
   * set large, so a replayed day reads at a glance.
   */
  private updateClock(): void {
    const pos = this.position;
    if (pos.kind !== 'replay' || !pos.playing) {
      if (this.clockText) {
        this.clockText = '';
        this.readoutKey = '';
      }
      return;
    }
    const text = `${longDay(pos.t).replace(/ \d{4}$/, '')}, ${clock(Math.floor(pos.t / (10 * MINUTE)) * 10 * MINUTE)} ${zone(pos.t)}`;
    if (text === this.clockText) return;
    this.clockText = text;
    this.el.whenShort.textContent = text;
  }

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
    this.player.setArrangement(arrangementsFor(mix, snap.intensity, this.player.mode, this.player.ossiaMode), replay ? (playing ? 0.35 : 0.2) : 2.5);
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


  // ---------- readouts ----------

  private updateReadout(snap: GridSnapshot): void {
    const s = this.source;
    const pos = this.position;
    const mode: Mode = this.player.mode ?? arrange(snap.mix, snap.intensity).mode;
    const fresh = s.kind === 'live' && isFresh(Date.now(), s.latest.start);
    const playing = pos.kind === 'replay' && pos.playing;
    const key = [this.feed.version, snap.period.start, mode, s.kind, s.kind === 'live' ? `${s.region.slug}|${s.failedSince}|${s.checkedAt}|${fresh}` : s.reason, pos.kind, playing, this.ossia].join('|');
    if (key === this.readoutKey) return;
    this.readoutKey = key;
    const p = snap.period;
    const el = this.el;
    const region = s.kind === 'live' ? s.region : GB;
    const regional = region.id !== null;
    el.headline.textContent = headline(p.mix, mode, regional ? region.name : undefined);
    el.mixline.textContent = `${pos.kind === 'live' ? 'Generating now' : 'Generating then'}: ${describeMix(p.mix)}`;
    el.intensityline.textContent = `Carbon intensity: ${describeIntensity(p, regional)}`;
    el.key.textContent = `D ${MODE_NAMES[mode]}, ${modeInfo(mode).marking}`;
    for (const [m, li] of this.ladderItems) li.classList.toggle('current', m === mode);

    const r = describeState({
      period: p,
      source: s.kind === 'sample' ? { kind: 'sample', reason: s.reason } : { kind: 'live', region: s.region, fresh, failedSince: s.failedSince, checkedAt: s.checkedAt },
      playback: pos.kind === 'live' ? 'live' : playing ? 'replay-playing' : 'replay-held',
    });
    el.status.className = r.offline ? 'status offline' : 'status';
    if (el.status.innerHTML !== r.statusHtml) el.status.innerHTML = r.statusHtml;
    el.when.innerHTML = r.whenHtml;
    el.whenShort.textContent = r.whenShort;
    this.clockText = ''; // a playing replay's clock rewrites the line straight after
    el.credit.classList.toggle('replaying', pos.kind === 'replay' && s.kind === 'live');
    updateVoiceShares(this.voiceRefs, p.mix, r.sharesLabel);
    if (this.ossia) {
      const when = s.kind === 'sample' ? `recorded sample, ${shortDay(p.start)}, ${periodLabel(p)}` : pos.kind === 'live' ? periodLabel(p) : `${shortDay(p.start)}, ${periodLabel(p)}`;
      el.ossiaFallback.hidden = !fillOssiaTable(this.ossiaTable, p, mode, when, regional);
    }
  }

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
    this.readoutKey = '';
    this.record.versionChanged();
    this.announce(on ? 'Ossia on: this moment re-scored for a fully renewable grid, a hypothetical. Press O again for the real grid.' : 'Ossia off: the real grid again.');
  }

  private drawRibbon(snap: GridSnapshot): void {
    const s = this.source;
    const pos = this.position;
    const cursor = pos.kind === 'replay' ? pos.t : snap.period.start + HALF_HOUR / 2;
    const span = pos.kind === 'replay' ? pos.span : null;
    const key = `${s.series.length}|${s.series[s.series.length - 1]?.start ?? 0}|${Math.round(cursor / 60_000)}|${span?.start ?? ''}|${pos.kind}`;
    if (key === this.ribbonKey) return;
    this.ribbonKey = key;
    this.ribbon.draw({ series: s.series, cursor, span, live: pos.kind === 'live' });
    const idx = s.series.findIndex((p) => p.start <= cursor && cursor < p.end);
    if (idx >= 0 && document.activeElement !== this.el.scrub) this.el.scrub.value = String(idx);
    const p = s.series[idx];
    if (p) this.el.scrub.setAttribute('aria-valuetext', `${longDay(p.start)}, ${periodLabel(p)}`);
  }

  private refreshMachine(): void {
    const s = this.source;
    const el = this.el;
    const focused = document.activeElement;
    const usable = s.series.length > 1;
    el.scrub.disabled = !usable;
    el.scrub.max = String(Math.max(0, s.series.length - 1));
    el.yesterday.disabled = !usable;
    el.yesterdayQuick.disabled = !usable;
    el.yesterday.textContent = s.kind === 'sample' ? 'Play the sample day in 60 seconds' : 'Play yesterday in 60 seconds';
    el.yesterdayQuick.textContent = s.kind === 'sample' ? 'Sample day in 60 s' : 'Yesterday in 60 s';
    const replay = this.position.kind === 'replay';
    el.live.hidden = !(replay && s.kind === 'live');
    el.liveQuick.hidden = el.live.hidden;
    el.yesterdayQuick.hidden = !el.live.hidden;
    el.onwards.hidden = !(this.position.kind === 'replay' && !this.position.playing);
    if (s.kind === 'live' && s.history === 'loading') el.yesterday.textContent = 'Loading the week…';
    if (s.kind === 'live' && s.history === 'failed') el.yesterday.textContent = 'Week unavailable, retrying';
    this.ribbonKey = '';
    // A control that hid itself when pressed hands focus to the one that replaced it.
    if (focused instanceof HTMLElement && focused.hidden) {
      const next = new Map<HTMLElement, HTMLElement[]>([
        [el.yesterdayQuick, [el.liveQuick, el.play]],
        [el.liveQuick, [el.yesterdayQuick, el.play]],
        [el.onwards, [el.live, el.yesterday]],
        [el.live, [el.yesterday]],
      ]).get(focused);
      next?.find((b) => !b.hidden)?.focus();
    }
  }

  // ---------- actions ----------

  private ensureStarted(): Promise<void> {
    if (this.player.started) return Promise.resolve();
    this.starting ??= this.startSound().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startSound(): Promise<void> {
    try {
      await this.player.start();
    } catch {
      this.announce('Sound could not start in this browser. The score and the readings still work.');
      return;
    }
    this.player.setVolume(Number(this.el.volume.value) / 100);
    this.player.setMuted(this.muted);
    this.updatePlayButton();
    this.announce('Playing. The sound fades in over a few seconds.');
  }

  /** Start the sound if needed, and resume it if paused. */
  private async ensurePlaying(): Promise<void> {
    await this.ensureStarted();
    if (this.player.isPaused || this.player.interrupted) await this.player.resume();
    this.updatePlayButton();
  }

  private async togglePlay(): Promise<void> {
    if (!this.player.started) await this.ensureStarted();
    else if (this.player.isPaused || this.player.interrupted) {
      await this.player.resume();
      this.announce('Resumed.');
    } else {
      await this.player.pause();
      this.announce('Paused.');
    }
    this.updatePlayButton();
  }

  private updatePlayButton(): void {
    const label = !this.player.started ? 'Listen' : this.player.isPaused || this.player.interrupted ? 'Resume' : 'Pause';
    if (this.el.playLabel.textContent !== label) this.el.playLabel.textContent = label;
    this.el.play.classList.toggle('playing', label === 'Pause');
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.player.setMuted(this.muted);
    this.el.mute.setAttribute('aria-pressed', String(this.muted));
    store.set('muted', this.muted ? '1' : '0');
    this.announce(this.muted ? 'Muted.' : 'Sound on.');
  }

  private nudgeVolume(delta: number): void {
    const v = Math.min(100, Math.max(0, Number(this.el.volume.value) + delta));
    this.el.volume.value = String(v);
    this.setVolume(v);
  }

  private setVolume(v: number): void {
    this.player.setVolume(v / 100);
    this.el.volume.setAttribute('aria-valuetext', `${v}%`);
    store.set('volume', String(v));
  }

  private async playDay(): Promise<void> {
    const s = this.source;
    const first = s.series[0];
    const last = s.series[s.series.length - 1];
    if (!first || !last) return;
    let span = s.kind === 'sample' ? londonDay(first.start) : londonYesterday(Date.now());
    span = { start: Math.max(span.start, first.start), end: Math.min(span.end, last.end) };
    if (span.end - span.start < HOUR) return;
    this.position = { kind: 'replay', t: span.start, playing: true, startsAt: this.nextDownbeat(), span, stopAt: span.end };
    this.refreshMachine();
    this.clockText = '';
    this.revealStage();
    await this.ensurePlaying();
    this.announce(`Playing ${longDay(span.start)}, one hour every 2.5 seconds.`);
  }

  private async playOnwards(): Promise<void> {
    const pos = this.position;
    const last = this.source.series[this.source.series.length - 1];
    if (pos.kind !== 'replay' || !last) return;
    if (pos.t >= last.end - HALF_HOUR) pos.t = this.source.series[0]?.start ?? pos.t;
    this.position = { kind: 'replay', t: pos.t, playing: true, startsAt: this.nextDownbeat(), span: null, stopAt: last.end };
    this.refreshMachine();
    this.clockText = '';
    this.revealStage();
    await this.ensurePlaying();
    this.announce(`Playing on from ${clock(pos.t)}, ${shortDay(pos.t)}.`);
  }

  private endReplay(): void {
    const pos = this.position;
    if (pos.kind !== 'replay') return;
    pos.playing = false;
    this.refreshMachine();
    this.announce(`That was ${longDay(pos.t - 1)}. Scrub the week, play on, or go back to live.`);
  }

  private goLive(): void {
    if (this.source.kind !== 'live') return;
    this.position = { kind: 'live' };
    this.refreshMachine();
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
    this.refreshMachine();
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
    await this.ensurePlaying();
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
    el.play.addEventListener('click', () => void this.togglePlay());
    el.mute.addEventListener('click', () => {
      this.toggleMute();
    });
    el.ossia.addEventListener('click', () => {
      this.setOssia(!this.ossia);
    });
    el.volume.addEventListener('input', () => {
      this.setVolume(Number(el.volume.value));
    });
    el.scrub.addEventListener('input', () => {
      this.scrubTo(Number(el.scrub.value));
    });
    el.region.addEventListener('change', () => {
      const region = REGIONS.find((r) => r.slug === el.region.value);
      if (region) void this.setRegion(region);
    });
    el.yesterday.addEventListener('click', () => void this.playDay());
    el.yesterdayQuick.addEventListener('click', () => void this.playDay());
    el.liveQuick.addEventListener('click', () => {
      this.goLive();
    });
    el.onwards.addEventListener('click', () => void this.playOnwards());
    el.live.addEventListener('click', () => {
      this.goLive();
    });
    for (const [fuel, ref] of this.voiceRefs) ref.button.addEventListener('click', () => void this.toggleAudition(fuel));

    el.shortcuts.checked = this.shortcuts;
    el.shortcuts.addEventListener('change', () => {
      this.shortcuts = el.shortcuts.checked;
      store.set('shortcuts', this.shortcuts ? 'on' : 'off');
    });
    installShortcuts(() => this.shortcuts, {
      togglePlay: () => void this.togglePlay(),
      toggleMute: () => {
        this.toggleMute();
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
        this.nudgeVolume(delta);
      },
    });
    document.addEventListener('visibilitychange', () => {
      this.feed.pollIfOverdue();
    });

    const resize = new ResizeObserver(() => {
      this.score.resize();
      this.ribbon.resize();
      this.ribbonKey = '';
    });
    resize.observe(el.scoreCanvas);
    resize.observe(el.ribbonCanvas);
    this.reduced.addEventListener('change', () => {
      this.score.resize();
    });
    void document.fonts.ready.then(() => {
      this.ribbonKey = '';
    });
    setInterval(() => {
      this.updatePlayButton();
      this.feed.pollIfOverdue();
    }, 1000);
  }
}

