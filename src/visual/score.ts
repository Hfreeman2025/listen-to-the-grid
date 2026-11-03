import { BAR_SECONDS, STEP_SECONDS, type Bar } from '../music/conductor';
import type { Mode } from '../music/theory';
import type { BarPair } from '../player';
import { OSSIA_SCALE, TIER_1, engraveBar, engraveFrame, engraveOssiaFrame, ossiaHeight, staffPositions, tierAbove, type Engraved, type Frame, type Mark, type Tail } from '../notation/engrave';
import { MUSIC_FONT, TEXT_FONT, musicFontReady, paintMark, paintMarks } from '../notation/paint';

export const INK = '#1a1714';
export const CURSOR = '#c23b22';

export interface ScoreOptions {
  /** reduced motion: no cursor, each bar appears whole at its bar line */
  reduced: () => boolean;
  /** text above a replayed bar: the hour it stands for */
  cue: (bar: number, start: number) => string | undefined;
}

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

/** Bars per system for a canvas width: four on a desktop, two on a phone. */
export function barsPerSystem(width: number): number {
  return width >= 760 ? 4 : width >= 520 ? 3 : 2;
}

/** The words over the ossia: what it is, and that it is not a reading. */
export const OSSIA_LABEL = 'ossia: fully renewable, hypothetical';

interface Layout {
  w: number;
  h: number;
  dpr: number;
  sp: number;
  bars: number;
  short: boolean;
  /** y of the system's top (its tiers above the first staff) */
  top: number;
  /** y of the ossia block above the system, when there is one */
  ossiaTop: number;
}

/** Size a canvas to its box and work out the system's staff space and bar count, leaving room for an ossia if asked. */
function layoutFor(canvas: HTMLCanvasElement, extra: HTMLCanvasElement[] = [], ossia = false): Layout {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = rect.width;
  const h = rect.height;
  const above = ossia ? ossiaHeight() : 0;
  const height = staffPositions().height + above;
  const sp = Math.max(4.2, Math.min(9, (h - 8) / height));
  for (const c of [canvas, ...extra]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const top = Math.max(2, (h - height * sp) / 2);
  return { w, h, dpr, sp, bars: barsPerSystem(w), short: w < 640, top: top + above * sp, ossiaTop: top };
}

/**
 * The page before the orchestra arrives: an empty system, staves, clefs and
 * names engraved, waiting for its first bar. Shown while NESO is asked.
 */
export async function paintBlankPage(canvas: HTMLCanvasElement): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const L = layoutFor(canvas);
  const { marks } = engraveFrame({ sp: L.sp, top: L.top, width: L.w, bars: L.bars, mode: 'dorian', short: L.short, time: true });
  const draw = (all: boolean): void => {
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    paintMarks(ctx, all ? marks : marks.filter((m) => m.k === 'line' || m.k === 'rect' || m.k === 'text'), L.sp, INK);
  };
  draw(false);
  try {
    await musicFontReady();
    draw(true);
  } catch {
    // no music font: the staves alone still read as a page
  }
}

/**
 * The live score, one system at a time like a page of a printed score. A
 * standing page is the recent past engraved in full with the present as its
 * last bar; a flowing page fills bar by bar and turns. Either way each mark
 * of the sounding music is inked when it is heard, and a cursor follows it.
 * With the ossia on, small staves above carry the same bars re-scored for a
 * fully renewable grid: over the live bar on a standing page, over every bar
 * of a replay.
 */
export class Score {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cursorCtx: CanvasRenderingContext2D;
  private readonly bars = new Map<number, { bar: Bar; ossia: Bar; start: number }>();
  private layout: Layout = { w: 0, h: 0, dpr: 1, sp: 6, bars: 4, short: false, top: 0, ossiaTop: 0 };
  private page: Page = { kind: 'flowing', key: '', from: 0 };
  private ossia = false;
  /** key of the page as built for the current layout and fonts; null when it needs building */
  private built: string | null = null;
  /** flowing: the system on screen */
  private system = -1;
  /** standing: the music bar in the last slot */
  private live = -1;
  private frame: Frame | null = null;
  private ossiaFrame: Frame | null = null;
  /** what is engraved before the music arrives, kept to redraw under each new live bar; each set of marks with its staff space */
  private plate: { marks: Mark[]; sp: number }[] = [];
  private firstNumber: number | null = null;
  /** top of the words over the system's first bar, which the tempo mark must clear, and where it went */
  private headTop = Infinity;
  private headBase = 0;
  private engraved = new Map<number, Engraved>();
  private ossiaEngraved = new Map<number, Engraved>();
  private queue: { t: number; mark: Mark; sp: number }[] = [];
  private shown = 0;
  private lastMode: Mode = 'dorian';
  private fontsReady = false;

  /**
   * Notes are inked straight onto `canvas` and never erased until their bar
   * is rewritten or the page turns; the cursor lives on its own transparent
   * `cursor` canvas above it, so a frame usually costs one thin rectangle.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cursor: HTMLCanvasElement,
    private readonly origin: number,
    private readonly opts: ScoreOptions,
  ) {
    const ctx = canvas.getContext('2d');
    const cursorCtx = cursor.getContext('2d');
    if (!ctx || !cursorCtx) throw new Error('canvas 2D is not available');
    this.ctx = ctx;
    this.cursorCtx = cursorCtx;
    this.resize();
    void musicFontReady().then(() => {
      this.fontsReady = true;
      this.built = null;
    });
  }

  setPage(page: Page): void {
    if (page.key === this.page.key) return;
    this.page = page;
    this.built = null;
  }

  /** Print the ossia above the system, or take it away. */
  setOssia(on: boolean): void {
    if (on === this.ossia) return;
    this.ossia = on;
    this.resize();
  }

  resize(): void {
    this.layout = layoutFor(this.canvas, [this.cursor], this.ossia);
    this.built = null;
  }

  addBar(pair: BarPair, start: number): void {
    const bar = pair.real;
    this.bars.set(bar.index, { bar, ossia: pair.ossia, start });
    this.lastMode = bar.mode;
    // Forget bars more than two systems behind.
    for (const k of this.bars.keys()) if (k < bar.index - this.layout.bars * 2) this.bars.delete(k);
    const page = this.page;
    if (page.kind !== 'flowing' || this.built === null) return;
    // A page opened before its first bar was composed (a replay's count-in)
    // takes that bar's key once it is known.
    if (bar.index === page.from + this.system * this.layout.bars && bar.mode !== this.frame?.mode) this.built = null;
    else this.engraveSlot(bar.index);
  }

  draw(now: number): void {
    const L = this.layout;
    const barIndex = Math.max(0, Math.floor((now - this.origin) / BAR_SECONDS));
    const page = this.page;
    if (page.kind === 'standing') {
      if (this.built !== page.key) this.buildStanding(page, barIndex);
      if (barIndex !== this.live && this.bars.has(barIndex)) this.writeLive(page, barIndex);
    } else {
      const system = Math.max(0, Math.floor((barIndex - page.from) / L.bars));
      if (this.built !== page.key || system !== this.system) this.buildFlowing(page, system);
    }
    if (this.canvas.dataset.bar !== String(barIndex)) this.canvas.dataset.bar = String(barIndex);
    // Ink in every mark whose moment has come; with reduced motion, whole bars at their bar line.
    const reduced = this.opts.reduced();
    const until = reduced ? this.barStart(barIndex) + 0.001 : now + 0.004;
    const c = this.ctx;
    c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    c.fillStyle = INK;
    c.strokeStyle = INK;
    while (this.shown < this.queue.length) {
      const next = this.queue[this.shown];
      if (!next || next.t > until) break;
      paintMark(c, next.mark, next.sp);
      this.shown++;
    }
    const k = this.cursorCtx;
    k.setTransform(1, 0, 0, 1, 0, 0);
    k.clearRect(0, 0, this.cursor.width, this.cursor.height);
    if (reduced) return;
    if (page.kind === 'standing') {
      if (this.live === barIndex) this.drawCursor(now, barIndex, L.bars - 1);
    } else {
      // Before a replay's first downbeat the cursor waits at the top of the page.
      const slot = barIndex - page.from - this.system * L.bars;
      this.drawCursor(now, barIndex, barIndex < page.from ? null : slot);
    }
  }

  private barStart(index: number): number {
    return this.bars.get(index)?.start ?? this.origin + index * BAR_SECONDS;
  }

  /** Time labels and notes over the bars, never smaller than a readable size. */
  private get cueSize(): number {
    return Math.max(1.3, 11 / this.layout.sp);
  }

  private keepGlyphs(marks: readonly Mark[]): Mark[] {
    // Before the music font arrives, staves and text only; the page is rebuilt when it does.
    return this.fontsReady ? [...marks] : marks.filter((m) => m.k !== 'glyph' && m.k !== 'brace');
  }

  /** Clear the page and engrave its frame, then the bars already known. */
  private startPage(mode: Mode, time: boolean): Frame {
    const L = this.layout;
    const { frame, marks } = engraveFrame({ sp: L.sp, top: L.top, width: L.w, bars: L.bars, mode, short: L.short, time, cueSize: this.cueSize });
    this.frame = frame;
    this.ossiaFrame = null;
    this.headTop = Infinity;
    this.plate = [{ marks: this.keepGlyphs(marks), sp: L.sp }];
    this.engraved = new Map();
    this.ossiaEngraved = new Map();
    this.queue = [];
    this.shown = 0;
    return frame;
  }

  /** The ossia's small staves over `bars` bars from slot `from`, added to the plate. */
  private startOssia(from: number, bars: number, mode: Mode): void {
    const f = this.frame;
    const L = this.layout;
    if (!this.ossia || !f) return;
    const sp = L.sp * OSSIA_SCALE;
    const { frame, marks } = engraveOssiaFrame({
      sp,
      top: L.ossiaTop,
      x0: f.firstBarX + from * f.barWidth,
      barWidth: f.barWidth,
      bars,
      mode,
      short: true,
    });
    this.ossiaFrame = frame;
    this.plate.push({ marks: this.keepGlyphs(marks), sp });
  }

  private paintPlate(): void {
    const L = this.layout;
    const c = this.ctx;
    c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    for (const p of this.plate) paintMarks(c, p.marks, p.sp, INK);
    if (this.fontsReady) this.paintHeading();
  }

  private finishPage(key: string, kind: Page['kind'], label: string): void {
    const L = this.layout;
    this.ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    this.ctx.clearRect(0, 0, L.w, L.h);
    this.paintPlate();
    this.built = key;
    this.canvas.dataset.page = kind;
    this.canvas.dataset.ossia = this.ossia ? 'on' : '';
    this.canvas.setAttribute('aria-label', label);
    // The page's first meaningful paint: a fully engraved system.
    if (this.fontsReady && performance.getEntriesByName('score:engraved').length === 0) performance.mark('score:engraved');
  }

  /** The half-hours before the moment, engraved whole; the last bar waits for the music. */
  private buildStanding(page: Extract<Page, { kind: 'standing' }>, barIndex: number): void {
    const n = this.layout.bars;
    const past = page.past.slice(-(n - 1));
    const empty = n - 1 - past.length;
    const mode = past[0]?.bar.mode ?? this.bars.get(barIndex)?.bar.mode ?? this.lastMode;
    const frame = this.startPage(mode, true);
    const sp = frame.sp;
    const main = this.plate[0];
    let tails: (Tail | null)[] = [];
    past.forEach((p, i) => {
      const engraved = engraveBar(p.bar, {
        frame,
        slot: empty + i,
        previous: past[i - 1]?.bar ?? null,
        tails,
        firstInSystem: i === 0,
        cue: p.label,
        cueSize: this.cueSize,
        cueAfter: true,
        whole: true,
      });
      tails = engraved.tails;
      if (empty + i === 0) this.headTop = engraved.top;
      main?.marks.push(...this.keepGlyphs(engraved.marks));
    });
    // Bars the data cannot fill stay empty, and say why.
    if (empty > 0) {
      main?.marks.push({ k: 'text', x: frame.firstBarX + 0.4 * sp, y: (frame.ys[0] ?? 0) - 2 * sp - TIER_1 * sp, text: page.note, style: 'italic', align: 'left', size: this.cueSize * 1.1 });
    }
    // The ossia stands over the present only: the past is as it was.
    this.startOssia(n - 1, 1, this.bars.get(barIndex)?.ossia.mode ?? 'lydian');
    const first = past[0];
    const counted = page.now.number - (n - 1);
    this.firstNumber = empty === 0 && first ? first.number : counted > 0 ? counted : null;
    this.live = -1;
    const when = past.length > 0 ? `the half-hours from ${past[0]?.label ?? ''} engraved, then ` : '';
    const ossia = this.ossia ? ` Above it, an ossia: the same half-hour re-scored for a hypothetical, fully renewable grid.` : '';
    this.finishPage(page.key, 'standing', `The score: ${when}the ${page.now.live ? 'live' : 'held'} half-hour from ${page.now.label.replace(/ \D.*$/, '')}, written as it plays.${ossia}`);
    this.canvas.dataset.past = past.map((p) => p.label).join(',');
    this.canvas.dataset.now = page.now.label;
    this.canvas.dataset.note = empty > 0 ? page.note : '';
  }

  /**
   * A new bar of the music now playing: wipe the last slot back to its bare
   * staves (by redrawing the plate under a clip) and queue the bar's marks to
   * ink as they sound, with its ossia above. It never ties back into the
   * past, which it does not follow musically; its key and dynamics are
   * written against the bar before it on the page.
   */
  private writeLive(page: Extract<Page, { kind: 'standing' }>, index: number): void {
    const entry = this.bars.get(index);
    if (!entry) return;
    const L = this.layout;
    const slot = L.bars - 1;
    const past = page.past.slice(-(L.bars - 1));
    const prev = past[past.length - 1]?.bar ?? null;
    // With no past to set the key, the page takes the music's own.
    if (!prev && entry.bar.mode !== this.frame?.mode) this.buildStanding(page, index);
    const f = this.frame;
    if (!f) return;
    const sp = f.sp;
    const c = this.ctx;
    const x0 = f.firstBarX + slot * f.barWidth - 0.8 * sp;
    c.save();
    c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    c.beginPath();
    c.rect(x0, 0, L.w - x0, L.h);
    // The ossia's band too, where its label runs out over the bars before.
    if (this.ossiaFrame) c.rect(0, 0, L.w, L.top);
    c.clip();
    c.clearRect(0, 0, L.w, L.h);
    this.paintPlate();
    c.restore();
    const whole = this.opts.reduced();
    const bar = prev ? { ...entry.bar, keyChange: entry.bar.mode !== prev.mode } : entry.bar;
    const engraved = engraveBar(bar, {
      frame: f,
      slot,
      previous: prev,
      tails: [],
      firstInSystem: !prev,
      cue: page.now.label,
      cueSize: this.cueSize,
      cueAfter: true,
      cueLive: page.now.live,
      whole,
      restart: true,
    });
    this.engraved = new Map([[index, engraved]]);
    const items = this.timed(engraved.marks, entry.start, sp);
    const o = this.ossiaFrame;
    if (o) {
      // Its label runs left from the system's end, over the half-hours past, where there is room.
      const alt = engraveBar(entry.ossia, { frame: o, slot: 0, previous: null, tails: [], firstInSystem: true, whole, restart: true, label: this.ossiaLabel(o.staffRight, 'right') });
      this.ossiaEngraved = new Map([[index, alt]]);
      items.push(...this.timed(alt.marks, entry.start, o.sp));
    }
    this.queue = items.sort((a, b) => a.t - b.t);
    this.shown = 0;
    this.live = index;
  }

  private ossiaLabel(x: number, align: 'left' | 'right'): { text: string; size: number; x: number; align: 'left' | 'right' } {
    return { text: OSSIA_LABEL, size: Math.max(2.1, 11 / (this.layout.sp * OSSIA_SCALE)), x, align };
  }

  private timed(marks: readonly Mark[], start: number, sp: number): { t: number; mark: Mark; sp: number }[] {
    return this.keepGlyphs(marks).map((mark) => ({ t: start + ('at' in mark ? (mark.at ?? 0) : 0) * STEP_SECONDS, mark, sp }));
  }

  private buildFlowing(page: Extract<Page, { kind: 'flowing' }>, system: number): void {
    const L = this.layout;
    this.built = null;
    this.system = system;
    const firstIndex = page.from + system * L.bars;
    const first = this.bars.get(firstIndex);
    this.startPage(first?.bar.mode ?? this.lastMode, system === 0);
    // A replayed day is re-scored bar by bar, so its ossia runs the whole system.
    this.startOssia(0, L.bars, first?.ossia.mode ?? 'lydian');
    this.firstNumber = system * L.bars + 1;
    // Bars already composed first, so the tempo mark can clear the first one's words.
    for (let slot = 0; slot < L.bars; slot++) {
      const index = firstIndex + slot;
      if (this.bars.has(index)) this.engraveSlot(index);
    }
    const ossia = this.ossia ? ' Above it, an ossia: the same hours re-scored for a hypothetical, fully renewable grid.' : '';
    this.finishPage(page.key, 'flowing', `The score of the day being replayed, one bar an hour, written as it plays.${ossia}`);
    this.canvas.dataset.past = '';
    this.canvas.dataset.now = '';
    this.canvas.dataset.note = '';
  }

  /** Tempo mark and the system's first bar number, on their tiers above the top staff. */
  private paintHeading(): void {
    const f = this.frame;
    if (!f) return;
    const c = this.ctx;
    const sp = f.sp;
    const topLine = (f.ys[0] ?? 0) - 2 * sp;
    c.fillStyle = INK;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.font = `700 ${1.75 * sp}px ${TEXT_FONT}`;
    const tempo = 'Andante';
    const x = f.firstBarX;
    const y2 = Math.min(topLine - tierAbove(this.cueSize) * sp, this.headTop - 0.6 * sp);
    this.headBase = y2;
    c.fillText(tempo, x, y2);
    const tw = c.measureText(tempo).width;
    c.font = `${2.9 * sp}px ${MUSIC_FONT}`;
    c.fillText('\u{1D15F}', x + tw + 0.8 * sp, y2 + 0.15 * sp);
    c.font = `500 ${1.6 * sp}px ${TEXT_FONT}`;
    c.fillText('= 96', x + tw + 2.2 * sp, y2);
    if (this.firstNumber === null) return;
    c.font = `italic 400 ${1.35 * sp}px ${TEXT_FONT}`;
    c.textAlign = 'right';
    c.fillText(String(this.firstNumber), x - 0.6 * sp, topLine - TIER_1 * sp);
  }

  /** Engrave a replayed bar (and its ossia) into its slot, if it belongs to the system on screen. */
  private engraveSlot(index: number): void {
    const f = this.frame;
    const L = this.layout;
    const page = this.page;
    const entry = this.bars.get(index);
    if (page.kind !== 'flowing' || !f || !entry || this.engraved.has(index)) return;
    const slot = index - page.from - this.system * L.bars;
    if (slot < 0 || slot >= L.bars) return;
    const whole = this.opts.reduced();
    const engraved = engraveBar(entry.bar, {
      frame: f,
      slot,
      previous: this.bars.get(index - 1)?.bar ?? null,
      tails: this.engraved.get(index - 1)?.tails ?? ([] as (Tail | null)[]),
      firstInSystem: slot === 0,
      cue: this.opts.cue(index, entry.start),
      cueSize: this.cueSize,
      cueAfter: true,
      whole,
    });
    this.engraved.set(index, engraved);
    if (slot === 0) {
      this.headTop = engraved.top;
      // A first bar that arrives after its page was painted, reaching up into the tempo mark: set the page again.
      if (this.built !== null && engraved.top < this.headBase + 0.3 * f.sp) this.built = null;
    }
    const items = this.timed(engraved.marks, entry.start, f.sp);
    const o = this.ossiaFrame;
    if (o) {
      const alt = engraveBar(entry.ossia, {
        frame: o,
        slot,
        previous: this.bars.get(index - 1)?.ossia ?? null,
        tails: this.ossiaEngraved.get(index - 1)?.tails ?? ([] as (Tail | null)[]),
        firstInSystem: slot === 0,
        whole,
        ...(slot === 0 ? { label: this.ossiaLabel(o.staffLeft, 'left') } : {}),
      });
      this.ossiaEngraved.set(index, alt);
      items.push(...this.timed(alt.marks, entry.start, o.sp));
    }
    // Merge into the part of the queue not yet inked, keeping time order.
    const pending = this.queue.slice(this.shown).concat(items).sort((a, b) => a.t - b.t);
    this.queue = this.queue.slice(0, this.shown).concat(pending);
  }

  /** The cursor follows the music through the bar's columns, as a score follower would; `slot` null parks it at the first bar line. */
  private drawCursor(now: number, barIndex: number, slot: number | null): void {
    const f = this.frame;
    const L = this.layout;
    if (!f) return;
    let x = f.firstBarX;
    if (slot !== null) {
      const into = (now - this.barStart(barIndex)) / STEP_SECONDS;
      const cols = this.engraved.get(barIndex)?.columns ?? [];
      const barX = f.firstBarX + slot * f.barWidth;
      const points = [{ step: 0, x: barX }, ...cols.filter((c) => c.step > 0), { step: 16, x: barX + f.barWidth }];
      x = barX;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (a && b && into >= a.step && into <= b.step) {
          x = a.x + ((into - a.step) / (b.step - a.step)) * (b.x - a.x);
          break;
        }
      }
    }
    const ctx = this.cursorCtx;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    // Through the ossia too, when it is printed: both are the same moment.
    const o = this.ossiaFrame;
    const top = o ? (o.ys[0] ?? 0) - 2.5 * o.sp : (f.ys[0] ?? 0) - 3 * f.sp;
    const bottom = (f.ys[f.ys.length - 1] ?? 0) + 2.5 * f.sp;
    ctx.fillStyle = CURSOR;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(Math.round(x) - 1, top, 2, bottom - top);
    ctx.globalAlpha = 1;
  }
}
