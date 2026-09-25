// The game WebSocket (JSON frames). Messages that arrive before the game is ready are queued.

import { PROTOCOL_VERSION, type ClientMessage, type InputTuple, type ServerMessage, type WelcomeMessage } from '@ironwild/shared';

export interface ConnectionHandlers {
  message(msg: ServerMessage, receivedAt: number): void;
  closed(reason: string, code: number): void;
}

export class Connection {
  private ws: WebSocket | null = null;
  private handlers: ConnectionHandlers | null = null;
  private queue: { msg: ServerMessage; at: number }[] = [];
  private pingTimer = 0;
  private pingId = 0;
  private readonly pingSent = new Map<number, number>();
  /** Smoothed round-trip time in milliseconds. */
  rtt = 100;
  bytesIn = 0;
  private closeReason = '';

  connect(token: string): Promise<WelcomeMessage> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token, protocol: PROTOCOL_VERSION } satisfies ClientMessage));
      ws.onmessage = (ev) => {
        const at = performance.now();
        const data = ev.data as string;
        this.bytesIn += data.length;
        const msg = JSON.parse(data) as ServerMessage;
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
            this.rtt = this.rtt * 0.8 + (at - sent) * 0.2;
          }
          return;
        }
        if (!this.handlers) this.queue.push({ msg, at });
        else this.handlers.message(msg, at);
      };
      ws.onclose = (ev) => {
        clearInterval(this.pingTimer);
        const reason = this.closeReason || ev.reason || (welcomed ? 'Connection lost.' : 'Could not connect to the server.');
        if (!welcomed) reject(new Error(reason));
        this.handlers?.closed(reason, ev.code);
      };
    });
  }

  attach(handlers: ConnectionHandlers): void {
    this.handlers = handlers;
    const queued = this.queue;
    this.queue = [];
    for (const q of queued) handlers.message(q.msg, q.at);
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

  sendInputs(inputs: InputTuple[]): void {
    if (inputs.length > 0) this.send({ t: 'in', i: inputs });
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
