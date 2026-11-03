// Reads a pressed record back from disk and reports what a mastering
// engineer would check first: peak, loudness, clipped samples, and how much
// the loudness moves (a flat line is a drone; phrases breathe).
//
//   node scripts/analyse-wav.mjs shots/v2/yesterday.wav
import { readFile } from 'node:fs/promises';

const bytes = await readFile(process.argv[2] ?? 'shots/v2/yesterday.wav');
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
let at = 12;
let fmt = null;
let data = null;
const chunks = [];
while (at + 8 <= bytes.length) {
  const id = tag(at);
  const size = view.getUint32(at + 4, true);
  chunks.push(id);
  if (id === 'fmt ') fmt = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
  if (id === 'data') data = { start: at + 8, size };
  at += 8 + size + (size % 2);
}
if (!fmt || !data || fmt.bits !== 16) throw new Error('expected 16-bit PCM');
const frames = data.size / (2 * fmt.channels);
const sample = (i, c) => view.getInt16(data.start + (i * fmt.channels + c) * 2, true) / 32768;
let peak = 0;
let sum = 0;
let clipped = 0;
const win = Math.round(fmt.rate * 0.4);
const frameDb = [];
let e = 0;
for (let i = 0; i < frames; i++) {
  let m = 0;
  for (let c = 0; c < fmt.channels; c++) {
    const v = sample(i, c);
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) >= 0.999) clipped++;
    m += v * v;
  }
  sum += m / fmt.channels;
  e += m / fmt.channels;
  if ((i + 1) % win === 0) {
    frameDb.push(10 * Math.log10(e / win + 1e-12));
    e = 0;
  }
}
// Ignore the fade in and the reverb tail when judging how the music moves.
const body = frameDb.slice(3, -9).sort((a, b) => a - b);
const pct = (q) => body[Math.floor(q * (body.length - 1))];
const db = (x) => Math.round(20 * Math.log10(x) * 10) / 10;
console.log(
  JSON.stringify(
    {
      chunks,
      seconds: +(frames / fmt.rate).toFixed(2),
      sampleRate: fmt.rate,
      peakDbfs: db(peak),
      rmsDbfs: db(Math.sqrt(sum / frames)),
      clippedSamples: clipped,
      loudnessRangeP10toP90Db: Math.round((pct(0.9) - pct(0.1)) * 10) / 10,
    },
    null,
    2,
  ),
);
