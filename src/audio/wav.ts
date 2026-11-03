/**
 * A 16-bit PCM WAV file with its liner notes inside: a RIFF LIST/INFO chunk
 * (title, artist, album, date, comment) that most players read, and an
 * "id3 " chunk carrying the same tags plus the sleeve as front-cover art.
 */

export interface RecordTags {
  title: string;
  artist: string;
  album: string;
  /** ISO date */
  date: string;
  comment: string;
}

export interface PcmSource {
  sampleRate: number;
  channels: readonly Float32Array[];
}

/** Interleaved little-endian 16-bit PCM, with TPDF dither and hard limits at full scale. */
export function toPcm16(src: PcmSource, seed = 1): Uint8Array {
  const frames = src.channels[0]?.length ?? 0;
  const ch = src.channels.length;
  const out = new DataView(new ArrayBuffer(frames * ch * 2));
  let s = seed >>> 0;
  const rand = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const v = src.channels[c]?.[i] ?? 0;
      const dithered = v * 32767 + (rand() - rand());
      out.setInt16((i * ch + c) * 2, Math.max(-32768, Math.min(32767, Math.round(dithered))), true);
    }
  }
  return new Uint8Array(out.buffer);
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array): this {
    this.parts.push(b);
    this.length += b.length;
    return this;
  }
  ascii(s: string): this {
    return this.bytes(Uint8Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) & 0x7f));
  }
  u32le(n: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return this.bytes(b);
  }
  u16le(n: number): this {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return this.bytes(b);
  }
  u32be(n: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, false);
    return this.bytes(b);
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A RIFF chunk, padded to an even length as RIFF requires. */
function chunk(id: string, body: Uint8Array): Uint8Array {
  const w = new Writer().ascii(id).u32le(body.length).bytes(body);
  if (body.length % 2 === 1) w.bytes(new Uint8Array(1));
  return w.done();
}

function infoChunk(tags: RecordTags): Uint8Array {
  const field = (id: string, value: string): Uint8Array => chunk(id, new Writer().bytes(utf8(value)).bytes(new Uint8Array(1)).done());
  const w = new Writer()
    .ascii('INFO')
    .bytes(field('INAM', tags.title))
    .bytes(field('IART', tags.artist))
    .bytes(field('IPRD', tags.album))
    .bytes(field('ICRD', tags.date))
    .bytes(field('ICMT', tags.comment))
    .bytes(field('ISFT', 'Listen to the Grid'));
  return chunk('LIST', w.done());
}

/** UTF-16 with a byte-order mark, as ID3 v2.3 text frames expect. */
function utf16(s: string, terminate: boolean): Uint8Array {
  const units = [0xfeff, ...Array.from(s).flatMap((c) => {
    const cp = c.codePointAt(0) ?? 0x3f;
    if (cp < 0x10000) return [cp];
    const v = cp - 0x10000;
    return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)];
  })];
  if (terminate) units.push(0);
  const b = new Uint8Array(units.length * 2);
  units.forEach((u, i) => {
    b[i * 2] = u & 0xff;
    b[i * 2 + 1] = u >> 8;
  });
  return b;
}

function frame(id: string, body: Uint8Array): Uint8Array {
  return new Writer().ascii(id).u32be(body.length).bytes(new Uint8Array(2)).bytes(body).done();
}

function syncsafe(n: number): Uint8Array {
  return Uint8Array.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

/** An ID3 v2.3 tag: title, artist, album, year, comment and the cover. */
export function id3Tag(tags: RecordTags, cover?: { mime: string; data: Uint8Array }): Uint8Array {
  const text = (id: string, v: string): Uint8Array => frame(id, new Writer().bytes(Uint8Array.of(1)).bytes(utf16(v, false)).done());
  const frames = new Writer()
    .bytes(text('TIT2', tags.title))
    .bytes(text('TPE1', tags.artist))
    .bytes(text('TALB', tags.album))
    .bytes(text('TYER', tags.date.slice(0, 4)))
    .bytes(frame('COMM', new Writer().bytes(Uint8Array.of(1)).ascii('eng').bytes(utf16('', true)).bytes(utf16(tags.comment, false)).done()));
  if (cover) {
    frames.bytes(
      frame(
        'APIC',
        new Writer()
          .bytes(Uint8Array.of(0))
          .ascii(cover.mime)
          .bytes(Uint8Array.of(0, 3))
          .ascii('Sleeve')
          .bytes(Uint8Array.of(0))
          .bytes(cover.data)
          .done(),
      ),
    );
  }
  const body = frames.done();
  return new Writer().ascii('ID3').bytes(Uint8Array.of(3, 0, 0)).bytes(syncsafe(body.length)).bytes(body).done();
}

export function encodeWav(src: PcmSource, tags: RecordTags, cover?: { mime: string; data: Uint8Array }): Uint8Array {
  const ch = src.channels.length;
  const fmt = new Writer()
    .u16le(1)
    .u16le(ch)
    .u32le(src.sampleRate)
    .u32le(src.sampleRate * ch * 2)
    .u16le(ch * 2)
    .u16le(16)
    .done();
  const body = new Writer()
    .ascii('WAVE')
    .bytes(chunk('fmt ', fmt))
    .bytes(chunk('data', toPcm16(src)))
    .bytes(infoChunk(tags))
    .bytes(chunk('id3 ', id3Tag(tags, cover)))
    .done();
  return new Writer().ascii('RIFF').u32le(body.length).bytes(body).done();
}
