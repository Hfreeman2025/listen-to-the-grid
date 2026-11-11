// The hosting rules (src/hosting/*.ts) loaded into Node through Vite, as the browser harness loads the
// loudness meter, so the gate, the deploy and the unit tests all run the same code.
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

export const root = new URL('../../', import.meta.url).pathname;

export async function loadHosting() {
  const vite = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, entries: [] },
    logLevel: 'warn',
  });
  try {
    const [config, headers, gate, wrangler] = await Promise.all(
      ['config', 'headers', 'gate', 'wrangler'].map((m) => vite.ssrLoadModule(`/src/hosting/${m}.ts`)),
    );
    const hosting = config.parseHostingConfig(JSON.parse(readFileSync(`${root}hosting.config.json`, 'utf8')));
    return { hosting, headers, gate, wrangler };
  } finally {
    await vite.close();
  }
}
