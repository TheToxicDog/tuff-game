import { defineConfig } from 'vite';

const server = process.env.IRONWILD_SERVER ?? 'http://localhost:7780';

export default defineConfig({
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': server,
      '/healthz': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
  },
});
