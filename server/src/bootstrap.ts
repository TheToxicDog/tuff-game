// Wires storage, content, map, authentication, the game and the HTTP server together. Used by
// main.ts and by the integration tests (with in-memory storage and a random port).

import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { generatePrototypeTown, MAP_RELOAD_CODE, type MapData } from '@tuff/shared';
import { AuthService } from './authentication/auth-service';
import { loadContent, type LoadedContent } from './content/loader';
import { Game } from './game/game';
import { createGameHttpServer, type GameHost } from './networking/http';
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
  /** The live game (replaced when a map is republished from the editor). */
  readonly game: Game;
  auth: AuthService;
  port: number;
  /** Rebuilds the world from a new version of the map; everyone reconnects into it. */
  publishMap(map: MapData): Promise<void>;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const content = options.content ?? loadContent();
  const map = options.map ?? loadMap(content);
  await options.storage.init();
  const auth = new AuthService(options.storage, new Set((options.adminUsernames ?? []).map((u) => u.toLowerCase())), {
    rateLimit: options.rateLimit,
  });
  const createGame = async (m: MapData): Promise<Game> => {
    const g = new Game(content, m, options.storage, {
      autosaveSeconds: options.autosaveSeconds,
      log: options.quiet ? () => undefined : undefined,
    });
    g.authenticate = (token) => auth.authenticate(token);
    await g.init();
    return g;
  };
  let publishing: Promise<void> | null = null;
  const host: GameHost = {
    game: await createGame(map),
    publishMap: async (next: MapData) => {
      // One republish at a time; the world is saved, rebuilt from the new map and players reconnect.
      while (publishing) await publishing;
      publishing = (async () => {
        const old = host.game;
        const previousId = content.config.map;
        await old.stop('The map was updated. Reconnecting…', MAP_RELOAD_CODE);
        content.config.map = next.id;
        try {
          host.game = await createGame(next);
        } catch (err) {
          // Never leave the server without a world: bring the previous map back and report.
          content.config.map = previousId;
          host.game = await createGame(old.map);
          host.game.start();
          throw err;
        }
        host.game.start();
        if (!options.quiet) console.log(`[server] republished map "${next.name}" (${next.id})`);
      })();
      try {
        await publishing;
      } finally {
        publishing = null;
      }
    },
  };
  const { server, wss } = createGameHttpServer({
    auth,
    host,
    content,
    staticDir: options.staticDir ?? null,
    trustProxy: options.trustProxy ?? false,
    allowedOrigins: options.allowedOrigins ?? [],
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host ?? '0.0.0.0', resolve));
  host.game.start();
  const port = (server.address() as AddressInfo).port;
  const sessionSweep = setInterval(() => void options.storage.deleteExpiredSessions(Date.now()).catch(() => undefined), 60 * 60 * 1000);
  return {
    get game() {
      return host.game;
    },
    auth,
    port,
    publishMap: (m) => host.publishMap(m),
    async close() {
      clearInterval(sessionSweep);
      while (publishing) await publishing;
      await host.game.stop();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await options.storage.close();
    },
  };
}
