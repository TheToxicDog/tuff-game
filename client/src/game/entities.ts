// Replicated entities from snapshots, with a short history per entity so remote players and
// zombies can be interpolated smoothly between server ticks (design plan §76).

import { EntityKind, lerpAngle, type NetEntity, type Snapshot } from '@tuff/shared';

interface Sample {
  tick: number;
  x: number;
  y: number;
  angle: number;
}

export class RemoteEntity {
  readonly id: number;
  readonly kind: EntityKind;
  /** Latest authoritative state. */
  readonly net: NetEntity;
  private readonly samples: Sample[] = [];
  /** Interpolated render state. */
  x: number;
  y: number;
  angle: number;
  /** Line-of-sight visibility, faded for rendering. */
  visible = false;
  alpha = 0;
  /** Seconds since spawn (for fade-ins and animation phase). */
  age = 0;
  /** Renderer-owned view object. */
  view: unknown = null;

  constructor(net: NetEntity, tick: number) {
    this.id = net.id;
    this.kind = net.kind;
    this.net = { ...net };
    this.x = net.x;
    this.y = net.y;
    this.angle = net.angle;
    this.samples.push({ tick, x: net.x, y: net.y, angle: net.angle });
  }

  push(tick: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.tick >= tick) {
      last.x = this.net.x;
      last.y = this.net.y;
      last.angle = this.net.angle;
      return;
    }
    this.samples.push({ tick, x: this.net.x, y: this.net.y, angle: this.net.angle });
    if (this.samples.length > 30) this.samples.shift();
  }

  interpolate(renderTick: number): void {
    const s = this.samples;
    if (s.length === 0) return;
    if (renderTick <= s[0].tick) {
      this.x = s[0].x;
      this.y = s[0].y;
      this.angle = s[0].angle;
      return;
    }
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (renderTick >= a.tick && renderTick <= b.tick) {
        const t = (renderTick - a.tick) / Math.max(1e-6, b.tick - a.tick);
        // Teleports (respawn, large corrections) snap instead of sliding across the map.
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 8) {
          this.x = b.x;
          this.y = b.y;
        } else {
          this.x = a.x + (b.x - a.x) * t;
          this.y = a.y + (b.y - a.y) * t;
        }
        this.angle = lerpAngle(a.angle, b.angle, t);
        return;
      }
    }
    // Past the newest sample: hold (with a tiny extrapolation to hide late packets).
    const last = s[s.length - 1];
    const prev = s.length > 1 ? s[s.length - 2] : last;
    const over = Math.min(2, renderTick - last.tick);
    const span = Math.max(1, last.tick - prev.tick);
    this.x = last.x + ((last.x - prev.x) / span) * over * 0.5;
    this.y = last.y + ((last.y - prev.y) / span) * over * 0.5;
    this.angle = last.angle;
  }
}

export interface EntityListener {
  spawned(e: RemoteEntity): void;
  despawned(e: RemoteEntity): void;
}

export class EntityStore {
  readonly all = new Map<number, RemoteEntity>();
  private readonly listeners: EntityListener[] = [];

  listen(l: EntityListener): void {
    this.listeners.push(l);
  }

  apply(snap: Snapshot): void {
    for (const net of snap.spawns) {
      const existing = this.all.get(net.id);
      if (existing) {
        Object.assign(existing.net, net);
        continue;
      }
      const e = new RemoteEntity(net, snap.tick);
      this.all.set(net.id, e);
      for (const l of this.listeners) l.spawned(e);
    }
    for (const u of snap.updates) {
      const e = this.all.get(u.id);
      if (!e) continue;
      const { bits: _bits, ...fields } = u;
      Object.assign(e.net, fields);
    }
    for (const e of this.all.values()) e.push(snap.tick);
    for (const id of snap.despawns) this.remove(id);
  }

  remove(id: number): void {
    const e = this.all.get(id);
    if (!e) return;
    this.all.delete(id);
    for (const l of this.listeners) l.despawned(e);
  }

  clear(): void {
    for (const id of [...this.all.keys()]) this.remove(id);
  }

  interpolate(renderTick: number, dt: number, skip: number): void {
    for (const e of this.all.values()) {
      e.age += dt;
      if (e.id === skip) continue;
      if (e.kind === EntityKind.Corpse || e.kind === EntityKind.Item) {
        e.x = e.net.x;
        e.y = e.net.y;
        e.angle = e.net.angle;
      } else {
        e.interpolate(renderTick);
      }
    }
  }
}
