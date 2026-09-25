// Factories (§19–24, §58): mechanical power networks, machines that process recipes over time,
// and logistics — conveyors carrying individual items, hoppers, splitters, filters and crates.

import {
  TICK_RATE,
  BASE_RPM,
  BELT_SPACING,
  DX,
  DY,
  ITEM_BY_ID,
  KNOWLEDGE,
  OVERCLOCK,
  STRUCTURE_BY_ID,
  WEAR_PER_OP,
  WEAR_SLOWDOWN,
  TICK_DT,
  addStack,
  beltSpeed,
  machineRecipes,
  opposite,
  roomFor,
  rotateDir,
  solveKinetics,
  turnLeft,
  turnRight,
  type BeltGroup,
  type BeltKeyframe,
  type ClientMessage,
  type FactoryStats,
  type Fluid,
  type ItemStack,
  type KineticBlock,
  type KineticSolution,
  type MachineUi,
  type NetSummary,
  type Recipe,
  type Slots,
} from '@ironwild/shared';
import type { StructureSave } from '../persistence/storage';
import { perimeter } from './fluids';
import type { Game } from './game';
import type { Player } from './player';
import type { BeltItem, MachineState, Structure } from './world';

const HOPPER_INTERVAL = 0.5;
const MACHINE_PUSH_INTERVAL = 0.2;
const CRANK_STAMINA_PER_SECOND = 5;

const BELT_TYPES = new Set(['conveyor', 'splitter', 'filter']);

export class Factory {
  private powerDirty = true;
  private topologyDirty = true;
  /** Belt tiles ordered so downstream tiles move first. */
  private beltOrder: Structure[] = [];
  solution: KineticSolution | null = null;
  readonly keyframes: { chunk: number; kf: BeltKeyframe }[] = [];
  private readonly pushTimers = new Map<number, number>();

  constructor(private readonly game: Game) {}

  // ——— Structure lifecycle ———

  initStructure(s: Structure): void {
    const def = s.def;
    if (def.container) s.store = Array.from({ length: def.container }, () => null);
    if (def.logistics && BELT_TYPES.has(def.logistics)) s.items = [];
    if (def.logistics === 'filter') s.filter = null;
    if (def.logistics === 'hopper') s.timer = 0;
    if (def.machine) {
      const recipes = machineRecipes(def.machine.station);
      const inSlots = Math.max(2, ...recipes.map((r) => r.inputs.length));
      s.machine = {
        in: Array.from({ length: inSlots }, () => null),
        fuel: def.machine.fuel ? [null] : null,
        out: [null, null],
        progress: 0,
        recipe: null,
        burn: 0,
        acc: {},
        mode: def.machine.modes?.[0],
        status: 'Idle',
        active: false,
        outputs: 0,
        oc: 0,
        wear: 0,
        util: 0,
        made: [],
      };
    }
  }

  structureChanged(s: Structure): void {
    if (s.def.kinetic || (s.def.logistics && BELT_TYPES.has(s.def.logistics))) this.powerDirty = true;
    if (s.def.logistics || s.def.machine || s.def.container) this.topologyDirty = true;
    if (s.def.fluid) this.game.fluids.markDirty();
    if (s.def.electric) this.game.power.markDirty();
  }

  /** A power source switched on or off (steam engines, from the fluid system). */
  markPowerDirty(): void {
    this.powerDirty = true;
  }

  rebuildAll(): void {
    this.powerDirty = true;
    this.topologyDirty = true;
  }

  /** Everything stored in a structure (refunded when it is picked up). */
  contents(s: Structure): ItemStack[] {
    const out: ItemStack[] = [];
    const add = (slots: Slots | null | undefined) => {
      for (const it of slots ?? []) if (it) out.push({ ...it });
    };
    add(s.store);
    if (s.machine) {
      add(s.machine.in);
      add(s.machine.fuel);
      add(s.machine.out);
    }
    for (const it of s.items ?? []) {
      out.push(it.q === undefined ? { id: it.item, n: 1 } : { id: it.item, n: 1, q: it.q });
      this.pushKeyframe(s, { i: it.id, k: this.game.tick, rm: 1 });
    }
    return out;
  }

  // ——— Tick ———

  step(dt: number): void {
    const now = Date.now();
    this.updateSources(now, dt);
    if (this.powerDirty) this.recomputePower();
    if (this.topologyDirty) this.recomputeTopology();
    for (const s of this.game.world.structures.values()) {
      if (s.machine) this.stepMachine(s, dt);
      else if (s.def.logistics === 'hopper') this.stepHopper(s, dt);
    }
    for (const s of this.beltOrder) this.stepBelt(s, dt);
    this.flushKeyframes();
    if (this.game.tick % TICK_RATE === 0) this.stepLubricators();
  }

  // ——— Maintenance, automated (§61) ———

  /** Each lubricator oils the machines beside it: one Lubricant keeps a machine from wearing for a day. */
  private stepLubricators(): void {
    const w = this.game.world;
    for (const l of w.lubricators) {
      const store = l.store;
      if (!store) continue;
      const seen = new Set<number>();
      for (const [nx, ny] of perimeter(l)) {
        const t = w.structAt(nx, ny);
        if (!t?.machine || seen.has(t.id) || t.def.fluid) continue;
        seen.add(t.id);
        const m = t.machine;
        if (m.lube !== undefined && this.game.minutes < m.lube) continue;
        const k = store.findIndex((x) => x?.id === 'lubricant');
        if (k < 0) break;
        const x = store[k]!;
        x.n -= 1;
        if (x.n <= 0) store[k] = null;
        m.wear = 0;
        m.lube = this.game.minutes + 1440;
        this.fillChanged(l);
      }
    }
  }

  private updateSources(now: number, dt: number): void {
    for (const s of this.game.world.structures.values()) {
      if (s.crank) {
        const p = this.game.players.get(s.crank.player);
        const tooFar = !p || p.dead || Math.hypot(p.x - (s.x + 0.5), p.y - (s.y + 0.5)) > 3;
        if (p && !tooFar) {
          p.move.stamina = Math.max(0, p.move.stamina - CRANK_STAMINA_PER_SECOND * dt);
          p.move.staminaDelay = 0.5;
        }
        if (tooFar || s.crank.until < now || (p && p.move.stamina <= 0)) {
          if (p) p.crankId = 0;
          s.crank = undefined;
          this.powerDirty = true;
          this.game.structVisual(s);
        }
      }
    }
  }

  // ——— Power ———

  private sourceActive(s: Structure): boolean {
    if (s.type === 'hand_crank') return !!s.crank;
    if (s.type === 'steam_engine') return !!s.machine?.active;
    if (s.def.electric?.role === 'motor') return (s.power ?? 0) > 0;
    return true;
  }

  private recomputePower(): void {
    this.powerDirty = false;
    const blocks: KineticBlock[] = [];
    const belts: Structure[] = [];
    for (const s of this.game.world.structures.values()) {
      if (s.def.kinetic) {
        blocks.push({
          id: s.id,
          def: s.def,
          x: s.x,
          y: s.y,
          rot: s.rot,
          active: this.sourceActive(s),
          rpm: s.rpm,
          stressMul: OVERCLOCK[s.machine?.oc ?? 0]?.cost ?? 1,
          torqueMul: s.def.electric?.role === 'motor' ? (s.power ?? 0) : undefined,
        });
      } else if (s.items) belts.push(s);
    }
    const groups = this.beltGroups(belts);
    const sol = solveKinetics(
      blocks,
      groups.map((g, i) => ({ id: i + 1, tiles: g.map((s) => ({ x: s.x, y: s.y })) }) as BeltGroup),
    );
    this.solution = sol;
    const changed: Structure[] = [];
    const w = this.game.world;
    for (const b of blocks) {
      const s = w.structures.get(b.id)!;
      const spin = sol.speeds.get(b.id) ?? [0];
      const net = sol.netOf.get(b.id);
      if (!sameSpin(s.spin, spin) || s.net !== net) {
        s.spin = spin;
        s.net = net;
        changed.push(s);
      }
      if (s.def.kinetic?.role === 'consumer') s.speed = spin[0];
    }
    groups.forEach((g, i) => {
      const rpm = sol.beltSpeed.get(i + 1) ?? 0;
      const speed = beltSpeed(rpm);
      const net = sol.beltNet.get(i + 1);
      for (const s of g) {
        if (s.speed !== speed || s.net !== net) {
          s.speed = speed;
          s.net = net;
          s.spin = [Math.round(speed * 100) / 100];
          changed.push(s);
        }
      }
    });
    this.game.replication.kineticChanged(changed, this.netSummaries());
  }

  netSummaries(): NetSummary[] {
    if (!this.solution) return [];
    return [...this.solution.networks.values()].map((n) => ({
      id: n.id,
      rpm: Math.round(n.rpm * 100) / 100,
      cap: n.capacity,
      load: n.load,
      stalled: n.stalled,
      conflict: n.conflict,
    }));
  }

  netSummary(id: number | undefined): NetSummary | undefined {
    if (id === undefined || !this.solution) return undefined;
    const n = this.solution.networks.get(id);
    if (!n) return undefined;
    return { id: n.id, rpm: Math.round(n.rpm * 100) / 100, cap: n.capacity, load: n.load, stalled: n.stalled, conflict: n.conflict };
  }

  /** Connected conveyor groups: tiles joined when one feeds the other. */
  private beltGroups(belts: Structure[]): Structure[][] {
    const w = this.game.world;
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = a;
      while (parent.get(c) !== r) {
        const next = parent.get(c)!;
        parent.set(c, r);
        c = next;
      }
      return r;
    };
    for (const b of belts) parent.set(b.id, b.id);
    for (const b of belts) {
      for (const d of this.beltOutputs(b)) {
        const n = w.structAt(b.x + DX[d], b.y + DY[d]);
        if (n?.items && n.rot !== opposite(d)) parent.set(find(b.id), find(n.id));
      }
    }
    const groups = new Map<number, Structure[]>();
    for (const b of belts) {
      const r = find(b.id);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = []));
      g.push(b);
    }
    return [...groups.values()];
  }

  private beltOutputs(s: Structure): number[] {
    if (s.def.logistics === 'conveyor') return [s.rot];
    return [s.rot, turnLeft(s.rot), turnRight(s.rot)];
  }

  // ——— Topology (belt processing order) ———

  private recomputeTopology(): void {
    this.topologyDirty = false;
    const w = this.game.world;
    const belts = [...w.structures.values()].filter((s) => s.items);
    // Reverse edges: who feeds whom. Process sinks first, then walk upstream.
    const feeders = new Map<number, Structure[]>();
    const outDegree = new Map<number, number>();
    for (const b of belts) {
      let n = 0;
      for (const d of this.beltOutputs(b)) {
        const t = w.structAt(b.x + DX[d], b.y + DY[d]);
        if (t?.items && t.rot !== opposite(d)) {
          n++;
          let list = feeders.get(t.id);
          if (!list) feeders.set(t.id, (list = []));
          list.push(b);
        }
      }
      outDegree.set(b.id, n);
    }
    const order: Structure[] = [];
    const seen = new Set<number>();
    const queue = belts.filter((b) => outDegree.get(b.id) === 0);
    for (let qi = 0; qi < queue.length; qi++) {
      const b = queue[qi];
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      order.push(b);
      for (const f of feeders.get(b.id) ?? []) if (!seen.has(f.id)) queue.push(f);
    }
    for (const b of belts) if (!seen.has(b.id)) order.push(b);
    this.beltOrder = order;
  }

  // ——— Belts ———

  private stepBelt(s: Structure, dt: number): void {
    const items = s.items!;
    const speed = s.speed ?? 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const limit = i === 0 ? 1 : items[i - 1].p - BELT_SPACING;
      let np = Math.min(it.p + speed * dt, limit);
      if (np < it.p) np = it.p;
      if (i === 0 && np >= 1) {
        if (this.passOn(s, it)) {
          items.shift();
          i--;
          continue;
        }
        np = 1;
      }
      it.v = (np - it.p) / dt;
      it.p = np;
      if (Math.abs(it.v - it.sentV) > 0.02) it.dirty = true;
      if (it.dirty) this.emitItem(s, it);
    }
  }

  /** Item at the end of a belt tile tries to move on. */
  private passOn(s: Structure, it: BeltItem): boolean {
    const d = it.exit;
    const stack: ItemStack = it.q === undefined ? { id: it.item, n: 1 } : { id: it.item, n: 1, q: it.q };
    const target = this.game.world.structAt(s.x + DX[d], s.y + DY[d]);
    if (!target) return false;
    if (target.items) return this.enterBelt(target, d, it);
    if (this.insert(target, d, stack)) {
      this.pushKeyframe(s, { i: it.id, k: this.game.tick, rm: 1 });
      return true;
    }
    // Filters and splitters re-route if their chosen side stays blocked.
    if (s.def.logistics !== 'conveyor' && Math.random() < 0.05) it.exit = this.chooseExit(s, it.item) ?? it.exit;
    return false;
  }

  /** Moves an existing belt item (keeping its id) onto a belt tile. */
  private enterBelt(t: Structure, dir: number, it: BeltItem): boolean {
    if (t.rot === opposite(dir)) return false;
    const items = t.items!;
    if (items.length > 0 && items[items.length - 1].p < BELT_SPACING) return false;
    const exit = t.def.logistics === 'conveyor' ? t.rot : this.chooseExit(t, it.item);
    if (exit === null) return false;
    it.p = 0;
    it.entry = opposite(dir);
    it.exit = exit;
    it.dirty = true;
    items.push(it);
    this.emitItem(t, it);
    return true;
  }

  /** Splitters alternate between front, left and right; filters send matches straight on. */
  private chooseExit(s: Structure, item: string): number | null {
    const w = this.game.world;
    const valid = (d: number) => {
      const t = w.structAt(s.x + DX[d], s.y + DY[d]);
      return !!t && (t.items ? t.rot !== opposite(d) : this.canReceive(t, d, item));
    };
    if (s.def.logistics === 'filter') {
      if (s.filter && item === s.filter) return valid(s.rot) ? s.rot : null;
      const sides = [turnLeft(s.rot), turnRight(s.rot)].filter(valid);
      if (sides.length === 0) return null;
      s.rr = ((s.rr ?? 0) + 1) % sides.length;
      return sides[s.rr];
    }
    const outs = [turnLeft(s.rot), s.rot, turnRight(s.rot)].filter(valid);
    if (outs.length === 0) return null;
    s.rr = ((s.rr ?? 0) + 1) % outs.length;
    return outs[s.rr];
  }

  /** Puts a brand-new item on a belt tile (machine output, hopper push). */
  private placeOnBelt(t: Structure, dir: number, stack: ItemStack): boolean {
    if (t.rot === opposite(dir)) return false;
    const items = t.items!;
    if (items.length > 0 && items[items.length - 1].p < BELT_SPACING) return false;
    const exit = t.def.logistics === 'conveyor' ? t.rot : this.chooseExit(t, stack.id);
    if (exit === null) return false;
    const it: BeltItem = {
      id: this.game.nextItemId++,
      item: stack.id,
      q: stack.q,
      p: 0,
      entry: opposite(dir),
      exit,
      sentV: -1,
      v: 0,
      dirty: true,
    };
    items.push(it);
    this.emitItem(t, it);
    return true;
  }

  private emitItem(s: Structure, it: BeltItem): void {
    it.dirty = false;
    it.sentV = it.v;
    this.pushKeyframe(s, {
      i: it.id,
      it: it.item,
      x: s.x,
      y: s.y,
      e: it.entry,
      o: it.exit,
      p: Math.round(it.p * 1000),
      v: Math.round(it.v * 100),
      k: this.game.tick,
    });
  }

  private pushKeyframe(s: Structure, kf: BeltKeyframe): void {
    this.keyframes.push({ chunk: s.chunk, kf });
  }

  private flushKeyframes(): void {
    if (this.keyframes.length === 0) return;
    this.game.replication.beltKeyframes(this.keyframes);
    this.keyframes.length = 0;
  }

  /** Current state of all belt items on a structure (for newly loaded chunks). */
  beltState(s: Structure): BeltKeyframe[] {
    return (s.items ?? []).map((it) => ({
      i: it.id,
      it: it.item,
      x: s.x,
      y: s.y,
      e: it.entry,
      o: it.exit,
      p: Math.round(it.p * 1000),
      v: Math.round(it.v * 100),
      k: this.game.tick,
    }));
  }

  // ——— Insertion into structures ———

  /** Whether `t` could take this item from direction `dir` in principle (ignoring room). */
  private canReceive(t: Structure, dir: number, item: string): boolean {
    if (t.items) return t.rot !== opposite(dir);
    if (t.machine) return this.machineFace(t, dir) && (this.accepts(t, 'in', item) || this.accepts(t, 'fuel', item));
    if (t.def.only) return item === t.def.only;
    return !!t.store && !t.def.shop;
  }

  /** The machine's front (output) face does not take items. */
  private machineFace(t: Structure, dir: number): boolean {
    return opposite(dir) !== t.rot;
  }

  /** Inserts one item moving in direction `dir` into structure `t`. */
  insert(t: Structure, dir: number, stack: ItemStack): boolean {
    if (t.items) return this.placeOnBelt(t, dir, stack);
    if (t.machine) {
      if (!this.machineFace(t, dir)) return false;
      const m = t.machine;
      const def = ITEM_BY_ID.get(stack.id);
      const fuelFirst = !!def?.fuel && !!m.fuel && (m.fuel[0]?.n ?? 0) < 5;
      if (fuelFirst && this.accepts(t, 'fuel', stack.id) && roomFor(m.fuel!, stack) > 0) {
        addStack(m.fuel!, stack);
        return true;
      }
      if (this.accepts(t, 'in', stack.id) && this.inputRoom(t, stack) > 0) {
        addStack(m.in, stack);
        return true;
      }
      if (this.accepts(t, 'fuel', stack.id) && roomFor(m.fuel!, stack) > 0) {
        addStack(m.fuel!, stack);
        return true;
      }
      return false;
    }
    if (t.store) {
      if (t.def.only && stack.id !== t.def.only) return false;
      if (roomFor(t.store, stack) <= 0) return false;
      addStack(t.store, stack);
      this.fillChanged(t);
      return true;
    }
    return false;
  }

  /** Room in a machine's input buffer, limited per item to the machine's buffer size. */
  private inputRoom(t: Structure, stack: ItemStack): number {
    const m = t.machine!;
    const limit = t.def.machine!.buffer;
    let have = 0;
    for (const s of m.in) if (s && s.id === stack.id) have += s.n;
    return Math.min(limit - have, roomFor(m.in, stack));
  }

  /** Whether a machine section accepts an item type. */
  accepts(s: Structure, section: 'in' | 'fuel', item: string): boolean {
    const m = s.machine;
    const def = s.def.machine;
    if (!m || !def) return false;
    if (section === 'fuel') return !!m.fuel && !!ITEM_BY_ID.get(item)?.fuel;
    return this.recipesFor(s).some((r) => r.inputs.some((i) => i.item === item));
  }

  private recipesFor(s: Structure): Recipe[] {
    // A drill only knows what it stands over.
    if (s.def.drill && !s.machine?.mode) return [];
    return machineRecipes(s.def.machine!.station, s.machine?.mode);
  }

  contentsChanged(s: Structure): void {
    if (s.machine) s.machine.recipe = null;
    if (s.def.shop) this.game.structVisual(s);
    else this.fillChanged(s);
  }

  /** Tells clients how full a container is, when that changed — counted in slots, so a busy conveyor doesn't flood them. */
  fillChanged(s: Structure): void {
    if (!s.store) return;
    let used = 0;
    for (const x of s.store) if (x) used++;
    if (used === s.fillSent) return;
    s.fillSent = used;
    this.game.structVisual(s);
  }

  // ——— Machines ———

  private stepMachine(s: Structure, dt: number): void {
    const m = s.machine!;
    const def = s.def.machine!;
    const wasActive = m.active;
    const prevStatus = m.status;
    this.pushOutput(s, dt);
    m.util += ((wasActive ? 1 : 0) - m.util) * Math.min(1, dt / 30);

    // Pumps, boilers and engines are run by the fluid system (refineries process recipes here).
    if (s.def.fluid && s.def.fluid.role !== 'refinery') return;

    let rate = 1;
    if (def.electric) {
      rate = s.power ?? 0;
      if (rate <= 0) {
        const grid = this.game.power.gridAt(s);
        this.setIdle(s, !m.in.some((x) => x) ? 'Idle' : grid ? 'No electricity' : 'No power pole nearby');
        return this.visual(s, wasActive, prevStatus);
      }
    }
    if (def.powered) {
      const rpm = s.speed ?? 0;
      rate = rpm / BASE_RPM;
      if (rate <= 0) {
        const net = this.netSummary(s.net);
        this.setIdle(s, net?.stalled ? 'Overstressed' : net?.conflict ? 'Gears jammed' : 'No power');
        return this.visual(s, wasActive, prevStatus);
      }
    }
    if (def.water && !this.game.world.touchesWater(s.x, s.y, s.w, s.h)) {
      this.setIdle(s, 'Needs water');
      return this.visual(s, wasActive, prevStatus);
    }
    const recipe = this.currentRecipe(s);
    if (!recipe) {
      this.setIdle(s, m.in.some((x) => x) ? 'Wrong input' : 'Idle');
      return this.visual(s, wasActive, prevStatus);
    }
    if (!this.outputRoom(s, recipe)) {
      this.setIdle(s, 'Output full', false);
      return this.visual(s, wasActive, prevStatus);
    }
    if (def.fuel && m.burn <= 0) {
      const fuel = m.fuel?.[0];
      const fdef = fuel ? ITEM_BY_ID.get(fuel.id) : undefined;
      if (!fuel || !fdef?.fuel) {
        this.setIdle(s, 'No fuel', false);
        return this.visual(s, wasActive, prevStatus);
      }
      fuel.n -= 1;
      if (fuel.n <= 0) m.fuel![0] = null;
      m.burn += fdef.fuel;
    }
    const oc = OVERCLOCK[m.oc] ?? OVERCLOCK[0];
    const step = (dt * rate * oc.speed * (1 - m.wear * WEAR_SLOWDOWN)) / recipe.time;
    m.progress += step;
    // Overclocked fuel machines burn disproportionately more fuel.
    if (def.fuel) m.burn = Math.max(0, m.burn - (step * oc.cost) / oc.speed);
    m.active = true;
    m.status = 'Working';
    if (m.progress >= 1) {
      m.progress -= 1;
      this.finish(s, recipe);
    }
    this.visual(s, wasActive, prevStatus);
  }

  private setIdle(s: Structure, status: string, resetProgress = true): void {
    const m = s.machine!;
    m.active = false;
    m.status = status;
    if (resetProgress && status !== 'Output full') m.progress = Math.min(m.progress, 0.999);
  }

  private visual(s: Structure, wasActive: boolean, prevStatus: string): void {
    const m = s.machine!;
    if (m.active !== wasActive || (m.status !== prevStatus && (m.status === 'Working' || prevStatus === 'Working')))
      this.game.structVisual(s);
  }

  private currentRecipe(s: Structure): Recipe | null {
    const m = s.machine!;
    const has = (r: Recipe) =>
      (!r.fluid || (s.buf?.[r.fluid.fluid as Fluid] ?? 0) >= r.fluid.amount) &&
      r.inputs.every((i) => {
        let n = 0;
        for (const x of m.in) if (x && x.id === i.item) n += x.n;
        return n >= i.n;
      });
    if (m.recipe) {
      const r = this.recipesFor(s).find((x) => x.id === m.recipe);
      if (r && has(r)) return r;
    }
    const r = this.recipesFor(s).find(has) ?? null;
    if (r?.id !== m.recipe) m.progress = 0;
    m.recipe = r?.id ?? null;
    return r;
  }

  private outputRoom(s: Structure, recipe: Recipe): boolean {
    const m = s.machine!;
    const trial = m.out.map((x) => (x ? { ...x } : null));
    for (const o of recipe.outputs) {
      const n = Math.ceil((m.acc[o.item] ?? 0) + o.n - 1e-9);
      if (n > 0 && addStack(trial, { id: o.item, n, ...(ITEM_BY_ID.get(o.item)?.quality ? { q: 1 } : {}) }) > 0) return false;
    }
    return true;
  }

  private finish(s: Structure, recipe: Recipe): void {
    const m = s.machine!;
    let quality: number | undefined;
    if (recipe.fluid && s.buf) s.buf[recipe.fluid.fluid as Fluid] = Math.max(0, s.buf[recipe.fluid.fluid as Fluid] - recipe.fluid.amount);
    for (const i of recipe.inputs) {
      let left = i.n;
      for (let k = 0; k < m.in.length && left > 0; k++) {
        const x = m.in[k];
        if (!x || x.id !== i.item) continue;
        if (x.q !== undefined) quality = Math.max(quality ?? 0, x.q);
        const take = Math.min(left, x.n);
        x.n -= take;
        left -= take;
        if (x.n <= 0) m.in[k] = null;
      }
    }
    let made = 0;
    const now = Date.now();
    const out: [string, number][] = [];
    for (const o of recipe.outputs) {
      const acc = (m.acc[o.item] ?? 0) + o.n;
      const whole = Math.floor(acc + 1e-9);
      m.acc[o.item] = acc - whole;
      if (whole <= 0) continue;
      m.made.push([now, o.item, whole]);
      out.push([o.item, whole]);
      const def = ITEM_BY_ID.get(o.item);
      // Machines produce consistent Standard quality (§16), or keep the input's quality.
      addStack(m.out, { id: o.item, n: whole, ...(def?.quality ? { q: Math.min(quality ?? 1, 2) } : {}) });
      made += whole;
    }
    m.outputs += made;
    // Lubricated machines don't wear for a while.
    if (!m.lube || this.game.minutes >= m.lube) m.wear = Math.min(1, m.wear + WEAR_PER_OP * (OVERCLOCK[m.oc]?.cost ?? 1));
    while (m.made.length > 0 && m.made[0][0] < now - 60_000) m.made.shift();
    if (s.owner && made > 0) {
      const owner = this.game.byAccount.get(s.owner);
      if (owner) this.game.progression.addKnowledge(owner, KNOWLEDGE.machineOutput * made, true);
    }
    // Value added counts expected outputs, so fractional yields even out (§63).
    if (s.owner) {
      const worth = (list: { item: string; n: number }[]) => list.reduce((v, x) => v + (ITEM_BY_ID.get(x.item)?.value ?? 0) * x.n, 0);
      this.game.ambitions.job(s.owner, out, worth(recipe.outputs) - worth(recipe.inputs));
    }
  }

  private pushOutput(s: Structure, dt: number): void {
    const m = s.machine!;
    const first = m.out.findIndex((x) => x);
    if (first < 0) return;
    const t = (this.pushTimers.get(s.id) ?? 0) - dt;
    if (t > 0) {
      this.pushTimers.set(s.id, t);
      return;
    }
    this.pushTimers.set(s.id, MACHINE_PUSH_INTERVAL);
    const stack = m.out[first]!;
    const unit: ItemStack = stack.q === undefined ? { id: stack.id, n: 1 } : { id: stack.id, n: 1, q: stack.q };
    for (const [tx, ty] of this.frontTiles(s)) {
      const target = this.game.world.structAt(tx, ty);
      if (!target || target === s) continue;
      if (this.insert(target, s.rot, unit)) {
        stack.n -= 1;
        if (stack.n <= 0) m.out[first] = null;
        return;
      }
    }
  }

  /** Tiles just in front of a structure's front face. */
  private frontTiles(s: Structure): [number, number][] {
    const d = s.rot;
    const out: [number, number][] = [];
    if (d === 0) for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y - 1]);
    else if (d === 2) for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y + s.h]);
    else if (d === 1) for (let y = s.y; y < s.y + s.h; y++) out.push([s.x + s.w, y]);
    else for (let y = s.y; y < s.y + s.h; y++) out.push([s.x - 1, y]);
    return out;
  }

  // ——— Hoppers ———

  private stepHopper(s: Structure, dt: number): void {
    s.timer = (s.timer ?? 0) - dt;
    if (s.timer > 0) return;
    s.timer = HOPPER_INTERVAL;
    const w = this.game.world;
    const store = s.store!;
    // Pull from behind.
    const back = opposite(s.rot);
    const src = w.structAt(s.x + DX[back], s.y + DY[back]);
    if (src && src !== s) {
      const from = src.machine ? src.machine.out : src.store && !src.def.shop && !src.def.only ? src.store : null;
      if (from) {
        const k = from.findIndex((x) => x && roomFor(store, { ...x, n: 1 }) > 0);
        if (k >= 0) {
          const x = from[k]!;
          addStack(store, x.q === undefined ? { id: x.id, n: 1 } : { id: x.id, n: 1, q: x.q });
          x.n -= 1;
          if (x.n <= 0) {
            from[k] = null;
            if (!src.machine) this.fillChanged(src);
          }
        }
      }
    }
    // Push forward.
    const k = store.findIndex((x) => x);
    if (k < 0) return;
    const target = w.structAt(s.x + DX[s.rot], s.y + DY[s.rot]);
    if (!target || target === s) return;
    const x = store[k]!;
    const unit: ItemStack = x.q === undefined ? { id: x.id, n: 1 } : { id: x.id, n: 1, q: x.q };
    if (this.insert(target, s.rot, unit)) {
      x.n -= 1;
      if (x.n <= 0) store[k] = null;
    }
  }

  // ——— Player controls ———

  machineUi(p: Player, s: Structure): MachineUi {
    const m = s.machine;
    const recipes = s.def.machine ? this.recipesFor(s).map((r) => r.id) : [];
    const rpm = s.def.machine?.powered ? (s.speed ?? 0) : s.type === 'steam_engine' ? (s.spin?.[0] ?? 0) : 0;
    const fluid = s.def.fluid ? this.game.fluids.machineInfo(s) : {};
    return {
      kind: 'machine',
      id: s.id,
      type: s.type,
      title: s.def.name,
      in: s.def.fluid || s.def.drill ? [] : (m?.in ?? []),
      fuel: m?.fuel ?? undefined,
      out: s.def.fluid && s.def.fluid.role !== 'refinery' ? [] : (m?.out ?? []),
      progress: Math.round((m?.progress ?? 0) * 100) / 100,
      status: m?.status ?? (s.filter ? `Passing ${ITEM_BY_ID.get(s.filter)?.name ?? s.filter}` : 'Set a filter item'),
      rpm: Math.round(rpm * 10) / 10,
      mode: m?.mode,
      oc: m && !s.def.fluid ? m.oc : undefined,
      condition: m && !s.def.fluid ? Math.round((1 - m.wear) * 100) / 100 : undefined,
      perMin: m && !s.def.fluid ? this.perMinute(m) : undefined,
      modes: s.def.machine?.modes,
      filter: s.def.logistics === 'filter' ? (s.filter ?? null) : undefined,
      fuelLeft: m?.fuel ? Math.round(m.burn * 10) / 10 : undefined,
      net: this.netSummary(s.net),
      recipes,
      ...fluid,
      ...(s.def.electric ? { grid: this.game.power.gridAt(s) ?? null } : {}),
    };
  }

  configure(p: Player, msg: Extract<ClientMessage, { t: 'machine' }>): void {
    const s = this.game.world.structures.get(msg.id);
    if (!s || !this.game.building.canUse(p, s)) return;
    if (Math.hypot(s.x + 0.5 - p.x, s.y + 0.5 - p.y) > 4) return;
    if (msg.op === 'mode' && s.machine && s.def.machine?.modes?.includes(msg.mode)) {
      s.machine.mode = msg.mode;
      s.machine.recipe = null;
      s.machine.progress = 0;
      this.game.structVisual(s);
    } else if (msg.op === 'oc' && s.machine && Number.isInteger(msg.level) && OVERCLOCK[msg.level]) {
      s.machine.oc = msg.level;
      this.powerDirty = true;
    } else if (msg.op === 'repair' && s.machine) {
      // Lubricant repairs and keeps the machine from wearing for a day; an iron gear just repairs.
      const lube = p.slots.findIndex((x) => x?.id === 'lubricant');
      const gear = p.slots.findIndex((x) => x?.id === 'iron_gear');
      if (s.machine.wear < 0.01 && lube < 0) return;
      const slot = lube >= 0 ? lube : gear;
      if (slot < 0) {
        this.game.notice(p, 'Repairs need an Iron Gear (or Lubricant).', 'bad');
        return;
      }
      const g = p.slots[slot]!;
      g.n -= 1;
      if (g.n <= 0) p.slots[slot] = null;
      p.invDirty = true;
      s.machine.wear = 0;
      if (lube >= 0) s.machine.lube = this.game.minutes + 1440;
      this.game.notice(p, lube >= 0 ? `${s.def.name} oiled: no wear for a day.` : `${s.def.name} repaired.`, 'good');
    } else if (msg.op === 'filter' && s.def.logistics === 'filter') {
      s.filter = msg.item && ITEM_BY_ID.has(msg.item) ? msg.item : null;
      this.game.structVisual(s);
    }
    this.game.playerSystem.refreshUi(p, true);
  }

  crank(p: Player, id: number, on: boolean): void {
    const s = this.game.world.structures.get(id);
    if (!s || s.type !== 'hand_crank') return;
    if (on) {
      if (Math.hypot(s.x + 0.5 - p.x, s.y + 0.5 - p.y) > 2.6 || p.move.stamina < 5) return;
      if (s.crank && s.crank.player !== p.id) return;
      if (!this.game.building.canUse(p, s)) return;
      const was = !!s.crank;
      s.crank = { player: p.id, until: Date.now() + 1500 };
      p.crankId = s.id;
      if (!was) {
        this.powerDirty = true;
        this.game.structVisual(s);
        this.game.progression.onCrank(p);
      }
    } else if (s.crank?.player === p.id) {
      s.crank = undefined;
      p.crankId = 0;
      this.powerDirty = true;
      this.game.structVisual(s);
    }
  }

  // ——— Statistics (§59) ———

  private perMinute(m: MachineState): number {
    const cutoff = Date.now() - 60_000;
    let n = 0;
    for (const [t, , k] of m.made) if (t >= cutoff) n += k;
    return n;
  }

  /** Overview of everything a player (or their company) owns that produces. */
  stats(p: Player): FactoryStats {
    const cutoff = Date.now() - 60_000;
    const mine = (s: Structure) => !!s.owner && (s.owner === p.accountId || this.game.companies.sameCompany(p.accountId, s.owner));
    const groups = new Map<string, { count: number; util: number; made: Map<string, number>; issues: Map<string, number> }>();
    const nets = new Set<number>();
    const hints: string[] = [];
    let valuePerMin = 0;
    for (const s of this.game.world.structures.values()) {
      if (!mine(s)) continue;
      if (s.net !== undefined) nets.add(s.net);
      const m = s.machine;
      if (!m) continue;
      let g = groups.get(s.type);
      if (!g) groups.set(s.type, (g = { count: 0, util: 0, made: new Map(), issues: new Map() }));
      g.count++;
      g.util += m.util;
      for (const [t, item, n] of m.made) {
        if (t < cutoff) continue;
        g.made.set(item, (g.made.get(item) ?? 0) + n);
        valuePerMin += (ITEM_BY_ID.get(item)?.value ?? 0) * n;
      }
      if (m.status !== 'Working' && m.status !== 'Running') g.issues.set(m.status, (g.issues.get(m.status) ?? 0) + 1);
      if (m.wear > 0.5) g.issues.set('Worn (repair it)', (g.issues.get('Worn (repair it)') ?? 0) + 1);
    }
    for (const [type, g] of groups) {
      const name = STRUCTURE_BY_ID.get(type)?.name ?? type;
      const full = g.issues.get('Output full') ?? 0;
      const idle = (g.issues.get('Idle') ?? 0) + (g.issues.get('Wrong input') ?? 0);
      if (full > 0)
        hints.push(
          `${full} ${name}${full > 1 ? 's are' : ' is'} backed up — take the output away faster (a conveyor, hopper or crate in front).`,
        );
      if (idle > 0 && g.util / g.count < 0.5)
        hints.push(`${name}: starved for input — feed ${idle > 1 ? 'them' : 'it'} more, or you have more machines than supply.`);
      if (g.issues.get('No fuel')) hints.push(`${name}: out of fuel.`);
      if (g.issues.get('No power')) hints.push(`${name}: not connected to power.`);
      if (g.issues.get('No steam') || g.issues.get('Pipe it to a boiler'))
        hints.push(`${name}: short of steam — a fired boiler makes enough for two engines.`);
      if (g.issues.get('No water')) hints.push(`${name}: no water — pump it in (a pump makes enough for one boiler).`);
    }
    const summaries = [...nets].map((id) => this.netSummary(id)).filter((n): n is NonNullable<typeof n> => !!n);
    for (const n of summaries) {
      if (n.stalled)
        hints.push(
          `A power network is overloaded (${n.load.toFixed(0)} / ${n.cap.toFixed(0)} stress): add a source, gear machines down, or remove one.`,
        );
      else if (n.cap > 0 && n.load / n.cap < 0.35)
        hints.push(`A power network is only ${Math.round((n.load / n.cap) * 100)}% loaded — room for more machines.`);
    }
    return {
      machines: [...groups].map(([type, g]) => ({
        type,
        count: g.count,
        util: Math.round((g.util / g.count) * 100) / 100,
        perMin: [...g.made],
        value: Math.round([...g.made].reduce((v, [item, n]) => v + (ITEM_BY_ID.get(item)?.value ?? 0) * n, 0) * 10) / 10,
        issues: [...g.issues],
      })),
      networks: summaries,
      valuePerMin: Math.round(valuePerMin * 10) / 10,
      hints,
    };
  }

  // ——— Persistence ———

  saveStructure(s: Structure): StructureSave {
    const data: Record<string, unknown> = {};
    if (s.store) data.store = s.store;
    if (s.machine) {
      const m = s.machine;
      data.machine = {
        in: m.in,
        fuel: m.fuel,
        out: m.out,
        progress: m.progress,
        burn: m.burn,
        acc: m.acc,
        mode: m.mode,
        outputs: m.outputs,
        oc: m.oc,
        wear: m.wear,
      };
    }
    if (s.items?.length) data.items = s.items.map((it) => ({ item: it.item, q: it.q, p: it.p, entry: it.entry, exit: it.exit }));
    if (s.filter) data.filter = s.filter;
    if (s.open) data.open = true;
    if (s.members?.length) data.members = s.members;
    if (s.prices?.length) data.prices = s.prices;
    if (s.crop) data.crop = s.crop;
    if (s.rpm) data.rpm = s.rpm;
    if (s.fluid?.kind && s.fluid.amount > 0) data.fluid = s.fluid;
    if (s.sw !== undefined) data.sw = s.sw;
    if (s.town) data.town = true;
    if (s.raised !== undefined) data.raised = s.raised;
    if (s.node !== undefined) data.node = s.node;
    if (s.guard) data.guard = { until: s.guard.until, hp: s.guard.hp, back: s.guard.back };
    if (s.rmode) data.rmode = s.rmode;
    if (s.buf && (s.buf.water > 0 || s.buf.steam > 0)) data.buf = s.buf;
    return {
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      rot: s.rot,
      owner: s.owner,
      ownerName: s.ownerName,
      hp: s.hp,
      data: Object.keys(data).length ? data : undefined,
    };
  }

  loadStructure(save: StructureSave): void {
    if (!STRUCTURE_BY_ID.has(save.type)) return;
    const w = this.game.world;
    const s = w.makeStructure(save.id, save.type, save.x, save.y, save.rot, save.owner, save.ownerName);
    s.hp = save.hp;
    this.initStructure(s);
    const d = (save.data ?? {}) as Record<string, never>;
    if (d.store && s.store) s.store = fitSlots(d.store, s.store.length);
    if (d.machine && s.machine) {
      const m = d.machine as Partial<MachineState>;
      s.machine.in = fitSlots(m.in ?? [], s.machine.in.length);
      if (s.machine.fuel) s.machine.fuel = fitSlots(m.fuel ?? [], 1);
      s.machine.out = fitSlots(m.out ?? [], 2);
      s.machine.progress = m.progress ?? 0;
      s.machine.burn = m.burn ?? 0;
      s.machine.acc = m.acc ?? {};
      s.machine.mode = m.mode ?? s.machine.mode;
      s.machine.outputs = m.outputs ?? 0;
      s.machine.oc = m.oc ?? 0;
      s.machine.wear = m.wear ?? 0;
    }
    if (d.items && s.items) {
      for (const it of d.items as { item: string; q?: number; p: number; entry: number; exit: number }[]) {
        if (!ITEM_BY_ID.has(it.item)) continue;
        s.items.push({
          id: this.game.nextItemId++,
          item: it.item,
          q: it.q,
          p: it.p,
          entry: it.entry,
          exit: it.exit,
          sentV: -1,
          v: 0,
          dirty: true,
        });
      }
    }
    if (d.filter) s.filter = d.filter;
    if (d.open) s.open = true;
    if (d.members) s.members = d.members;
    if (d.prices) s.prices = d.prices;
    if (d.crop) s.crop = d.crop;
    if (d.rpm) s.rpm = d.rpm;
    if (d.fluid) s.fluid = d.fluid;
    if (d.sw !== undefined) s.sw = d.sw;
    if (d.town) s.town = true;
    if (d.raised !== undefined) s.raised = d.raised;
    if (d.node !== undefined) s.node = d.node;
    if (d.guard) {
      const g = d.guard as { until?: number; hp?: number; back?: number };
      if (typeof g.until === 'number') s.guard = { until: g.until, hp: g.hp ?? 1, entity: 0, back: g.back ?? 0 };
    }
    if (d.rmode) s.rmode = d.rmode;
    if (d.buf) s.buf = d.buf;
    w.addStructure(s);
    if (s.crop) this.game.farming.track(s);
    this.game.nextStructId = Math.max(this.game.nextStructId, s.id + 1);
  }

  /** Belt tile speed for tests and tools. */
  tickSeconds(): number {
    return TICK_DT;
  }

  /** Direction a structure outputs to (for tools). */
  outputDir(s: Structure): number {
    return rotateDir(0, s.rot);
  }
}

function sameSpin(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}

function fitSlots(saved: Slots, n: number): Slots {
  const out: Slots = Array.from({ length: n }, () => null);
  let k = 0;
  for (const s of saved) {
    if (!s || !ITEM_BY_ID.has(s.id)) continue;
    if (k < n) out[k++] = s;
  }
  return out;
}
