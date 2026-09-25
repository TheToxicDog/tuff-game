// A headless IRONWILD client for integration tests and the load test. It speaks the real
// protocol: registers over HTTP, authenticates the WebSocket, tracks state and sends inputs.

import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type InputTuple,
  type InventoryMessage,
  type MeState,
  type ServerMessage,
  type StructSpawn,
  type UiState,
  type WelcomeMessage,
} from '@ironwild/shared';

export class Bot {
  readonly messages: ServerMessage[] = [];
  readonly entities = new Map<number, [number, number]>();
  readonly structures = new Map<number, StructSpawn>();
  readonly notices: string[] = [];
  welcome: WelcomeMessage | null = null;
  me: MeState | null = null;
  inv: InventoryMessage | null = null;
  status: Extract<ServerMessage, { t: 'status' }> | null = null;
  ui: UiState | null = null;
  snapshots = 0;
  bytesIn = 0;
  private seq = 0;

  private constructor(
    readonly ws: WebSocket,
    readonly username: string,
  ) {
    ws.on('message', (data) => this.onMessage(data as Buffer));
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

  static async connect(baseUrl: string, username: string, token: string): Promise<Bot> {
    const ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/ws');
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const bot = new Bot(ws, username);
    bot.send({ t: 'hello', token, protocol: PROTOCOL_VERSION });
    await bot.waitFor(() => bot.welcome !== null, 5000, 'welcome');
    return bot;
  }

  private onMessage(data: Buffer): void {
    this.bytesIn += data.length;
    const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
    switch (msg.t) {
      case 'welcome':
        this.welcome = msg;
        return;
      case 's':
        this.snapshots++;
        if (msg.me) this.me = msg.me;
        for (const [id, x, y] of msg.e) this.entities.set(id, [x / 100, y / 100]);
        for (const id of msg.d ?? []) this.entities.delete(id);
        return;
      case 'inv':
        this.inv = msg;
        break;
      case 'status':
        this.status = msg;
        break;
      case 'ui':
        this.ui = msg.ui;
        break;
      case 'uiclose':
        this.ui = null;
        break;
      case 'notice':
        this.notices.push(msg.text);
        break;
      case 'chunk':
        for (const s of msg.st) this.structures.set(s.id, s);
        break;
      case 'sa':
        for (const s of msg.s) this.structures.set(s.id, s);
        break;
      case 'sr':
        for (const id of msg.ids) this.structures.delete(id);
        break;
    }
    this.messages.push(msg);
    if (this.messages.length > 2000) this.messages.splice(0, 1000);
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Sends one movement/action input step. */
  input(flags: number, mx: number, my: number, angle: number): void {
    const tuple: InputTuple = [++this.seq, flags, mx, my, Math.round(angle * 1000)];
    this.send({ t: 'in', i: [tuple] });
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.inv?.slots ?? []) if (s?.id === id) n += s.n;
    return n;
  }

  async waitFor(cond: () => boolean, timeoutMs = 5000, what = 'condition'): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close(): void {
    this.ws.close();
  }
}
