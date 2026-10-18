import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ASSET_HEADERS } from './worker/asset-headers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
execFileSync('git', ['branch', '--show-current'], { cwd: root });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const adapters = new Map(['variant', 'basemap', 'basemap-styles'].map((name) => [
  resolve(root, 'src/config', `${name}.ts`).replaceAll('\\', '/'), resolve(here, 'client', `${name}.ts`),
]));

export default defineConfig({
  root: here,
  envDir: false,
  envPrefix: 'ONRUSH_PUBLIC_',
  resolve: { alias: { '@': resolve(root, 'src') } },
  define: {
    __APP_VERSION__: JSON.stringify('2.11.0-onrush'), __BUILD_HASH__: JSON.stringify(revision), __CLERK_JS_VERSION__: JSON.stringify('disabled'),
    'import.meta.env.VITE_VARIANT': JSON.stringify('full'),
    'import.meta.env.VITE_COUNTRY_OVERRIDES_URL': JSON.stringify('/data/country-boundary-overrides.geojson'),
  },
  plugins: [{
    name: 'onrush-build-adapters', enforce: 'pre',
    async resolveId(source, importer) {
      if (/\/MapPopup(?:\.ts)?$/.test(source) && !importer?.replaceAll('\\', '/').endsWith('/onrush/client/reference-popup.ts')) {
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (resolved?.id.replaceAll('\\', '/') === resolve(root, 'src/components/MapPopup.ts').replaceAll('\\', '/')) return resolve(here, 'client/reference-popup.ts');
      }
      if (/\/(?:variant|basemap|basemap-styles)(?:\.ts)?$/.test(source)) {
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        const adapter = resolved && adapters.get(resolved.id.replaceAll('\\', '/'));
        if (adapter) return adapter;
      }
      if (source.endsWith('/bootstrap-tier-keys.js') && !importer?.replaceAll('\\', '/').endsWith('/onrush/worker/bootstrap-keys.mjs')) {
        return resolve(here, 'worker/bootstrap-keys.mjs');
      }
      return null;
    },
    async generateBundle() {
      for (const name of ['countries.geojson', 'countries-50m.json', 'countries-110m.json']) {
        this.emitFile({ type: 'asset', fileName: `data/${name}`, source: await readFile(resolve(root, 'public/data', name)) });
      }
      this.emitFile({ type: 'asset', fileName: 'LICENSE', source: await readFile(resolve(root, 'LICENSE')) });
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n${Object.entries(ASSET_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n` });
    },
  }],
  build: { outDir: 'dist/site', emptyOutDir: true, target: 'es2022' },
  server: { host: '127.0.0.1', fs: { allow: [root] } },
});
