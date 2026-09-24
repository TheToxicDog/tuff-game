// Fortification and construction (design plan §54–56, Phase 7).
//
// - Barricades: planks nailed across doors and windows. Each plank adds health that zombies have
//   to chew through before they reach the door or window itself; two or more block sight.
// - Construction: walls, doors, fences, gates, floors, storage crates, workbenches and fires,
//   placed from build mode. Structures are world deltas owned by the builder's account.
// - Furniture: movable furniture can be picked up (carried in your hands, heavy) and placed
//   somewhere else — for example in front of a door.
// - Permissions: owners (and survivors they /trust) may lock doors and storage, dismantle and pick
//   up their structures. Other players cannot damage structures unless griefing is enabled
//   (it follows the PvP setting by default).

import {
  BOARD_HP,
  checkMaterials,
  countItems,
  furnitureItemId,
  FURNITURE_STRUCTURE,
  hasToolTag,
  INTERACT_RANGE,
  MAX_BOARDS,
  placementProblem,
  snapPlacement,
  storageId,
  structureBounds,
  structureShape,
  type ItemStack,
  type StructureDef,
  type WorldAction,
} from '@tuff/shared';
import type { TrustRecord } from '../persistence/storage';
import { Body, Player, Transform, type PlayerComp, type TimedAction } from './components';
import type { Game } from './game';
import { newUid } from './loot';

const DEFAULT_MAX_STRUCTURES = 400;
const BARRICADE_PLANKS = 1;
const BARRICADE_NAILS = 2;

type Build = NonNullable<TimedAction['build']>;

export class BuildingSystem {
  readonly trust = new Map<string, TrustRecord>();

  constructor(private readonly game: Game) {}

  // =============================================================================================
  // Permissions

  /** Owners, survivors they trust and admins may manage a structure or storage. */
  canManage(accountId: string, owner: string | null | undefined, admin = false): boolean {
    if (!owner || owner === accountId || admin) return true;
    return this.trust.get(owner)?.accounts.includes(accountId) ?? false;
  }

  private get griefing(): boolean {
    return this.game.config.building?.griefing ?? this.game.config.pvp;
  }

  /** Whether an attacker may damage a structure. */
  canDamage(attacker: number, structureId: string): boolean {
    const s = this.game.world.compiled.structures.get(structureId);
    if (!s) return false;
    const p = this.game.ecs.get(attacker, Player);
    if (!p) return true; // Zombies always may.
    return this.griefing || this.canManage(p.accountId, s.def.owner);
  }

  setTrust(owner: string, record: TrustRecord | null): void {
    if (record && record.accounts.length > 0) this.trust.set(owner, record);
    else this.trust.delete(owner);
    this.game.world.changes.trust.set(owner, record && record.accounts.length > 0 ? record : null);
  }

  // =============================================================================================
  // Construction

  private floorAt(x: number, y: number): boolean {
    for (const s of this.game.world.compiled.structures.values()) {
      if (s.shape.kind !== 'floor' || Math.abs(s.x - x) > 2 || Math.abs(s.y - y) > 2) continue;
      const dx = x - s.x;
      const dy = y - s.y;
      const lx = dx * Math.cos(s.rot) + dy * Math.sin(s.rot);
      const ly = -dx * Math.sin(s.rot) + dy * Math.cos(s.rot);
      if (Math.abs(lx) < s.shape.w / 2 - 0.05 && Math.abs(ly) < s.shape.h / 2 - 0.05) return true;
    }
    return false;
  }

  private occupied(x: number, y: number, r: number): boolean {
    const game = this.game;
    for (const id of game.spatial.query(x, y, r + 1)) {
      const b = game.ecs.get(id, Body);
      const t = game.ecs.get(id, Transform);
      if (b && t && Math.hypot(t.x - x, t.y - y) < r + b.radius) return true;
    }
    return false;
  }

  private placementError(e: number, b: Build): string | null {
    const game = this.game;
    const t = game.ecs.get(e, Transform)!;
    return placementProblem(
      {
        content: game.content,
        collision: game.world.compiled.collision,
        mapWidth: game.map.width,
        mapHeight: game.map.height,
        occupied: (x, y, r) => this.occupied(x, y, r),
        floorAt: (x, y) => this.floorAt(x, y),
      },
      b.type,
      b.prop,
      b.x,
      b.y,
      b.rot,
      t,
    );
  }

  private furnitureStack(p: PlayerComp, prop: string | undefined): ItemStack | null {
    if (!prop) return null;
    const id = furnitureItemId(prop);
    return p.inventory.slots.find((s) => s?.id === id) ?? null;
  }

  /** Checks materials and tools for a build; returns an error or null. */
  private buildRequirements(p: PlayerComp, b: Build): string | null {
    const game = this.game;
    if (b.type === FURNITURE_STRUCTURE) return this.furnitureStack(p, b.prop) ? null : 'You are not carrying that.';
    const con = game.content.findConstruction(b.type);
    if (!con) return 'You cannot build that.';
    const check = checkMaterials(game.content, p.inventory, con.materials, con.tools);
    return check.ok ? null : check.problem;
  }

  beginBuild(e: number, p: PlayerComp, raw: { type: unknown; prop?: unknown; x: unknown; y: unknown; rot: unknown }): string | null {
    const game = this.game;
    if (p.action) return 'You are busy.';
    if (typeof raw.type !== 'string' || typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof raw.rot !== 'number') return null;
    const prop = typeof raw.prop === 'string' ? raw.prop : undefined;
    const shape = structureShape(game.content, raw.type, prop);
    if (!shape) return 'You cannot build that.';
    const snapped = snapPlacement(raw.x, raw.y, raw.rot);
    const b: Build = { type: raw.type, prop, ...snapped };
    const missing = this.buildRequirements(p, b);
    if (missing) return missing;
    const where = this.placementError(e, b);
    if (where) return where;
    const max = game.config.building?.maxPerPlayer ?? DEFAULT_MAX_STRUCTURES;
    let mine = 0;
    for (const s of game.world.structures.values()) if (s.owner === p.accountId) mine++;
    if (mine >= max) return `You have built the maximum of ${max} structures.`;
    const time = b.type === FURNITURE_STRUCTURE ? 1.5 : (game.content.findConstruction(b.type)?.time ?? 5);
    game.startAction(e, p, {
      kind: 'build',
      label: `${b.type === FURNITURE_STRUCTURE ? 'Placing' : 'Building'} ${shape.name}`,
      duration: time,
      target: '',
      build: b,
    });
    if (b.type !== FURNITURE_STRUCTURE) game.sound('hammer', e, 0.7);
    return null;
  }

  finishBuild(e: number, p: PlayerComp, b: Build): string | null {
    const game = this.game;
    const missing = this.buildRequirements(p, b);
    if (missing) return missing;
    const where = this.placementError(e, b);
    if (where) return where;
    if (b.type === FURNITURE_STRUCTURE) {
      const stack = this.furnitureStack(p, b.prop);
      if (!stack) return 'You are not carrying that.';
      game.inventory.consumeUnits(p, stack.uid, 1);
    } else {
      const con = game.content.findConstruction(b.type)!;
      if (!game.inventory.consumeMaterials(p, con.materials)) return 'You are missing materials.';
    }
    const def: StructureDef = {
      id: `s${newUid().toString(36)}`,
      type: b.type,
      ...(b.prop ? { prop: b.prop } : {}),
      x: b.x,
      y: b.y,
      rot: b.rot,
      owner: p.accountId,
      ownerName: p.name,
    };
    this.addStructure(def);
    const shape = structureShape(game.content, def.type, def.prop)!;
    const fire = shape.construction?.kind === 'fire' ? shape.construction : null;
    if (fire?.burnMinutes) {
      game.world.setObjectState(def.id, { until: game.minutes + fire.burnMinutes });
      game.broadcastObject(def.id);
      game.soundAt('fire', def.x, def.y, 0.6, e);
    } else {
      game.soundAt('hammer', def.x, def.y, 0.8, e);
    }
    game.noise.emit(def.x, def.y, b.type === FURNITURE_STRUCTURE ? 6 : 14, e);
    return null;
  }

  /** Adds a structure to the world and tells nearby clients. */
  addStructure(def: StructureDef): void {
    const game = this.game;
    if (!game.world.addStructure(def)) return;
    const shape = structureShape(game.content, def.type, def.prop)!;
    if (shape.container) game.world.setContainer(storageId(def.id), { items: [] });
    const b = structureBounds(def, shape);
    game.nav.invalidate(b.minX, b.minY, b.maxX, b.maxY);
    const json = JSON.stringify({ t: 'structure', structure: def });
    const keys = game.world.chunksOfStructure(def.id);
    for (const s of game.sessions) if (keys.some((k) => s.loadedChunks.has(k))) s.sendRaw(json);
  }

  /** Removes a structure; its storage spills onto the ground. */
  removeStructure(id: string): void {
    const game = this.game;
    const s = game.world.compiled.structures.get(id);
    if (!s) return;
    const box = game.world.containers.get(storageId(id));
    for (const stack of box?.items ?? []) {
      game.spawnGroundItem(s.x + game.rng.range(-0.5, 0.5), s.y + game.rng.range(-0.5, 0.5), stack);
    }
    for (const e of game.ecs.query(Player)) {
      const p = game.ecs.get(e, Player)!;
      if (p.openContainer === storageId(id)) {
        p.openContainer = null;
        p.link?.send({ t: 'container', container: null });
      }
      if (p.sleep?.spot === id) game.survival.wake(p, 'Your bed is gone.', 'warn');
    }
    const b = structureBounds(s, s.shape);
    const keys = game.world.removeStructure(id);
    game.nav.invalidate(b.minX, b.minY, b.maxX, b.maxY);
    const json = JSON.stringify({ t: 'unstructure', id });
    for (const session of game.sessions) if (keys.some((k) => session.loadedChunks.has(k))) session.sendRaw(json);
  }

  /** A structure took damage. Returns true when it was destroyed. */
  damageStructure(id: string, amount: number, source: number): boolean {
    const game = this.game;
    const s = game.world.compiled.structures.get(id);
    if (!s || s.shape.kind === 'floor') return false;
    const hp = game.world.compiled.effectiveState(id).hp - amount;
    if (hp <= 0) {
      game.soundAt('board_break', s.x, s.y, 1, source);
      game.noise.emit(s.x, s.y, 28, source);
      this.removeStructure(id);
      return true;
    }
    game.world.setObjectState(id, { hp });
    game.soundAt(s.shape.material === 'wood' ? 'door_bang' : 'board_break', s.x, s.y, 0.8, source);
    game.noise.emit(s.x, s.y, 16, source);
    game.broadcastObject(id);
    return false;
  }

  // =============================================================================================
  // World actions (hold E)

  /** Validates a world action and starts it as a timed action. */
  beginAction(e: number, p: PlayerComp, action: WorldAction, target: string): string | null {
    const game = this.game;
    if (p.action) return 'You are busy.';
    const problem = this.check(e, p, action, target, false);
    if (problem) return problem;
    // Instant actions.
    if (action === 'extinguish' || action === 'lockStorage') return this.finish(e, p, action, target);
    const labels: Record<WorldAction, [string, number]> = {
      barricade: ['Barricading', 3.5],
      unbarricade: ['Prying off a plank', 4],
      pickup: ['Picking up', 1.5],
      dismantle: ['Dismantling', 6],
      repair: ['Repairing', 4],
      refuel: ['Feeding the fire', 1.5],
      extinguish: ['', 0],
      lockStorage: ['', 0],
    };
    const [label, duration] = labels[action];
    game.startAction(e, p, { kind: 'work', label, duration, target, work: action });
    if (action === 'barricade' || action === 'repair' || action === 'dismantle' || action === 'unbarricade') {
      game.sound('hammer', e, 0.8);
      game.noise.emit(game.ecs.get(e, Transform)!.x, game.ecs.get(e, Transform)!.y, 12, e);
    }
    return null;
  }

  private near(e: number, x: number, y: number, extra: number): boolean {
    const t = this.game.ecs.get(e, Transform)!;
    return Math.hypot(x - t.x, y - t.y) <= INTERACT_RANGE + extra;
  }

  private admin(p: PlayerComp): boolean {
    return this.game.isAdmin(p);
  }

  /** Why an action cannot be done (null when it can). `finishing` re-checks at completion. */
  check(e: number, p: PlayerComp, action: WorldAction, target: string, finishing: boolean): string | null {
    const game = this.game;
    const compiled = game.world.compiled;
    const inv = p.inventory;
    const has = (tag: string) => hasToolTag(game.content, inv, tag);
    switch (action) {
      case 'barricade':
      case 'unbarricade': {
        const obj = compiled.doors.get(target) ?? compiled.windows.get(target);
        if (!obj) return 'You cannot barricade that.';
        if (!this.near(e, obj.x, obj.y, obj.w / 2)) return 'Too far away.';
        const s = compiled.effectiveState(target);
        if (action === 'barricade') {
          if (s.boards >= MAX_BOARDS) return 'It is already fully barricaded.';
          if (obj.kind === 'door' && s.open && !s.broken) return 'Close the door first.';
          if (!has('hammer')) return 'You need a hammer.';
          const planks = countItems(inv, (st) => st.id === 'plank');
          const nails = countItems(inv, (st) => st.id === 'nails');
          if (planks < BARRICADE_PLANKS || nails < BARRICADE_NAILS)
            return `You need ${BARRICADE_PLANKS} plank and ${BARRICADE_NAILS} nails.`;
          if (!finishing && game.doorwayBlocked(obj.x, obj.y, obj.w)) return 'Something is in the way.';
        } else {
          if (s.boards <= 0) return 'There is nothing to pry off.';
          if (!has('crowbar') && !has('hammer')) return 'You need a crowbar or a hammer.';
        }
        return null;
      }
      case 'pickup': {
        const mov = compiled.movables.get(target);
        const struct = compiled.structures.get(target);
        if (mov) {
          if (compiled.effectiveState(target).removed) return 'It is gone.';
          if (!this.near(e, mov.x, mov.y, mov.radius)) return 'Too far away.';
          if (compiled.containers.has(target)) {
            if (!compiled.effectiveState(target).searched) return 'Search it first.';
            if ((game.world.containers.get(target)?.items.length ?? 0) > 0) return 'Empty it first.';
          }
        } else if (struct && struct.def.type === FURNITURE_STRUCTURE) {
          if (!this.near(e, struct.x, struct.y, struct.radius)) return 'Too far away.';
          if (!this.canManage(p.accountId, struct.def.owner, this.admin(p))) return 'That belongs to someone else.';
          if ((game.world.containers.get(storageId(target))?.items.length ?? 0) > 0) return 'Empty it first.';
        } else return 'You cannot pick that up.';
        for (const other of game.ecs.query(Player)) {
          if (game.ecs.get(other, Player)!.sleep?.spot === target) return 'Someone is sleeping there.';
        }
        if (!inv.slots.some((s) => s === null)) return 'Your hands are full — free a quick slot first.';
        return null;
      }
      case 'dismantle':
      case 'repair': {
        const struct = compiled.structures.get(target);
        if (!struct || struct.def.type === FURNITURE_STRUCTURE)
          return action === 'repair' ? 'You cannot repair that.' : 'You cannot dismantle that.';
        if (!this.near(e, struct.x, struct.y, struct.radius)) return 'Too far away.';
        if (!has('hammer')) return 'You need a hammer.';
        if (action === 'dismantle') {
          if (!this.canManage(p.accountId, struct.def.owner, this.admin(p))) return 'That belongs to someone else.';
          if ((game.world.containers.get(storageId(target))?.items.length ?? 0) > 0) return 'Empty it first.';
        } else {
          if (compiled.effectiveState(target).hp >= struct.maxHp) return 'It is in good repair.';
          if (countItems(inv, (st) => st.id === 'plank') < 1 || countItems(inv, (st) => st.id === 'nails') < 2)
            return 'You need a plank and 2 nails.';
        }
        return null;
      }
      case 'refuel':
      case 'extinguish': {
        const struct = compiled.structures.get(target);
        const con = struct?.shape.construction;
        if (!struct || con?.kind !== 'fire') return 'That is not a fire.';
        if (!this.near(e, struct.x, struct.y, struct.radius)) return 'Too far away.';
        const lit = compiled.effectiveState(target).until > game.minutes;
        if (action === 'extinguish') return lit ? null : 'The fire is already out.';
        if (!countItems(inv, (st) => st.id === con.fuel))
          return `You need a ${game.content.findItem(con.fuel ?? '')?.name.toLowerCase() ?? 'fuel'}.`;
        if (!lit && !has('fire')) return 'You need a lighter or matches to light it.';
        return null;
      }
      case 'lockStorage': {
        const box = compiled.containers.get(target);
        if (!box?.owner) return 'That cannot be locked.';
        if (!this.near(e, box.x, box.y, box.radius)) return 'Too far away.';
        if (!this.canManage(p.accountId, box.owner, this.admin(p))) return 'That belongs to someone else.';
        return null;
      }
    }
    return 'Nothing happens.';
  }

  finish(e: number, p: PlayerComp, action: WorldAction, target: string): string | null {
    const game = this.game;
    const problem = this.check(e, p, action, target, true);
    if (problem) return problem;
    const compiled = game.world.compiled;
    switch (action) {
      case 'barricade': {
        const obj = (compiled.doors.get(target) ?? compiled.windows.get(target))!;
        if (
          !game.inventory.consumeMaterials(p, [
            { item: 'plank', qty: BARRICADE_PLANKS },
            { item: 'nails', qty: BARRICADE_NAILS },
          ])
        )
          return 'You are missing materials.';
        const s = compiled.effectiveState(target);
        game.world.setObjectState(target, {
          boards: s.boards + 1,
          boardHp: s.boardHp + BOARD_HP,
          ...(s.open && !s.broken ? { open: false } : {}),
        });
        game.broadcastObject(target);
        game.soundAt('hammer', obj.x, obj.y, 0.9, e);
        return s.boards + 1 >= MAX_BOARDS ? 'Fully barricaded.' : null;
      }
      case 'unbarricade': {
        const obj = (compiled.doors.get(target) ?? compiled.windows.get(target))!;
        const s = compiled.effectiveState(target);
        const boards = s.boards - 1;
        game.world.setObjectState(target, { boards, boardHp: Math.min(s.boardHp, boards * BOARD_HP) });
        game.broadcastObject(target);
        game.soundAt('board_break', obj.x, obj.y, 0.6, e);
        if (game.rng.chance(0.75)) game.inventory.giveItems(e, p, [{ item: 'plank', qty: 1 }]);
        else return 'The plank splits as it comes off.';
        return null;
      }
      case 'pickup': {
        const mov = compiled.movables.get(target);
        let propType: string;
        if (mov) {
          propType = mov.propType;
          game.world.setObjectState(target, { removed: true });
          game.broadcastObject(target);
          game.nav.invalidate(mov.x - mov.radius, mov.y - mov.radius, mov.x + mov.radius, mov.y + mov.radius);
          if (p.openContainer === target) p.openContainer = null;
        } else {
          const struct = compiled.structures.get(target)!;
          propType = struct.def.prop ?? '';
          this.removeStructure(target);
        }
        const def = game.content.findItem(furnitureItemId(propType));
        if (!def) return null;
        const stack: ItemStack = { uid: newUid(), id: def.id, qty: 1 };
        const t = game.ecs.get(e, Transform)!;
        if (!game.inventory.autoPlace(p, stack)) game.spawnGroundItem(t.x, t.y, stack);
        return `You pick up the ${def.name.toLowerCase()}. Place it with build mode (B).`;
      }
      case 'dismantle': {
        const struct = compiled.structures.get(target)!;
        const con = struct.shape.construction;
        this.removeStructure(target);
        if (con) {
          game.inventory.giveItems(
            e,
            p,
            con.materials.map((m) => ({ item: m.item, qty: Math.max(m.item === 'nails' ? 0 : 1, Math.floor(m.qty / 2)) })),
          );
        }
        game.soundAt('board_break', struct.x, struct.y, 0.7, e);
        return `You take apart the ${struct.shape.name.toLowerCase()}.`;
      }
      case 'repair': {
        const struct = compiled.structures.get(target)!;
        if (
          !game.inventory.consumeMaterials(p, [
            { item: 'plank', qty: 1 },
            { item: 'nails', qty: 2 },
          ])
        )
          return 'You are missing materials.';
        const hp = Math.min(struct.maxHp, compiled.effectiveState(target).hp + struct.maxHp * 0.4);
        game.world.setObjectState(target, { hp });
        game.broadcastObject(target);
        return hp >= struct.maxHp ? 'Good as new.' : 'Patched up.';
      }
      case 'refuel': {
        const struct = compiled.structures.get(target)!;
        const con = struct.shape.construction!;
        if (!game.inventory.consumeMaterials(p, [{ item: con.fuel!, qty: 1 }])) return 'You have no fuel.';
        const until = compiled.effectiveState(target).until;
        const lit = until > game.minutes;
        game.world.setObjectState(target, { until: Math.max(until, game.minutes) + (con.burnMinutes ?? 240) });
        game.broadcastObject(target);
        game.soundAt('fire', struct.x, struct.y, 0.6, e);
        return lit ? 'The fire flares up.' : 'You light the fire.';
      }
      case 'extinguish': {
        const struct = compiled.structures.get(target)!;
        game.world.setObjectState(target, { until: 0 });
        game.broadcastObject(target);
        game.soundAt('sizzle', struct.x, struct.y, 0.5, e);
        return 'You put the fire out.';
      }
      case 'lockStorage': {
        const locked = !compiled.effectiveState(target).locked;
        game.world.setObjectState(target, { locked });
        game.broadcastObject(target);
        return locked ? 'Locked. Only you and survivors you trust can open it.' : 'Unlocked.';
      }
    }
    return null;
  }

  // =============================================================================================
  // Trust (chat commands)

  trustCommand(owner: { id: string; name: string }, cmd: string, args: string[]): string {
    const game = this.game;
    const record = this.trust.get(owner.id) ?? { accounts: [], names: [] };
    if (cmd === 'trusted') {
      return record.names.length > 0
        ? `You trust: ${record.names.join(', ')}. They can open your locked doors and storage and manage your structures.`
        : 'You do not trust anyone yet. /trust <name> shares your base with another survivor.';
    }
    const name = args.join(' ').trim().toLowerCase();
    if (!name) return `Usage: /${cmd} <player name>`;
    if (cmd === 'trust') {
      const target = [...game.sessions].find((s) => s.account?.displayName.toLowerCase() === name)?.account;
      if (!target) return `No survivor called "${args.join(' ')}" is online.`;
      if (target.id === owner.id) return 'You already trust yourself.';
      if (record.accounts.includes(target.id)) return `You already trust ${target.displayName}.`;
      this.setTrust(owner.id, { accounts: [...record.accounts, target.id], names: [...record.names, target.displayName] });
      for (const s of game.sessions) {
        if (s.account?.id === target.id)
          s.send({ t: 'chat', from: '', text: `${owner.name} now trusts you with their base.`, system: true });
      }
      return `You now trust ${target.displayName}. They can open your locked doors and storage.`;
    }
    const i = record.names.findIndex((n) => n.toLowerCase() === name);
    if (i < 0) return `You do not trust anyone called "${args.join(' ')}".`;
    const removed = record.names[i];
    this.setTrust(owner.id, {
      accounts: record.accounts.filter((_, j) => j !== i),
      names: record.names.filter((_, j) => j !== i),
    });
    return `You no longer trust ${removed}.`;
  }
}
