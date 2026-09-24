// One connected browser. Wraps the WebSocket, enforces message size and rate limits, parses
// binary input batches and JSON messages, and remembers what has been replicated to this client.

import WebSocket from 'ws';
import { BinaryReader, BinaryReadError, ClientBinary, decodeInputs, type NetEntity } from '@tuff/shared';
import type { AccountRecord, CharacterData } from '../persistence/storage';
import type { PlayerLink } from './components';
import type { Game } from './game';

const MAX_JSON_BYTES = 8 * 1024;
const JSON_PER_SECOND = 40;
const BINARY_PER_SECOND = 120;

export class ClientSession implements PlayerLink {
  entity = 0;
  account: AccountRecord | null = null;
  /** Character data kept while dead, until respawn. */
  deadCharacter: CharacterData | null = null;
  respawnAt = 0;
  readonly known = new Map<number, NetEntity>();
  readonly loadedChunks = new Set<string>();
  viewX = 0;
  viewY = 0;
  closed = false;
  private windowStart = Date.now();
  private jsonCount = 0;
  private binaryCount = 0;
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

  sendBinary(bytes: Uint8Array): void {
    if (this.connected) this.ws.send(bytes, { binary: true });
  }

  /** Bytes queued in the socket but not yet sent (used to skip snapshots for slow clients). */
  get backlog(): number {
    return this.ws.bufferedAmount;
  }

  close(reason: string, code = 4000): void {
    if (this.closed) return;
    this.send({ t: 'error', code: 'closed', message: reason });
    this.ws.close(code, reason.slice(0, 120));
    this.onClose();
  }

  private rateOk(binary: boolean): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.jsonCount = 0;
      this.binaryCount = 0;
    }
    if (binary) return ++this.binaryCount <= BINARY_PER_SECOND;
    return ++this.jsonCount <= JSON_PER_SECOND;
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (this.closed) return;
    if (!this.rateOk(isBinary)) {
      // Drop excess traffic; persistent flooding gets the connection closed.
      if (this.jsonCount > JSON_PER_SECOND * 3 || this.binaryCount > BINARY_PER_SECOND * 3) this.close('Too many messages.');
      return;
    }
    if (isBinary) {
      if (!this.account || !this.entity) return;
      try {
        const r = new BinaryReader(data);
        const type = r.u8();
        if (type === ClientBinary.Input) this.game.receiveInputs(this, decodeInputs(r));
      } catch (err) {
        if (err instanceof BinaryReadError) this.close('Malformed input.');
        else throw err;
      }
      return;
    }
    if (data.length > MAX_JSON_BYTES) {
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
    const m = msg as { t: string };
    if (!this.account) {
      if (m.t !== 'hello' || this.authenticating) return;
      this.authenticating = true;
      clearTimeout(this.helloTimer);
      this.game.hello(this, m).catch((err) => {
        console.error('[game] hello failed', err);
        this.close('Server error during login.');
      });
      return;
    }
    try {
      this.game.handleMessage(this, m);
    } catch (err) {
      console.error('[game] message handler error', err);
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.helloTimer);
    this.game.disconnect(this);
  }
}
