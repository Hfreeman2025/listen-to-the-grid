import type { Mode } from '../music/theory';
import type { GlyphName, Mark } from './marks';
import { type Clef, keySignature } from './pitch';
import { halfHeight, lineCount, OSSIA_STAVES, OSSIA_TOP, STAVES, type StaffDef, staffPositions, TIER_2, tierAbove } from './staves';

/** The parts of a system that stand still while bars are written into it: staves, names, clefs, keys and bar lines. */

export interface Frame {
  sp: number;
  /** the staves this frame carries, top to bottom */
  staves: readonly StaffDef[];
  /** pixel y of each staff's middle line */
  ys: number[];
  /** tier for tempo and expression above the top staff, raised clear of large cues */
  tier2: number;
  namesRight: number;
  staffLeft: number;
  staffRight: number;
  firstBarX: number;
  barWidth: number;
  bars: number;
  mode: Mode;
}

export interface FrameOptions {
  sp: number;
  top: number;
  width: number;
  bars: number;
  mode: Mode;
  short: boolean;
  /** show the time signature (the first system of a piece) */
  time: boolean;
  /** size of the cues over the bars, in staff spaces, so the tier above can clear them */
  cueSize?: number;
  /** the staves to engrave: the full score by default, or only those a passage uses */
  staves?: readonly StaffDef[];
}

/** A system across the full width, its bars after the clefs, key and time signature. */
export function engraveFrame(o: FrameOptions): { frame: Frame; marks: Mark[] } {
  const sp = o.sp;
  const staves = o.staves ?? STAVES;
  const { ys: rel } = staffPositions(staves);
  const ys = rel.map((y) => o.top + y * sp);
  const nameWidth = o.short ? 4.2 : 8.4;
  const namesRight = nameWidth * sp;
  const staffLeft = namesRight + 1.6 * sp;
  const keyWidth = Math.abs(keyCount(o.mode)) * 1.05 * sp;
  const firstBarX = staffLeft + (1.2 + 3 + 0.9) * sp + keyWidth + (o.time ? 2.3 * sp : 0) + 0.6 * sp;
  const staffRight = o.width - 0.5 * sp;
  const frame: Frame = {
    sp,
    staves,
    ys,
    tier2: tierAbove(o.cueSize),
    namesRight,
    staffLeft,
    staffRight,
    firstBarX,
    barWidth: (staffRight - firstBarX) / o.bars,
    bars: o.bars,
    mode: o.mode,
  };
  const marks: Mark[] = [];

  staves.forEach((s, i) => {
    const y = ys[i] ?? 0;
    marks.push(...staffLines(s, staffLeft, staffRight, y, sp));
    const name = nameMark(s, ys, i, namesRight, o.short);
    if (name) marks.push(name);
    marks.push(...clefMarks(s, staffLeft + 1.1 * sp, y, sp));
    const keyX = staffLeft + (1.1 + 3 + 0.5) * sp;
    marks.push(...keyMarks(o.mode, s.clef, keyX, y, sp));
    if (o.time) marks.push({ k: 'glyph', glyph: 'common', x: keyX + keyWidth + 0.4 * sp, y: y + 2 * sp });
    // Bar lines, including the system's end.
    for (let b = 1; b <= o.bars; b++) marks.push(barline(s, frame.firstBarX + b * frame.barWidth, y, sp, ys[i + 1]));
  });

  // System bracket and the brace for the wind's two staves.
  const top = (ys[0] ?? 0) - 2 * sp;
  const lastStaff = staves[staves.length - 1];
  const bottom = (ys[staves.length - 1] ?? 0) + (lastStaff ? halfHeight(lastStaff) : 2) * sp;
  marks.push({ k: 'line', x1: staffLeft, y1: top, x2: staffLeft, y2: bottom, w: 0.16 * sp });
  marks.push({ k: 'rect', x: staffLeft - 0.9 * sp, y: top - 0.2 * sp, w: 0.5 * sp, h: bottom - top + 0.4 * sp });
  marks.push({ k: 'line', x1: staffLeft - 0.9 * sp, y1: top - 0.2 * sp, x2: staffLeft + 0.7 * sp, y2: top - 0.9 * sp, w: 0.22 * sp });
  marks.push({ k: 'line', x1: staffLeft - 0.9 * sp, y1: bottom + 0.2 * sp, x2: staffLeft + 0.7 * sp, y2: bottom + 0.9 * sp, w: 0.22 * sp });
  const wi = staves.findIndex((s) => s.key === 'wind-hi');
  if (wi >= 0) marks.push({ k: 'brace', x: staffLeft - 1.5 * sp, y1: (ys[wi] ?? 0) - 2 * sp, y2: (ys[wi + 1] ?? 0) + 2 * sp });
  return { frame, marks };
}

export interface OssiaOptions {
  /** the ossia's own staff space: the system's, times OSSIA_SCALE */
  sp: number;
  /** pixel y of the ossia block's top */
  top: number;
  /** x of the bar line where the ossia begins, and its bars' width (the system's) */
  x0: number;
  barWidth: number;
  bars: number;
  mode: Mode;
  short: boolean;
}

/**
 * Small staves printed above the system for an alternative passage. As an
 * engraver sets an ossia that begins mid-system, its clefs and key stand just
 * before the bar line where it starts, so its bars align with the system's
 * below; its staff lines end with the passage. Names are short; the label
 * saying what the passage is goes with its bars, clear of their notes.
 */
export function engraveOssiaFrame(o: OssiaOptions): { frame: Frame; marks: Mark[] } {
  const sp = o.sp;
  const staves = OSSIA_STAVES;
  const ys = staffPositions(staves, OSSIA_TOP).ys.map((y) => o.top + y * sp);
  const keyWidth = Math.abs(keyCount(o.mode)) * 1.05 * sp;
  const staffLeft = o.x0 - (0.5 + 3 + 0.5) * sp - keyWidth - 0.4 * sp;
  const staffRight = o.x0 + o.bars * o.barWidth;
  const frame: Frame = {
    sp,
    staves,
    ys,
    tier2: TIER_2,
    namesRight: staffLeft - 0.6 * sp,
    staffLeft,
    staffRight,
    firstBarX: o.x0,
    barWidth: o.barWidth,
    bars: o.bars,
    mode: o.mode,
  };
  const marks: Mark[] = [];
  staves.forEach((s, i) => {
    const y = ys[i] ?? 0;
    marks.push(...staffLines(s, staffLeft, staffRight, y, sp));
    const name = nameMark(s, ys, i, frame.namesRight, o.short);
    if (name) marks.push(name);
    marks.push(...clefMarks(s, staffLeft + 0.5 * sp, y, sp));
    marks.push(...keyMarks(o.mode, s.clef, staffLeft + (0.5 + 3 + 0.3) * sp, y, sp));
    for (let b = 0; b <= o.bars; b++) marks.push(barline(s, o.x0 + b * o.barWidth, y, sp, ys[i + 1]));
  });
  const wi = staves.findIndex((s) => s.key === 'wind-hi');
  marks.push({ k: 'brace', x: staffLeft - 1.2 * sp, y1: (ys[wi] ?? 0) - 2 * sp, y2: (ys[wi + 1] ?? 0) + 2 * sp });
  return { frame, marks };
}

/** Five lines, or one for an unpitched part. */
function staffLines(s: StaffDef, x1: number, x2: number, y: number, sp: number): Mark[] {
  const w = 0.13 * sp;
  if (lineCount(s) === 1) return [{ k: 'line', x1, y1: y, x2, y2: y, w }];
  const lines: Mark[] = [];
  for (let l = -2; l <= 2; l++) lines.push({ k: 'line', x1, y1: y + l * sp, x2, y2: y + l * sp, w });
  return lines;
}

/** The part's name to the left of its staff; the wind's sits between its two. */
function nameMark(s: StaffDef, ys: readonly number[], i: number, x: number, short: boolean): Mark | null {
  const name = short ? s.short : s.name;
  if (!name) return null;
  const y = s.split === 'upper' ? ((ys[i] ?? 0) + (ys[i + 1] ?? 0)) / 2 : (ys[i] ?? 0);
  return { k: 'text', x, y, text: name, style: 'name', align: 'right' };
}

const CLEF_GLYPHS: Record<Exclude<Clef, 'percussion'>, GlyphName> = {
  treble: 'gClef',
  treble8va: 'gClef8va',
  bass: 'fClef',
  bass8vb: 'fClef8vb',
};

function clefMarks(s: StaffDef, x: number, y: number, sp: number): Mark[] {
  // Unpitched parts take the neutral clef: two thick strokes.
  if (s.clef === 'percussion') {
    return [
      { k: 'rect', x: x + 0.4 * sp, y: y - sp, w: 0.42 * sp, h: 2 * sp },
      { k: 'rect', x: x + 1.2 * sp, y: y - sp, w: 0.42 * sp, h: 2 * sp },
    ];
  }
  return [{ k: 'glyph', glyph: CLEF_GLYPHS[s.clef], x, y: y + 2 * sp }];
}

function keyCount(mode: Mode): number {
  const k = keySignature(mode, 'treble');
  return k.kind === 'none' ? 0 : k.kind === 'sharp' ? k.steps.length : -k.steps.length;
}

/** A key signature, after naturals cancelling whatever the key before it (`cancel`) had that this one doesn't. */
export function keyMarks(mode: Mode, clef: Clef, x: number, y: number, sp: number, cancel?: Mode): Mark[] {
  const marks: Mark[] = [];
  let cx = x;
  if (cancel) {
    const old = keySignature(cancel, clef);
    const next = keySignature(mode, clef);
    for (const step of old.steps) {
      if (next.kind === old.kind && next.steps.includes(step)) continue;
      marks.push({ k: 'glyph', glyph: 'natural', x: cx, y: y - (step * sp) / 2 });
      cx += 0.95 * sp;
    }
  }
  const k = keySignature(mode, clef);
  for (const step of k.steps) {
    marks.push({ k: 'glyph', glyph: k.kind === 'sharp' ? 'sharp' : 'flat', x: cx, y: y - (step * sp) / 2 });
    cx += 1.05 * sp;
  }
  return marks;
}

export function barline(s: StaffDef, x: number, y: number, sp: number, nextY?: number): Mark {
  if (lineCount(s) === 1) return { k: 'line', x1: x, y1: y - sp, x2: x, y2: y + sp, w: 0.16 * sp };
  // The wind's two staves share bar lines, joined through the gap.
  const to = s.split === 'upper' && nextY !== undefined ? nextY + 2 * sp : y + 2 * sp;
  return { k: 'line', x1: x, y1: y - 2 * sp, x2: x, y2: to, w: 0.16 * sp };
}
