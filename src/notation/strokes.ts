import type { PartNote } from '../music/conductor';
import type { Mode } from '../music/theory';
import type { GlyphName, Mark } from './marks';
import { staffStep } from './pitch';
import type { Piece } from './rhythm';
import type { StaffDef } from './staves';

/** The strokes of a note, and of its silences: displaced heads, stems, beams and rests. */

/** A chord's heads in stem order, with each second pushed to the other side of the stem. */
export function displace(steps: readonly number[], up: boolean): { step: number; shifted: boolean }[] {
  const order = up ? [...steps] : [...steps].reverse();
  const out: { step: number; shifted: boolean }[] = [];
  order.forEach((st, i) => {
    const prev = out[i - 1];
    const shifted = !!prev && !prev.shifted && Math.abs(st - prev.step) === 1;
    out.push({ step: st, shifted });
  });
  return out;
}

/** A beamed group's stems go up when its notes sit mostly below the middle line. */
export function groupUp(items: readonly { note?: PartNote }[], mode: Mode, s: StaffDef): boolean {
  if (s.clef === 'percussion') return true;
  const all = items.flatMap((it) => (it.note ? it.note.midis.map((m) => staffStep(m, mode, s.clef)) : []));
  const mean = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  return mean < 0;
}

export function stemMark(
  x: number,
  steps: readonly number[],
  up: boolean,
  y: number,
  sp: number,
  hw: number,
  start: number,
  whole?: boolean,
): { line: Mark; x: number; end: number } {
  const lo = Math.min(...steps);
  const hi = Math.max(...steps);
  const sx = up ? x + hw - 0.06 * sp : x + 0.06 * sp;
  const from = y - ((up ? lo : hi) * sp) / 2;
  let tip = up ? hi + 7 : lo - 7;
  // Long stems reach at least the middle line, as engravers extend them.
  if (up && tip < 0) tip = 0;
  if (!up && tip > 0) tip = 0;
  const end = y - (tip * sp) / 2;
  return { line: { k: 'line', x1: sx, y1: from, x2: sx, y2: end, w: 0.12 * sp, at: whole ? 0 : start }, x: sx, end };
}

export function beamMarks(
  members: readonly { x: number; steps: number[]; up: boolean; item: Piece & { rest: boolean } }[],
  y: number,
  sp: number,
  whole?: boolean,
): Mark[] {
  const first = members[0];
  const last = members[members.length - 1];
  if (!first || !last) return [];
  const up = first.up;
  const hw = 1.18 * sp;
  const xs = members.map((m) => (up ? m.x + hw - 0.06 * sp : m.x + 0.06 * sp));
  const ends = members.map((m) => (up ? Math.max(...m.steps) + 7 : Math.min(...m.steps) - 7));
  // A gentle slope following the first and last notes, at most one space.
  const slope = Math.max(-1, Math.min(1, ((ends[ends.length - 1] ?? 0) - (ends[0] ?? 0)) / 4));
  const x0 = xs[0] ?? 0;
  const x1 = xs[xs.length - 1] ?? x0;
  const lineAt = (x: number, base: number): number => base + (x1 === x0 ? 0 : (slope * (x - x0)) / (x1 - x0));
  // Every stem must reach the beam: shift the beam to clear the furthest note.
  let base = ends[0] ?? 0;
  members.forEach((_m, i) => {
    const need = ends[i] ?? 0;
    const atX = lineAt(xs[i] ?? 0, base);
    if (up && atX < need) base += need - atX;
    if (!up && atX > need) base -= atX - need;
  });
  const marks: Mark[] = [];
  const startAt = whole ? 0 : first.item.start;
  members.forEach((m, i) => {
    const lo = Math.min(...m.steps);
    const hi = Math.max(...m.steps);
    const from = y - ((up ? lo : hi) * sp) / 2;
    const tip = y - (lineAt(xs[i] ?? 0, base) * sp) / 2;
    marks.push({ k: 'line', x1: xs[i] ?? 0, y1: from, x2: xs[i] ?? 0, y2: tip, w: 0.12 * sp, at: whole ? 0 : m.item.start });
  });
  const yAt = (x: number): number => y - (lineAt(x, base) * sp) / 2;
  const thick = 0.5 * sp;
  const dir = up ? 1 : -1;
  marks.push({ k: 'line', x1: x0, y1: yAt(x0) + (dir * thick) / 2, x2: x1, y2: yAt(x1) + (dir * thick) / 2, w: thick, at: startAt });
  // Secondary beams for runs of semiquavers; a lone one gets a stub pointing into the group.
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!m || m.item.value !== 'sixteenth') continue;
    let j = i;
    while (members[j + 1]?.item.value === 'sixteenth') j++;
    const a = xs[i] ?? 0;
    const b = j > i ? (xs[j] ?? a) : a + (i === 0 ? 1.1 * sp : -1.1 * sp);
    const off = dir * (thick + 0.25 * sp + thick / 2);
    marks.push({
      k: 'line',
      x1: Math.min(a, b),
      y1: yAt(Math.min(a, b)) + off,
      x2: Math.max(a, b),
      y2: yAt(Math.max(a, b)) + off,
      w: thick,
      at: startAt,
    });
    i = j;
  }
  return marks;
}

export function restMarks(r: Piece, s: StaffDef, y: number, sp: number, x: number, at: number): Mark[] {
  // Whole and half rests are blocks hanging from, or sitting on, a line; a one-line staff uses its only line.
  if (r.value === 'whole') return [{ k: 'rect', x, y: s.clef === 'percussion' ? y : y - sp, w: 1.25 * sp, h: 0.5 * sp, at }];
  if (r.value === 'half') return [{ k: 'rect', x, y: y - 0.5 * sp, w: 1.25 * sp, h: 0.5 * sp, at }];
  const glyph: GlyphName = r.value === 'quarter' ? 'restQuarter' : r.value === 'eighth' ? 'restEighth' : 'restSixteenth';
  return [{ k: 'glyph', glyph, x, y: y + 2 * sp, at }];
}
