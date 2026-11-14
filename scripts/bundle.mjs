/** Bundles the Worker (API + static asset routing) into dist/worker.js. */
import { build } from 'esbuild';
await build({
  entryPoints: ['src/worker.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  outfile: 'dist/worker.js',
  external: ['node:*', 'cloudflare:sockets'],
  logLevel: 'info',
});
