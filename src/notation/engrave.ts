import { type Bar, type PartNote, SWELL } from '../music/conductor';
import { modeInfo } from '../music/harmony';
import { dynamicFor } from '../music/mapping';
import { barline, type Frame, keyMarks } from './frame';
import { CUE_SIZE, extent, type Head, type Mark, textWidth } from './marks';
import { ledgerLines, staffStep, stemUp } from './pitch';
import { beamGroups, type Piece, rests, spell } from './rhythm';
import { type StaffDef, TIER_1 } from './staves';
import { beamMarks, displace, groupUp, restMarks, stemMark } from './strokes';

/**
 * Engraving: turns composed bars into positioned marks, in staff spaces
 * scaled to pixels. Marks carry the step (0-16) within their bar at which
 * they sound, so the live score can ink each one in as it is heard.
 */

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
    const staffMarks = marks.length;
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
      const up = group
        ? groupUp(
            group.map((g) => items[g]).filter((x): x is Item => !!x),
            mode,
            s,
          )
        : s.clef === 'percussion'
          ? true
          : stemUp(steps);
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
          for (const l of ledgerLines(p.step))
            marks.push({
              k: 'line',
              x1: hx - 0.35 * sp,
              y1: y - (l * sp) / 2,
              x2: hx + hw + 0.35 * sp,
              y2: y - (l * sp) / 2,
              w: 0.16 * sp,
              at: at(it.start),
            });
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
        if (it.value === 'eighth' || it.value === 'sixteenth')
          marks.push({ k: 'flag', x: stem.x, y: stem.end, up, count: it.value === 'eighth' ? 1 : 2, at: at(it.start) });
      }
      // The water's roll: three strokes over the held note.
      if (s.fuel === 'hydro' && n.held) {
        for (let t = 0; t < 3; t++)
          marks.push({
            k: 'line',
            x1: x + 0.2 * sp,
            y1: y - 2.2 * sp - t * 0.75 * sp + 0.35 * sp,
            x2: x + hw - 0.2 * sp,
            y2: y - 2.2 * sp - t * 0.75 * sp - 0.35 * sp,
            w: 0.42 * sp,
            at: at(it.start),
          });
      }
      // Ties: between the pieces of one note, and from the last bar.
      if (it.tieNext) {
        const nextX = colX(it.start + it.length);
        for (const st of steps)
          marks.push({
            k: 'tie',
            x1: x + hw * 0.6,
            x2: nextX + hw * 0.3,
            y: y - (st * sp) / 2 + (up ? 0.6 : -0.6) * sp,
            up: !up,
            at: at(it.start),
          });
      }
      if (it.start === 0 && prevTail && prevTail.held && n.held && prevTail.midis === n.midis.join()) {
        const fromX = o.firstInSystem ? x - 2.2 * sp : prevTail.x + hw * 0.6;
        for (const st of steps)
          marks.push({ k: 'tie', x1: fromX, x2: x + hw * 0.3, y: y - (st * sp) / 2 + (up ? 0.6 : -0.6) * sp, up: !up, at: at(0) });
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
      if (first) {
        // Over the notes, and lifted clear of any stem or beam of this staff that reaches higher under the word.
        const x = colX(first.start);
        const w = textWidth(s.entry, 1.5, sp);
        let top = y - (highest / 2 + 1.2) * sp + 0.4 * sp;
        for (const m of marks.slice(staffMarks)) {
          const e = extent(m, sp);
          if (e && e.x1 > x && e.x0 < x + w) top = Math.min(top, e.top);
        }
        marks.push({ k: 'text', x, y: top - 0.4 * sp, text: s.entry, style: 'italic', align: 'left', at: at(first.start) });
      }
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
        if (x2 - x1 > 2.5 * sp)
          marks.push({ k: 'hairpin', x1, x2, y: dynY, open1: opening(before), open2: opening(before + 1), at: at(0) });
      }
    }

    const lastNote = notesOnly[notesOnly.length - 1];
    const lastHead = heads[heads.length - 1];
    if (lastNote?.note && lastHead)
      tails[si] = { x: lastHead.x, steps: lastHead.steps, midis: lastNote.note.midis.join(), held: !!lastNote.note.held };
  });

  const top = wordsOver(marks, f, barX, o, marking);
  return { marks, columns, tails, top };
}

/**
 * Words over the bar, once its notes are placed: the time cue, then any
 * expression marking above it, each on its tier unless the top staff reaches
 * higher there (a bell above the staff, its l.v.), when it lifts clear of it.
 * Adds them to `marks` and returns the top of the highest.
 */
function wordsOver(marks: Mark[], f: Frame, barX: number, o: BarOptions, marking: string | null): number {
  const sp = f.sp;
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
    marks.push({
      k: 'text',
      x,
      y,
      text: o.cue,
      style: 'cue',
      align: after ? 'left' : 'center',
      ...(o.cueSize ? { size: o.cueSize } : {}),
      ...(o.cueLive ? { live: true } : {}),
    });
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
  return top;
}
