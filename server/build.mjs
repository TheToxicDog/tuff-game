// Bundles the server (and the shared package it imports as TypeScript source) into a single ES
// module for production: `node server/dist/main.js`. Runtime dependencies with native or dynamic
// requires (ws, pg) stay external and are loaded from node_modules.

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
  external: ['ws', 'pg', 'bufferutil', 'utf-8-validate', 'pg-native'],
  // Some bundled CommonJS helpers call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
