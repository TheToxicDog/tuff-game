// Railways (§36): minecarts follow the rails on their own, stop at stations to load from or
// unload into whatever stands beside the platform, and turn back at the end of the line. E on a
// junction flips its switch; E on a station changes its mode; G on a minecart reverses it.

import {
  CART_SPEED,
  DX,
  DY,
  ITEM_BY_ID,
  STATION_IDLE,
  STATION_MODES,
  addStack,
  beltPosition,
  opposite,
  railExit,
  railLength,
  railLinks,
  roomFor,
  type StationMode,
} from '@ironwild/shared';
import type { Cart } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

export interface RailState {
  tx: number;
  ty: number;
  entry: number;
  exit: number;
  /** Progress across the tile, 0 → 1. */
  p: number;
  /** Stopped at this tile's station already (so it doesn't stop twice). */
  stopped: boolean;
  /** Stopped at a station now: seconds since anything moved. */
  dwell: number;
  atStation: boolean;
  /** Seconds spent waiting behind another cart. */
  blocked: number;
  transferT: number;
}

const TRANSFER_EVERY = 0.25;
const PER_TRANSFER = 8;
const pos = { x: 0, y: 0 };

export class RailSystem {
  constructor(private readonly game: Game) {}

  private railAt(x: number, y: number): Structure | undefined {
    const s = this.game.world.structAt(x, y);
    return s?.def.rail ? s : undefined;
  }

  links(s: Structure): number[] {
    return railLinks((d) => !!this.railAt(s.x + DX[d], s.y + DY[d]));
  }

  // ——— Placing and handling carts ———

  /** Puts a minecart on the rail at (x, y), heading the way the player faces. Returns false off-rail. */
  place(p: Player, cart: Cart, x: number, y: number): boolean {
    const s = this.railAt(Math.floor(x), Math.floor(y));
    if (!s) return false;
    const links = this.links(s);
    const facing = Math.round(((p.angle + Math.PI / 2) / (Math.PI / 2) + 4) % 4) % 4;
    const exit = links.length === 0 ? 1 : links.includes(facing) ? facing : links[0];
    const entry = links.includes(opposite(exit)) || links.length < 2 ? opposite(exit) : (links.find((d) => d !== exit) ?? opposite(exit));
    cart.rail = { tx: s.x, ty: s.y, entry, exit, p: 0.5, stopped: true, dwell: 0, atStation: false, blocked: 0, transferT: 0 };
    this.locate(cart);
    return true;
  }

  /** Turns a minecart around. */
  reverse(cart: Cart): void {
    const r = cart.rail;
    if (!r) return;
    [r.entry, r.exit] = [r.exit, r.entry];
    r.p = 1 - r.p;
    r.atStation = false;
    r.blocked = 0;
  }

  /** E on a rail: flip a junction's switch, or change a station's mode. */
  interact(p: Player, s: Structure): void {
    if (s.def.rail === 'station') {
      const i = STATION_MODES.indexOf(s.rmode ?? 'load');
      s.rmode = STATION_MODES[(i + 1) % STATION_MODES.length];
      this.game.structVisual(s);
      const text: Record<StationMode, string> = {
        load: 'Load: carts stop and fill up from what stands beside the platform.',
        unload: 'Unload: carts stop and empty into what stands beside the platform.',
        pass: 'Pass: carts run straight through.',
      };
      this.game.notice(p, text[s.rmode], 'info');
      return;
    }
    const links = this.links(s);
    if (links.length < 3) {
      this.game.notice(p, 'Only junctions (three or four rails meeting) have a switch.', 'info');
      return;
    }
    const i = s.sw === undefined ? -1 : links.indexOf(s.sw);
    s.sw = links[(i + 1) % links.length];
    this.game.structVisual(s);
    this.game.notice(p, `Switch set: carts leave ${['north', 'east', 'south', 'west'][s.sw]} where they can.`, 'info');
  }

  // ——— Running ———

  step(dt: number): void {
    const carts: Cart[] = [];
    for (const e of this.game.entities.values()) if (e.kind === 'cart' && e.rail) carts.push(e);
    for (const c of carts) this.stepCart(c, carts, dt);
  }

  private stepCart(c: Cart, all: Cart[], dt: number): void {
    const r = c.rail!;
    const here = this.railAt(r.tx, r.ty);
    if (!here) {
      // The rail was taken up: the cart stays where it is.
      c.rail = undefined;
      return;
    }
    if (r.atStation) {
      this.stepStation(c, here, dt);
      return;
    }
    // Wait behind a cart just ahead; after a while, back off the other way.
    const dirX = DX[r.exit];
    const dirY = DY[r.exit];
    for (const o of all) {
      if (o === c) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.05 && dx * dirX + dy * dirY > 0.2) {
        r.blocked += dt;
        if (r.blocked > 2 + (c.id % 7) * 0.1) this.reverse(c);
        return;
      }
    }
    r.blocked = 0;
    r.p += (CART_SPEED * dt) / railLength(r.entry, r.exit);
    if (here.def.rail === 'station' && !r.stopped && r.p >= 0.5 && (here.rmode ?? 'load') !== 'pass') {
      r.p = 0.5;
      r.stopped = true;
      r.atStation = true;
      r.dwell = 0;
      r.transferT = 0;
      this.locate(c);
      return;
    }
    while (r.p >= 1) {
      const nx = r.tx + DX[r.exit];
      const ny = r.ty + DY[r.exit];
      const next = this.railAt(nx, ny);
      if (!next) {
        // End of the line: come back the way we came.
        [r.entry, r.exit] = [r.exit, r.entry];
        r.p = Math.max(0, r.p - 1);
        r.stopped = true;
        break;
      }
      r.p -= 1;
      r.tx = nx;
      r.ty = ny;
      r.entry = opposite(r.exit);
      r.exit = railExit(this.links(next), r.entry, next.sw);
      r.stopped = false;
    }
    this.locate(c);
  }

  /** Loads or unloads while stopped at a station; leaves once nothing has moved for a moment. */
  private stepStation(c: Cart, s: Structure, dt: number): void {
    const r = c.rail!;
    r.transferT -= dt;
    r.dwell += dt;
    if (r.transferT <= 0) {
      r.transferT = TRANSFER_EVERY;
      const unloading = (s.rmode ?? 'load') === 'unload';
      const moved = unloading ? this.unload(c, s) : this.load(c, s);
      if (moved > 0) r.dwell = 0;
      if (unloading) this.game.ambitions.count(c.owner, 'freight', moved);
    }
    if (r.dwell >= STATION_IDLE) r.atStation = false;
  }

  /** The structures beside a station that carts trade with (not other rails). */
  private beside(s: Structure): [Structure, number][] {
    const out: [Structure, number][] = [];
    for (let d = 0; d < 4; d++) {
      const t = this.game.world.structAt(s.x + DX[d], s.y + DY[d]);
      if (t && !t.def.rail) out.push([t, d]);
    }
    return out;
  }

  private load(c: Cart, s: Structure): number {
    let moved = 0;
    for (const [t] of this.beside(s)) {
      const source = t.store && !t.def.shop && !t.def.tower ? t.store : t.machine?.out;
      if (!source) continue;
      for (let i = 0; i < source.length && moved < PER_TRANSFER; i++) {
        const st = source[i];
        if (!st) continue;
        const n = Math.min(st.n, PER_TRANSFER - moved, roomFor(c.slots, st));
        if (n <= 0) continue;
        addStack(c.slots, { ...st, n });
        st.n -= n;
        if (st.n <= 0) source[i] = null;
        moved += n;
      }
      if (moved > 0) this.game.factory.contentsChanged(t);
    }
    return moved;
  }

  private unload(c: Cart, s: Structure): number {
    let moved = 0;
    for (const [t, dir] of this.beside(s)) {
      for (let i = 0; i < c.slots.length && moved < PER_TRANSFER; i++) {
        const st = c.slots[i];
        if (!st) continue;
        while (st.n > 0 && moved < PER_TRANSFER) {
          const one = st.q === undefined ? { id: st.id, n: 1 } : { id: st.id, n: 1, q: st.q };
          if (!this.game.factory.insert(t, dir, one)) break;
          st.n -= 1;
          moved++;
        }
        if (st.n <= 0) c.slots[i] = null;
      }
    }
    return moved;
  }

  /** Puts the cart where its rail state says, facing its way. */
  private locate(c: Cart): void {
    const r = c.rail!;
    const bx = c.x;
    const by = c.y;
    beltPosition(r.tx, r.ty, r.entry, r.exit, Math.min(1, Math.max(0, r.p)), pos);
    c.x = pos.x;
    c.y = pos.y;
    if (Math.hypot(c.x - bx, c.y - by) > 1e-4) c.angle = Math.atan2(c.y - by, c.x - bx);
    else if (!r.atStation) c.angle = Math.atan2(DY[r.exit], DX[r.exit]);
  }

  /** What a cart carries, for its label. */
  describe(c: Cart): string {
    const first = c.slots.find((x) => x);
    return first ? (ITEM_BY_ID.get(first.id)?.name ?? first.id) : 'empty';
  }
}
