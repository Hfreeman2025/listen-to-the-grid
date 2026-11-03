// Fails if any installed package (dependencies and devDependencies, at any
// depth) is not under MIT, Apache-2.0, a BSD licence or ISC. SPDX "OR"
// expressions pass when any branch is allowed.
//
//   node scripts/check-licences.mjs [--list]
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'ISC']);
const root = new URL('../node_modules/', import.meta.url).pathname;

async function packages(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const path = join(dir, e.name);
    if (e.name.startsWith('@')) {
      out.push(...(await packages(path)));
      continue;
    }
    try {
      const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
      if (pkg.name && pkg.version) out.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? pkg.licenses });
    } catch {
      // not a package directory
    }
    out.push(...(await packages(join(path, 'node_modules'))));
  }
  return out;
}

function allowed(license) {
  if (typeof license !== 'string') return false;
  const expr = license.replace(/[()]/g, '');
  return expr.split(/\s+OR\s+/).some((part) => ALLOWED.has(part.trim()));
}

const all = await packages(root);
const unique = new Map(all.map((p) => [`${p.name}@${p.version}`, p]));
const counts = new Map();
const bad = [];
for (const p of unique.values()) {
  const key = typeof p.license === 'string' ? p.license : JSON.stringify(p.license);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (!allowed(p.license)) bad.push(p);
}
console.log(`${unique.size} packages: ${[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ')}`);
if (process.argv.includes('--list')) for (const p of unique.values()) console.log(`  ${p.name}@${p.version}  ${p.license}`);
if (bad.length > 0) {
  console.error('Not allowed:');
  for (const p of bad) console.error(`  ${p.name}@${p.version}: ${JSON.stringify(p.license)}`);
  process.exit(1);
}
console.log('All licences allowed (MIT, Apache-2.0, BSD, ISC).');
