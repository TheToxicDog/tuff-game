// Wires storage, authentication, the game and the HTTP server together. Used by main.ts and by the
// integration tests (in-memory storage, random port).

import type { AddressInfo } from 'node:net';
import { AuthService } from './auth/auth-service';
import { Game, type GameConfig } from './game/game';
import { createGameHttpServer } from './http';
import type { Storage } from './persistence/storage';

export interface ServerOptions {
  port: number;
  host?: string;
  storage: Storage;
  config?: Partial<GameConfig>;
  staticDir?: string | null;
  trustProxy?: boolean;
  allowedOrigins?: string[];
  adminUsernames?: string[];
  quiet?: boolean;
  /** Login/registration rate limits (default on). Only in-process load tests turn them off. */
  rateLimit?: boolean;
  /** Don't start the tick loop (tests step the game by hand). */
  manualTicks?: boolean;
}

export interface RunningServer {
  game: Game;
  auth: AuthService;
  port: number;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  await options.storage.init();
  const admins = options.adminUsernames ?? [];
  const auth = new AuthService(options.storage, new Set(admins.map((u) => u.toLowerCase())), { rateLimit: options.rateLimit });
  const game = new Game(options.storage, options.config, admins);
  if (options.quiet) game.log = () => undefined;
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
  if (!options.manualTicks) game.start();
  const port = (server.address() as AddressInfo).port;
  const sweep = setInterval(() => void options.storage.deleteExpiredSessions(Date.now()).catch(() => undefined), 60 * 60 * 1000);
  return {
    game,
    auth,
    port,
    async close() {
      clearInterval(sweep);
      await game.stop();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await options.storage.close();
    },
  };
}
