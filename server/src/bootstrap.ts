// Wires storage, content, map, authentication, the game and the HTTP server together. Used by
// main.ts and by the integration tests (with in-memory storage and a random port).

import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { MapData } from '@tuff/shared';
import { generatePrototypeTown } from '@tuff/shared';
import { AuthService } from './authentication/auth-service';
import { loadContent, type LoadedContent } from './content/loader';
import { Game } from './game/game';
import { createGameHttpServer } from './networking/http';
import type { Storage } from './persistence/storage';

export interface ServerOptions {
  port: number;
  host?: string;
  storage: Storage;
  content?: LoadedContent;
  /** Use this map instead of loading data/maps/<config.map>.json. */
  map?: MapData;
  staticDir?: string | null;
  trustProxy?: boolean;
  allowedOrigins?: string[];
  adminUsernames?: string[];
  autosaveSeconds?: number;
  quiet?: boolean;
  /** Login/registration rate limits (default on). Only in-process load tests turn them off. */
  rateLimit?: boolean;
}

export function loadMap(content: LoadedContent): MapData {
  const file = join(content.dataDir, 'maps', `${content.config.map}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as MapData;
  if (content.config.map === 'prototype') {
    console.warn(`[server] ${file} not found; generating the prototype map in memory.`);
    return generatePrototypeTown();
  }
  throw new Error(`Map "${content.config.map}" not found at ${file}`);
}

export interface RunningServer {
  game: Game;
  auth: AuthService;
  port: number;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const content = options.content ?? loadContent();
  const map = options.map ?? loadMap(content);
  await options.storage.init();
  const auth = new AuthService(options.storage, new Set((options.adminUsernames ?? []).map((u) => u.toLowerCase())), {
    rateLimit: options.rateLimit,
  });
  const game = new Game(content, map, options.storage, {
    autosaveSeconds: options.autosaveSeconds,
    log: options.quiet ? () => undefined : undefined,
  });
  game.authenticate = (token) => auth.authenticate(token);
  await game.init();
  const { server, wss } = createGameHttpServer({
    auth,
    game,
    staticDir: options.staticDir ?? null,
    trustProxy: options.trustProxy ?? false,
    allowedOrigins: options.allowedOrigins ?? [],
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host ?? '0.0.0.0', resolve));
  game.start();
  const port = (server.address() as AddressInfo).port;
  const sessionSweep = setInterval(() => void options.storage.deleteExpiredSessions(Date.now()).catch(() => undefined), 60 * 60 * 1000);
  return {
    game,
    auth,
    port,
    async close() {
      clearInterval(sessionSweep);
      await game.stop();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await options.storage.close();
    },
  };
}
