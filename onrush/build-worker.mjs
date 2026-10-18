import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'onrush/dist'), { recursive: true });
export const workerBuildOptions = {
  absWorkingDir: root,
  entryPoints: ['onrush/worker/index.mjs'],
  outfile: 'onrush/dist/worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['node:*'],
  plugins: [{ name: 'onrush-adapters', setup(builder) {
    builder.onResolve({ filter: /(?:_cors\.js|\/cors(?:\.ts)?|_bootstrap-tier-keys\.js|@vercel\/functions)$/ }, (args) => {
      const name = args.path === '@vercel/functions' ? 'execution.mjs'
        : args.path.includes('bootstrap-tier-keys') ? 'bootstrap-keys.mjs' : 'cors.mjs';
      return { path: resolve(root, 'onrush/worker', name) };
    });
  } }],
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build(workerBuildOptions);
}
