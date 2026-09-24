import { defineConfig } from 'vite';

const server = process.env.TUFF_SERVER ?? 'http://localhost:7777';

export default defineConfig({
  server: {
    port: 5173,
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
