/**
 * public/_headers in Cloudflare Pages' format: a path on a line of its own,
 * then its headers, indented; "! Name" removes a header Pages would add.
 * The build applies the indexing switch to it and writes robots.txt to
 * match; `vite preview` serves its /* rule, so local checks run under the
 * same headers as the hosted piece. Pure, so the build, the gate and the
 * tests read it the same way.
 */

export interface HeaderRule {
  readonly path: string;
  /** header names in lower case, with their values */
  readonly set: ReadonlyArray<readonly [name: string, value: string]>;
  readonly detach: readonly string[];
}

export function parseHeaders(text: string): HeaderRule[] {
  const rules: { path: string; set: [string, string][]; detach: string[] }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), set: [], detach: [] });
      continue;
    }
    const rule = rules.at(-1);
    if (!rule) continue;
    const detach = /^\s*!\s*([\w-]+)\s*$/.exec(line);
    if (detach?.[1]) rule.detach.push(detach[1].toLowerCase());
    else {
      const m = /^\s*([\w-]+):\s*(.*)$/.exec(line);
      if (m?.[1]) rule.set.push([m[1].toLowerCase(), (m[2] ?? '').trim()]);
    }
  }
  return rules;
}

/** A header's value in one rule (by default the rule for every path, /*). */
export function headerOf(rules: readonly HeaderRule[], name: string, path = '/*'): string | undefined {
  return rules.find((r) => r.path === path)?.set.find(([n]) => n === name.toLowerCase())?.[1];
}

/** A policy's directives, by name, each with its sources. */
export function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map((d) => [(d[0] ?? '').toLowerCase(), d.slice(1)]),
  );
}

const ROBOTS_LINE = /^[ \t]+X-Robots-Tag:.*\n/gim;

/**
 * _headers with the indexing switch applied: the template always carries
 * X-Robots-Tag: noindex, nofollow, and an indexable build drops it.
 */
export function applyIndexing(template: string, indexable: boolean): string {
  const rules = parseHeaders(template);
  if (headerOf(rules, 'X-Robots-Tag') !== 'noindex, nofollow')
    throw new Error('_headers has no X-Robots-Tag: noindex, nofollow under /* for the indexing switch');
  if (!headerOf(rules, 'Content-Security-Policy')) throw new Error('_headers has no Content-Security-Policy under /*');
  return indexable ? template.replace(ROBOTS_LINE, '') : template;
}

export function robotsTxt(indexable: boolean): string {
  return indexable ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n';
}

/** The /* rule's headers, for `vite preview`, with the header names as written. */
export function previewHeaders(headers: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inAll = false;
  for (const line of headers.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === '/*';
      continue;
    }
    const m = /^\s*([\w-]+):\s*(.*)$/.exec(line);
    if (inAll && m?.[1]) out[m[1]] = (m[2] ?? '').trim();
  }
  return out;
}
