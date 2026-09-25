// Electricity (§19): power poles within reach of each other form a grid; generators, motors,
// electric machines and lamps attach to the nearest pole. Each tick a grid adds up what its
// generators make and what its devices ask for; when demand outruns supply, everything on the grid
// gets the same share. Motors turn that share into torque for the rotation network they drive.

import { BASE_RPM, DEVICE_RANGE, OVERCLOCK, POLE_RANGE, type ElectricRole } from '@ironwild/shared';
import type { Game } from './game';
import type { Structure } from './world';

interface Grid {
  id: number;
  poles: Structure[];
  devices: Structure[];
  supply: number;
  demand: number;
  /** Share of demand met (0–1). */
  share: number;
}

export class PowerSystem {
  private grids: Grid[] = [];
  private readonly gridOf = new Map<number, Grid>();
  private dirty = true;
  private nextId = 1;
  private lastSent = '';

  constructor(private readonly game: Game) {}

  markDirty(): void {
    this.dirty = true;
  }

  private role(s: Structure): ElectricRole | undefined {
    return s.def.electric?.role;
  }

  // ——— Topology ———

  private rebuild(): void {
    this.dirty = false;
    this.grids = [];
    this.gridOf.clear();
    const poles: Structure[] = [];
    const devices: Structure[] = [];
    for (const s of this.game.world.structures.values()) {
      const r = this.role(s);
      if (r === 'pole') poles.push(s);
      else if (r) devices.push(s);
    }
    // Poles within reach join (union by flood fill over a coarse grid).
    const cell = (x: number, y: number) => `${Math.floor(x / POLE_RANGE)},${Math.floor(y / POLE_RANGE)}`;
    const buckets = new Map<string, Structure[]>();
    for (const p of poles) {
      const k = cell(p.x, p.y);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(p);
    }
    const near = (p: Structure): Structure[] => {
      const out: Structure[] = [];
      const cx = Math.floor(p.x / POLE_RANGE);
      const cy = Math.floor(p.y / POLE_RANGE);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          for (const q of buckets.get(`${cx + dx},${cy + dy}`) ?? [])
            if (q !== p && Math.hypot(q.x - p.x, q.y - p.y) <= POLE_RANGE) out.push(q);
      return out;
    };
    for (const p of poles) {
      if (this.gridOf.has(p.id)) continue;
      const grid: Grid = { id: this.nextId++, poles: [], devices: [], supply: 0, demand: 0, share: 1 };
      const stack = [p];
      this.gridOf.set(p.id, grid);
      while (stack.length > 0) {
        const c = stack.pop()!;
        grid.poles.push(c);
        for (const q of near(c)) {
          if (this.gridOf.has(q.id)) continue;
          this.gridOf.set(q.id, grid);
          stack.push(q);
        }
      }
      this.grids.push(grid);
    }
    // Each device uses the nearest pole in reach.
    for (const d of devices) {
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      let best: Structure | null = null;
      let bestD = DEVICE_RANGE;
      for (const p of poles) {
        const dist = Math.hypot(p.x + 0.5 - cx, p.y + 0.5 - cy);
        if (dist <= bestD) {
          bestD = dist;
          best = p;
        }
      }
      const grid = best ? this.gridOf.get(best.id) : undefined;
      if (grid) {
        grid.devices.push(d);
        this.gridOf.set(d.id, grid);
      } else d.power = 0;
    }
    this.broadcast(true);
  }

  // ——— Tick ———

  step(): void {
    if (this.dirty) this.rebuild();
    for (const g of this.grids) {
      let supply = 0;
      let demand = 0;
      for (const d of g.devices) {
        const spec = d.def.electric!;
        if (spec.role === 'generator') supply += spec.power * Math.min(2, Math.max(0, (d.speed ?? 0) / BASE_RPM));
        // Overclocked machines draw disproportionately more (§60).
        else if (this.wants(d)) demand += spec.power * (OVERCLOCK[d.machine?.oc ?? 0]?.cost ?? 1);
      }
      g.supply = supply;
      g.demand = demand;
      g.share = demand > 0 ? Math.min(1, supply / demand) : supply > 0 ? 1 : 0;
      for (const d of g.devices) this.apply(d, g);
    }
    if (this.game.tick % 10 === 0) this.broadcast(false);
  }

  /** Whether a device is asking for power right now. */
  private wants(d: Structure): boolean {
    switch (d.def.electric!.role) {
      case 'motor':
        return true;
      case 'lamp':
        return this.game.night;
      case 'machine':
        return !!d.machine && (d.machine.in.some((x) => x) || d.machine.progress > 0);
      default:
        return false;
    }
  }

  private apply(d: Structure, g: Grid): void {
    const role = d.def.electric!.role;
    if (role === 'generator') return;
    const share = this.wants(d) ? g.share : 0;
    if (role === 'motor') {
      // Torque follows the grid in 10 % steps (each change recomputes the rotation network).
      const next = Math.round(g.share * 10) / 10;
      if (next !== d.power) {
        const was = (d.power ?? 0) > 0;
        d.power = next;
        this.game.factory.markPowerDirty();
        if (was !== next > 0) this.game.structVisual(d);
      }
      return;
    }
    const was = (d.power ?? 0) > 0.05;
    d.power = share;
    if (role === 'lamp' && was !== share > 0.05) this.game.structVisual(d);
  }

  // ——— Info ———

  /** The grid a structure is on, for panels, hover text and tests. */
  gridAt(s: Structure): { supply: number; demand: number; share: number } | undefined {
    const g = this.gridOf.get(s.id);
    return g
      ? { supply: Math.round(g.supply * 10) / 10, demand: Math.round(g.demand * 10) / 10, share: Math.round(g.share * 100) / 100 }
      : undefined;
  }

  broadcast(withMap: boolean, only?: { send(m: object): void }): void {
    const nets = this.grids.map((g) => [g.id, Math.round(g.supply), Math.round(g.demand)] as [number, number, number]);
    const key = JSON.stringify(nets);
    if (!withMap && !only && key === this.lastSent) return;
    if (!only) this.lastSent = key;
    const msg: { t: 'power'; nets: [number, number, number][]; of?: [number, number][] } = { t: 'power', nets };
    if (withMap || only) msg.of = [...this.gridOf].map(([id, g]) => [id, g.id] as [number, number]);
    if (only) only.send(msg);
    else for (const p of this.game.players.values()) p.session.send(msg);
  }
}
