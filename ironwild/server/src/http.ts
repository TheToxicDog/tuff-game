// HTTP: the auth API, a status endpoint and static hosting of the built client. The WebSocket
// game connection is upgraded from the same server on /ws.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { AuthError, type AuthService } from './auth/auth-service';
import type { Game } from './game/game';
import { ClientSession } from './game/session';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface HttpOptions {
  auth: AuthService;
  game: Game;
  /** Directory of the built client (client/dist); static hosting is skipped if missing. */
  staticDir: string | null;
  /** Trust X-Forwarded-For (behind a reverse proxy). */
  trustProxy: boolean;
  /** Allowed WebSocket origins; empty allows any. */
  allowedOrigins: string[];
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

async function readJson(req: IncomingMessage, limit = 4096): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AuthError('invalid_username', 'Request too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolvePromise(typeof parsed === 'object' && parsed ? parsed : {});
      } catch {
        reject(new AuthError('invalid_username', 'Invalid JSON.', 400));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export function createGameHttpServer(options: HttpOptions): { server: Server; wss: WebSocketServer } {
  const { auth, game } = options;
  const staticRoot = options.staticDir && existsSync(options.staticDir) ? resolve(options.staticDir) : null;

  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = clientIp(req, options.trustProxy);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST' && url.pathname === '/api/register') {
          const body = await readJson(req);
          sendJson(res, 200, await auth.register(body.username, body.password, ip));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/login') {
          const body = await readJson(req);
          sendJson(res, 200, await auth.login(body.username, body.password, ip));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/logout') {
          await auth.logout(bearer(req));
          sendJson(res, 200, { ok: true });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/session') {
          const account = await auth.authenticate(bearer(req));
          if (!account) sendJson(res, 401, { error: 'invalid_session', message: 'Not logged in.' });
          else
            sendJson(res, 200, {
              account: { id: account.id, username: account.username, displayName: account.displayName, isAdmin: account.isAdmin },
            });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/status') {
          const s = game.summary();
          sendJson(res, 200, {
            name: game.config.name,
            motd: game.config.motd,
            pvp: game.config.pvp,
            maxPlayers: game.config.maxPlayers,
            players: s.players,
            day: s.day,
            time: s.time,
            online: [...game.players.values()].map((p) => p.name),
          });
          return;
        }
        sendJson(res, 404, { error: 'not_found', message: 'Unknown endpoint.' });
        return;
      }
      if (url.pathname === '/healthz') {
        sendJson(res, 200, { ok: true, ...game.summary() });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (!staticRoot) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('IRONWILD server is running. Build the client (npm run ironwild:build) or use the Vite dev server (npm run ironwild:dev).');
        return;
      }
      serveStatic(staticRoot, url.pathname, res);
    } catch (err) {
      if (err instanceof AuthError) {
        sendJson(res, err.status, { error: err.code, message: err.message });
        return;
      }
      console.error('[http] request failed', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error', message: 'Something went wrong.' });
    }
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 3 } },
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (options.allowedOrigins.length > 0 && origin && !options.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const session = new ClientSession(ws, clientIp(req, options.trustProxy), game);
      game.attachSession(session);
    });
  });
  return { server, wss };
}

function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  let file = target;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Single-page app: unknown paths (e.g. /editor) get index.html.
    file = join(root, 'index.html');
  }
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const ext = extname(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
