/** What the engraver hands the painter: marks positioned in pixels, and how far each reaches. */

export type Head = 'black' | 'half' | 'whole' | 'x';
export type GlyphName =
  | 'gClef'
  | 'gClef8va'
  | 'fClef'
  | 'fClef8vb'
  | 'common'
  | 'sharp'
  | 'flat'
  | 'natural'
  | 'restQuarter'
  | 'restEighth'
  | 'restSixteenth'
  | 'dynamic'
  | 'quarterNote';

/** Everything drawn on the score. Coordinates are pixels; `at` is the step it sounds. */
export type Mark =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; at?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; at?: number }
  | { k: 'head'; x: number; y: number; head: Head; at?: number }
  | { k: 'glyph'; glyph: GlyphName; x: number; y: number; text?: string; align?: 'left' | 'center' | 'right'; at?: number }
  | {
      k: 'text';
      x: number;
      y: number;
      text: string;
      style: 'name' | 'italic' | 'number' | 'tempo' | 'cue';
      align: 'left' | 'center' | 'right';
      size?: number;
      live?: boolean;
      at?: number;
    }
  | { k: 'flag'; x: number; y: number; up: boolean; count: number; at?: number }
  | { k: 'tie'; x1: number; x2: number; y: number; up: boolean; at?: number }
  | { k: 'dot'; x: number; y: number; r: number; at?: number }
  | { k: 'brace'; x: number; y1: number; y2: number }
  /** a hairpin, or one bar's length of one: its opening (in pixels) at each end */
  | { k: 'hairpin'; x1: number; x2: number; y: number; open1: number; open2: number; at?: number };

/** Cue size in staff spaces when none is given. */
export const CUE_SIZE = 1.15;

/** A word's width, near enough to keep words apart: half an em a letter. */
export function textWidth(text: string, size: number, sp: number): number {
  return text.length * 0.55 * size * sp;
}

/** Roughly where a mark reaches up to, and across, for keeping words clear of it. */
export function extent(m: Mark, sp: number): { top: number; x0: number; x1: number } | null {
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
      return {
        top: m.y - (m.glyph === 'sharp' || m.glyph === 'flat' || m.glyph === 'natural' ? 1.6 : 0.5) * sp,
        x0: m.x,
        x1: m.x + 1.2 * sp,
      };
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
