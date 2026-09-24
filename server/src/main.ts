// Server entry point. Configuration comes from environment variables:
//
//   PORT              HTTP/WebSocket port (default 7777)
//   HOST              bind address (default 0.0.0.0)
//   DATABASE_URL      PostgreSQL connection string; without it saves go to TUFF_SAVE_DIR (./.data)
//   TUFF_CLIENT_DIR   built client to serve (default client/dist next to the repo)
//   TUFF_TRUST_PROXY  "1" to honour X-Forwarded-For behind a reverse proxy
//   TUFF_ORIGINS      comma-separated allowed WebSocket origins (default: any)
//   TUFF_ADMINS       comma-separated usernames that get admin rights
//   TUFF_PVP, TUFF_MAX_PLAYERS, TUFF_SERVER_NAME, TUFF_DAY_SECONDS  override data/config/server.json

import { dirname, join, resolve } from 'node:path';
import { startServer } from './bootstrap';
import { findDataDir } from './content/loader';
import { createStorage } from './persistence';

const env = process.env;
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function main(): Promise<void> {
  const storage = createStorage(env);
  const repoRoot = dirname(findDataDir());
  const staticDir = env.TUFF_CLIENT_DIR ? resolve(env.TUFF_CLIENT_DIR) : join(repoRoot, 'client', 'dist');
  const server = await startServer({
    port: Number(env.PORT ?? 7777),
    host: env.HOST,
    storage,
    staticDir,
    trustProxy: env.TUFF_TRUST_PROXY === '1',
    allowedOrigins: list(env.TUFF_ORIGINS),
    adminUsernames: list(env.TUFF_ADMINS),
  });
  const s = server.game.summary();
  console.log(
    `[server] "${server.game.config.name}" listening on :${server.port} — storage: ${storage.kind}, ` +
      `map: ${server.game.map.name}, day ${s.day} ${s.time}, ${s.dormant} dormant zombies`,
  );
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} received, saving and shutting down…`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
