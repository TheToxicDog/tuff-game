// What each client sees: chunks of nodes and structures around the player, entities within view
// (snapshots every tick), events, and pushed changes (nodes, structures, power, conveyor items).

import {
  CHUNK,
  ENTITY_VIEW,
  EntityFlags,
  InputFlags,
  VIEW_CHUNKS,
  type BeltKeyframe,
  type EntitySpawn,
  type EntityTuple,
  type GameEvent,
  type NetSummary,
  type NodeTuple,
  type Snapshot,
  type StructSpawn,
  type StructVisual,
} from '@ironwild/shared';
import type { Entity } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import type { ClientSession } from './session';
import { chunkKey, type ResourceNode, type Structure } from './world';

const MAX_BACKLOG = 512 * 1024;
const q100 = (v: number) => Math.round(v * 100);

export class Replication {
  /** Per session: entity id → spawn signature, to resend when appearance changes. */
  private readonly signatures = new WeakMap<ClientSession, Map<number, string>>();
  /** Per session: last tuple sent per entity; unchanged entities are left out of snapshots. */
  private readonly lastTuples = new WeakMap<ClientSession, Map<number, EntityTuple>>();

  constructor(private readonly game: Game) {}

  step(): void {
    for (const session of this.game.sessions) {
      const p = session.player;
      if (!p || !session.connected) continue;
      this.updateChunks(session, p);
      if (session.backlog > MAX_BACKLOG && this.game.tick % 10 !== 0) continue;
      session.send(this.snapshot(session, p));
    }
  }

  // ——— Chunks ———

  private updateChunks(session: ClientSession, p: Player): void {
    if (this.game.tick % 5 !== 0 && session.chunks.size > 0) return;
    const w = this.game.world;
    const max = Math.ceil(w.size / CHUNK) - 1;
    const pcx = Math.floor(p.x / CHUNK);
    const pcy = Math.floor(p.y / CHUNK);
    const want = new Set<number>();
    for (let cy = Math.max(0, pcy - VIEW_CHUNKS); cy <= Math.min(max, pcy + VIEW_CHUNKS); cy++) {
      for (let cx = Math.max(0, pcx - VIEW_CHUNKS); cx <= Math.min(max, pcx + VIEW_CHUNKS); cx++) want.add(chunkKey(cx, cy));
    }
    for (const key of session.chunks) {
      // Keep a margin before dropping chunks, so walking along a border doesn't thrash.
      const cx = key % 1024;
      const cy = Math.floor(key / 1024);
      if (Math.abs(cx - pcx) > VIEW_CHUNKS + 1 || Math.abs(cy - pcy) > VIEW_CHUNKS + 1) {
        session.chunks.delete(key);
        session.send({ t: 'unchunk', cx, cy });
      }
    }
    for (const key of want) {
      if (session.chunks.has(key)) continue;
      session.chunks.add(key);
      this.sendChunk(session, key);
    }
  }

  private sendChunk(session: ClientSession, key: number): void {
    const w = this.game.world;
    const cx = key % 1024;
    const cy = Math.floor(key / 1024);
    const nodes: NodeTuple[] = [];
    for (const n of w.nodesByChunk.get(key) ?? []) {
      if (n.gone) continue;
      nodes.push([n.id, n.type, q100(n.x), q100(n.y), w.nodeState(n)]);
    }
    const structs: StructSpawn[] = [];
    const belts: BeltKeyframe[] = [];
    for (const id of w.structsByChunk.get(key) ?? []) {
      const s = w.structures.get(id);
      if (!s) continue;
      structs.push(this.structSpawn(s));
      if (s.items?.length) belts.push(...this.game.factory.beltState(s));
    }
    session.send({ t: 'chunk', cx, cy, n: nodes, st: structs });
    if (belts.length) session.send({ t: 'belt', k: belts });
  }

  structSpawn(s: Structure): StructSpawn {
    const spawn: StructSpawn = { id: s.id, type: s.type, x: s.x, y: s.y, r: s.rot };
    if (s.owner) spawn.owner = s.ownerName;
    const st = this.visual(s);
    if (st) spawn.st = st;
    if (s.spin) spawn.k = s.spin;
    if (s.net !== undefined) spawn.n = s.net;
    return spawn;
  }

  visual(s: Structure): StructVisual | undefined {
    const v: StructVisual = {};
    if (s.machine) {
      v.on = s.machine.active;
      if (s.machine.mode) v.mode = s.machine.mode;
      if (s.machine.active && s.machine.recipe) {
        const first = s.machine.in.find((x) => x);
        if (first) v.item = first.id;
      }
    }
    if (s.crank) v.crank = true;
    if (s.hp < s.def.hp) v.hp = Math.max(1, Math.round((s.hp / s.def.hp) * 100));
    if (s.def.rail === 'station') v.mode = s.rmode ?? 'load';
    if (s.sw !== undefined) v.sw = s.sw;
    if (s.def.door) v.open = !!s.open;
    if (s.filter) v.filter = s.filter;
    if (s.store && (s.def.shipping || s.def.container)) {
      const used = s.store.filter((x) => x).length;
      v.fill = Math.round((used / s.store.length) * 100) / 100;
    }
    if (s.crop) {
      v.crop = s.crop.id;
      v.stage = this.game.farming.stage(s);
    }
    if (s.def.shop && s.prices?.length) {
      const first = s.prices[0];
      v.label = first.item;
    }
    return Object.keys(v).length ? v : undefined;
  }

  private sessionsWithChunk(chunk: number): ClientSession[] {
    const out: ClientSession[] = [];
    for (const s of this.game.sessions) if (s.player && s.chunks.has(chunk)) out.push(s);
    return out;
  }

  nodeChanged(n: ResourceNode): void {
    const json = JSON.stringify({ t: 'node', id: n.id, a: n.gone ? -1 : this.game.world.nodeState(n) });
    for (const s of this.sessionsWithChunk(n.chunk)) s.sendRaw(json);
  }

  structAdded(st: Structure): void {
    const json = JSON.stringify({ t: 'sa', s: [this.structSpawn(st)] });
    for (const s of this.sessionsWithChunk(st.chunk)) s.sendRaw(json);
  }

  structRemoved(st: Structure): void {
    const json = JSON.stringify({ t: 'sr', ids: [st.id] });
    for (const s of this.sessionsWithChunk(st.chunk)) s.sendRaw(json);
  }

  structVisual(st: Structure): void {
    const json = JSON.stringify({ t: 'su', s: [{ id: st.id, st: this.visual(st) ?? {} }] });
    for (const s of this.sessionsWithChunk(st.chunk)) s.sendRaw(json);
  }

  kineticChanged(changed: Structure[], nets: NetSummary[]): void {
    for (const session of this.game.sessions) {
      if (!session.player) continue;
      const mine = changed.filter((s) => session.chunks.has(s.chunk));
      session.send({
        t: 'kin',
        s: mine.map((s) => [s.id, ...(s.spin ?? [0])] as [number, ...number[]]),
        nets,
        of: mine.filter((s) => s.net !== undefined).map((s) => [s.id, s.net!] as [number, number]),
      });
    }
  }

  beltKeyframes(list: { chunk: number; kf: BeltKeyframe }[]): void {
    for (const session of this.game.sessions) {
      if (!session.player) continue;
      const mine = list.filter((k) => session.chunks.has(k.chunk)).map((k) => k.kf);
      if (mine.length) session.send({ t: 'belt', k: mine });
    }
  }

  tileChanged(x: number, y: number, t: number): void {
    const json = JSON.stringify({ t: 'tiles', c: [[x, y, t]] });
    for (const s of this.game.sessions) if (s.player) s.sendRaw(json);
  }

  // ——— Entities ———

  private snapshot(session: ClientSession, p: Player): Snapshot {
    let sigs = this.signatures.get(session);
    if (!sigs) this.signatures.set(session, (sigs = new Map()));
    let last = this.lastTuples.get(session);
    if (!last) this.lastTuples.set(session, (last = new Map()));
    const e: EntityTuple[] = [];
    const push = (t: EntityTuple) => {
      const prev = last.get(t[0]);
      if (prev && prev[1] === t[1] && prev[2] === t[2] && prev[3] === t[3] && prev[4] === t[4] && prev[5] === t[5]) return;
      last.set(t[0], t);
      e.push(t);
    };
    const sp: EntitySpawn[] = [];
    const seen = new Set<number>();
    const view = (x: number, y: number) => Math.abs(x - p.x) <= ENTITY_VIEW && Math.abs(y - p.y) <= ENTITY_VIEW;

    for (const other of this.game.players.values()) {
      if (other.dead && other !== p) continue;
      if (!view(other.x, other.y)) continue;
      seen.add(other.id);
      if (this.track(session, sigs, sp, this.playerSpawn(other))) last.delete(other.id);
      push([other.id, q100(other.x), q100(other.y), q100(other.angle), other.healthPct(), this.playerFlags(other)]);
    }
    for (const ent of this.game.entities.values()) {
      if (!view(ent.x, ent.y)) continue;
      if (ent.kind === 'creature' && ent.rider) continue;
      seen.add(ent.id);
      if (this.track(session, sigs, sp, this.entitySpawn(ent))) last.delete(ent.id);
      push(this.entityTuple(ent));
    }
    const d: number[] = [];
    for (const id of session.known) {
      if (!seen.has(id)) {
        d.push(id);
        session.known.delete(id);
        sigs.delete(id);
        last.delete(id);
      }
    }
    const ev: GameEvent[] = [];
    for (const pe of this.game.events) {
      if (pe.only !== undefined && pe.only !== p.id) continue;
      if (pe.except === p.id) continue;
      if (Math.abs(pe.x - p.x) > pe.r || Math.abs(pe.y - p.y) > pe.r) continue;
      ev.push(pe.ev);
    }
    const snap: Snapshot = { t: 's', k: this.game.tick, tm: Math.round(this.game.minutes * 10) / 10, e };
    if (!p.dead) {
      const m = p.move;
      const r = (v: number) => Math.round(v * 10000) / 10000;
      snap.me = {
        q: p.lastSeq,
        x: m.x,
        y: m.y,
        vx: m.vx,
        vy: m.vy,
        st: r(m.stamina),
        sd: r(m.staminaDelay),
        dt: r(m.dodgeT),
        dx: m.dodgeX,
        dy: m.dodgeY,
        dc: r(m.dodgeCd),
        sm: p.mods.speed,
        sr: p.mods.staminaRegen,
      };
    }
    if (sp.length) snap.sp = sp;
    if (d.length) snap.d = d;
    if (ev.length) snap.ev = ev;
    return snap;
  }

  /** Sends the spawn record for new entities and changed appearances; true if sent. */
  private track(session: ClientSession, sigs: Map<number, string>, out: EntitySpawn[], spawn: EntitySpawn): boolean {
    const sig = `${spawn.held ?? ''}|${spawn.name ?? ''}|${spawn.n ?? ''}|${spawn.tag ?? ''}|${spawn.owner ?? ''}`;
    if (session.known.has(spawn.id) && sigs.get(spawn.id) === sig) return false;
    const isNew = !session.known.has(spawn.id);
    session.known.add(spawn.id);
    sigs.set(spawn.id, sig);
    out.push(spawn);
    return isNew;
  }

  private playerSpawn(p: Player): EntitySpawn {
    const held = p.slots[p.sel]?.id;
    const spawn: EntitySpawn = { id: p.id, k: 'player', name: p.name, look: p.look, x: p.x, y: p.y, a: p.angle };
    if (held) spawn.held = held;
    if (p.company) spawn.tag = this.game.companies.name(p.company);
    return spawn;
  }

  private playerFlags(p: Player): number {
    let f = 0;
    const tool = p.heldItem()?.tool;
    if (p.flags & InputFlags.Secondary && tool && ['sword', 'club', 'spear', 'axe'].includes(tool.kind)) f |= EntityFlags.Blocking;
    if (p.drawT > 0) f |= EntityFlags.Drawing;
    if (p.chargeT > 0.2) f |= EntityFlags.Charging;
    if (p.move.dodgeT > 0) f |= EntityFlags.Dodging;
    if (p.hurtT > 0) f |= EntityFlags.Hurt;
    if (p.mounted) f |= EntityFlags.Mounted;
    if (p.pulling) f |= EntityFlags.Pulling;
    if (p.crankId) f |= EntityFlags.Busy;
    if (p.dead) f |= EntityFlags.Sleeping;
    return f;
  }

  private entitySpawn(e: Entity): EntitySpawn {
    switch (e.kind) {
      case 'creature':
        return { id: e.id, k: 'creature', type: e.def.id, x: e.x, y: e.y, a: e.angle, ...(e.ownerName ? { owner: e.ownerName } : {}) };
      case 'drop':
        return { id: e.id, k: 'drop', type: e.stack.id, n: e.stack.n, x: e.x, y: e.y };
      case 'bag':
        return { id: e.id, k: 'bag', owner: e.ownerName, x: e.x, y: e.y };
      case 'arrow':
        return { id: e.id, k: 'arrow', x: e.x, y: e.y, a: e.angle };
      case 'cart':
        return { id: e.id, k: 'cart', type: e.type, n: e.slots.filter((x) => x).length, owner: e.ownerName, x: e.x, y: e.y, a: e.angle };
    }
  }

  private entityTuple(e: Entity): EntityTuple {
    let hp = 100;
    let flags = 0;
    let angle = 0;
    if (e.kind === 'creature') {
      hp = Math.round((e.hp / e.def.hp) * 100);
      angle = e.angle;
      if (e.hurtT > 1.2) flags |= EntityFlags.Hurt;
      if (e.windup > 0) flags |= EntityFlags.Busy;
      if (e.hasProduct) flags |= EntityFlags.Product;
    } else if (e.kind === 'arrow' || e.kind === 'cart') angle = e.angle;
    return [e.id, q100(e.x), q100(e.y), q100(angle), hp, flags];
  }
}
