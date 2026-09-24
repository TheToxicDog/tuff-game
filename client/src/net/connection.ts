// The game WebSocket: JSON text frames for structured messages, binary frames for inputs and
// snapshots. Messages that arrive before the game is ready are queued.

import {
  BinaryReader,
  decodeSnapshot,
  encodeInputs,
  PROTOCOL_VERSION,
  ServerBinary,
  type ClientMessage,
  type PlayerInput,
  type ServerMessage,
  type Snapshot,
} from '@tuff/shared';

export type WelcomeMessage = Extract<ServerMessage, { t: 'welcome' }>;

export interface ConnectionHandlers {
  message(msg: ServerMessage): void;
  snapshot(snap: Snapshot, receivedAt: number): void;
  closed(reason: string, code: number): void;
}

export class Connection {
  private ws: WebSocket | null = null;
  private handlers: ConnectionHandlers | null = null;
  private queue: ({ kind: 'json'; msg: ServerMessage } | { kind: 'snap'; snap: Snapshot; at: number })[] = [];
  private pingTimer = 0;
  private pingId = 0;
  private pingSent = new Map<number, number>();
  /** Smoothed round-trip time in milliseconds. */
  rtt = 100;
  bytesIn = 0;
  lastMessageAt = performance.now();
  private closeReason = '';

  connect(token: string): Promise<WelcomeMessage> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token, protocol: PROTOCOL_VERSION } satisfies ClientMessage));
      ws.onmessage = (ev) => {
        this.lastMessageAt = performance.now();
        if (typeof ev.data === 'string') {
          this.bytesIn += ev.data.length;
          const msg = JSON.parse(ev.data) as ServerMessage;
          if (msg.t === 'welcome' && !welcomed) {
            welcomed = true;
            this.startPing();
            resolve(msg);
            return;
          }
          if (msg.t === 'error') this.closeReason = msg.message;
          if (msg.t === 'pong') {
            const sent = this.pingSent.get(msg.id);
            if (sent !== undefined) {
              this.pingSent.delete(msg.id);
              const sample = performance.now() - sent;
              this.rtt = this.rtt * 0.8 + sample * 0.2;
            }
            return;
          }
          this.dispatch({ kind: 'json', msg });
        } else {
          const buf = ev.data as ArrayBuffer;
          this.bytesIn += buf.byteLength;
          const r = new BinaryReader(buf);
          if (r.u8() !== ServerBinary.Snapshot) return;
          this.dispatch({ kind: 'snap', snap: decodeSnapshot(r), at: performance.now() });
        }
      };
      ws.onclose = (ev) => {
        clearInterval(this.pingTimer);
        const reason = this.closeReason || ev.reason || (welcomed ? 'Connection lost.' : 'Could not connect to the server.');
        if (!welcomed) reject(new Error(reason));
        this.handlers?.closed(reason, ev.code);
      };
      ws.onerror = () => {
        // onclose follows with the details.
      };
    });
  }

  /** Starts delivering messages (including any queued ones) to the game. */
  attach(handlers: ConnectionHandlers): void {
    this.handlers = handlers;
    const queued = this.queue;
    this.queue = [];
    for (const q of queued) this.deliver(q);
  }

  private dispatch(item: { kind: 'json'; msg: ServerMessage } | { kind: 'snap'; snap: Snapshot; at: number }): void {
    if (!this.handlers) this.queue.push(item);
    else this.deliver(item);
  }

  private deliver(item: { kind: 'json'; msg: ServerMessage } | { kind: 'snap'; snap: Snapshot; at: number }): void {
    if (item.kind === 'json') this.handlers!.message(item.msg);
    else this.handlers!.snapshot(item.snap, item.at);
  }

  private startPing(): void {
    const ping = () => {
      const id = ++this.pingId;
      this.pingSent.set(id, performance.now());
      this.send({ t: 'ping', id });
    };
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  sendInputs(inputs: PlayerInput[]): void {
    if (this.open && inputs.length > 0) this.ws!.send(encodeInputs(inputs) as Uint8Array<ArrayBuffer>);
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
