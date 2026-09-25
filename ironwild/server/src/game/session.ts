// One connected browser: wraps the WebSocket, enforces message size and rate limits and keeps
// track of what has been replicated to this client.

import WebSocket from 'ws';
import type { ClientMessage } from '@ironwild/shared';
import type { AccountRecord } from '../persistence/storage';
import type { Game } from './game';
import type { Player } from './player';

const MAX_MESSAGE_BYTES = 16 * 1024;
const MESSAGES_PER_SECOND = 90;

export class ClientSession {
  account: AccountRecord | null = null;
  player: Player | null = null;
  /** Chunks this client has loaded. */
  readonly chunks = new Set<number>();
  /** Entities this client knows about. */
  readonly known = new Set<number>();
  closed = false;
  private windowStart = Date.now();
  private count = 0;
  private readonly helloTimer: NodeJS.Timeout;
  private authenticating = false;

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
    private readonly game: Game,
  ) {
    ws.on('message', (data, isBinary) => this.onMessage(data as Buffer, isBinary));
    ws.on('close', () => this.onClose());
    ws.on('error', () => this.onClose());
    this.helloTimer = setTimeout(() => {
      if (!this.account) this.close('Login timed out.');
    }, 10_000);
  }

  get connected(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  send(message: object): void {
    if (this.connected) this.ws.send(JSON.stringify(message));
  }

  sendRaw(json: string): void {
    if (this.connected) this.ws.send(json);
  }

  /** Bytes queued but not yet sent: slow clients skip snapshots. */
  get backlog(): number {
    return this.ws.bufferedAmount;
  }

  close(reason: string, code = 4000): void {
    if (this.closed) return;
    this.send({ t: 'error', code: 'closed', message: reason });
    this.ws.close(code, reason.slice(0, 120));
    this.onClose();
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    if (++this.count > MESSAGES_PER_SECOND) {
      if (this.count > MESSAGES_PER_SECOND * 3) this.close('Too many messages.');
      return;
    }
    if (isBinary || data.length > MAX_MESSAGE_BYTES) {
      this.close('Message too large.');
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      this.close('Malformed message.');
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string') return;
    const m = msg as ClientMessage;
    if (!this.account) {
      if (m.t !== 'hello' || this.authenticating) return;
      this.authenticating = true;
      clearTimeout(this.helloTimer);
      this.game.hello(this, m).catch((err) => {
        console.error('[ironwild] hello failed', err);
        this.close('Server error during login.');
      });
      return;
    }
    try {
      this.game.handleMessage(this, m);
    } catch (err) {
      console.error('[ironwild] message handler error', err);
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.helloTimer);
    this.game.disconnect(this);
  }
}
