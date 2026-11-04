import { transform } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite keeps whitespace in library builds so a later bundler can still
 * tree-shake; this module is meant to be used as it is, so minify it fully.
 */
const minify: Plugin = {
  name: 'minify-library',
  apply: 'build',
  enforce: 'post',
  // Last of all, after Vite's own library pass has printed the chunks.
  async generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type !== 'chunk') continue;
      file.code = (await transform(file.code, { minify: true, format: 'esm', target: 'es2022' })).code;
    }
  },
};

/**
 * The radio: Listen to the Grid's sound as one ES module for another page to
 * embed (see src/radio.ts and the README). Same engine, conductor and data
 * code as the page; none of the page itself. `base: './'` keeps the
 * loudness worker's address relative to the module, wherever it is vendored.
 * `npm run build:radio` then puts its types, README and licence beside it.
 */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [minify],
  build: {
    outDir: 'dist-radio',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: 'src/radio.ts',
      formats: ['es'],
      fileName: () => 'listen-to-the-grid-radio.js',
    },
  },
});
