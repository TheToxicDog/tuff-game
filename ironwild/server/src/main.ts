// IRONWILD server entry point. Configuration comes from environment variables:
//
//   PORT                      HTTP/WebSocket port (default 7780)
//   HOST                      bind address (default 0.0.0.0)
//   IRONWILD_SAVE_DIR         directory for JSON saves (default ./.data/ironwild)
//   IRONWILD_STORAGE=memory   keep nothing on disk
//   IRONWILD_CLIENT_DIR       built client to serve (default ironwild/client/dist)
//   IRONWILD_TRUST_PROXY      "1" to honour X-Forwarded-For behind a reverse proxy
//   IRONWILD_ORIGINS          comma-separated allowed WebSocket origins (default: any)
//   IRONWILD_ADMINS           comma-separated usernames with admin commands
//   IRONWILD_NAME, IRONWILD_MOTD, IRONWILD_PVP, IRONWILD_MAX_PLAYERS, IRONWILD_DAY_SECONDS, IRONWILD_SEED

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './bootstrap';
import type { GameConfig } from './game/game';
import { createStorage } from './persistence';

const env = process.env;
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** ironwild/client/dist, whether running from source (src/) or the bundle (dist/). */
function defaultClientDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'client', 'dist');
    if (existsSync(join(dir, 'client'))) return candidate;
    dir = dirname(dir);
  }
  return resolve('ironwild/client/dist');
}

async function main(): Promise<void> {
  const config: Partial<GameConfig> = {};
  if (env.IRONWILD_NAME) config.name = env.IRONWILD_NAME;
  if (env.IRONWILD_MOTD) config.motd = env.IRONWILD_MOTD;
  if (env.IRONWILD_PVP) config.pvp = env.IRONWILD_PVP === '1' || env.IRONWILD_PVP === 'true';
  if (env.IRONWILD_MAX_PLAYERS) config.maxPlayers = Number(env.IRONWILD_MAX_PLAYERS);
  if (env.IRONWILD_DAY_SECONDS) config.daySeconds = Number(env.IRONWILD_DAY_SECONDS);
  if (env.IRONWILD_SEED) config.seed = Number(env.IRONWILD_SEED);
  const storage = createStorage(env);
  const server = await startServer({
    port: Number(env.PORT ?? 7780),
    host: env.HOST,
    storage,
    config,
    staticDir: env.IRONWILD_CLIENT_DIR ? resolve(env.IRONWILD_CLIENT_DIR) : defaultClientDir(),
    trustProxy: env.IRONWILD_TRUST_PROXY === '1',
    allowedOrigins: list(env.IRONWILD_ORIGINS),
    adminUsernames: list(env.IRONWILD_ADMINS),
  });
  const s = server.game.summary();
  console.log(`[ironwild] "${server.game.config.name}" listening on :${server.port} — storage: ${storage.kind}, day ${s.day} ${s.time}`);
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[ironwild] ${signal} received, saving and shutting down…`);
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
  console.error('[ironwild] failed to start', err);
  process.exit(1);
});
