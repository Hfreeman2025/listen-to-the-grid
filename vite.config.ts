import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { parseHostingConfig } from './src/hosting/config';
import { applyIndexing, previewHeaders, robotsTxt } from './src/hosting/headers';

const root = import.meta.dirname;
const hosting = parseHostingConfig(JSON.parse(readFileSync(join(root, 'hosting.config.json'), 'utf8')));
/** The response headers, the Content-Security-Policy among them: one file, read by Pages, the build and `vite preview`. */
const headers = applyIndexing(readFileSync(join(root, 'public/_headers'), 'utf8'), hosting.SITE_INDEXABLE);

/**
 * The hosted files beside the page: _headers with the indexing switch
 * applied, robots.txt to match, and a 404 page, so Pages answers a missing
 * path with 404 rather than with the piece (its default when there is none).
 */
function hostedFiles(): Plugin {
  let outDir = '';
  return {
    name: 'hosted-files',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      writeFileSync(join(outDir, '_headers'), headers);
      writeFileSync(join(outDir, 'robots.txt'), robotsTxt(hosting.SITE_INDEXABLE));
      const index = readFileSync(join(outDir, 'index.html'), 'utf8');
      const style = /<link rel="stylesheet"[^>]*href="\.\/(assets\/index-[^"]+\.css)"/.exec(index)?.[1];
      if (!style) throw new Error('build: index.html has no stylesheet for the 404 page');
      writeFileSync(join(outDir, '404.html'), notFound(`/${style}`));
    },
  };
}

function notFound(style: string): string {
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Not here: Listen to the Grid</title>
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#f4efe6" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/fonts/fonts.css" />
    <link rel="stylesheet" href="${style}" />
  </head>
  <body>
    <header class="top">
      <h1>Listen to the Grid</h1>
      <p class="lede">There is nothing at this address. <a href="/">The grid is playing here.</a></p>
    </header>
  </body>
</html>
`;
}

export default defineConfig({
  base: './',
  plugins: [hostedFiles()],
  build: {
    target: 'es2022',
    // Nothing of the source leaves the build: no maps.
    sourcemap: false,
  },
  // `vite preview` answers with the hosted headers, so the browser checks run under the hosted policy.
  preview: { headers: previewHeaders(headers) },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
