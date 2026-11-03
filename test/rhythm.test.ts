import { describe, expect, it } from 'vitest';
import { beamGroups, rests, spell, type Piece } from '../src/notation/rhythm';

const names = (pieces: Piece[]): string[] => pieces.map((p) => `${p.dotted ? 'dotted ' : ''}${p.value}@${p.start}`);

describe('spell', () => {
  it('writes simple values where they belong', () => {
    expect(names(spell(0, 16))).toEqual(['whole@0']);
    expect(names(spell(0, 12))).toEqual(['dotted half@0']);
    expect(names(spell(8, 8))).toEqual(['half@8']);
    expect(names(spell(0, 6))).toEqual(['dotted quarter@0']);
    expect(names(spell(6, 2))).toEqual(['eighth@6']);
  });

  it('shows the middle of the bar: a minim on beat 2 is two tied crotchets', () => {
    expect(names(spell(4, 8))).toEqual(['quarter@4', 'quarter@8']);
  });

  it('shows the beat: an off-beat crotchet is two tied quavers', () => {
    expect(names(spell(2, 4))).toEqual(['eighth@2', 'eighth@4']);
  });

  it('never runs past the bar line', () => {
    expect(names(spell(12, 8))).toEqual(['quarter@12']);
  });

  it('never dots a rest', () => {
    expect(names(spell(0, 12, true))).toEqual(['half@0', 'quarter@8']);
    expect(names(spell(0, 6, true))).toEqual(['quarter@0', 'eighth@4']);
  });
});

describe('rests', () => {
  it('fills an empty bar with one whole-bar rest', () => {
    expect(names(rests([]))).toEqual(['whole@0']);
  });

  it('fills the gaps around a sung phrase', () => {
    // crotchet, crotchet, then silence: a minim rest on beat 3.
    expect(names(rests([{ start: 0, length: 4 }, { start: 4, length: 4 }]))).toEqual(['half@8']);
    // a note on beat 2 only: rests either side.
    expect(names(rests([{ start: 4, length: 4 }]))).toEqual(['quarter@0', 'half@8']);
    // a quaver figure in beat 3.
    expect(names(rests([{ start: 8, length: 2 }, { start: 10, length: 2 }]))).toEqual(['half@0', 'quarter@12']);
  });
});

describe('beamGroups', () => {
  it('beams quavers within a beat and leaves crotchets alone', () => {
    const p = (start: number, length: number, value: Piece['value'], rest = false) => ({ start, length, value, dotted: false, rest });
    const bar = [p(0, 2, 'eighth'), p(2, 2, 'eighth'), p(4, 4, 'quarter'), p(8, 1, 'sixteenth'), p(9, 1, 'sixteenth'), p(10, 1, 'sixteenth'), p(11, 1, 'sixteenth'), p(12, 2, 'eighth'), p(14, 2, 'eighth', true)];
    expect(beamGroups(bar)).toEqual([[0, 1], [3, 4, 5, 6]]);
  });

  it('does not beam across a beat', () => {
    const p = (start: number) => ({ start, length: 2, value: 'eighth' as const, dotted: false });
    expect(beamGroups([p(2), p(4)])).toEqual([]);
  });
});
