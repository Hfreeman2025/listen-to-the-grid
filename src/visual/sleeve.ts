import type { Bar } from '../music/conductor';
import { STAVES, engraveBar, engraveFrame, staffPositions, type StaffDef, type Tail } from '../notation/engrave';
import { MUSIC_FONT, TEXT_FONT, UI_FONT, paintMarks } from '../notation/paint';
import { INK } from './score';

export const SLEEVE_PAPER = '#fbf8f2';
/** The hours over the sleeve's bars, printed larger than the live score's. */
const CUE = 2.1;

export interface SleeveText {
  /** "Wednesday 28 October 2026" */
  title: string;
  /** "for the electricity grid of Great Britain" */
  dedication: string;
  /** small print at the foot: data, range, modes */
  footer: string[];
  /** label above each bar: the hour it stands for */
  cue: (bar: number) => string;
  /** a line under the music: which parts are silent throughout, when only some are engraved */
  tacet?: string;
}

export interface SleeveBar {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

/** How a day's bars fall into the sleeve's three systems (8, 8, 8 for a 24-hour day). */
export function sleeveRows(count: number): number[] {
  const base = Math.floor(count / 3);
  const extra = count % 3;
  return [0, 1, 2].map((r) => base + (r < extra ? 1 : 0)).filter((n) => n > 0);
}

/**
 * The sleeve: the day's score engraved as the first page of a printed
 * edition. Title, dedication and tempo at the head; the whole day in three
 * systems of eight bars, each bar labelled with its hour; the data at the
 * foot. Returns where each bar sits, so a cursor can follow the record.
 */
export function drawSleeve(ctx: CanvasRenderingContext2D, size: number, bars: readonly Bar[], text: SleeveText, staves: readonly StaffDef[] = STAVES): SleeveBar[] {
  ctx.save();
  ctx.fillStyle = SLEEVE_PAPER;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  const m = size * 0.065;

  // Head: title centred, dedication beneath, tempo left, the work right.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = `600 ${size * 0.043}px ${TEXT_FONT}`;
  ctx.fillText(text.title, size / 2, m + size * 0.04);
  ctx.font = `italic 400 ${size * 0.021}px ${TEXT_FONT}`;
  ctx.fillText(text.dedication, size / 2, m + size * 0.075);
  ctx.textAlign = 'left';
  ctx.font = `700 ${size * 0.0165}px ${TEXT_FONT}`;
  ctx.fillText('Andante', m, m + size * 0.112);
  const tw = ctx.measureText('Andante').width;
  ctx.font = `${size * 0.027}px ${MUSIC_FONT}`;
  ctx.fillText('\u{1D15F}', m + tw + size * 0.008, m + size * 0.113);
  ctx.font = `500 ${size * 0.015}px ${TEXT_FONT}`;
  ctx.fillText('= 96, one bar an hour', m + tw + size * 0.026, m + size * 0.112);
  ctx.textAlign = 'right';
  ctx.font = `600 ${size * 0.0125}px ${TEXT_FONT}`;
  ctx.fillText('LISTEN TO THE GRID', size - m, m + size * 0.112);

  // The small print at the foot, wrapped to the page, decides how much room it takes.
  ctx.font = `400 ${size * 0.0118}px ${UI_FONT}`;
  const footer = text.footer.flatMap((line) => wrap(ctx, line, size - 2 * m));
  const lineH = size * 0.019;

  // The day, in systems of about eight bars.
  const rows = sleeveRows(bars.length);
  const headH = size * 0.135;
  const footH = Math.max(size * 0.07, footer.length * lineH + size * 0.02);
  const avail = size - 2 * m - headH - footH - (text.tacet ? size * 0.03 : 0);
  const totalSp = staffPositions(staves).height + 5;
  const width = size - 2 * m;
  const perBar = Math.max(...rows);
  // Fill the page's height, unless that would make the bars too narrow for
  // their notes (a sleeve of only a few staves); then space the systems out.
  const sp = Math.min(avail / (rows.length * totalSp), width / (perBar * 32 + 22));
  const gap = (avail - rows.length * totalSp * sp) / rows.length;
  const placed: SleeveBar[] = [];
  let index = 0;
  let tails: (Tail | null)[] = [];
  rows.forEach((count, r) => {
    const top = m + headH + r * (totalSp * sp + gap) + gap / 2;
    const first = bars[index];
    if (!first) return;
    // Shorter last rows keep the same bar width, as an engraver would.
    const probe = engraveFrame({ sp, top, width, bars: perBar, mode: first.mode, short: r > 0, time: r === 0, staves, cueSize: CUE });
    const frameWidth = probe.frame.firstBarX + count * probe.frame.barWidth + 0.5 * sp;
    const { frame, marks } = count === perBar ? probe : engraveFrame({ sp, top, width: frameWidth, bars: count, mode: first.mode, short: r > 0, time: r === 0, staves, cueSize: CUE });
    ctx.save();
    ctx.translate(m, 0);
    paintMarks(ctx, marks, sp, INK);
    for (let slot = 0; slot < count; slot++) {
      const bar = bars[index];
      if (!bar) break;
      const engraved = engraveBar(bar, {
        frame,
        slot,
        previous: bars[index - 1] ?? null,
        tails: slot === 0 ? [] : tails,
        firstInSystem: slot === 0,
        cue: text.cue(index),
        cueSize: CUE,
        whole: true,
      });
      paintMarks(ctx, engraved.marks, sp, INK);
      tails = engraved.tails;
      const x0 = m + frame.firstBarX + slot * frame.barWidth;
      placed.push({ x0, x1: x0 + frame.barWidth, top: (frame.ys[0] ?? 0) - 2 * sp, bottom: (frame.ys[frame.ys.length - 1] ?? 0) + 2 * sp });
      index++;
    }
    // A final bar line, thin then thick, at the end of the day.
    if (r === rows.length - 1) {
      const x = frame.firstBarX + count * frame.barWidth;
      const y0 = (frame.ys[0] ?? 0) - 2 * sp;
      const y1 = (frame.ys[frame.ys.length - 1] ?? 0) + 2 * sp;
      ctx.fillRect(x - 0.55 * sp, y0, 0.5 * sp, y1 - y0);
      ctx.fillRect(x - 1.25 * sp, y0, 0.16 * sp, y1 - y0);
    }
    ctx.restore();
  });

  if (text.tacet) {
    ctx.textAlign = 'left';
    ctx.font = `italic 400 ${size * 0.0165}px ${TEXT_FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(text.tacet, m, size - m - footH - size * 0.004);
  }

  // Foot: the data, in small print.
  ctx.textAlign = 'left';
  ctx.font = `400 ${size * 0.0118}px ${UI_FONT}`;
  ctx.fillStyle = '#5a5249';
  footer.forEach((line, i) => {
    ctx.fillText(line, m, size - m - (footer.length - 1 - i) * lineH);
  });
  ctx.restore();
  return placed;
}

/** Break a line of small print at spaces so it fits the page. */
function wrap(ctx: CanvasRenderingContext2D, line: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > width) {
      out.push(current);
      current = word;
    } else current = next;
  }
  if (current) out.push(current);
  return out;
}
