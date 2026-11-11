import { describe, expect, it } from 'vitest';
import hostingJson from '../hosting.config.json';
import { parseHostingConfig } from '../src/hosting/config';
import {
  checkHeaders,
  deniedIn,
  denyMatchers,
  EXCEPTIONS,
  fileProblems,
  parseDenylist,
  printableRuns,
  scanText,
} from '../src/hosting/gate';
import { applyIndexing, headerOf, parseHeaders, previewHeaders, robotsTxt } from '../src/hosting/headers';
import { allowedAccount, deploymentUrl, projectNames } from '../src/hosting/wrangler';

const POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src https://api.carbonintensity.org.uk; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const headersWith = (csp = POLICY, robots = true) => `# a comment line: X-Robots-Tag in a comment is not a header
/*
  Content-Security-Policy: ${csp}
${robots ? '  X-Robots-Tag: noindex, nofollow\n' : ''}  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  ! Access-Control-Allow-Origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
const PAGE = { file: 'index.html', html: '<!doctype html><script type="module" src="./assets/index-a1.js"></script><p class="x">hi</p>' };
const whats = (found: readonly { what: string }[]) => found.map((f) => f.what);

describe('the hosting config', () => {
  it('is valid as committed, with indexing off', () => {
    const c = parseHostingConfig(hostingJson);
    expect(c).toMatchObject({
      origin: 'https://listen.harryfreeman.dev',
      project: 'listen-to-the-grid',
      branch: 'main',
      SITE_INDEXABLE: false,
    });
  });

  it('refuses an origin with a path, a non-https one, and a wrong branch', () => {
    expect(() => parseHostingConfig({ ...hostingJson, origin: 'https://listen.harryfreeman.dev/' })).toThrow(/origin/);
    expect(() => parseHostingConfig({ ...hostingJson, origin: 'http://listen.harryfreeman.dev' })).toThrow(/origin/);
    expect(() => parseHostingConfig({ ...hostingJson, branch: 'preview' })).toThrow(/branch/);
    expect(() => parseHostingConfig({ ...hostingJson, account: 'not an email' })).toThrow(/account/);
  });
});

describe('_headers', () => {
  it('reads the rules as Pages does, comments and detached headers included', () => {
    const rules = parseHeaders(headersWith());
    expect(rules.map((r) => r.path)).toEqual(['/*', '/assets/*']);
    expect(headerOf(rules, 'x-robots-tag')).toBe('noindex, nofollow');
    expect(rules[0]?.detach).toEqual(['access-control-allow-origin']);
    expect(headerOf(rules, 'Cache-Control', '/assets/*')).toBe('public, max-age=31536000, immutable');
  });

  it('applies the indexing switch: the noindex header goes only when indexable, and robots.txt follows', () => {
    expect(applyIndexing(headersWith(), false)).toBe(headersWith());
    const indexable = applyIndexing(headersWith(), true);
    expect(headerOf(parseHeaders(indexable), 'X-Robots-Tag')).toBeUndefined();
    expect(indexable).toContain('# a comment line: X-Robots-Tag');
    expect(robotsTxt(false)).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt(true)).toBe('User-agent: *\nAllow: /\n');
  });

  it('refuses a template the switch cannot work on', () => {
    expect(() => applyIndexing(headersWith(POLICY, false), false)).toThrow(/X-Robots-Tag/);
  });

  it('gives vite preview the /* rule only', () => {
    const h = previewHeaders(headersWith());
    expect(Object.keys(h)).toEqual([
      'Content-Security-Policy',
      'X-Robots-Tag',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'Permissions-Policy',
    ]);
  });
});

describe('the gate: names', () => {
  it('refuses an empty denylist, and ignores comments and blank lines', () => {
    expect(() => parseDenylist('# only a comment\n\n')).toThrow(/no names/);
    expect(parseDenylist('# names\nAcme Widgets\n\nGlobex # a client\n')).toEqual(['Acme Widgets', 'Globex']);
  });

  it('matches whole words, any case, with space, hyphen or underscore between words, and reports numbers only', () => {
    const m = denyMatchers(['Acme Widgets', 'Globex']);
    expect(deniedIn('made for ACME widgets', m)).toEqual([1]);
    expect(deniedIn('acme-widgets and acme_widgets', m)).toEqual([1]);
    expect(deniedIn('globex.', m)).toEqual([2]);
    expect(deniedIn('Globexcorp, xGlobex, Acmewidgets', m)).toEqual([]);
  });

  it('reads binary files as their printable runs, so short names in compressed bytes do not match', () => {
    expect(printableRuns('\x00\x01Glo\x02\x03Author: Someone Else\x00')).toBe('Author: Someone Else');
  });
});

describe('the gate: what must not leave the machine', () => {
  it.each([
    ['a home path', 'see /Users/someone/Personal'],
    ['a home path', 'cd ~/Personal/lab'],
    ['a local address', 'fetch("http://localhost:4179/x")'],
    ['a local address', 'host 127.0.0.1'],
    ['a source map reference', '//# sourceMappingURL=index.js.map'],
    ['a private key', '-----BEGIN PRIVATE KEY-----'],
    ['an API key', 'sk-abcdefghijklmnopqrstuvwxyz'],
    ['an email address', 'write to someone@example.com'],
    ['a plain http:// URL', 'src="http://example.com/a.js"'],
  ])('refuses %s', (what, text) => {
    expect(whats(scanText('assets/index-a1.js', text)).some((w) => w.startsWith(what))).toBe(true);
  });

  it('allows XML namespaces, and plain http in licence texts', () => {
    expect(scanText('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg">')).toEqual([]);
    expect(scanText('fonts/OFL-ibm-plex-sans.txt', 'see http://scripts.sil.org/OFL')).toEqual([]);
  });

  it('keeps each exception exactly as narrow as written: only those strings, only in the main bundle', () => {
    expect(EXCEPTIONS.length).toBe(1);
    const zod = 'a="http://json-schema.org/draft-07/schema#";b=`http://[${t}]`';
    expect(scanText('assets/index-a1B2.js', zod)).toEqual([]);
    expect(scanText('assets/loudness.worker-a1.js', zod).length).toBe(2);
    expect(scanText('assets/index-a1B2.js', 'x="http://json-schema.org/other"').length).toBe(1);
  });

  it('refuses source maps, local secrets files and anything over 25 MiB', () => {
    expect(whats(fileProblems('assets/index-a1.js.map', 10))).toEqual(['a source map']);
    expect(whats(fileProblems('.env.production', 10))).toEqual(['a local secrets or tooling file']);
    expect(whats(fileProblems('og.png', 26 * 1024 * 1024))[0]).toMatch(/over Cloudflare Pages' 25 MiB/);
    expect(fileProblems('index.html', 13_000)).toEqual([]);
  });
});

describe('the gate: the headers and pages', () => {
  it('passes the policy as committed, with indexing off', () => {
    expect(checkHeaders(headersWith(), robotsTxt(false), [PAGE], false)).toEqual([]);
  });

  it.each([
    [
      "'unsafe-inline' in style-src",
      POLICY.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
      /style-src allows 'unsafe-inline'/,
    ],
    [
      "'unsafe-eval' in script-src",
      POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
      /script-src allows 'unsafe-eval'/,
    ],
    ['data: in script-src', POLICY.replace("script-src 'self'", "script-src 'self' data:"), /script-src allows data:/],
    ['a wildcard host', POLICY.replace('connect-src https://api', 'connect-src https://*.carbonintensity.org.uk https://api'), /wildcard/],
    ['plain http', POLICY.replace('connect-src https://api', 'connect-src http://api'), /plain http/],
    ["default-src that is not 'none'", POLICY.replace("default-src 'none'", "default-src 'self'"), /default-src is not 'none'/],
    ['no frame-ancestors', POLICY.replace("; frame-ancestors 'none'", ''), /frame-ancestors is not 'none'/],
  ])('refuses %s', (_name, csp, message) => {
    expect(whats(checkHeaders(headersWith(csp), robotsTxt(false), [PAGE], false)).some((w) => message.test(w))).toBe(true);
  });

  it('refuses the indexing switch out of step, either way', () => {
    expect(whats(checkHeaders(headersWith(POLICY, false), robotsTxt(false), [PAGE], false))).toContain(
      'X-Robots-Tag: noindex, nofollow is missing, and SITE_INDEXABLE is false',
    );
    expect(whats(checkHeaders(headersWith(), robotsTxt(true), [PAGE], true))).toContain(
      'X-Robots-Tag noindex is sent, but SITE_INDEXABLE is true',
    );
    expect(whats(checkHeaders(headersWith(), robotsTxt(true), [PAGE], false))).toContain('does not disallow everything');
    expect(whats(checkHeaders(headersWith(), null, [PAGE], false))).toContain('missing');
  });

  it('refuses a missing security header', () => {
    const noSniff = headersWith().replace('  X-Content-Type-Options: nosniff\n', '');
    expect(whats(checkHeaders(noSniff, robotsTxt(false), [PAGE], false))).toContain('X-Content-Type-Options is missing');
  });

  it('refuses an inline script, a style attribute or a second policy in a page', () => {
    const pages = [
      { file: 'a.html', html: '<script>alert(1)</script>' },
      { file: 'b.html', html: '<p style="color:red">x</p>' },
      { file: 'c.html', html: '<meta http-equiv="Content-Security-Policy" content="default-src *">' },
    ];
    expect(checkHeaders(headersWith(), robotsTxt(false), pages, false).map((f) => f.file)).toEqual(['a.html', 'b.html', 'c.html']);
  });
});

describe('wrangler', () => {
  const who = (email: string, accounts = [{ id: 'a'.repeat(32), name: 'Personal' }]) => JSON.stringify({ loggedIn: true, email, accounts });

  it('accepts exactly the allowed email with exactly one account', () => {
    expect(allowedAccount(who('me@example.com'), 'me@example.com')).toEqual({
      email: 'me@example.com',
      id: 'a'.repeat(32),
      name: 'Personal',
    });
  });

  it('refuses another email, two accounts, no login and output that is not JSON', () => {
    expect(() => allowedAccount(who('other@example.com'), 'me@example.com')).toThrow(/not me@example.com/);
    expect(() =>
      allowedAccount(
        who('me@example.com', [
          { id: 'a'.repeat(32), name: 'A' },
          { id: 'b'.repeat(32), name: 'B' },
        ]),
        'me@example.com',
      ),
    ).toThrow(/2 Cloudflare accounts/);
    expect(() => allowedAccount(JSON.stringify({ loggedIn: false }), 'me@example.com')).toThrow(/not logged in/);
    expect(() => allowedAccount('You are not authenticated.', 'me@example.com')).toThrow(/did not answer in JSON/);
  });

  it('reads project names and the deployment URL', () => {
    expect(projectNames(JSON.stringify([{ 'Project Name': 'listen-to-the-grid', 'Project Domains': 'x' }]))).toEqual([
      'listen-to-the-grid',
    ]);
    expect(deploymentUrl('✨ Deployment complete! Take a peek over at https://abc123.listen-to-the-grid.pages.dev.')).toBe(
      'https://abc123.listen-to-the-grid.pages.dev',
    );
  });
});
