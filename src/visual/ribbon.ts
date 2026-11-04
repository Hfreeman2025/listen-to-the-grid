import type { GridPeriod } from '../data/series';
import { HOUR, londonDayStart } from '../data/time';
import { MODE_LADDER } from '../music/harmony';
import { MODE_NAMES, clock, dayOfMonth, weekday } from '../ui/format';
import { MONO_FONT, SANS_FONT } from '../notation/paint';
import { CURSOR, INK } from './score';

/** Highest intensity the strip is scaled to, in g/kWh. */
const TOP_G = 300;

export interface RibbonState {
  series: readonly GridPeriod[];
  /** the instant being played */
  cursor: number;
  /** a span to mark, such as the day being replayed */
  span: { start: number; end: number } | null;
  live: boolean;
}

/**
 * The week as an engraved chart: carbon intensity as an ink line over fine
 * hatching, with faint guides where the music changes mode. It sits behind a
 * transparent range input, which does the work of being a slider.
 */
export class Ribbon {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D is not available');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.w = rect.width;
    this.h = rect.height;
  }

  draw({ series, cursor, span, live }: RibbonState): void {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const first = series[0];
    const last = series[series.length - 1];
    if (!first || !last) return;
    const labelW = w < 640 ? 0 : 74;
    const t0 = first.start;
    const t1 = last.end;
    const x = (t: number): number => ((t - t0) / (t1 - t0)) * (w - labelW);
    const top = 22;
    const bottom = h - 8;
    const y = (g: number): number => bottom - (Math.min(TOP_G, g) / TOP_G) * (bottom - top);

    // Mode guides: where each mode begins, named at the right.
    ctx.font = `italic 400 11px ${SANS_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    MODE_LADDER.forEach((band, i) => {
      const next = MODE_LADDER[i + 1];
      if (i > 0 && band.from < TOP_G) {
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.22;
        for (let gx = 0; gx < w - labelW; gx += 4) ctx.fillRect(gx, Math.round(y(band.from)), 1.6, 1);
        ctx.globalAlpha = 1;
      }
      if (labelW > 0) {
        const mid = (band.from + Math.min(next ? next.from : TOP_G, TOP_G)) / 2;
        ctx.fillStyle = '#5a5249';
        ctx.fillText(`D ${MODE_NAMES[band.mode]}`, w - labelW + 8, y(mid));
      }
    });

    // Hatching under the line, as an engraver shades an area.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x(t0), bottom);
    for (const p of series) ctx.lineTo(x((p.start + p.end) / 2), y(p.intensity));
    ctx.lineTo(x(t1), bottom);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let d = -h; d < w; d += 5) {
      ctx.moveTo(d, bottom);
      ctx.lineTo(d + (bottom - top), top);
    }
    ctx.stroke();
    ctx.restore();

    // The line itself.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    series.forEach((p, i) => {
      const px = x((p.start + p.end) / 2);
      if (i === 0) ctx.moveTo(px, y(p.intensity));
      else ctx.lineTo(px, y(p.intensity));
    });
    ctx.stroke();

    // Days: a rule at each midnight, the day above.
    ctx.font = `400 11px ${MONO_FONT}`;
    ctx.textBaseline = 'alphabetic';
    for (let d = londonDayStart(t0); d < t1; d = londonDayStart(d + 26 * HOUR)) {
      const dx = x(d);
      if (dx >= 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(Math.round(dx), top - 6, 1, bottom - top + 6);
      }
      const label = `${weekday(d + 12 * HOUR)} ${dayOfMonth(d + 12 * HOUR)}`;
      const lx = Math.max(2, dx + 4);
      if (lx + ctx.measureText(label).width < w - labelW - 2 && x(d + 24 * HOUR) - lx > 36) {
        ctx.fillStyle = '#5a5249';
        ctx.fillText(label, lx, top - 9);
      }
    }
    ctx.fillStyle = INK;
    ctx.fillRect(0, bottom, w - labelW, 1);

    // The replayed span, ruled under the strip.
    if (span) {
      ctx.fillStyle = CURSOR;
      ctx.fillRect(x(span.start), bottom + 3, Math.max(1, x(span.end) - x(span.start)), 2);
    }

    // The cursor: the conductor's red pencil.
    const cx = Math.round(Math.min(w - labelW - 1, Math.max(1, x(cursor)))) + 0.5;
    ctx.fillStyle = CURSOR;
    ctx.fillRect(cx - 1, top - 4, 2, bottom - top + 8);
    ctx.font = `600 11px ${MONO_FONT}`;
    const tag = live ? 'now' : clock(cursor);
    const tw = ctx.measureText(tag).width;
    const tx = Math.min(w - labelW - tw - 4, Math.max(2, cx + 5));
    ctx.fillStyle = 'rgba(244, 239, 230, 0.94)';
    ctx.fillRect(tx - 3, top - 2, tw + 6, 15);
    ctx.fillStyle = CURSOR;
    ctx.fillText(tag, tx, top + 9);
  }
}
