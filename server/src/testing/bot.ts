// A headless game client used by integration tests and the load-test script. It speaks the real
// protocol: registers over HTTP, authenticates the WebSocket, decodes snapshots and sends inputs.

import WebSocket from 'ws';
import {
  BinaryReader,
  decodeSnapshot,
  encodeInputs,
  NO_SLOT,
  PROTOCOL_VERSION,
  ServerBinary,
  type NetEntity,
  type NetEvent,
  type PlayerInput,
  type PlayerSimState,
  type ServerMessage,
} from '@tuff/shared';

export class Bot {
  readonly entities = new Map<number, NetEntity>();
  readonly messages: ServerMessage[] = [];
  readonly events: NetEvent[] = [];
  readonly chunks = new Set<string>();
  self: PlayerSimState | null = null;
  entityId = 0;
  tick = 0;
  ackSeq = 0;
  snapshots = 0;
  bytesIn = 0;
  private seq = 0;
  private closed = false;

  private constructor(
    readonly ws: WebSocket,
    readonly username: string,
  ) {
    ws.on('message', (data, isBinary) => this.onMessage(data as Buffer, isBinary));
    ws.on('close', () => (this.closed = true));
  }

  static async register(baseUrl: string, username: string, password = 'password-123'): Promise<string> {
    const res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = (await res.json()) as { token?: string; message?: string };
    if (!res.ok || !body.token) throw new Error(`register failed: ${body.message}`);
    return body.token;
  }

  static async login(baseUrl: string, username: string, password = 'password-123'): Promise<string> {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = (await res.json()) as { token?: string; message?: string };
    if (!res.ok || !body.token) throw new Error(`login failed: ${body.message}`);
    return body.token;
  }

  static async connect(baseUrl: string, username: string, token: string): Promise<Bot> {
    const ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/ws');
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const bot = new Bot(ws, username);
    ws.send(JSON.stringify({ t: 'hello', token, protocol: PROTOCOL_VERSION }));
    await bot.waitFor(() => bot.entityId !== 0, 5000, 'welcome');
    return bot;
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    this.bytesIn += data.length;
    if (isBinary) {
      const r = new BinaryReader(data);
      if (r.u8() !== ServerBinary.Snapshot) return;
      const snap = decodeSnapshot(r);
      this.snapshots++;
      this.tick = snap.tick;
      this.ackSeq = snap.ackSeq;
      if (snap.self) this.self = snap.self;
      for (const e of snap.spawns) this.entities.set(e.id, e);
      for (const u of snap.updates) {
        const e = this.entities.get(u.id);
        if (e) Object.assign(e, u);
      }
      for (const id of snap.despawns) this.entities.delete(id);
      this.events.push(...snap.events);
      return;
    }
    const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
    this.messages.push(msg);
    if (msg.t === 'welcome') this.entityId = msg.entityId;
    else if (msg.t === 'spawned') this.entityId = msg.entityId;
    else if (msg.t === 'chunk') this.chunks.add(`${msg.chunk.cx},${msg.chunk.cy}`);
  }

  last<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].t === type) return this.messages[i] as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }

  send(message: object): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Sends inputs in real time: 3 fixed 60 Hz steps every 50 ms, for `seconds`. */
  async act(seconds: number, input: Partial<Omit<PlayerInput, 'seq' | 'viewTick'>>): Promise<void> {
    const batches = Math.round(seconds * 20);
    for (let b = 0; b < batches && !this.closed; b++) {
      const inputs: PlayerInput[] = [];
      for (let i = 0; i < 3; i++) {
        inputs.push({
          seq: ++this.seq,
          moveX: 0,
          moveY: 0,
          aim: 0,
          buttons: 0,
          slot: NO_SLOT,
          ...input,
          viewTick: Math.max(0, this.tick - 2),
        });
      }
      this.ws.send(encodeInputs(inputs));
      await sleep(50);
    }
  }

  async waitFor(predicate: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`${this.username}: timed out waiting for ${what}`);
      if (this.closed) throw new Error(`${this.username}: connection closed while waiting for ${what}`);
      await sleep(20);
    }
  }

  close(): void {
    this.ws.close();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
