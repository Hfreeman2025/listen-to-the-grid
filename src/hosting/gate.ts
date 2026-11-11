import { directives, headerOf, parseHeaders } from './headers';

/**
 * The pre-deploy gate's rules; scripts/predeploy-check.mjs runs them over
 * every file in dist/. Pure, so the unit tests prove each rule fires and
 * each exception stays exactly as narrow as it is written.
 */

export interface Finding {
  readonly file: string;
  readonly what: string;
}

// Names that must never be public

/**
 * The denylist: one name per line, # comments, from a file kept outside
 * every repository (README, Hosting). An empty list would pass everything,
 * so it is refused.
 */
export function parseDenylist(text: string): string[] {
  const names = text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error('the denylist has no names');
  return names;
}

/**
 * Case-insensitive, whole words: a name inside a longer word or a base64
 * hash never matches, a standalone one does, and a space, hyphen or
 * underscore may stand between the words of a name.
 */
export function denyMatchers(names: readonly string[]): RegExp[] {
  return names.map((name) => {
    const body = name
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(String.raw`[\s_-]+`);
    return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'i');
  });
}

/** Which entries of the denylist (by number, never by name) a text contains. */
export function deniedIn(text: string, matchers: readonly RegExp[]): number[] {
  return matchers.flatMap((re, i) => (re.test(text) ? [i + 1] : []));
}

/**
 * The text in a binary file, given as latin1: runs of six or more printable
 * characters, as `strings` reads metadata. Compressed pixels and font
 * outlines are not text, and a short name read straight out of them would
 * match random bytes.
 */
export function printableRuns(latin1: string): string {
  return latin1.match(/[\x20-\x7e]{6,}/g)?.join('\n') ?? '';
}

// What must not leave Harry's machine

export const PATTERNS: readonly (readonly [what: string, re: RegExp])[] = [
  ['a home path', /\/Users\/[A-Za-z0-9._-]+|\/home\/[a-z][a-z0-9_-]*|~\/(?:Personal|Projects|Documents|Desktop|Downloads)\b/g],
  ['a local address', /(?<![\w.])(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?!\w)|\[::1\]/g],
  ['a source map reference', /sourceMappingURL=/g],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  [
    'an API key',
    /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|hf_[A-Za-z0-9]{30,})\b/g,
  ],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
];
const PLAIN_HTTP = /http:\/\/[^\s"'`)<>\\]+/g;
/** XML and SVG namespace names are identifiers, never fetched. */
const NAMESPACE = /^http:\/\/(?:www\.w3\.org|ns\.adobe\.com|purl\.org)\//;
/** Licence texts give their own (old, plain http) addresses. */
const LICENCE_FILE = /(?:^|\/)(?:LICEN[CS]E|OFL)[^/]*\.txt$/;

/**
 * Exact strings allowed in exact files, each reviewed: a match is dropped
 * only when its file and its text are both listed. Anything else of the
 * same kind still fails.
 */
export const EXCEPTIONS: readonly { file: RegExp; what: string; match: RegExp; why: string }[] = [
  {
    file: /^assets\/index-[\w-]+\.js$/,
    what: 'a plain http:// URL',
    match: /^http:\/\/(?:json-schema\.org\/draft-0[47]\/schema#|\[\$\{\w\}\])$/,
    why: 'inside the bundled zod: JSON Schema identifiers, and the string it hands to new URL() to check an IPv6 address; neither is fetched',
  },
];

function excepted(file: string, what: string, match: string): boolean {
  return EXCEPTIONS.some((e) => e.what === what && e.file.test(file) && e.match.test(match));
}

/** Every problem in one text file of dist/, by its path inside dist/. */
export function scanText(file: string, text: string): Finding[] {
  const found: Finding[] = [];
  for (const [what, re] of PATTERNS)
    for (const m of text.matchAll(re)) if (!excepted(file, what, m[0])) found.push({ file, what: `${what} (“${m[0].slice(0, 40)}”)` });
  if (!LICENCE_FILE.test(file))
    for (const m of text.matchAll(PLAIN_HTTP))
      if (!NAMESPACE.test(m[0]) && !excepted(file, 'a plain http:// URL', m[0]))
        found.push({ file, what: `a plain http:// URL (“${m[0].slice(0, 60)}”)` });
  return found;
}

/** Cloudflare Pages' limits: 25 MiB a file, 20,000 files. */
export const LIMITS = { fileBytes: 25 * 1024 * 1024, files: 20_000 } as const;

/** What a file's name and size alone rule out. */
export function fileProblems(file: string, bytes: number): Finding[] {
  const found: Finding[] = [];
  const base = file.split('/').pop() ?? '';
  if (bytes > LIMITS.fileBytes) found.push({ file, what: `${(bytes / 1024 / 1024).toFixed(1)} MiB, over Cloudflare Pages' 25 MiB a file` });
  if (base.endsWith('.map')) found.push({ file, what: 'a source map' });
  if (/^(?:\.env|\.dev\.vars|\.npmrc|\.wrangler)/.test(base)) found.push({ file, what: 'a local secrets or tooling file' });
  return found;
}

// The headers

/** Sources no directive may allow. */
const LOOSE = new Set([
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'wasm-unsafe-eval'",
  '*',
  'http:',
  'https:',
  'data:',
  'blob:',
]);
/** The one exception: the select's arrow is an inline SVG in the stylesheet. */
const ALLOWED_LOOSE: Readonly<Record<string, readonly string[]>> = { 'img-src': ['data:'] };

export const REQUIRED_HEADERS: readonly (readonly [name: string, value: RegExp])[] = [
  ['Referrer-Policy', /^strict-origin-when-cross-origin$/],
  ['X-Content-Type-Options', /^nosniff$/],
  ['Permissions-Policy', /^(?=.*\bcamera=\(\))(?=.*\bmicrophone=\(\))(?=.*\bgeolocation=\(\))/],
];

/**
 * The built _headers and robots.txt, checked against the indexing switch,
 * and the built pages against the policy: no inline script, no style
 * attribute and no second policy in a <meta> tag.
 */
export function checkHeaders(
  headers: string,
  robots: string | null,
  pages: readonly { file: string; html: string }[],
  indexable: boolean,
): Finding[] {
  const found: Finding[] = [];
  const bad = (what: string) => found.push({ file: '_headers', what });
  const rules = parseHeaders(headers);
  const csp = headerOf(rules, 'Content-Security-Policy');
  if (!csp) bad('no Content-Security-Policy for /*');
  else {
    const d = directives(csp);
    for (const name of ['default-src', 'base-uri', 'form-action', 'frame-ancestors', 'object-src'])
      if (d.get(name)?.join(' ') !== "'none'") bad(`the CSP's ${name} is not 'none'`);
    for (const [name, sources] of d)
      for (const s of sources) {
        if (LOOSE.has(s) && !(ALLOWED_LOOSE[name] ?? []).includes(s)) bad(`the CSP's ${name} allows ${s}`);
        else if (s.includes('*') && s !== '*') bad(`the CSP's ${name} allows the wildcard ${s}`);
        else if (/^http:/.test(s)) bad(`the CSP's ${name} allows plain http (${s})`);
      }
  }
  for (const r of rules)
    if (r.path !== '/*' && r.set.some(([n]) => n === 'content-security-policy')) bad(`${r.path} has a Content-Security-Policy of its own`);
  for (const [name, value] of REQUIRED_HEADERS) {
    const line = headerOf(rules, name);
    if (!line || !value.test(line)) bad(`${name} is ${line ? `“${line}”` : 'missing'}`);
  }
  const noindex = headerOf(rules, 'X-Robots-Tag') === 'noindex, nofollow';
  if (indexable && noindex) bad('X-Robots-Tag noindex is sent, but SITE_INDEXABLE is true');
  if (!indexable && !noindex) bad('X-Robots-Tag: noindex, nofollow is missing, and SITE_INDEXABLE is false');
  if (robots === null) found.push({ file: 'robots.txt', what: 'missing' });
  else if (indexable === /^Disallow:\s*\/\s*$/m.test(robots))
    found.push({
      file: 'robots.txt',
      what: indexable ? 'disallows everything, but SITE_INDEXABLE is true' : 'does not disallow everything',
    });
  for (const p of pages) {
    const markup = p.html.replace(/<!--[\s\S]*?-->/g, '');
    for (const m of markup.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi))
      if (!/\ssrc\s*=/i.test(m[1] ?? '')) found.push({ file: p.file, what: 'an inline script, which the policy refuses' });
    if (/<[a-z][^>]*\sstyle\s*=/i.test(markup.replace(/<script[\s\S]*?<\/script\s*>/gi, '')))
      found.push({ file: p.file, what: 'a style attribute, which the policy refuses' });
    if (/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy/i.test(markup))
      found.push({ file: p.file, what: 'a second policy in a <meta> tag; the policy lives only in _headers' });
  }
  return found;
}
