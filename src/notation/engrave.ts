import type { Fuel } from '../data/schema';
import { SWELL, type Bar, type PartNote } from '../music/conductor';
import { modeInfo } from '../music/harmony';
import { dynamicFor } from '../music/mapping';
import type { Mode } from '../music/theory';
import { keySignature, ledgerLines, staffStep, stemUp, type Clef } from './pitch';
import { beamGroups, rests, spell, type Piece } from './rhythm';

/**
 * Engraving: turns composed bars into positioned marks, in staff spaces
 * scaled to pixels. Marks carry the step (0-16) within their bar at which
 * they sound, so the live score can ink each one in as it is heard.
 */

export interface StaffDef {
  key: string;
  fuel: Fuel;
  clef: Clef;
  name: string;
  short: string;
  /** which notes of a chord this staff carries (the wind pad spans two staves) */
  split?: 'upper' | 'lower';
  /** text written over the part's first entry */
  entry?: string;
  /** space below this staff, in staff spaces */
  below: number;
}

/** Score order: highest voices at the top, the drone at the bottom. */
export const STAVES: readonly StaffDef[] = [
  { key: 'solar', fuel: 'solar', clef: 'treble8va', name: 'Solar', short: 'Sol.', entry: 'l.v.', below: 5 },
  { key: 'wind-hi', fuel: 'wind', clef: 'treble', name: 'Wind', short: 'Wind', split: 'upper', below: 6 },
  { key: 'wind-lo', fuel: 'wind', clef: 'bass', name: '', short: '', split: 'lower', below: 5 },
  { key: 'hydro', fuel: 'hydro', clef: 'percussion', name: 'Hydro', short: 'Hyd.', below: 4.2 },
  { key: 'biomass', fuel: 'biomass', clef: 'treble', name: 'Biomass', short: 'Bio.', below: 7.2 },
  { key: 'imports', fuel: 'imports', clef: 'treble', name: 'Imports', short: 'Imp.', entry: 'lontano', below: 5 },
  { key: 'nuclear', fuel: 'nuclear', clef: 'bass', name: 'Nuclear', short: 'Nuc.', below: 5 },
  { key: 'other', fuel: 'other', clef: 'treble', name: 'Other', short: 'Oth.', entry: 'pizz.', below: 4.6 },
  { key: 'coal', fuel: 'coal', clef: 'percussion', name: 'Coal', short: 'Coal', below: 4.2 },
  { key: 'gas', fuel: 'gas', clef: 'bass8vb', name: 'Gas', short: 'Gas', below: 4.5 },
];

const lineCount = (s: StaffDef): number => (s.clef === 'percussion' ? 1 : 5);
const halfHeight = (s: StaffDef): number => (lineCount(s) === 5 ? 2 : 0);

/** Room above the top staff for bar numbers, tempo and expression marks. */
export const SYSTEM_TOP = 8;
/**
 * Text above the top staff sits on tiers, in staff spaces above its top
 * line. A part's own words (l.v. over the bells) sit closest, just over the
 * staff; bar numbers and time cues clear them; tempo and expression clear
 * the cues.
 */
export const TIER_1 = 2.7;
export const TIER_2 = 4.8;

/**
 * The ossia's staves: only the parts a fully renewable grid would play
 * (the others are tacet in it), set closer together, as ossia staves are.
 */
export const OSSIA_STAVES: readonly StaffDef[] = STAVES.filter((s) => s.fuel === 'solar' || s.fuel === 'wind' || s.fuel === 'hydro').map((s) => ({
  ...s,
  below: s.fuel === 'solar' ? 4.2 : s.split === 'upper' ? 5.6 : 4.4,
}));
/** Ossia staves are engraved smaller than the system's, by this much. */
export const OSSIA_SCALE = 0.68;
/** Room above the ossia's top staff for its label, in its own staff spaces. */
export const OSSIA_TOP = 8.5;

/** Middle-line y of each staff, in staff spaces from the system top, and the total height. */
export function staffPositions(staves: readonly StaffDef[] = STAVES, top = SYSTEM_TOP): { ys: number[]; height: number } {
  const ys: number[] = [];
  let y = top;
  staves.forEach((s, i) => {
    y += halfHeight(s);
    ys.push(y);
    y += halfHeight(s) + s.below;
    // Below the last staff, keep room for its dynamic.
    if (i === staves.length - 1) y -= s.below - 4.6;
  });
  return { ys, height: y };
}

/** Height of the ossia block above a system, in the system's staff spaces. */
export function ossiaHeight(): number {
  return staffPositions(OSSIA_STAVES, OSSIA_TOP).height * OSSIA_SCALE;
}

export type Head = 'black' | 'half' | 'whole' | 'x';
export type GlyphName = 'gClef' | 'gClef8va' | 'fClef' | 'fClef8vb' | 'common' | 'sharp' | 'flat' | 'natural' | 'restQuarter' | 'restEighth' | 'restSixteenth' | 'dynamic' | 'quarterNote';

/** Everything drawn on the score. Coordinates are pixels; `at` is the step it sounds. */
export type Mark =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; at?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; at?: number }
  | { k: 'head'; x: number; y: number; head: Head; at?: number }
  | { k: 'glyph'; glyph: GlyphName; x: number; y: number; text?: string; align?: 'left' | 'center' | 'right'; at?: number }
  | { k: 'text'; x: number; y: number; text: string; style: 'name' | 'italic' | 'number' | 'tempo' | 'cue'; align: 'left' | 'center' | 'right'; size?: number; live?: boolean; at?: number }
  | { k: 'flag'; x: number; y: number; up: boolean; count: number; at?: number }
  | { k: 'tie'; x1: number; x2: number; y: number; up: boolean; at?: number }
  | { k: 'dot'; x: number; y: number; r: number; at?: number }
  | { k: 'brace'; x: number; y1: number; y2: number }
  /** a hairpin, or one bar's length of one: its opening (in pixels) at each end */
  | { k: 'hairpin'; x1: number; x2: number; y: number; open1: number; open2: number; at?: number };

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

/** Tempo and expression sit far enough above a cue of this size that neither touches the other. */
export function tierAbove(cueSize = 1.15): number {
  return Math.max(TIER_2, TIER_1 + 0.75 * cueSize + 1.25);
}

/** The parts of a system that don't change bar to bar: staves, names, clefs, key and bar lines. */
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
  const frame: Frame = { sp, staves, ys, tier2: tierAbove(o.cueSize), namesRight, staffLeft, staffRight, firstBarX, barWidth: (staffRight - firstBarX) / o.bars, bars: o.bars, mode: o.mode };
  const marks: Mark[] = [];
  const thin = 0.13 * sp;

  staves.forEach((s, i) => {
    const y = ys[i] ?? 0;
    if (lineCount(s) === 5) {
      for (let l = -2; l <= 2; l++) marks.push({ k: 'line', x1: staffLeft, y1: y + l * sp, x2: staffRight, y2: y + l * sp, w: thin });
    } else {
      marks.push({ k: 'line', x1: staffLeft, y1: y, x2: staffRight, y2: y, w: thin });
    }
    const name = o.short ? s.short : s.name;
    if (name) {
      const mid = s.split === 'upper' ? ((ys[i] ?? 0) + (ys[i + 1] ?? 0)) / 2 : y;
      marks.push({ k: 'text', x: namesRight, y: mid, text: name, style: 'name', align: 'right' });
    }
    // Clef
    const clefX = staffLeft + 1.1 * sp;
    if (s.clef === 'percussion') {
      marks.push({ k: 'rect', x: clefX + 0.4 * sp, y: y - sp, w: 0.42 * sp, h: 2 * sp });
      marks.push({ k: 'rect', x: clefX + 1.2 * sp, y: y - sp, w: 0.42 * sp, h: 2 * sp });
    } else {
      const glyph: GlyphName = s.clef === 'treble' ? 'gClef' : s.clef === 'treble8va' ? 'gClef8va' : s.clef === 'bass' ? 'fClef' : 'fClef8vb';
      marks.push({ k: 'glyph', glyph, x: clefX, y: y + 2 * sp });
    }
    // Key signature
    const keyX = staffLeft + (1.1 + 3 + 0.5) * sp;
    marks.push(...keyMarks(o.mode, s.clef, keyX, y, sp));
    // Time signature
    if (o.time) marks.push({ k: 'glyph', glyph: 'common', x: keyX + keyWidth + 0.4 * sp, y: y + 2 * sp });
    // Bar lines, including the system's end.
    for (let b = 1; b <= o.bars; b++) {
      const x = frame.firstBarX + b * frame.barWidth;
      marks.push(barline(s, x, y, sp, ys[i + 1]));
    }
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
  const frame: Frame = { sp, staves, ys, tier2: TIER_2, namesRight: staffLeft - 0.6 * sp, staffLeft, staffRight, firstBarX: o.x0, barWidth: o.barWidth, bars: o.bars, mode: o.mode };
  const marks: Mark[] = [];
  const thin = 0.13 * sp;
  staves.forEach((s, i) => {
    const y = ys[i] ?? 0;
    if (lineCount(s) === 5) {
      for (let l = -2; l <= 2; l++) marks.push({ k: 'line', x1: staffLeft, y1: y + l * sp, x2: staffRight, y2: y + l * sp, w: thin });
    } else {
      marks.push({ k: 'line', x1: staffLeft, y1: y, x2: staffRight, y2: y, w: thin });
    }
    const name = s.split === 'lower' ? '' : o.short ? s.short : s.name;
    if (name) {
      const mid = s.split === 'upper' ? ((ys[i] ?? 0) + (ys[i + 1] ?? 0)) / 2 : y;
      marks.push({ k: 'text', x: frame.namesRight, y: mid, text: name, style: 'name', align: 'right' });
    }
    const clefX = staffLeft + 0.5 * sp;
    if (s.clef === 'percussion') {
      marks.push({ k: 'rect', x: clefX + 0.4 * sp, y: y - sp, w: 0.42 * sp, h: 2 * sp });
      marks.push({ k: 'rect', x: clefX + 1.2 * sp, y: y - sp, w: 0.42 * sp, h: 2 * sp });
    } else {
      const glyph: GlyphName = s.clef === 'treble' ? 'gClef' : s.clef === 'treble8va' ? 'gClef8va' : s.clef === 'bass' ? 'fClef' : 'fClef8vb';
      marks.push({ k: 'glyph', glyph, x: clefX, y: y + 2 * sp });
    }
    marks.push(...keyMarks(o.mode, s.clef, staffLeft + (0.5 + 3 + 0.3) * sp, y, sp));
    for (let b = 0; b <= o.bars; b++) marks.push(barline(s, o.x0 + b * o.barWidth, y, sp, ys[i + 1]));
  });
  const wi = staves.findIndex((s) => s.key === 'wind-hi');
  marks.push({ k: 'brace', x: staffLeft - 1.2 * sp, y1: (ys[wi] ?? 0) - 2 * sp, y2: (ys[wi + 1] ?? 0) + 2 * sp });
  return { frame, marks };
}

function keyCount(mode: Mode): number {
  const k = keySignature(mode, 'treble');
  return k.kind === 'none' ? 0 : k.kind === 'sharp' ? k.steps.length : -k.steps.length;
}

function keyMarks(mode: Mode, clef: Clef, x: number, y: number, sp: number, cancel?: Mode): Mark[] {
  const marks: Mark[] = [];
  let cx = x;
  if (cancel) {
    // Naturals for the accidentals the new key no longer has.
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

function barline(s: StaffDef, x: number, y: number, sp: number, nextY?: number): Mark {
  if (lineCount(s) === 1) return { k: 'line', x1: x, y1: y - sp, x2: x, y2: y + sp, w: 0.16 * sp };
  // The wind's two staves share bar lines, joined through the gap.
  const to = s.split === 'upper' && nextY !== undefined ? nextY + 2 * sp : y + 2 * sp;
  return { k: 'line', x1: x, y1: y - 2 * sp, x2: x, y2: to, w: 0.16 * sp };
}

/** Where the wind's chord splits between its two staves: D4 and up on the treble. */
const SPLIT = 62;

/** A part's notes as this staff carries them. */
function staffNotes(s: StaffDef, bar: Bar): PartNote[] {
  const notes = bar.parts[s.fuel];
  if (!s.split) return notes;
  return notes
    .map((n) => ({ ...n, midis: n.midis.filter((m) => (s.split === 'upper' ? m >= SPLIT : m < SPLIT)) }))
    .filter((n) => n.midis.length > 0);
}

/** Whether the phrase swells (+1) or falls away (-1) through a bar. */
function swellDirection(pos: number): number {
  const p = ((pos % 8) + 8) % 8;
  return Math.sign((SWELL[p + 1] ?? 0) - (SWELL[p] ?? 0));
}

export interface Tail {
  x: number;
  steps: number[];
  midis: string;
  held: boolean;
}

export interface Engraved {
  marks: Mark[];
  /** onset steps and their x, for the cursor */
  columns: { step: number; x: number }[];
  /** last note of each staff, to tie into the next bar */
  tails: (Tail | null)[];
  /** y of the top of the words over the bar (its cue and any marking), so a heading can clear them */
  top: number;
}

export interface BarOptions {
  frame: Frame;
  /** which bar of the system, from 0 */
  slot: number;
  previous: Bar | null;
  tails: (Tail | null)[];
  firstInSystem: boolean;
  /** text above the bar line, such as the hour it stands for */
  cue?: string | undefined;
  /** cue size in staff spaces (a sleeve prints them larger) */
  cueSize?: number;
  /** print the cue in the live red */
  cueLive?: boolean;
  /** set every cue just after its bar line, rather than centred on it */
  cueAfter?: boolean;
  /** reveal everything at the bar line (reduced motion) */
  whole?: boolean;
  /** words in italics over the bar, which may run beyond it, lifted clear of its notes: an ossia's label */
  label?: { text: string; size: number; x: number; align: 'left' | 'right' };
  /**
   * The bar does not follow the one engraved before it (the live bar after
   * the half-hours already past): nothing is tied into it, and its hairpin
   * begins and ends within it.
   */
  restart?: boolean;
}

const WIDTHS = (d: number): number => 1.4 + 1.3 * Math.log2(Math.max(1, d));

/** Engrave one bar into its slot of the system frame. */
export function engraveBar(bar: Bar, o: BarOptions): Engraved {
  const f = o.frame;
  const sp = f.sp;
  const barX = f.firstBarX + o.slot * f.barWidth;
  const marks: Mark[] = [];
  const mode = bar.mode;
  const at = (step: number): number => (o.whole ? 0 : step);

  // A change of mode mid-system: double bar line, cancelling naturals, new key.
  let lead = 1.3 * sp;
  let marking: string | null = null;
  if (bar.keyChange && !o.firstInSystem && o.previous) {
    let width = 0;
    f.staves.forEach((s, i) => {
      const y = f.ys[i] ?? 0;
      const line = barline(s, barX - 0.45 * sp, y, sp, f.ys[i + 1]);
      if (line.k === 'line') marks.push({ ...line, w: 0.12 * sp });
      const km = keyMarks(mode, s.clef, barX + 0.9 * sp, y, sp, o.previous?.mode);
      marks.push(...km);
      width = Math.max(width, km.length * 1.0 * sp);
    });
    lead += width + 0.6 * sp;
    marking = modeInfo(mode).marking;
  }

  // Pieces for every staff.
  type Item = Piece & { rest: boolean; note?: PartNote; tieNext: boolean };
  const perStaff: Item[][] = f.staves.map((s) => {
    const notes = staffNotes(s, bar).filter((n) => n.midis.length > 0);
    const items: Item[] = [];
    // Hydro's droplets ride over the held water; spell the water alone.
    const main = s.fuel === 'hydro' ? notes.filter((n) => n.held) : notes;
    for (const n of main) {
      const pieces = spell(n.start, n.length);
      pieces.forEach((p, i) => items.push({ ...p, rest: false, note: n, tieNext: i < pieces.length - 1 }));
    }
    for (const r of rests(main)) items.push({ ...r, rest: true, tieNext: false });
    return items.sort((a, b) => a.start - b.start);
  });
  const droplets = bar.parts.hydro.filter((n) => !n.held);

  // Columns: every onset in the bar, shared by all staves so they align.
  const starts = new Set<number>([0]);
  for (const items of perStaff) for (const it of items) if (!(it.rest && it.length === 16)) starts.add(it.start);
  for (const d of droplets) starts.add(d.start);
  const sorted = [...starts].sort((a, b) => a - b);
  const ideal = sorted.map((s, i) => WIDTHS((sorted[i + 1] ?? 16) - s));
  const total = ideal.reduce((a, b) => a + b, 0);
  const room = f.barWidth - lead - 0.4 * sp;
  const scale = room / (total * sp);
  const columns: { step: number; x: number }[] = [];
  let cx = barX + lead;
  sorted.forEach((s, i) => {
    columns.push({ step: s, x: cx });
    cx += (ideal[i] ?? 0) * sp * scale;
  });
  const colX = (step: number): number => columns.find((c) => c.step === step)?.x ?? barX + lead;


  const tails: (Tail | null)[] = f.staves.map(() => null);

  f.staves.forEach((s, si) => {
    const y = f.ys[si] ?? 0;
    const items = perStaff[si] ?? [];
    const prevTail = o.restart ? null : (o.tails[si] ?? null);
    const notesOnly = items.filter((it) => !it.rest);
    const active = notesOnly.length > 0;
    const prevActive = o.previous ? staffNotes(s, o.previous).length > 0 : false;

    // Beams group the quavers and semiquavers within each beat.
    const groups = beamGroups(items);
    const inGroup = new Map<number, number[]>();
    for (const g of groups) for (const idx of g) inGroup.set(idx, g);

    let lowest = s.clef === 'percussion' ? 0 : -4;
    const heads: { x: number; steps: number[]; up: boolean; item: Item }[] = [];
    items.forEach((it, idx) => {
      if (it.rest) {
        // A whole-bar rest is centred in the bar, not placed on the beat.
        const x = it.length === 16 ? barX + f.barWidth / 2 - 0.6 * sp : colX(it.start);
        marks.push(...restMarks(it, s, y, sp, x, at(it.start)));
        return;
      }
      const n = it.note;
      if (!n) return;
      const steps = n.midis.map((m) => staffStep(m, mode, s.clef)).sort((a, b) => a - b);
      lowest = Math.min(lowest, ...steps);
      const group = inGroup.get(idx);
      const up = group ? groupUp(group.map((g) => items[g]).filter((x): x is Item => !!x), mode, s) : s.clef === 'percussion' ? true : stemUp(steps);
      const x = colX(it.start);
      const head: Head = s.clef === 'percussion' && !n.held ? 'x' : it.value === 'whole' ? 'whole' : it.value === 'half' ? 'half' : 'black';
      heads.push({ x, steps, up, item: it });
      // Note heads, with seconds pushed to the other side of the stem.
      const hw = head === 'whole' ? 1.7 * sp : 1.18 * sp;
      const placed = displace(steps, up);
      for (const p of placed) {
        const hx = p.shifted ? (up ? x + hw * 0.92 : x - hw * 0.92) : x;
        marks.push({ k: 'head', x: hx, y: y - (p.step * sp) / 2, head, at: at(it.start) });
        if (s.clef !== 'percussion') {
          for (const l of ledgerLines(p.step)) marks.push({ k: 'line', x1: hx - 0.35 * sp, y1: y - (l * sp) / 2, x2: hx + hw + 0.35 * sp, y2: y - (l * sp) / 2, w: 0.16 * sp, at: at(it.start) });
        }
        if (it.dotted) {
          // A dot sits in a space: a note on a line moves its dot up into the space above.
          const dotY = y - (p.step * sp) / 2 - (p.step % 2 === 0 ? 0.5 * sp : 0);
          marks.push({ k: 'dot', x: x + hw + 0.55 * sp, y: dotY, r: 0.2 * sp, at: at(it.start) });
        }
      }
      // Stems and flags (beamed stems are drawn with their beam).
      if (head !== 'whole' && !group) {
        const stem = stemMark(x, steps, up, y, sp, hw, it.start, o.whole);
        marks.push(stem.line);
        if (it.value === 'eighth' || it.value === 'sixteenth') marks.push({ k: 'flag', x: stem.x, y: stem.end, up, count: it.value === 'eighth' ? 1 : 2, at: at(it.start) });
      }
      // The water's roll: three strokes over the held note.
      if (s.fuel === 'hydro' && n.held) {
        for (let t = 0; t < 3; t++) marks.push({ k: 'line', x1: x + 0.2 * sp, y1: y - 2.2 * sp - t * 0.75 * sp + 0.35 * sp, x2: x + hw - 0.2 * sp, y2: y - 2.2 * sp - t * 0.75 * sp - 0.35 * sp, w: 0.42 * sp, at: at(it.start) });
      }
      // Ties: between the pieces of one note, and from the last bar.
      if (it.tieNext) {
        const nextX = colX(it.start + it.length);
        for (const st of steps) marks.push({ k: 'tie', x1: x + hw * 0.6, x2: nextX + hw * 0.3, y: y - (st * sp) / 2 + (up ? 0.6 : -0.6) * sp, up: !up, at: at(it.start) });
      }
      if (it.start === 0 && prevTail && prevTail.held && n.held && prevTail.midis === n.midis.join()) {
        const fromX = o.firstInSystem ? x - 2.2 * sp : prevTail.x + hw * 0.6;
        for (const st of steps) marks.push({ k: 'tie', x1: fromX, x2: x + hw * 0.3, y: y - (st * sp) / 2 + (up ? 0.6 : -0.6) * sp, up: !up, at: at(0) });
      }
    });

    // Beams.
    for (const g of groups) {
      const members = g.map((idx) => heads.find((h) => h.item === items[idx])).filter((h): h is NonNullable<typeof h> => !!h);
      marks.push(...beamMarks(members, y, sp, o.whole));
    }

    // Hydro's droplets: x heads with flags, stems up, over the line.
    if (s.fuel === 'hydro') {
      for (const d of droplets) {
        const x = colX(d.start);
        marks.push({ k: 'head', x, y: y - 1.5 * sp, head: 'x', at: at(d.start) });
        const stem = stemMark(x, [3], true, y, sp, 1.18 * sp, d.start, o.whole);
        marks.push(stem.line);
        marks.push({ k: 'flag', x: stem.x, y: stem.end, up: true, count: 1, at: at(d.start) });
      }
    }

    // Entry text (l.v., pizz., lontano) over a part's first notes.
    if (active && s.entry && (o.firstInSystem || !prevActive)) {
      const first = notesOnly[0];
      const highest = Math.max(4, ...notesOnly.flatMap((it) => (it.note ? it.note.midis.map((m) => staffStep(m, mode, s.clef)) : [])));
      if (first) marks.push({ k: 'text', x: colX(first.start), y: y - (highest / 2 + 1.2) * sp, text: s.entry, style: 'italic', align: 'left', at: at(first.start) });
    }

    // Dynamics, where they change and at the start of each system; hairpins
    // for the phrase's swell in the strings and the voice.
    const share = bar.shares[s.fuel];
    const dyn = dynamicFor(share);
    const prevDyn = o.previous ? dynamicFor(o.previous.shares[s.fuel]) : null;
    // The wind's two staves share one set of dynamics, between them, whichever staff its notes are on.
    const partActive = s.split ? bar.parts[s.fuel].length > 0 : active;
    const prevPartActive = s.split ? (o.previous?.parts[s.fuel].length ?? 0) > 0 : prevActive;
    const dynamicsHere = s.split !== 'lower' && partActive && dyn !== 'tacet';
    // Under the staff, clear of its lowest note; between the staves for the wind; just under the line for percussion.
    const dynY =
      s.split === 'upper'
        ? ((f.ys[si] ?? 0) + (f.ys[si + 1] ?? 0)) / 2 + 0.2 * sp
        : s.clef === 'percussion'
          ? y + 2.4 * sp
          : y + Math.max(2, -lowest / 2 + 0.6) * sp + 1.9 * sp;
    let hairStart = barX + lead;
    const printed = dynamicsHere && (o.firstInSystem || dyn !== prevDyn || !prevPartActive);
    if (printed) {
      const first = notesOnly[0];
      const x = first ? colX(first.start) : barX + lead;
      marks.push({ k: 'glyph', glyph: 'dynamic', text: dyn, x: x - 0.3 * sp, y: dynY, align: 'left', at: at(first?.start ?? 0) });
      hairStart = x + dyn.length * 1.3 * sp + 0.6 * sp;
    }
    // The phrase's swell, as the strings' hairpins. Each bar draws its own
    // length of the wedge, so a wedge can cross a bar line or a system break
    // (arriving part-open, as engravers continue one) and always stops
    // short of a newly printed dynamic, which begins a wedge of its own.
    if (dynamicsHere && s.fuel === 'wind') {
      const dir = swellDirection(bar.phrasePos);
      if (dir !== 0) {
        const continues = !printed && !o.restart && swellDirection(bar.phrasePos - 1) === dir;
        let before = 0;
        while (continues && before < 8 && swellDirection(bar.phrasePos - before - 1) === dir) before++;
        let after = 0;
        while (!o.restart && after < 8 && swellDirection(bar.phrasePos + after + 1) === dir) after++;
        const span = before + 1 + after;
        const opening = (k: number): number => 1.1 * sp * (dir > 0 ? k / span : 1 - k / span);
        const x1 = continues ? barX : hairStart;
        const x2 = barX + f.barWidth - (after > 0 ? 0 : 0.9 * sp);
        if (x2 - x1 > 2.5 * sp) marks.push({ k: 'hairpin', x1, x2, y: dynY, open1: opening(before), open2: opening(before + 1), at: at(0) });
      }
    }

    const lastNote = notesOnly[notesOnly.length - 1];
    const lastHead = heads[heads.length - 1];
    if (lastNote?.note && lastHead) tails[si] = { x: lastHead.x, steps: lastHead.steps, midis: lastNote.note.midis.join(), held: !!lastNote.note.held };
  });

  // Words over the bar, once its notes are placed: the time cue, then any
  // expression marking above it, each on its tier unless the top staff
  // reaches higher there (a bell above the staff, its l.v.), when it lifts
  // clear of it.
  const topLine = (f.ys[0] ?? 0) - 2 * sp;
  const clearOf = (x0: number, x1: number): number => {
    let y = Infinity;
    for (const m of marks) {
      const e = extent(m, sp);
      if (e && e.x1 > x0 && e.x0 < x1) y = Math.min(y, e.top);
    }
    return y;
  };
  let top = topLine;
  if (o.cue) {
    const after = o.slot === 0 || o.cueAfter;
    const size = o.cueSize ?? CUE_SIZE;
    const w = textWidth(o.cue, size, sp);
    const x = after ? barX + 0.4 * sp : barX;
    const x0 = after ? x : x - w / 2;
    const y = Math.min(topLine - TIER_1 * sp, clearOf(x0 - 0.3 * sp, x0 + w + 0.3 * sp) - 0.5 * sp);
    marks.push({ k: 'text', x, y, text: o.cue, style: 'cue', align: after ? 'left' : 'center', ...(o.cueSize ? { size: o.cueSize } : {}), ...(o.cueLive ? { live: true } : {}) });
    top = y - 0.75 * size * sp;
  }
  if (marking) {
    const x = barX + 0.4 * sp;
    const y = Math.min(topLine - f.tier2 * sp, Math.min(top, clearOf(x, x + textWidth(marking, 1.5, sp))) - 0.6 * sp);
    marks.push({ k: 'text', x, y, text: marking, style: 'italic', align: 'left' });
    top = Math.min(top, y - 1.2 * sp);
  }
  if (o.label) {
    const l = o.label;
    const w = textWidth(l.text, l.size * 0.85, sp);
    const x0 = l.align === 'left' ? l.x : l.x - w;
    const y = Math.min(topLine - 3.6 * sp, Math.min(top, clearOf(x0, x0 + w)) - 0.6 * sp);
    marks.push({ k: 'text', x: l.x, y, text: l.text, style: 'italic', align: l.align, size: l.size });
    top = Math.min(top, y - 0.8 * l.size * sp);
  }

  return { marks, columns, tails, top };
}

/** Cue size in staff spaces when none is given. */
const CUE_SIZE = 1.15;

/** A word's width, near enough to keep words apart: half an em a letter. */
function textWidth(text: string, size: number, sp: number): number {
  return text.length * 0.55 * size * sp;
}

/** Roughly where a mark reaches up to, and across, for keeping words clear of it. */
function extent(m: Mark, sp: number): { top: number; x0: number; x1: number } | null {
  switch (m.k) {
    case 'line':
      return { top: Math.min(m.y1, m.y2) - m.w / 2, x0: Math.min(m.x1, m.x2), x1: Math.max(m.x1, m.x2) };
    case 'rect':
      return { top: m.y, x0: m.x, x1: m.x + m.w };
    case 'head':
      return { top: m.y - 0.5 * sp, x0: m.x, x1: m.x + 1.8 * sp };
    case 'dot':
      return { top: m.y - m.r, x0: m.x - m.r, x1: m.x + m.r };
    case 'glyph':
      // Accidentals stand about a space and a half above their line; the rest sit in or under the staff.
      return { top: m.y - (m.glyph === 'sharp' || m.glyph === 'flat' || m.glyph === 'natural' ? 1.6 : 0.5) * sp, x0: m.x, x1: m.x + 1.2 * sp };
    case 'text': {
      const size = m.size ?? (m.style === 'cue' ? CUE_SIZE : 1.5);
      const w = textWidth(m.text, size, sp);
      const x0 = m.align === 'left' ? m.x : m.align === 'right' ? m.x - w : m.x - w / 2;
      return { top: m.y - 0.8 * size * sp, x0, x1: x0 + w };
    }
    case 'flag':
      return { top: m.up ? m.y : m.y - 3.1 * sp, x0: m.x, x1: m.x + 1.4 * sp };
    case 'tie':
      return { top: m.up ? m.y - 1.3 * sp : m.y, x0: m.x1, x1: m.x2 };
    case 'hairpin':
      return { top: m.y - Math.max(m.open1, m.open2) / 2, x0: m.x1, x1: m.x2 };
    case 'brace':
      return null;
  }
}

function displace(steps: readonly number[], up: boolean): { step: number; shifted: boolean }[] {
  const order = up ? [...steps] : [...steps].reverse();
  const out: { step: number; shifted: boolean }[] = [];
  order.forEach((st, i) => {
    const prev = out[i - 1];
    const shifted = !!prev && !prev.shifted && Math.abs(st - prev.step) === 1;
    out.push({ step: st, shifted });
  });
  return out;
}

function groupUp(items: readonly { note?: PartNote }[], mode: Mode, s: StaffDef): boolean {
  if (s.clef === 'percussion') return true;
  const all = items.flatMap((it) => (it.note ? it.note.midis.map((m) => staffStep(m, mode, s.clef)) : []));
  const mean = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  return mean < 0;
}

function stemMark(x: number, steps: readonly number[], up: boolean, y: number, sp: number, hw: number, start: number, whole?: boolean): { line: Mark; x: number; end: number } {
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

function beamMarks(members: readonly { x: number; steps: number[]; up: boolean; item: Piece & { rest: boolean } }[], y: number, sp: number, whole?: boolean): Mark[] {
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
  // Secondary beams for runs of semiquavers.
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!m || m.item.value !== 'sixteenth') continue;
    let j = i;
    while (members[j + 1]?.item.value === 'sixteenth') j++;
    const a = xs[i] ?? 0;
    const b = j > i ? (xs[j] ?? a) : a + (i === 0 ? 1.1 * sp : -1.1 * sp);
    const off = dir * (thick + 0.25 * sp + thick / 2);
    marks.push({ k: 'line', x1: Math.min(a, b), y1: yAt(Math.min(a, b)) + off, x2: Math.max(a, b), y2: yAt(Math.max(a, b)) + off, w: thick, at: startAt });
    i = j;
  }
  return marks;
}

function restMarks(r: Piece, s: StaffDef, y: number, sp: number, x: number, at: number): Mark[] {
  const percussion = s.clef === 'percussion';
  if (r.value === 'whole') return [{ k: 'rect', x, y: percussion ? y : y - sp, w: 1.25 * sp, h: 0.5 * sp, at }];
  if (r.value === 'half') return [{ k: 'rect', x, y: percussion ? y - 0.5 * sp : y - 0.5 * sp, w: 1.25 * sp, h: 0.5 * sp, at }];
  const glyph: GlyphName = r.value === 'quarter' ? 'restQuarter' : r.value === 'eighth' ? 'restEighth' : 'restSixteenth';
  return [{ k: 'glyph', glyph, x, y: y + 2 * sp, at }];
}
