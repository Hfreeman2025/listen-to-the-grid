import { FUELS, type Fuel } from '../data/schema';
import type { GridPeriod } from '../data/series';
import { modeInfo } from '../music/harmony';
import { OSSIA_GRAMS, RENEWABLES, renewableMix, usesFallback } from '../music/ossia';
import type { Mode } from '../music/theory';
import type { MatchState } from '../ossia-loudness';
import { FUEL_NAMES, MODE_NAMES, percent } from './format';

/** Renewables first, as the ossia reads; then everything it silences, in score order. */
const ORDER: readonly Fuel[] = [...RENEWABLES, ...FUELS.filter((f) => !(RENEWABLES as readonly Fuel[]).includes(f))];

export interface OssiaTable {
  realHead: HTMLElement;
  cells: Map<string, { real: HTMLElement; ossia: HTMLElement }>;
}

/** The real-against-ossia table, built once: a row per source, then intensity and key. */
export function buildOssiaTable(table: HTMLTableElement): OssiaTable {
  const doc = table.ownerDocument;
  const cell = (tag: 'td' | 'th', text = '', scope?: string): HTMLElement => {
    const c = doc.createElement(tag);
    c.textContent = text;
    if (scope) c.setAttribute('scope', scope);
    return c;
  };
  const realHead = cell('th', 'Real', 'col');
  const head = doc.createElement('thead');
  const hr = doc.createElement('tr');
  hr.append(cell('td'), realHead, cell('th', 'Ossia (hypothetical)', 'col'));
  head.append(hr);
  const body = doc.createElement('tbody');
  const cells = new Map<string, { real: HTMLElement; ossia: HTMLElement }>();
  const row = (key: string, name: string, extra = ''): void => {
    const tr = doc.createElement('tr');
    if (extra) tr.className = extra;
    const real = cell('td');
    const ossia = cell('td');
    tr.append(cell('th', name, 'row'), real, ossia);
    body.append(tr);
    cells.set(key, { real, ossia });
  };
  for (const f of ORDER) row(f, FUEL_NAMES[f], (RENEWABLES as readonly Fuel[]).includes(f) ? 'kept' : 'silenced');
  row('grams', 'Carbon intensity', 'total');
  row('key', 'Key', 'total');
  row('loudness', 'Loudness', 'total');
  row('trim', 'Level', 'total');
  table.replaceChildren(head, body);
  return { realHead, cells };
}

/** Fill the table for a half-hour: its real figures beside the ossia's. Returns whether the fallback was used. */
export function fillOssiaTable(t: OssiaTable, p: GridPeriod, realMode: Mode, when: string, regional: boolean): boolean {
  const ossia = renewableMix(p.mix);
  t.realHead.textContent = `Real, ${when}`;
  const set = (key: string, real: string, alt: string): void => {
    const c = t.cells.get(key);
    if (!c) return;
    if (c.real.textContent !== real) c.real.textContent = real;
    if (c.ossia.textContent !== alt) c.ossia.textContent = alt;
  };
  for (const f of ORDER) set(f, percent(p.mix[f]), percent(ossia[f]));
  const how = p.measured ? '' : regional ? ', modelled' : ', forecast';
  set('grams', `${Math.round(p.intensity)} g CO₂/kWh${how}`, `${OSSIA_GRAMS} g CO₂/kWh`);
  set('key', `D ${MODE_NAMES[realMode]}, ${modeInfo(realMode).marking}`, `D ${MODE_NAMES.lydian}, ${modeInfo('lydian').marking}`);
  return usesFallback(p.mix);
}

const db = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} dB`;
const lu = (x: number): string => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} LUFS`;

/**
 * The loudness match, in words and in the table: what was measured, how, and
 * the trim each version plays at. Always says when a trim is provisional or
 * carried over from another moment.
 */
export function showLoudness(view: { notes: HTMLElement; line: HTMLElement; table: OssiaTable }, state: MatchState, bars: number): void {
  const set = (key: string, real: string, alt: string): void => {
    const c = view.table.cells.get(key);
    if (!c) return;
    if (c.real.textContent !== real) c.real.textContent = real;
    if (c.ossia.textContent !== alt) c.ossia.textContent = alt;
  };
  view.notes.dataset.match = state.kind;
  let line = '';
  switch (state.kind) {
    case 'off':
      return;
    case 'matched': {
      const m = state.match;
      view.notes.dataset.trim = String(m.trimDb);
      set('loudness', lu(m.real), lu(m.ossia));
      set('trim', db(0), db(m.trimDb));
      const way = m.trimDb <= 0 ? `${db(-m.trimDb).replace('+', '')} quieter` : `${db(m.trimDb).replace('+', '')} louder`;
      line = `Loudness-matched for ${state.label}: both versions rendered here, ${bars} bars each, and measured with ITU-R BS.1770 in ${(m.ms / 1000).toFixed(1)} s. Real ${lu(m.real)}, ossia ${lu(m.ossia)}, so the ossia plays ${way}: switching changes the music, not the volume.`;
      break;
    }
    case 'measuring':
      view.notes.dataset.trim = String(state.trimDb);
      set('loudness', 'measuring…', 'measuring…');
      set('trim', db(0), `${db(state.trimDb)}, ${state.from ? `as at ${state.from.label}` : 'provisional'}`);
      line = state.from
        ? `Matching loudness for ${state.label}: rendering both versions here and measuring them (ITU-R BS.1770). Meanwhile the ossia keeps the trim measured at ${state.from.label}, ${db(state.trimDb)}.`
        : `Matching loudness for ${state.label}: rendering both versions here and measuring them (ITU-R BS.1770). Meanwhile the ossia plays ${db(state.trimDb)}, the typical gap, provisionally.`;
      break;
    case 'failed':
      view.notes.dataset.trim = String(state.trimDb);
      set('loudness', 'not measured', 'not measured');
      set('trim', db(0), `${db(state.trimDb)}, unverified`);
      line = `Couldn’t measure loudness here (${state.reason}). The ossia plays ${db(state.trimDb)}, unverified for ${state.label}.`;
      break;
  }
  if (view.line.textContent !== line) view.line.textContent = line;
}
