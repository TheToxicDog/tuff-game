// Remote entities (other players, creatures, drops, bags, arrows, carts) rendered a little in the
// past and interpolated between snapshots, plus the estimate of the server's tick clock that the
// interpolation and conveyor keyframes use.

import { TICK_RATE, angleDiff, type EntityKind, type EntitySpawn, type Snapshot } from '@ironwild/shared';

export interface Sample {
  k: number;
  x: number;
  y: number;
  a: number;
  hp: number;
  flags: number;
}

export interface EntityView {
  id: number;
  kind: EntityKind;
  type?: string;
  name?: string;
  held?: string;
  look?: number;
  n?: number;
  owner?: string;
  tag?: string;
  /** Rank title under a player's name. */
  title?: string;
  samples: Sample[];
  x: number;
  y: number;
  a: number;
  hp: number;
  flags: number;
  /** Swing animation start (performance.now), heavy swing. */
  swingAt: number;
  heavy: boolean;
  hurtAt: number;
  attackAt: number;
  /** Set when the view needs rebuilding (held item or name changed). */
  dirty: boolean;
}

/** Ticks of interpolation delay. */
const INTERP_TICKS = 2.3;

export class ServerClock {
  tick = 0;
  private started = false;

  onSnapshot(k: number, receivedAt: number): void {
    const target = k + ((performance.now() - receivedAt) / 1000) * TICK_RATE;
    if (!this.started || Math.abs(target - this.tick) > 6) {
      this.tick = target;
      this.started = true;
      return;
    }
    this.tick += (target - this.tick) * 0.08;
  }

  advance(dt: number): void {
    this.tick += dt * TICK_RATE;
  }

  get renderTick(): number {
    return this.tick - INTERP_TICKS;
  }
}

export class EntityStore {
  readonly map = new Map<number, EntityView>();
  onSpawn: (e: EntityView) => void = () => undefined;
  onDespawn: (e: EntityView) => void = () => undefined;

  applySnapshot(snap: Snapshot): void {
    for (const sp of snap.sp ?? []) this.spawn(sp, snap.k);
    const updated = new Set<number>();
    for (const [id, x, y, a, hp, flags] of snap.e) {
      const e = this.map.get(id);
      if (!e) continue;
      updated.add(id);
      e.samples.push({ k: snap.k, x: x / 100, y: y / 100, a: a / 100, hp, flags });
      if (e.samples.length > 12) e.samples.shift();
    }
    // Unchanged entities were left out: they hold still at this tick.
    for (const e of this.map.values()) {
      if (updated.has(e.id)) continue;
      const lastSample = e.samples[e.samples.length - 1];
      if (!lastSample || lastSample.k >= snap.k) continue;
      e.samples.push({ ...lastSample, k: snap.k });
      if (e.samples.length > 12) e.samples.shift();
    }
    for (const id of snap.d ?? []) {
      const e = this.map.get(id);
      if (!e) continue;
      this.map.delete(id);
      this.onDespawn(e);
    }
  }

  private spawn(sp: EntitySpawn, k: number): void {
    const existing = this.map.get(sp.id);
    if (existing) {
      existing.held = sp.held;
      existing.name = sp.name;
      existing.n = sp.n;
      existing.tag = sp.tag;
      existing.title = sp.title;
      existing.owner = sp.owner;
      existing.dirty = true;
      return;
    }
    const e: EntityView = {
      id: sp.id,
      kind: sp.k,
      type: sp.type,
      name: sp.name,
      held: sp.held,
      look: sp.look,
      n: sp.n,
      owner: sp.owner,
      tag: sp.tag,
      title: sp.title,
      samples: [{ k, x: sp.x, y: sp.y, a: sp.a ?? 0, hp: 100, flags: 0 }],
      x: sp.x,
      y: sp.y,
      a: sp.a ?? 0,
      hp: 100,
      flags: 0,
      swingAt: 0,
      heavy: false,
      hurtAt: 0,
      attackAt: 0,
      dirty: false,
    };
    this.map.set(e.id, e);
    this.onSpawn(e);
  }

  /** Positions every entity at the render tick. */
  sample(renderTick: number): void {
    for (const e of this.map.values()) {
      const s = e.samples;
      if (s.length === 0) continue;
      let a = s[0];
      let b = s[0];
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i].k <= renderTick) {
          a = s[i];
          b = s[Math.min(i + 1, s.length - 1)];
          break;
        }
      }
      if (renderTick < s[0].k) {
        a = b = s[0];
      }
      let t = b.k > a.k ? (renderTick - a.k) / (b.k - a.k) : 0;
      t = Math.max(0, Math.min(1, t));
      e.x = a.x + (b.x - a.x) * t;
      e.y = a.y + (b.y - a.y) * t;
      e.a = a.a + angleDiff(b.a, a.a) * t;
      e.hp = b.hp;
      e.flags = b.flags;
    }
  }
}
