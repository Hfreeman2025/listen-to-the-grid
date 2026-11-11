// The gate before anything is hosted. It reads the built dist/ and fails closed on anything that should not
// leave Harry's machine, then runs the typecheck, the lint and the unit tests. `npm run deploy` runs it after
// the build; on its own:
//
//   npm run build && npm run check:predeploy
//
// Over every file in dist/ it refuses (rules in src/hosting/gate.ts, unit-tested in test/hosting.test.ts):
//   - names that must never be public, from a denylist kept outside every repository,
//     ~/Personal/.site-gate/denylist.txt: one name per line, # comments, case-insensitive, whole words. A
//     missing or empty list, or one inside a repository, stops the gate. It reports how many names it
//     checked and how many hit, never the names;
//   - home paths, localhost and 127.0.0.1, plain http:// URLs, source maps, .env files, email addresses and
//     strings shaped like keys or tokens;
//   - a file over Cloudflare Pages' 25 MiB, or more files than its 20,000;
//   - _headers missing or loose (see checkHeaders), robots.txt out of step with the indexing switch, and an
//     inline script, a style attribute or a <meta> policy in any page.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';
import { loadHosting, root } from './hosting/load.mjs';

const dist = join(root, 'dist');
const DENYLIST = join(homedir(), 'Personal/.site-gate/denylist.txt');
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.otf', '.wav']);
const MIB = 1024 * 1024;

const findings = [];
const add = (list) => findings.push(...list);

function denylist(parse) {
  if (!existsSync(DENYLIST)) throw new Error(`the denylist is missing (${DENYLIST}); the gate does not run without it`);
  const inRepo = spawnSync('git', ['-C', dirname(DENYLIST), 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inRepo.status === 0 && inRepo.stdout.trim() === 'true')
    throw new Error('the denylist is inside a git repository; keep it outside every repository');
  return parse(readFileSync(DENYLIST, 'utf8'));
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? walk(path)
      : [{ path, rel: relative(dist, path).split('\\').join('/'), size: statSync(path).size }];
  });
}

function codeChecks() {
  return [
    ['typecheck', ['run', 'typecheck']],
    ['lint', ['run', 'lint']],
    ['unit tests', ['test']],
  ].map(([label, args]) => {
    const r = spawnSync('npm', args, { cwd: root, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    return { label, ok: r.status === 0, summary: label === 'unit tests' ? (/Tests\s+(.+)/.exec(out)?.[1]?.trim() ?? '') : '', out };
  });
}

try {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ has no index.html: run npm run build first');
  const { hosting, gate } = await loadHosting();
  const names = denylist(gate.parseDenylist);
  const matchers = gate.denyMatchers(names);
  const files = walk(dist);
  let hits = 0;
  let scanned = 0;
  for (const f of files) {
    add(gate.fileProblems(f.rel, f.size));
    const bytes = readFileSync(f.path);
    const binary = BINARY.has(extname(f.rel).toLowerCase());
    // Every file for the names: text whole, binary files as the text inside them (their metadata).
    const text = binary ? gate.printableRuns(bytes.toString('latin1')) : bytes.toString('utf8');
    for (const n of gate.deniedIn(text, matchers)) {
      hits++;
      findings.push({ file: f.rel, what: `a name on the denylist (entry ${n} of ${names.length})` });
    }
    if (binary) {
      if (/\/Users\/[A-Za-z0-9._-]+|~\/Personal\b/.test(text)) findings.push({ file: f.rel, what: 'a home path in a binary file' });
      continue;
    }
    scanned++;
    add(gate.scanText(f.rel, text));
  }
  if (files.length > gate.LIMITS.files)
    findings.push({ file: 'dist', what: `${files.length} files, over Cloudflare Pages' ${gate.LIMITS.files}` });
  const read = (rel) => (existsSync(join(dist, rel)) ? readFileSync(join(dist, rel), 'utf8') : null);
  const headers = read('_headers');
  if (headers === null) findings.push({ file: '_headers', what: 'missing' });
  else {
    const pages = files.filter((f) => f.rel.endsWith('.html')).map((f) => ({ file: f.rel, html: readFileSync(f.path, 'utf8') }));
    add(gate.checkHeaders(headers, read('robots.txt'), pages, hosting.SITE_INDEXABLE));
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  const largest = Math.max(...files.map((f) => f.size));
  console.log(
    `predeploy: ${files.length} files, ${(total / MIB).toFixed(2)} MiB in all, largest ${(largest / MIB).toFixed(2)} MiB; ${scanned} text files scanned`,
  );
  console.log(`predeploy: denylist: ${names.length} names checked, ${hits} hit${hits === 1 ? '' : 's'}`);
  console.log(
    `predeploy: indexing ${hosting.SITE_INDEXABLE ? 'ON (SITE_INDEXABLE true)' : 'off (noindex, nofollow; robots.txt disallows all)'}`,
  );
  for (const c of codeChecks()) {
    console.log(`predeploy: ${c.label} ${c.ok ? 'passed' : 'FAILED'}${c.summary ? ` (${c.summary})` : ''}`);
    if (!c.ok) {
      findings.push({ file: c.label, what: 'failed' });
      console.log(c.out.split('\n').slice(-40).join('\n'));
    }
  }
  if (findings.length > 0) {
    const unique = [...new Set(findings.map((f) => `${f.file}: ${f.what}`))];
    console.log(`predeploy: ${unique.length} problem${unique.length === 1 ? '' : 's'}; nothing may be deployed`);
    for (const p of unique.slice(0, 200)) console.log(`  ${p}`);
    process.exit(1);
  }
  const head = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  console.log(`predeploy: clean (${head}, dist/ at ${dist})`);
} catch (error) {
  console.error(`predeploy: stopped, nothing may be deployed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
