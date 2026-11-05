import { engraveFrame } from '../notation/frame';
import { canvasFontsReady, INK, paintMarks } from '../notation/paint';
import { ossiaHeight, staffPositions } from '../notation/staves';

/** How the score fits its canvas, and the empty page it shows before the music arrives. */

/** Bars per system for a canvas width: four on a desktop, three on a narrow window, two on a phone. */
function barsPerSystem(width: number): number {
  return width >= 760 ? 4 : width >= 520 ? 3 : 2;
}

export interface Layout {
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
export function layoutFor(canvas: HTMLCanvasElement, extra: HTMLCanvasElement[] = [], ossia = false): Layout {
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
    await canvasFontsReady();
    draw(true);
  } catch {
    // no music font: the staves alone still read as a page
  }
}
