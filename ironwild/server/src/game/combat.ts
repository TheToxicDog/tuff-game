// Swinging tools and weapons (§40): gathering from resource nodes, hitting creatures and players,
// heavy (charged) attacks, bows and arrows. Also owns ground drops and death bags.

import {
  FIST,
  ITEM_BY_ID,
  InputFlags,
  PLAYER_RADIUS,
  TILES,
  TRUCK_TILES_PER_FUEL,
  addStack,
  angleDiff,
  roomFor,
  type ItemStack,
  type ToolStats,
} from '@ironwild/shared';
import type { EntitySave } from '../persistence/storage';
import { CART_ITEM, type Arrow, type Bag, type Cart, type Creature, type Drop } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import type { ResourceNode } from './world';

const HIT_DELAY_MS = 110;
const ARC = Math.PI / 3;
const HEAVY_CHARGE = 0.5;
const HEAVY_STAMINA = 14;
const WEAPONS = new Set(['sword', 'club', 'spear']);

export class CombatSystem {
  private readonly tooWeakNotice = new Map<number, number>();

  constructor(private readonly game: Game) {}

  /** Called for every processed input step. */
  playerActions(p: Player, dt: number, now: number): void {
    if (p.swingCd > 0) p.swingCd -= dt;
    if (p.eatCd > 0) p.eatCd -= dt;
    const held = p.heldItem();
    const tool = held?.tool ?? FIST;
    const primary = (p.flags & InputFlags.Primary) !== 0;
    const wasPrimary = (p.prevFlags & InputFlags.Primary) !== 0;
    const secondary = (p.flags & InputFlags.Secondary) !== 0;
    const wasSecondary = (p.prevFlags & InputFlags.Secondary) !== 0;
    if (p.mounted || p.driving) return;

    if (secondary && !wasSecondary && held?.food) this.game.playerSystem.eat(p, p.sel);
    if (held?.place) return;

    if (tool.kind === 'rod') {
      this.game.fishing.input(p);
      return;
    }
    if (tool.kind === 'bow') {
      if (primary) p.drawT += dt;
      else if (wasPrimary) {
        if (p.drawT >= 0.25) this.shoot(p, p.drawT);
        p.drawT = 0;
      }
      return;
    }
    if (WEAPONS.has(tool.kind)) {
      if (primary && !wasPrimary && p.swingCd <= 0) this.swing(p, tool, held?.id ?? null, false, now);
      if (primary) p.chargeT += dt;
      else if (wasPrimary) {
        if (p.chargeT >= HEAVY_CHARGE && p.swingCd <= 0.15 && p.move.stamina >= HEAVY_STAMINA) {
          p.move.stamina -= HEAVY_STAMINA;
          p.move.staminaDelay = 0.8;
          this.swing(p, tool, held?.id ?? null, true, now);
        }
        p.chargeT = 0;
      }
      return;
    }
    if (primary && p.swingCd <= 0) this.swing(p, tool, held?.id ?? null, false, now);
  }

  private swing(p: Player, tool: ToolStats, item: string | null, heavy: boolean, now: number): void {
    p.swingCd = (1 / tool.rate) * (heavy ? 1.3 : 1);
    p.pendingHits.push({ at: now + HIT_DELAY_MS, heavy, tool, item });
    this.game.emit(['sw', p.id, heavy ? 1 : 0], p.x, p.y, { except: p.id });
  }

  step(dt: number): void {
    const now = Date.now();
    for (const p of this.game.players.values()) {
      while (p.pendingHits.length > 0 && p.pendingHits[0].at <= now) {
        const hit = p.pendingHits.shift()!;
        if (!p.dead) this.resolveHit(p, hit.tool, hit.heavy, hit.item);
      }
    }
    if (this.game.tick % 2 === 0) this.autoPickup(now);
    for (const e of this.game.entities.values()) if (e.kind === 'arrow') this.stepArrow(e, dt);
  }

  private resolveHit(p: Player, tool: ToolStats, heavy: boolean, item: string | null): void {
    const reach = PLAYER_RADIUS + tool.reach;
    const inArc = (x: number, y: number, r: number): boolean => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d - r > reach) return false;
      const spread = ARC + Math.atan2(r, Math.max(d, 0.01));
      return Math.abs(angleDiff(Math.atan2(y - p.y, x - p.x), p.angle)) <= spread;
    };
    let damage = tool.damage * (heavy ? 2.1 : 1) * (p.buffs.has('strength') ? 1.25 : 1) * (1 + p.skill('combat') * 0.02);

    // Creatures and (with PvP) players.
    let hitSomething = false;
    let hits = 0;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'creature' || hits >= 3 || e.rider) continue;
      if (!inArc(e.x, e.y, e.def.radius)) continue;
      if (e.def.temperament === 'farm' && e.owner && e.owner !== p.accountId && !this.game.companies.sameCompany(p.accountId, e.owner))
        continue;
      const crit = Math.random() < 0.1;
      this.game.creatures.damage(e, damage * (crit ? 1.5 : 1), p, heavy ? 0.9 : 0.4, crit);
      hitSomething = true;
      hits++;
    }
    if (this.game.config.pvp) {
      for (const other of this.game.players.values()) {
        if (other === p || other.dead || hits >= 3) continue;
        if (!inArc(other.x, other.y, PLAYER_RADIUS)) continue;
        if (this.game.world.settlementAt(other.x, other.y) || this.game.world.settlementAt(p.x, p.y)) continue;
        if (p.company && other.company === p.company) continue;
        this.game.playerSystem.damage(other, damage * 0.6, p.name, p.x, p.y);
        hitSomething = true;
        hits++;
      }
    }
    if (hitSomething) {
      this.game.emit(['hit', Math.round(p.x * 100), Math.round(p.y * 100), 'flesh'], p.x, p.y);
      p.addXp('combat', 1);
      return;
    }

    // Hammer on a cart: pack it back up (once it's empty).
    if (tool.kind === 'hammer') {
      for (const e of this.game.entities.values()) {
        if (e.kind !== 'cart' || e.driver || !inArc(e.x, e.y, 0.6)) continue;
        if (e.owner && e.owner !== p.accountId && !this.game.companies.sameCompany(p.accountId, e.owner)) continue;
        if (e.slots.some((x) => x)) {
          this.game.notice(p, 'Empty it first.', 'bad');
          return;
        }
        if (e.puller) {
          const puller = this.game.players.get(e.puller);
          if (puller) this.game.playerSystem.releaseCart(puller);
        }
        this.game.removeEntity(e.id);
        this.game.playerSystem.give(p, { id: CART_ITEM[e.type], n: 1 }, true);
        // Whole fuel oils left in a truck's tank come back too.
        const fuel = Math.floor((e.fuel ?? 0) / TRUCK_TILES_PER_FUEL);
        if (fuel > 0) this.game.playerSystem.give(p, { id: 'fuel_oil', n: fuel }, true);
        this.game.emit(['sfx', 'pickup', Math.round(e.x * 100), Math.round(e.y * 100)], e.x, e.y, { r: 16 });
        return;
      }
    }
    // Hammer on a structure: pick it back up.
    if (tool.kind === 'hammer') {
      const tx = Math.floor(p.x + Math.cos(p.angle) * (PLAYER_RADIUS + 0.7));
      const ty = Math.floor(p.y + Math.sin(p.angle) * (PLAYER_RADIUS + 0.7));
      const s = this.game.world.structAt(tx, ty) ?? this.game.world.floorStructAt(tx, ty);
      if (s) {
        this.game.building.hammer(p, s);
        return;
      }
    }

    // Resource nodes: the closest one in the arc.
    let best: ResourceNode | null = null;
    let bestD = Infinity;
    for (const n of this.game.world.nodesNear(p.x, p.y, reach + 1)) {
      if (n.regrowAt > 0) continue;
      const r = n.def.solid ? n.def.radius + 0.3 : n.def.visual * 0.8;
      if (!inArc(n.x, n.y, r)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y) - r;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best) this.gather(p, best, tool);
    damage = 0;
  }

  gather(p: Player, node: ResourceNode, tool: ToolStats): void {
    const def = node.def;
    let power: number;
    if (def.tool === 'hand') power = 1;
    else if (tool.kind === def.tool && tool.tier >= def.tier) power = tool.power;
    else if (def.tier === 0 && (tool.kind === 'fist' || tool.kind !== def.tool)) power = 1;
    else {
      const last = this.tooWeakNotice.get(p.id) ?? 0;
      if (Date.now() - last > 3000) {
        this.tooWeakNotice.set(p.id, Date.now());
        const need = def.tier >= 3 ? 'steel' : def.tier >= 2 ? 'iron' : 'stone';
        this.game.notice(p, `You need at least a ${need} ${def.tool} for ${def.name}.`, 'bad');
      }
      this.game.emit(['nd', node.id, Math.round(Math.cos(p.angle) * 50), Math.round(Math.sin(p.angle) * 50)], node.x, node.y);
      return;
    }
    const skillName = def.skill;
    const bonus = 1 + p.skill(skillName) * 0.025;
    const gained: string[] = [];
    for (const drop of def.drops) {
      if (drop.chance !== undefined && Math.random() >= drop.chance) continue;
      const key = drop.item;
      const acc = (p.gatherAcc.get(key) ?? 0) + power * drop.rate * bonus;
      const whole = Math.floor(acc);
      p.gatherAcc.set(key, acc - whole);
      if (whole <= 0) continue;
      const stack = { id: drop.item, n: whole };
      const room = roomFor(p.slots, stack);
      if (room < whole) {
        if (room > 0) addStack(p.slots, { ...stack, n: room });
        this.game.notice(p, 'Your backpack is full. Sell or store something.', 'bad');
        if (room <= 0) continue;
      } else addStack(p.slots, stack);
      p.invDirty = true;
      this.game.progression.discover(p, drop.item);
      this.game.progression.onGather(p, drop.item, Math.min(room, whole));
      gained.push(`+${Math.min(room, whole)} ${ITEM_BY_ID.get(drop.item)?.name ?? drop.item}`);
    }
    p.addXp(skillName, 1);
    node.amount -= power;
    const material = def.tool === 'axe' ? 'wood' : def.tool === 'pickaxe' ? 'stone' : 'plant';
    this.game.emit(['nd', node.id, Math.round(Math.cos(p.angle) * 100), Math.round(Math.sin(p.angle) * 100)], node.x, node.y);
    this.game.emit(['hit', Math.round(node.x * 100), Math.round(node.y * 100), material], node.x, node.y);
    if (gained.length > 0)
      this.game.emit(['pop', Math.round(node.x * 100), Math.round(node.y * 100), gained.join('  '), 0xffffff], node.x, node.y, {
        only: p.id,
      });
    if (node.amount <= 0) {
      node.amount = 0;
      node.regrowAt = Date.now() + def.regrow * 1000 * (0.8 + Math.random() * 0.4);
    }
    this.game.nodeChanged(node);
  }

  // ——— Bows ———

  private shoot(p: Player, draw: number): void {
    const idx = p.slots.findIndex((s) => s?.id === 'arrow');
    if (idx < 0) {
      this.game.notice(p, 'You have no arrows.', 'bad');
      return;
    }
    const s = p.slots[idx]!;
    s.n -= 1;
    if (s.n <= 0) p.slots[idx] = null;
    p.invDirty = true;
    const power = Math.min(1, draw / 0.9);
    const speed = 14 + power * 10;
    const arrow: Arrow = {
      kind: 'arrow',
      id: this.game.newEntityId(),
      x: p.x + Math.cos(p.angle) * 0.6,
      y: p.y + Math.sin(p.angle) * 0.6,
      vx: Math.cos(p.angle) * speed,
      vy: Math.sin(p.angle) * speed,
      angle: p.angle,
      damage: 6 + 22 * power,
      owner: p.id,
      life: 1.4,
    };
    this.game.addEntity(arrow);
    this.game.emit(['sfx', 'bow', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { r: 20 });
  }

  private stepArrow(a: Arrow, dt: number): void {
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      a.x += (a.vx * dt) / steps;
      a.y += (a.vy * dt) / steps;
      const w = this.game.world;
      const tx = Math.floor(a.x);
      const ty = Math.floor(a.y);
      // Tower arrows fly over walls; only cliffs and houses stop them.
      const blocked = a.high
        ? !w.inside(tx, ty) || (!TILES[w.tile(tx, ty)].walk && !TILES[w.tile(tx, ty)].water)
        : w.solidAt(tx, ty) && !w.structAt(tx, ty)?.def.low;
      if (blocked) {
        this.game.removeEntity(a.id);
        return;
      }
      for (const e of this.game.entities.values()) {
        if (e.kind !== 'creature' || e.rider) continue;
        if (a.high && (e.def.temperament === 'farm' || e.def.temperament === 'passive')) continue;
        if (Math.hypot(e.x - a.x, e.y - a.y) < e.def.radius + 0.15) {
          const shooter = a.owner ? (this.game.players.get(a.owner) ?? null) : null;
          this.game.creatures.damage(e, a.damage, shooter, 0.3, false, a.x - a.vx, a.y - a.vy);
          this.game.removeEntity(a.id);
          return;
        }
      }
      if (this.game.config.pvp && a.owner) {
        for (const p of this.game.players.values()) {
          if (p.id === a.owner || p.dead) continue;
          if (Math.hypot(p.x - a.x, p.y - a.y) < PLAYER_RADIUS + 0.1 && !w.settlementAt(p.x, p.y)) {
            const shooter = this.game.players.get(a.owner);
            this.game.playerSystem.damage(p, a.damage * 0.6, shooter?.name ?? 'an arrow', a.x - a.vx, a.y - a.vy);
            this.game.removeEntity(a.id);
            return;
          }
        }
      }
    }
    a.life -= dt;
    if (a.life <= 0) {
      this.game.removeEntity(a.id);
      if (Math.random() < 0.5) this.game.playerSystem.spawnDrop(a.x, a.y, { id: 'arrow', n: 1 });
    }
  }

  // ——— Drops ———

  /** Walking over dropped items picks them up (after a short delay for things you dropped). */
  private autoPickup(now: number): void {
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'drop') continue;
      if (now + 10 * 60 * 1000 - e.expires < 1500) continue;
      for (const p of this.game.players.values()) {
        if (p.dead || Math.abs(p.x - e.x) > 1 || Math.abs(p.y - e.y) > 1) continue;
        if (Math.hypot(p.x - e.x, p.y - e.y) > 0.95) continue;
        const room = roomFor(p.slots, e.stack);
        if (room <= 0) continue;
        addStack(p.slots, { ...e.stack, n: Math.min(room, e.stack.n) });
        this.game.progression.discover(p, e.stack.id);
        const took = Math.min(room, e.stack.n);
        e.stack.n -= took;
        p.invDirty = true;
        this.game.emit(
          ['pop', Math.round(e.x * 100), Math.round(e.y * 100), `+${took} ${ITEM_BY_ID.get(e.stack.id)?.name ?? ''}`, 0xffffff],
          e.x,
          e.y,
          {
            only: p.id,
          },
        );
        if (e.stack.n <= 0) {
          this.game.removeEntity(e.id);
          break;
        }
      }
    }
  }

  expireEntities(): void {
    const now = Date.now();
    for (const e of this.game.entities.values()) {
      if ((e.kind === 'drop' || e.kind === 'bag') && e.expires < now) this.game.removeEntity(e.id);
    }
  }

  dropLoot(x: number, y: number, stacks: ItemStack[]): void {
    for (const s of stacks) if (s.n > 0) this.game.playerSystem.spawnDrop(x, y, s);
  }

  save(): EntitySave[] {
    const out: EntitySave[] = [];
    for (const e of this.game.entities.values()) {
      if (e.kind === 'bag')
        out.push({ kind: 'bag', x: e.x, y: e.y, owner: e.owner, ownerName: e.ownerName, slots: e.slots, expires: e.expires });
      else if (e.kind === 'drop') out.push({ kind: 'drop', x: e.x, y: e.y, slots: [e.stack], expires: e.expires });
      else if (e.kind === 'cart')
        out.push({
          kind: 'cart',
          x: e.x,
          y: e.y,
          owner: e.owner,
          ownerName: e.ownerName,
          slots: e.slots,
          type: e.type,
          ...(e.rail ? { data: { rail: e.rail } } : {}),
          ...(e.type === 'truck' ? { data: { fuel: e.fuel ?? 0 } } : {}),
        });
    }
    return out;
  }

  load(saved: EntitySave[]): void {
    for (const s of saved) {
      if (s.kind === 'bag') {
        const bag: Bag = {
          kind: 'bag',
          id: this.game.newEntityId(),
          x: s.x,
          y: s.y,
          slots: s.slots ?? [],
          owner: s.owner ?? null,
          ownerName: s.ownerName ?? 'someone',
          expires: s.expires ?? Date.now() + 60_000,
        };
        this.game.addEntity(bag);
      } else if (s.kind === 'drop' && s.slots?.[0]) {
        const drop: Drop = {
          kind: 'drop',
          id: this.game.newEntityId(),
          x: s.x,
          y: s.y,
          stack: s.slots[0],
          expires: s.expires ?? Date.now() + 60_000,
        };
        this.game.addEntity(drop);
      } else if (s.kind === 'cart') {
        const type = s.type === 'wagon' || s.type === 'minecart' || s.type === 'truck' ? s.type : 'hand';
        const cart: Cart = {
          kind: 'cart',
          type,
          id: this.game.newEntityId(),
          x: s.x,
          y: s.y,
          angle: 0,
          slots: s.slots ?? Array.from({ length: 24 }, () => null),
          owner: s.owner ?? null,
          ownerName: s.ownerName ?? 'someone',
          puller: 0,
        };
        const data = s.data as { rail?: Cart['rail']; fuel?: number } | undefined;
        if (data?.rail) cart.rail = { ...data.rail, atStation: false };
        if (type === 'truck') cart.fuel = typeof data?.fuel === 'number' && data.fuel > 0 ? data.fuel : 0;
        this.game.addEntity(cart);
      }
    }
  }

  creatureRadius(c: Creature): number {
    return c.def.radius;
  }
}
