// Records one UK calendar day from the Carbon Intensity API into
// src/data/sample-day.json, which the app plays when the API is unreachable.
//
//   node scripts/record-sample.mjs 2026-10-28
//
// The file keeps the API's own response objects untouched (only trimmed to the
// day), so the app validates the sample with exactly the same schemas it uses
// for live data.
import { writeFile } from 'node:fs/promises';

const API = 'https://api.carbonintensity.org.uk';
const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('usage: node scripts/record-sample.mjs YYYY-MM-DD');
  process.exit(1);
}

/** UTC instant of 00:00 Europe/London on the given calendar date. */
function londonMidnight(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Try both possible UK offsets and keep the one that lands on 00:00 local.
  for (const offsetHours of [0, 1]) {
    const t = Date.UTC(y, m - 1, d, -offsetHours);
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(t);
    if (local === '00:00') return t;
  }
  throw new Error(`could not resolve London midnight for ${isoDate}`);
}

const start = londonMidnight(date);
const next = new Date(start + 26 * 3600e3).toISOString().slice(0, 10);
const end = londonMidnight(next);
const fmt = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';

async function get(path) {
  const res = await fetch(API + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const inDay = (row) => {
  const t = Date.parse(row.from);
  return t >= start && t < end;
};

// The API returns the periods whose *end* falls within [from, to], so the
// first row is the half-hour before `from`; the filter below trims it.
const range = `${fmt(start)}/${fmt(end)}`;
const generation = await get(`/generation/${range}`);
const intensity = await get(`/intensity/${range}`);
generation.data = generation.data.filter(inDay);
intensity.data = intensity.data.filter(inDay);

const expected = Math.round((end - start) / (30 * 60e3));
if (generation.data.length !== expected || intensity.data.length !== expected) {
  throw new Error(`expected ${expected} periods, got ${generation.data.length} generation / ${intensity.data.length} intensity`);
}

const sample = {
  date,
  recordedAt: new Date().toISOString(),
  source: `${API}/generation and /intensity, ${range}`,
  generation,
  intensity,
};
await writeFile(new URL('../src/data/sample-day.json', import.meta.url), JSON.stringify(sample) + '\n');
console.log(`recorded ${date}: ${expected} half-hour periods`);
