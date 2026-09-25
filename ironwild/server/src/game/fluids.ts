// Fluids (§19): pipe networks, pumps, boilers and steam engines. Connected pipes and tanks pool
// their capacity into one network holding one fluid. Each tick pumps push water in, boilers pull
// water and push steam, engines pull steam; machines whose faces touch directly skip the pipe.

import {
  BASE_RPM,
  BOIL_RATE,
  BOIL_SECONDS_PER_FUEL,
  ENGINE_STEAM,
  FLUIDS,
  FLUID_NAMES,
  ITEM_BY_ID,
  PUMPJACK_RATE,
  PUMP_RATE,
  TICK_RATE,
  fluidFace,
  fluidJoins,
  type Fluid,
  type FluidNetTuple,
  type MachineUi,
} from '@ironwild/shared';
import type { Game } from './game';
import type { Structure } from './world';

interface FluidNet {
  id: number;
  fluid: Fluid | null;
  amount: number;
  capacity: number;
  members: Structure[];
  /** Fluid put in since the last flow sample, and the smoothed flow per second. */
  moved: number;
  flow: number;
}

interface Ports {
  /** Networks the machine draws from and feeds. */
  ins: FluidNet[];
  outs: FluidNet[];
  /** Machines touching one of its outlets directly. */
  direct: Structure[];
}

const EPS = 1e-6;

export class FluidSystem {
  private nets: FluidNet[] = [];
  private readonly netOf = new Map<number, FluidNet>();
  private readonly ports = new Map<number, Ports>();
  private endpoints: Structure[] = [];
  private dirty = true;
  private nextId = 1;
  private lastSent = '';

  constructor(private readonly game: Game) {}

  markDirty(): void {
    this.dirty = true;
  }

  step(dt: number): void {
    if (this.dirty) this.rebuild();
    for (const s of this.endpoints) {
      switch (s.def.fluid!.role) {
        case 'pump':
          this.stepPump(s, dt);
          break;
        case 'boiler':
          this.stepBoiler(s, dt);
          break;
        case 'engine':
          this.stepEngine(s, dt);
          break;
        case 'pumpjack':
          this.stepPumpjack(s, dt);
          break;
        case 'refinery': {
          const buf = this.buffer(s);
          buf.crude += this.take(this.ports.get(s.id), 'crude', s.def.fluid!.capacity - buf.crude);
          break;
        }
      }
    }
    if (this.game.tick % 10 === 0) {
      for (const n of this.nets) {
        n.flow += (n.moved * (TICK_RATE / 10) - n.flow) * 0.5;
        n.moved = 0;
      }
      this.broadcast(false);
    }
  }

  // ——— Topology ———

  /** Writes each network's contents back onto its pipes and tanks (before regrouping and saving). */
  spread(): void {
    for (const n of this.nets) {
      for (const m of n.members) {
        const share = n.capacity > 0 ? (n.amount * m.def.fluid!.capacity) / n.capacity : 0;
        m.fluid = { kind: share > EPS ? n.fluid : null, amount: share };
      }
    }
  }

  private rebuild(): void {
    this.dirty = false;
    this.spread();
    this.nets = [];
    this.netOf.clear();
    this.ports.clear();
    this.endpoints = [];
    const w = this.game.world;
    const conduit = (s: Structure) => s.def.fluid?.role === 'pipe' || s.def.fluid?.role === 'tank';
    for (const s of w.structures.values()) {
      if (!s.def.fluid) continue;
      if (!conduit(s)) {
        this.endpoints.push(s);
        continue;
      }
      if (this.netOf.has(s.id)) continue;
      const net: FluidNet = { id: this.nextId++, fluid: null, amount: 0, capacity: 0, members: [], moved: 0, flow: 0 };
      const held: Record<Fluid, number> = { water: 0, steam: 0, crude: 0 };
      const stack = [s];
      this.netOf.set(s.id, net);
      while (stack.length > 0) {
        const c = stack.pop()!;
        net.members.push(c);
        net.capacity += c.def.fluid!.capacity;
        if (c.fluid?.kind) held[c.fluid.kind] += c.fluid.amount;
        for (const [nx, ny, dir] of perimeter(c)) {
          const t = w.structAt(nx, ny);
          if (!t || this.netOf.has(t.id) || !conduit(t) || !fluidJoins(c, t, dir)) continue;
          this.netOf.set(t.id, net);
          stack.push(t);
        }
      }
      // One fluid per network: when two meet, the larger share wins and the rest is vented.
      const kind = FLUIDS.reduce((a, b) => (held[b] > held[a] ? b : a));
      if (held[kind] > EPS) {
        net.fluid = kind;
        net.amount = Math.min(net.capacity, held[kind]);
      }
      this.nets.push(net);
    }
    for (const s of this.endpoints) {
      const p: Ports = { ins: [], outs: [], direct: [] };
      for (const [nx, ny, dir] of perimeter(s)) {
        const t = w.structAt(nx, ny);
        if (!t || t === s || !t.def.fluid || !fluidJoins(s, t, dir)) continue;
        const face = fluidFace(s.def, s.rot, dir)!;
        const net = this.netOf.get(t.id);
        if (net) {
          const list = face.io === 'in' ? p.ins : p.outs;
          if (!list.includes(net)) list.push(net);
        } else if (face.io === 'out' && !p.direct.includes(t)) p.direct.push(t);
      }
      this.ports.set(s.id, p);
    }
    this.broadcast(true);
  }

  // ——— Moving fluid ———

  /** Offers fluid to a machine's outlets; returns how much was taken. */
  private give(p: Ports | undefined, fluid: Fluid, amount: number): number {
    if (!p || amount <= EPS) return 0;
    let left = amount;
    for (const t of p.direct) {
      if (left <= EPS) break;
      left -= this.fill(t, fluid, left);
    }
    for (const net of p.outs) {
      if (left <= EPS) break;
      if (net.fluid && net.fluid !== fluid) continue;
      const put = Math.min(net.capacity - net.amount, left);
      if (put <= EPS) continue;
      net.fluid = fluid;
      net.amount += put;
      net.moved += put;
      left -= put;
    }
    return amount - left;
  }

  /** Draws fluid from a machine's inlets. */
  private take(p: Ports | undefined, fluid: Fluid, amount: number): number {
    if (!p || amount <= EPS) return 0;
    let got = 0;
    for (const net of p.ins) {
      if (got >= amount - EPS) break;
      if (net.fluid !== fluid) continue;
      const t = Math.min(net.amount, amount - got);
      net.amount -= t;
      got += t;
      if (net.amount <= EPS) {
        net.amount = 0;
        net.fluid = null;
      }
    }
    return got;
  }

  private buffer(s: Structure): Record<Fluid, number> {
    const b = (s.buf ??= { water: 0, steam: 0, crude: 0 });
    b.crude ??= 0;
    return b;
  }

  /** Fills a machine's own buffer directly (a boiler bolted to an engine). */
  private fill(t: Structure, fluid: Fluid, amount: number): number {
    const buf = this.buffer(t);
    const put = Math.max(0, Math.min(amount, t.def.fluid!.capacity - buf[fluid]));
    buf[fluid] += put;
    return put;
  }

  // ——— Machines ———

  private stepPump(s: Structure, dt: number): void {
    const m = s.machine!;
    const was = m.active;
    const rpm = s.speed ?? 0;
    const p = this.ports.get(s.id);
    let moved = 0;
    if (rpm <= 0) {
      const net = this.game.factory.netSummary(s.net);
      m.status = net?.stalled ? 'Overstressed' : net?.conflict ? 'Gears jammed' : 'No power';
    } else if (!this.game.world.touchesWater(s.x, s.y, s.w, s.h)) {
      m.status = 'Needs water';
    } else if (!p || (p.outs.length === 0 && p.direct.length === 0)) {
      m.status = 'No pipe';
    } else {
      moved = this.give(p, 'water', PUMP_RATE * (rpm / BASE_RPM) * dt);
      m.status = moved > EPS ? 'Running' : 'Pipes full';
    }
    m.active = moved > EPS;
    m.rate = (m.rate ?? 0) + (moved / dt - (m.rate ?? 0)) * Math.min(1, dt * 2);
    if (m.active !== was) this.game.structVisual(s);
  }

  private stepPumpjack(s: Structure, dt: number): void {
    const m = s.machine!;
    const was = m.active;
    const rpm = s.speed ?? 0;
    const p = this.ports.get(s.id);
    let moved = 0;
    if (rpm <= 0) {
      const net = this.game.factory.netSummary(s.net);
      m.status = net?.stalled ? 'Overstressed' : 'No power';
    } else if (!p || (p.outs.length === 0 && p.direct.length === 0)) m.status = 'No pipe';
    else {
      moved = this.give(p, 'crude', PUMPJACK_RATE * (rpm / BASE_RPM) * dt);
      m.status = moved > EPS ? 'Running' : 'Pipes full';
    }
    m.active = moved > EPS;
    m.rate = (m.rate ?? 0) + (moved / dt - (m.rate ?? 0)) * Math.min(1, dt * 2);
    if (m.active !== was) this.game.structVisual(s);
  }

  private stepBoiler(s: Structure, dt: number): void {
    const m = s.machine!;
    const was = m.active;
    const cap = s.def.fluid!.capacity;
    const buf = this.buffer(s);
    const p = this.ports.get(s.id);
    buf.water += this.take(p, 'water', cap - buf.water);
    const room = cap - buf.steam;
    let boiled = 0;
    if (buf.water > EPS && room > EPS && m.burn <= 0) {
      const fuel = m.fuel?.[0];
      const fdef = fuel ? ITEM_BY_ID.get(fuel.id) : undefined;
      if (fuel && fdef?.fuel) {
        fuel.n -= 1;
        if (fuel.n <= 0) m.fuel![0] = null;
        m.burn += fdef.fuel;
      }
    }
    if (buf.water > EPS && room > EPS && m.burn > 0) {
      boiled = Math.min(BOIL_RATE * dt, buf.water, room);
      buf.water -= boiled;
      buf.steam += boiled;
      m.burn = Math.max(0, m.burn - boiled / (BOIL_RATE * BOIL_SECONDS_PER_FUEL));
      m.status = 'Running';
    } else m.status = buf.water <= EPS ? 'No water' : room <= EPS ? 'Steam backed up' : 'No fuel';
    buf.steam -= this.give(p, 'steam', buf.steam);
    m.active = boiled > EPS;
    m.rate = (m.rate ?? 0) + (boiled / dt - (m.rate ?? 0)) * Math.min(1, dt * 2);
    if (m.active !== was) this.game.structVisual(s);
  }

  private stepEngine(s: Structure, dt: number): void {
    const m = s.machine!;
    const was = m.active;
    const cap = s.def.fluid!.capacity;
    const buf = this.buffer(s);
    const p = this.ports.get(s.id);
    buf.steam += this.take(p, 'steam', cap - buf.steam);
    const need = ENGINE_STEAM * dt;
    // Once stopped, wait for a second's worth of steam before starting again (no stuttering).
    const run = was ? buf.steam >= need - EPS : buf.steam >= Math.min(cap, ENGINE_STEAM);
    if (run) {
      buf.steam = Math.max(0, buf.steam - need);
      m.status = 'Running';
    } else m.status = p && (p.ins.length > 0 || this.fedDirectly(s)) ? 'No steam' : 'Pipe it to a boiler';
    m.active = run;
    if (m.active !== was) {
      this.game.factory.markPowerDirty();
      this.game.structVisual(s);
    }
  }

  private fedDirectly(s: Structure): boolean {
    for (const p of this.ports.values()) if (p.direct.includes(s)) return true;
    return false;
  }

  // ——— UI and replication ———

  /** Tank readouts and flow for a machine's panel. */
  machineInfo(s: Structure): Pick<MachineUi, 'tanks' | 'rate'> {
    const role = s.def.fluid?.role;
    const m = s.machine;
    const cap = s.def.fluid?.capacity ?? 0;
    const buf = s.buf ?? { water: 0, steam: 0, crude: 0 };
    const round = (v: number) => Math.round(v * 10) / 10;
    if (role === 'pump') return { rate: { fluid: FLUID_NAMES.water, perSec: round(m?.rate ?? 0) } };
    if (role === 'boiler')
      return {
        tanks: [
          { fluid: FLUID_NAMES.water, amount: round(buf.water), capacity: cap },
          { fluid: FLUID_NAMES.steam, amount: round(buf.steam), capacity: cap },
        ],
        rate: { fluid: FLUID_NAMES.steam, perSec: round(m?.rate ?? 0) },
      };
    if (role === 'engine') return { tanks: [{ fluid: FLUID_NAMES.steam, amount: round(buf.steam), capacity: cap }] };
    if (role === 'pumpjack') return { rate: { fluid: FLUID_NAMES.crude, perSec: round(m?.rate ?? 0) } };
    if (role === 'refinery') return { tanks: [{ fluid: FLUID_NAMES.crude, amount: round(buf.crude ?? 0), capacity: cap }] };
    return {};
  }

  /** The network a pipe or tank belongs to, for hover text and tests. */
  netAt(s: Structure): { fluid: Fluid | null; amount: number; capacity: number; flow: number } | undefined {
    const n = this.netOf.get(s.id);
    return n ? { fluid: n.fluid, amount: n.amount, capacity: n.capacity, flow: n.flow } : undefined;
  }

  private tuples(): FluidNetTuple[] {
    return this.nets.map((n) => [
      n.id,
      n.fluid ?? '',
      n.capacity > 0 ? Math.round((n.amount / n.capacity) * 1000) : 0,
      Math.round(n.flow * 10),
    ]);
  }

  /** Network states to everyone (when they changed), with the pipe → network map after regrouping. */
  broadcast(withMap: boolean, only?: { send(m: object): void }): void {
    const nets = this.tuples();
    const key = JSON.stringify(nets);
    if (!withMap && !only && key === this.lastSent) return;
    if (!only) this.lastSent = key;
    const msg: { t: 'fluids'; nets: FluidNetTuple[]; of?: [number, number][] } = { t: 'fluids', nets };
    if (withMap || only) msg.of = [...this.netOf].map(([id, n]) => [id, n.id] as [number, number]);
    if (only) only.send(msg);
    else for (const p of this.game.players.values()) p.session.send(msg);
  }
}

/** The tiles around a structure's footprint, with the direction from the structure to each. */
export function perimeter(s: Structure): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y - 1, 0], [x, s.y + s.h, 2]);
  for (let y = s.y; y < s.y + s.h; y++) out.push([s.x + s.w, y, 1], [s.x - 1, y, 3]);
  return out;
}
