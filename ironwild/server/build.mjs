// Bundles the IRONWILD server (and the shared package it imports as TypeScript source) into one
// ES module: `node ironwild/server/dist/main.js`. `ws` stays external.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

await build({
  entryPoints: [`${here}src/main.ts`],
  outfile: `${here}dist/main.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['ws', 'bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
