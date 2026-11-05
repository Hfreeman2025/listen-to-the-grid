import { describe, expect, it } from 'vitest';
import { encodeWav, id3Tag, type RecordTags, toPcm16 } from '../src/audio/wav';

const tags: RecordTags = {
  title: 'Wednesday 28 October 2026',
  artist: 'The electricity grid of Great Britain',
  album: 'Listen to the Grid',
  date: '2026-10-28',
  comment: 'Data: NESO Carbon Intensity API, CC BY 4.0',
};

/** Reads a RIFF file's top-level chunks back. */
function chunks(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, n: number): string => String.fromCharCode(...bytes.slice(at, at + n));
  expect(text(0, 4)).toBe('RIFF');
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(text(8, 4)).toBe('WAVE');
  const out = new Map<string, Uint8Array>();
  let at = 12;
  while (at < bytes.length) {
    const id = text(at, 4);
    const size = view.getUint32(at + 4, true);
    out.set(id, bytes.slice(at + 8, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  expect(at).toBe(bytes.length);
  return out;
}

describe('toPcm16', () => {
  it('interleaves channels and stays within 16 bits at and beyond full scale', () => {
    const pcm = toPcm16({ sampleRate: 48000, channels: [Float32Array.of(0, 1, -1, 2), Float32Array.of(0, -0.5, 0.5, -2)] });
    const v = new DataView(pcm.buffer);
    const s = (i: number) => v.getInt16(i * 2, true);
    expect(pcm.length).toBe(16);
    expect(Math.abs(s(0))).toBeLessThanOrEqual(1); // silence, plus at most one bit of dither
    expect(s(2)).toBeGreaterThanOrEqual(32765);
    expect(s(4)).toBeLessThanOrEqual(-32765);
    expect(s(6)).toBe(32767); // clipped, not wrapped
    expect(s(7)).toBe(-32768);
    expect(s(3)).toBeCloseTo(-16384, -1);
  });
});

describe('encodeWav', () => {
  const left = new Float32Array(1001).map((_, i) => Math.sin(i / 10) * 0.5);
  const bytes = encodeWav({ sampleRate: 44100, channels: [left, left] }, tags, {
    mime: 'image/jpeg',
    data: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
  });
  const found = chunks(bytes);

  it('writes a 16-bit stereo format chunk', () => {
    const fmt = new DataView((found.get('fmt ') ?? new Uint8Array(16)).buffer);
    expect(fmt.getUint16(0, true)).toBe(1); // PCM
    expect(fmt.getUint16(2, true)).toBe(2);
    expect(fmt.getUint32(4, true)).toBe(44100);
    expect(fmt.getUint32(8, true)).toBe(44100 * 4);
    expect(fmt.getUint16(14, true)).toBe(16);
  });

  it('holds every frame of audio', () => {
    expect(found.get('data')?.length).toBe(1001 * 4);
  });

  it('carries the liner notes in a LIST/INFO chunk', () => {
    const info = new TextDecoder().decode(found.get('LIST'));
    expect(info.startsWith('INFO')).toBe(true);
    expect(info).toContain('INAM');
    expect(info).toContain('Wednesday 28 October 2026');
    expect(info).toContain('The electricity grid of Great Britain');
    expect(info).toContain('2026-10-28');
  });

  it('embeds an ID3 tag with the sleeve as front cover', () => {
    const id3 = found.get('id3 ') ?? new Uint8Array();
    expect(String.fromCharCode(...id3.slice(0, 3))).toBe('ID3');
    expect(id3[3]).toBe(3);
    const size = ((id3[6] ?? 0) << 21) | ((id3[7] ?? 0) << 14) | ((id3[8] ?? 0) << 7) | (id3[9] ?? 0);
    expect(size).toBe(id3.length - 10);
    const raw = String.fromCharCode(...id3);
    for (const id of ['TIT2', 'TPE1', 'TALB', 'TYER', 'COMM', 'APIC']) expect(raw).toContain(id);
    expect(raw).toContain('image/jpeg');
  });
});

describe('id3Tag', () => {
  it('writes text frames as UTF-16 with a byte-order mark', () => {
    const tag = id3Tag({ ...tags, title: 'D é' });
    const at = String.fromCharCode(...tag).indexOf('TIT2');
    const body = tag.slice(at + 10, at + 10 + 9);
    expect([...body]).toEqual([1, 0xff, 0xfe, 0x44, 0, 0x20, 0, 0xe9, 0]);
  });
});
