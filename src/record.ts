import { integratedLoudness, samplePeakDb } from './audio/loudness';
import { RECORD_CEILING_DB, RECORD_TARGET_LUFS, recordGain } from './audio/match';
import { renderOffline } from './audio/render';
import { encodeWav, type RecordTags } from './audio/wav';
import { FIRST_DAY, describeError, fetchDay, type Day } from './data/api';
import type { Region } from './data/regions';
import type { GridPeriod } from './data/series';
import { HOUR, londonDay, londonDayStart, londonParts } from './data/time';
import { BAR_SECONDS } from './music/conductor';
import { composeDay, seedFor, type DayScore } from './music/day';
import { ossiaOf } from './music/ossia';
import { STAVES } from './notation/engrave';
import type { Player } from './player';
import type { Elements } from './ui/elements';
import { MODE_NAMES, clock, longDay } from './ui/format';
import { canvasFontsReady } from './notation/paint';
import { CURSOR } from './visual/score';
import { drawSleeve, type SleeveBar, type SleeveText } from './visual/sleeve';

/** Records are pressed at CD rate: smaller files, played everywhere. */
const RATE = 44100;
/** Download sleeve and embedded cover sizes, in pixels. */
const SLEEVE_PNG = 2400;
const COVER_JPEG = 1000;

export interface RecordDeps {
  region: () => Region;
  /** the half-hours already on the page (the week, or the recorded sample) */
  known: () => readonly GridPeriod[];
  /** true when the page is playing its bundled sample, not NESO */
  offline: () => boolean;
  sampleDate: string;
  /** whether the ossia is on: a press then makes the fully renewable hypothetical, labelled as such */
  ossia: () => boolean;
  player: Player;
  ensurePlaying: () => Promise<void>;
  announce: (text: string) => void;
}

interface Pressed {
  day: Day;
  region: Region;
  /** the ossia's fully renewable hypothetical, rather than the day as it was */
  ossia: boolean;
  score: DayScore;
  text: SleeveText;
  buffer: AudioBuffer | null;
  /** its loudness once pressed to the common level (ITU-R BS.1770) */
  loudness: { lufs: number; peakDb: number; gainDb: number; limited: boolean } | null;
}

/**
 * Press a rendered record to the common loudness: measure it (ITU-R BS.1770),
 * then scale it to -16 LUFS, or as near as its peak allows.
 */
function pressToLevel(buffer: AudioBuffer): NonNullable<Pressed['loudness']> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const lufs = integratedLoudness(channels, buffer.sampleRate).integrated;
  const peakDb = samplePeakDb(channels);
  const gainDb = recordGain(lufs, peakDb);
  const g = 10 ** (gainDb / 20);
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] = (c[i] ?? 0) * g;
  return { lufs: lufs + gainDb, peakDb: peakDb + gainDb, gainDb, limited: gainDb < RECORD_TARGET_LUFS - lufs - 0.05 };
}

/** An ossia record's sleeve engraves only the parts that play in it. */
const OSSIA_SLEEVE_STAVES = STAVES.filter((s) => s.fuel === 'wind' || s.fuel === 'solar' || s.fuel === 'hydro');
const TACET = 'Gas, coal, nuclear, biomass, imports and other: tacet. The ossia plays wind, sun and water alone.';

const iso = (t: number): string => {
  const p = londonParts(t);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/**
 * "Any day, pressed as a record": fetch a day, compose it, engrave its
 * sleeve, render it offline faster than real time, and hand over a WAV with
 * the sleeve inside it. The sleeve is drawn before the audio exists and the
 * audio is rendered from the very same bars, so they always agree.
 */
export class RecordPress {
  private current: Pressed | null = null;
  private urls: string[] = [];
  private layout: SleeveBar[] = [];
  private image: HTMLCanvasElement | null = null;
  private playing: { stop: () => void; startsAt: number } | null = null;
  private busy = false;
  private fontsReady = false;
  /** a day chosen but not yet fetched: its title page stands in for the sleeve */
  private pending: string | null = null;

  constructor(
    private readonly el: Elements,
    private readonly deps: RecordDeps,
  ) {
    const yesterday = iso(londonDayStart(Date.now()) - 1);
    el.recordDate.min = FIRST_DAY;
    el.recordDate.max = yesterday;
    el.recordDate.value = deps.offline() ? deps.sampleDate : yesterday;
    el.recordForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.press(el.recordDate.value);
    });
    el.recordPlay.addEventListener('click', () => void this.togglePlay());
    // The sleeve always shows the day in the box.
    el.recordDate.addEventListener('change', () => {
      if (this.busy) return;
      this.stopPlaying();
      this.current = null;
      el.recordResult.hidden = true;
      this.status('');
      this.preview();
    });
    new ResizeObserver(() => {
      this.paint();
    }).observe(el.sleeve);
    // A canvas can't redraw itself when a font arrives late, so the sleeve
    // waits for every music glyph before it is engraved.
    void canvasFontsReady()
      .catch(() => undefined)
      .then(() => {
        this.fontsReady = true;
        this.paint();
      });
    this.preview();
  }

  /**
   * Before anything is pressed, show a sleeve for the day in the date box if
   * the page already holds its figures (yesterday, from the week), so the
   * section is never empty and costs no requests.
   */
  preview(): void {
    if (this.current?.buffer || this.busy) return;
    const date = this.el.recordDate.value;
    const day = this.fromKnown(date);
    if (!day) {
      this.current = null;
      const valid = this.el.recordDate.checkValidity() && date !== '';
      this.pending = valid ? date : null;
      this.el.sleeveCaption.textContent = valid ? `Press the record to fetch NESO’s figures for this day and engrave its sleeve.` : 'Choose a day, then press it.';
      this.paint();
      return;
    }
    this.pending = null;
    this.current = this.compose(day, this.deps.region(), this.deps.ossia());
    this.el.sleeveCaption.textContent = this.current.ossia
      ? `The ossia sleeve for ${longDay(day.span.start)}: the day re-scored as fully renewable, a hypothetical. Press it to hear it.`
      : `The sleeve for ${longDay(day.span.start)}. Press it to hear the record.`;
    this.paint();
  }

  /**
   * The ossia was switched on or off: the sleeve shows the version a press
   * would now make. A record already pressed is set aside, as when the day
   * changes; one being pressed finishes as the version it began as, and is
   * labelled so.
   */
  versionChanged(): void {
    this.el.recordPress.textContent = this.deps.ossia() ? 'Press the ossia record' : 'Press the record';
    if (this.busy) return;
    this.stopPlaying();
    this.current = null;
    this.el.recordResult.hidden = true;
    this.status('');
    this.preview();
  }

  private fromKnown(date: string): Day | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [y, m, d] = date.split('-').map(Number);
    const span = londonDay(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 12));
    const series = this.deps.known().filter((p) => p.start >= span.start && p.start < span.end);
    const expected = Math.round((span.end - span.start) / (HOUR / 2));
    return series.length === expected ? { span, series, expected } : null;
  }

  private compose(day: Day, region: Region, ossia: boolean): Pressed {
    const seed = seedFor(iso(day.span.start), region.slug);
    const score = composeDay(day.series, day.span, seed, ossia ? ossiaOf : undefined);
    const values = day.series.map((p) => p.intensity);
    const journey: string[] = [];
    for (const b of score.bars) {
      const name = `D ${MODE_NAMES[b.mode]}`;
      if (journey[journey.length - 1] !== name) journey.push(name);
    }
    const regional = region.id !== null;
    const offline = this.deps.offline();
    const data = `Data: NESO Carbon Intensity API, CC BY 4.0. ${day.series.length} of ${day.expected} half-hours${regional ? '; regional figures are NESO’s modelled estimates' : ''}.`;
    const range = `${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))} g CO₂/kWh`;
    const text: SleeveText = ossia
      ? {
          title: longDay(day.span.start),
          dedication: `ossia: the grid of ${region.name}${offline ? ' (recorded sample)' : ''} as if fully renewable, a hypothetical`,
          footer: [
            `Hypothetical, not the day as it was: gas, coal, nuclear, biomass, imports and other set to 0, their share given to wind, solar and hydro in proportion to their real shares each hour.`,
            `Ossia 0 g CO₂/kWh throughout (the real day: ${range}). Keys: ${journey.join(' → ')}. ${data}`,
          ],
          cue: (bar) => clock(day.span.start + bar * HOUR),
          tacet: TACET,
        }
      : {
          title: longDay(day.span.start),
          dedication: `for the electricity grid of ${region.name}${offline ? ' (recorded sample)' : ''}`,
          footer: [data, `Carbon intensity ${range}. Keys: ${journey.join(' → ')}.`],
          cue: (bar) => clock(day.span.start + bar * HOUR),
        };
    return { day, region, ossia, score, text, buffer: null, loudness: null };
  }

  /** Draw the sleeve (or an empty title page) at the preview's size. */
  private paint(): void {
    if (!this.fontsReady) return;
    const canvas = this.el.sleeve;
    const css = canvas.getBoundingClientRect().width;
    if (css === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(css * dpr);
    canvas.width = px;
    canvas.height = px;
    const image = document.createElement('canvas');
    image.width = px;
    image.height = px;
    const ctx = image.getContext('2d');
    if (!ctx) return;
    const c = this.current;
    const waiting = this.pending ? londonDay(Date.UTC(Number(this.pending.slice(0, 4)), Number(this.pending.slice(5, 7)) - 1, Number(this.pending.slice(8, 10)), 12)) : null;
    const ossia = this.deps.ossia();
    this.layout = c
      ? drawSleeve(ctx, px, c.score.bars, c.text, c.ossia ? OSSIA_SLEEVE_STAVES : STAVES)
      : drawSleeve(ctx, px, [], {
          title: waiting ? longDay(waiting.start) : 'Choose a day',
          dedication: waiting ? (ossia ? `ossia: the grid of ${this.deps.region().name} as if fully renewable, a hypothetical` : `for the electricity grid of ${this.deps.region().name}`) : 'and press it to hear the grid play it',
          footer: [waiting ? 'Not yet pressed: the score is engraved once NESO’s figures for the day arrive.' : `Any day from ${longDay(Date.UTC(2018, 4, 12, 12))} to yesterday.`],
          cue: () => '',
        });
    this.image = image;
    this.blit(null);
  }

  private blit(t: number | null): void {
    const canvas = this.el.sleeve;
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.image) return;
    ctx.drawImage(this.image, 0, 0);
    if (t === null) return;
    // Follow the record across the sleeve, bar by bar.
    const bar = Math.floor(t / BAR_SECONDS);
    const where = this.layout[Math.min(bar, this.layout.length - 1)];
    if (!where) return;
    const f = bar >= this.layout.length ? 1 : (t - bar * BAR_SECONDS) / BAR_SECONDS;
    const x = where.x0 + f * (where.x1 - where.x0);
    ctx.fillStyle = CURSOR;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(Math.round(x) - 1, where.top, Math.max(2, canvas.width / 400), where.bottom - where.top);
    ctx.globalAlpha = 1;
  }

  private status(text: string, error = false): void {
    this.el.recordStatus.textContent = text;
    this.el.recordStatus.classList.toggle('error', error);
  }

  async press(date: string): Promise<void> {
    if (this.busy) return;
    const el = this.el;
    if (!el.recordDate.checkValidity()) {
      this.status(`Choose a day between ${longDay(Date.UTC(2018, 4, 12, 12))} and yesterday.`, true);
      return;
    }
    this.busy = true;
    this.stopPlaying();
    el.recordPress.disabled = true;
    el.recordResult.hidden = true;
    const region = this.deps.region();
    const started = performance.now();
    try {
      let day = this.fromKnown(date);
      if (!day) {
        this.status(`Fetching NESO’s figures for ${date}…`);
        day = await fetchDay(date, region);
      }
      await canvasFontsReady().catch(() => undefined);
      this.fontsReady = true;
      const pressed = this.compose(day, region, this.deps.ossia());
      this.current = pressed;
      this.paint();
      // Browsers that report progress get a percentage; the others a running
      // count of seconds, so the page never looks stuck.
      let reported = false;
      const pressStart = performance.now();
      const label = pressed.ossia ? `Pressing the ossia of ${longDay(day.span.start)} (hypothetical)` : `Pressing ${longDay(day.span.start)}`;
      this.status(`${label}…`);
      const ticker = window.setInterval(() => {
        if (!reported) this.status(`${label}… ${Math.round((performance.now() - pressStart) / 1000)} s`);
      }, 500);
      const rendered = await renderOffline({
        seconds: pressed.score.seconds,
        sampleRate: RATE,
        seed: 0,
        at: pressed.score.at,
        bars: pressed.score.bars,
        fades: true,
        onProgress: (f) => {
          if (f >= 1) return;
          reported = true;
          this.status(`${label}: ${Math.round(f * 100)}%`);
        },
      }).finally(() => {
        clearInterval(ticker);
      });
      pressed.buffer = rendered.buffer;
      pressed.loudness = pressToLevel(rendered.buffer);
      await this.publish(pressed, (performance.now() - started) / 1000);
      this.deps.announce(`Pressed ${pressed.ossia ? 'the fully renewable ossia of ' : ''}${longDay(day.span.start)}. Play it here or download it.`);
    } catch (err) {
      this.status(`Couldn’t press that day: ${describeError(err)}. Nothing was downloaded; try again.`, true);
      this.el.sleeveCaption.textContent = this.current ? `Still showing ${this.current.text.title}; ${date} couldn’t be fetched.` : 'No sleeve yet: that day couldn’t be fetched.';
    } finally {
      this.busy = false;
      el.recordPress.disabled = false;
      el.recordPress.textContent = this.deps.ossia() ? 'Press the ossia record' : 'Press the record';
    }
  }

  private async publish(p: Pressed, seconds: number): Promise<void> {
    const el = this.el;
    const buffer = p.buffer;
    if (!buffer) return;
    for (const u of this.urls) URL.revokeObjectURL(u);
    const png = await this.sleeveBlob(SLEEVE_PNG, 'image/png');
    const cover = await this.sleeveBlob(COVER_JPEG, 'image/jpeg');
    const tags: RecordTags = {
      title: p.ossia ? `${p.text.title} (ossia: fully renewable, hypothetical)` : p.text.title,
      artist: `The electricity grid of ${p.region.name}`,
      album: 'Listen to the Grid',
      date: iso(p.day.span.start),
      comment: `${p.text.footer.join(' ')}${p.loudness ? ` Pressed to ${p.loudness.lufs.toFixed(1)} LUFS (ITU-R BS.1770).` : ''} Rendered in the browser by Listen to the Grid.`,
    };
    const wav = encodeWav(
      { sampleRate: buffer.sampleRate, channels: [buffer.getChannelData(0), buffer.getChannelData(1)] },
      tags,
      cover ? { mime: 'image/jpeg', data: new Uint8Array(await cover.arrayBuffer()) } : undefined,
    );
    const name = `listen-to-the-grid-${iso(p.day.span.start)}-${p.region.slug}${p.ossia ? '-ossia-fully-renewable-hypothetical' : ''}`;
    const wavUrl = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));
    el.recordWav.href = wavUrl;
    el.recordWav.download = `${name}.wav`;
    el.recordWav.textContent = `Download audio (WAV, ${(wav.length / 1e6).toFixed(1)} MB)`;
    this.urls = [wavUrl];
    if (png) {
      const pngUrl = URL.createObjectURL(png);
      el.recordPng.href = pngUrl;
      el.recordPng.download = `${name}-sleeve.png`;
      this.urls.push(pngUrl);
    }
    const values = p.day.series.map((x) => x.intensity);
    const min = Math.min(...values);
    const cleanest = p.day.series.find((x) => x.intensity === min);
    const minutes = Math.floor(buffer.duration / 60);
    const secs = String(Math.round(buffer.duration % 60)).padStart(2, '0');
    const notes: [string, string][] = [
      ['Day', longDay(p.day.span.start)],
      ...(p.ossia ? ([['Version', 'Ossia: fully renewable, a hypothetical (0 g CO₂/kWh)']] as [string, string][]) : []),
      ['Grid', p.region.id === null ? 'Great Britain' : `${p.region.name} (modelled estimates)`],
      ['Figures', `${p.day.series.length} of ${p.day.expected} half-hours from NESO`],
      [p.ossia ? 'Real cleanest' : 'Cleanest', cleanest ? `${clock(cleanest.start)}, ${Math.round(min)} g CO₂/kWh` : '–'],
      ['Keys', p.text.footer[1]?.replace(/^.*Keys: /, '').replace(/\..*$/, '') ?? ''],
      ['Record', `${minutes}:${secs}, ${p.score.bars.length} bars, 44.1 kHz stereo`],
      ...(p.loudness
        ? ([
            [
              'Loudness',
              `${p.loudness.lufs.toFixed(1)} LUFS (ITU-R BS.1770), peak ${p.loudness.peakDb.toFixed(1)} dBFS. Every record is pressed to ${RECORD_TARGET_LUFS} LUFS${p.loudness.limited ? `; this one stops short so its peak stays under ${RECORD_CEILING_DB} dBFS` : ''}, so any two compare fairly.`,
            ],
          ] as [string, string][])
        : []),
    ];
    el.recordNotes.replaceChildren(
      ...notes.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    el.recordResult.hidden = false;
    el.sleeveCaption.textContent = p.ossia
      ? `The ossia sleeve for ${longDay(p.day.span.start)}: the hypothetical, fully renewable record’s own score, ${p.score.bars.length} bars, one an hour.`
      : `The sleeve for ${longDay(p.day.span.start)}: the record’s own score, ${p.score.bars.length} bars, one an hour.`;
    this.status(`Pressed in ${seconds.toFixed(1)} seconds, here in your browser.`);
  }

  private sleeveBlob(size: number, type: string): Promise<Blob | null> {
    const p = this.current;
    if (!p) return Promise.resolve(null);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    drawSleeve(ctx, size, p.score.bars, p.text, p.ossia ? OSSIA_SLEEVE_STAVES : STAVES);
    return new Promise((resolve) => {
      canvas.toBlob(resolve, type, 0.88);
    });
  }

  private async togglePlay(): Promise<void> {
    if (this.playing) {
      this.stopPlaying();
      return;
    }
    const buffer = this.current?.buffer;
    if (!buffer) return;
    await this.deps.ensurePlaying();
    const handle = this.deps.player.playRecord(buffer, () => {
      this.playing = null;
      this.el.recordPlay.textContent = 'Play the record';
      this.blit(null);
    });
    this.playing = handle;
    this.el.recordPlay.textContent = 'Stop the record';
    const tick = (): void => {
      if (this.playing !== handle) return;
      const t = this.deps.player.recordTime(handle.startsAt);
      this.blit(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private stopPlaying(): void {
    this.playing?.stop();
  }
}
