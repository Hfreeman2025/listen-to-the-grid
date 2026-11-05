import type { GlyphName, Mark } from './marks';

/**
 * Draws engraved marks on a canvas. Music glyphs come from Noto Music, whose
 * em is four staff spaces with the staff's bottom line on the baseline, so a
 * clef drawn at font size 4 × space on the bottom line lands exactly.
 */

/** The engraver's music font: clefs, notes, rests, accidentals, dynamics. Plex has no music symbols. */
export const MUSIC_FONT = '"Noto Music"';
/** IBM Plex, one family: Sans for words to read (tempo, expression), Mono for data (times, bar numbers), Condensed for signs (names, titles). */
export const SANS_FONT = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';
export const MONO_FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
export const SIGN_FONT = '"IBM Plex Sans Condensed", "IBM Plex Sans", "Arial Narrow", sans-serif';
/** Ink on score paper. */
export const INK = '#1a1714';
/** The conductor's red pencil: the cursor, and anything live. */
export const CURSOR = '#c23b22';
/** The conductor's red, darkened for small text: anything live. */
const LIVE_INK = '#a8301b';

const CODE: Record<Exclude<GlyphName, 'dynamic'>, string> = {
  gClef: '\u{1D11E}',
  gClef8va: '\u{1D11F}',
  fClef: '\u{1D122}',
  fClef8vb: '\u{1D124}',
  common: '\u{1D134}',
  restQuarter: '\u{1D13D}',
  restEighth: '\u{1D13E}',
  restSixteenth: '\u{1D13F}',
  sharp: '♯',
  flat: '♭',
  natural: '♮',
  quarterNote: '\u{1D15F}',
};

const DYNAMIC: Record<string, string> = { p: '\u{1D18F}', m: '\u{1D190}', f: '\u{1D191}' };

/**
 * Every glyph the score draws: clefs, rests, accidentals, dynamics, the brace.
 */
const MUSIC_GLYPHS = [...Object.values(CODE), ...Object.values(DYNAMIC), '\u{1D114}'].join('');

/** Every Plex face the canvases draw words in. */
const TEXT_FACES = [
  `400 16px ${SANS_FONT}`,
  `italic 400 16px ${SANS_FONT}`,
  `600 16px ${SANS_FONT}`,
  `400 16px ${MONO_FONT}`,
  `600 16px ${MONO_FONT}`,
  `500 16px ${SIGN_FONT}`,
  `600 16px ${SIGN_FONT}`,
];

/**
 * Resolves once every music glyph and every Plex face the canvases use can be
 * drawn (or has failed, when system fonts stand in). A canvas cannot redraw
 * itself when a font arrives late, so the score, the sleeve and the week wait
 * for this before engraving. WebKit can run the page's script before the font
 * rules' stylesheet is read, when there is nothing to load yet and the
 * browser answers at once with nothing: so wait for the stylesheets and ask
 * again, or a page engraved now would keep fallback glyphs for good.
 */
export async function canvasFontsReady(): Promise<unknown> {
  const load = (): Promise<FontFace[][]> =>
    Promise.all([document.fonts.load(`40px ${MUSIC_FONT}`, MUSIC_GLYPHS), ...TEXT_FACES.map((f) => document.fonts.load(f))]);
  const [music] = await load();
  if (music && music.length > 0) return music;
  const pending = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => !l.sheet);
  await Promise.all(
    pending.map(
      (link) =>
        new Promise((resolve) => {
          link.addEventListener('load', resolve, { once: true });
          link.addEventListener('error', resolve, { once: true });
        }),
    ),
  );
  return load();
}

/** Vertical offsets, in staff spaces, from the mark's anchor to the glyph's baseline. */
const BASELINE: Partial<Record<GlyphName, number>> = { sharp: 0.54, natural: 0.54, flat: 0.5, dynamic: 1.5, quarterNote: 0 };

function dynamicText(dyn: string): string {
  return Array.from(dyn, (c) => DYNAMIC[c] ?? c).join('');
}

export function paintMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[], sp: number, ink: string): void {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  for (const m of marks) paintMark(ctx, m, sp);
}

export function paintMark(ctx: CanvasRenderingContext2D, m: Mark, sp: number): void {
  switch (m.k) {
    case 'line':
      ctx.lineWidth = m.w;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
      return;
    case 'rect':
      ctx.fillRect(m.x, m.y, m.w, m.h);
      return;
    case 'dot':
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'head':
      paintHead(ctx, m.x, m.y, m.head, sp);
      return;
    case 'glyph': {
      const text = m.glyph === 'dynamic' ? dynamicText(m.text ?? '') : CODE[m.glyph];
      ctx.font = `${4 * sp}px ${MUSIC_FONT}`;
      ctx.textAlign = m.align ?? 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, m.x, m.y + (BASELINE[m.glyph] ?? 0) * sp);
      return;
    }
    case 'text': {
      const size =
        m.size ?? (m.style === 'name' ? 1.55 : m.style === 'tempo' ? 1.75 : m.style === 'cue' ? 1.15 : m.style === 'number' ? 1.25 : 1.5);
      // Names are signs, times and bar numbers are data, tempo and expression are words.
      const face = m.style === 'name' ? SIGN_FONT : m.style === 'cue' || m.style === 'number' ? MONO_FONT : SANS_FONT;
      const weight = m.style === 'tempo' ? '600' : m.style === 'name' ? '500' : '400';
      const italic = m.style === 'italic' ? 'italic ' : '';
      ctx.font = `${italic}${weight} ${size * sp}px ${face}`;
      ctx.textAlign = m.align;
      ctx.textBaseline = m.style === 'name' ? 'middle' : 'alphabetic';
      if (m.live) {
        const ink = ctx.fillStyle;
        ctx.fillStyle = LIVE_INK;
        ctx.fillText(m.text, m.x, m.y);
        ctx.fillStyle = ink;
        return;
      }
      ctx.fillText(m.text, m.x, m.y);
      return;
    }
    case 'flag':
      for (let i = 0; i < m.count; i++) paintFlag(ctx, m.x, m.y + (m.up ? 1 : -1) * i * 0.85 * sp, m.up, sp);
      return;
    case 'tie':
      paintTie(ctx, m.x1, m.x2, m.y, m.up, sp);
      return;
    case 'hairpin': {
      ctx.lineWidth = 0.13 * sp;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(m.x2, m.y - m.open2 / 2);
      ctx.lineTo(m.x1, m.y - m.open1 / 2);
      if (m.open1 > 0) ctx.moveTo(m.x1, m.y + m.open1 / 2);
      ctx.lineTo(m.x2, m.y + m.open2 / 2);
      ctx.stroke();
      return;
    }
    case 'brace': {
      const h = m.y2 - m.y1;
      ctx.save();
      ctx.font = `${4 * sp}px ${MUSIC_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.translate(m.x, m.y2);
      ctx.scale(1, h / (4 * sp));
      ctx.fillText('\u{1D114}', 0, 0);
      ctx.restore();
      return;
    }
  }
}

function paintHead(ctx: CanvasRenderingContext2D, x: number, y: number, head: string, sp: number): void {
  if (head === 'x') {
    const cx = x + 0.59 * sp;
    const r = 0.46 * sp;
    ctx.lineWidth = 0.17 * sp;
    ctx.beginPath();
    ctx.moveTo(cx - r, y - r);
    ctx.lineTo(cx + r, y + r);
    ctx.moveTo(cx - r, y + r);
    ctx.lineTo(cx + r, y - r);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  if (head === 'whole') {
    const cx = x + 0.85 * sp;
    ctx.ellipse(cx, y, 0.85 * sp, 0.5 * sp, 0, 0, Math.PI * 2);
    ctx.ellipse(cx, y, 0.42 * sp, 0.28 * sp, 0.75, 0, Math.PI * 2);
    ctx.fill('evenodd');
    return;
  }
  const cx = x + 0.59 * sp;
  ctx.ellipse(cx, y, 0.6 * sp, 0.42 * sp, -0.35, 0, Math.PI * 2);
  if (head === 'half') {
    ctx.ellipse(cx, y, 0.5 * sp, 0.19 * sp, -0.55, 0, Math.PI * 2);
    ctx.fill('evenodd');
    return;
  }
  ctx.fill();
}

function paintFlag(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean, sp: number): void {
  const d = up ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + 0.1 * sp, y + d * 1.1 * sp, x + 1.35 * sp, y + d * 1.5 * sp, x + 0.95 * sp, y + d * 3.1 * sp);
  ctx.bezierCurveTo(x + 1.05 * sp, y + d * 1.9 * sp, x + 0.35 * sp, y + d * 1.55 * sp, x, y + d * 1.05 * sp);
  ctx.closePath();
  ctx.fill();
}

function paintTie(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, up: boolean, sp: number): void {
  const d = up ? -1 : 1;
  const span = x2 - x1;
  const h = Math.min(1.3 * sp, 0.18 * span + 0.35 * sp);
  const mid = (x1 + x2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.quadraticCurveTo(mid, y + d * h * 1.6, x2, y);
  ctx.quadraticCurveTo(mid, y + d * (h * 1.6 - 0.32 * sp), x1, y);
  ctx.fill();
}
