import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The built page may only talk to the Carbon Intensity API and Google Fonts.
 * A Content-Security-Policy makes the browser enforce that. (Build only: the
 * dev server needs inline scripts and a websocket for hot reload.)
 */
const policy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  // WebKit draws a native <select> with inline style attributes of its own.
  // Attributes cannot run script; <style> elements and scripts stay locked down.
  "style-src-attr 'unsafe-inline'",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  'connect-src https://api.carbonintensity.org.uk',
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp: Plugin = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
};

export default defineConfig({
  base: './',
  plugins: [csp],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
