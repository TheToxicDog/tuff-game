// Wildlife, bandits and farm animals (§41). Creatures only think when a player is nearby; the
// spawner keeps each region's populations topped up away from players. Hired guards (guards.ts)
// are creatures too; animals and raiders a guard goes for turn on it.

import { CREATURE_BY_ID, PLAYER_RADIUS, Region, TICK_RATE, TILES, Tile, resolveCollisions, type CollisionWorld } from '@ironwild/shared';
import type { EntitySave } from '../persistence/storage';
import type { Creature, Detour } from './entities';
import type { Game } from './game';
import type { Player } from './player';

interface ZoneSpec {
  key: string;
  creature: string;
  target: number;
  region?: number;
  /** Fixed spawn point (bandit camp). */
  at?: { x: number; y: number; r: number };
}

const ACTIVE_RANGE = 60;

const ZONES: ZoneSpec[] = [
  { key: 'meadow-rabbit', creature: 'rabbit', target: 14, region: Region.Meadows },
  { key: 'meadow-deer', creature: 'deer', target: 6, region: Region.Meadows },
  { key: 'meadow-boar', creature: 'boar', target: 5, region: Region.Meadows },
  { key: 'forest-deer', creature: 'deer', target: 10, region: Region.Forest },
  { key: 'forest-boar', creature: 'boar', target: 8, region: Region.Forest },
  { key: 'forest-wolf', creature: 'wolf', target: 14, region: Region.Forest },
  { key: 'highland-wolf', creature: 'wolf', target: 8, region: Region.Highlands },
  { key: 'highland-bear', creature: 'bear', target: 3, region: Region.Highlands },
  { key: 'highland-boar', creature: 'boar', target: 4, region: Region.Highlands },
  { key: 'mountain-bear', creature: 'bear', target: 5, region: Region.Mountains },
  { key: 'mountain-wolf', creature: 'wolf', target: 5, region: Region.Mountains },
  { key: 'plains-deer', creature: 'deer', target: 8, region: Region.Plains },
  { key: 'plains-rabbit', creature: 'rabbit', target: 10, region: Region.Plains },
  { key: 'plains-boar', creature: 'boar', target: 5, region: Region.Plains },
  { key: 'marsh-boar', creature: 'boar', target: 6, region: Region.Marsh },
];

export class CreatureSystem {
  private readonly zoneCount = new Map<string, number>();
  private readonly zones: ZoneSpec[] = [...ZONES];
  private readonly regionTiles = new Map<number, number[]>();
  private spawnTimer = 0;
  /** Collision for creatures: like players, but gates, fences and town plazas also block. */
  readonly collision: CollisionWorld;

  constructor(private readonly game: Game) {
    const w = game.world;
    this.collision = {
      size: w.size,
      solidAt: (tx, ty) => {
        if (w.solidAt(tx, ty)) return true;
        const t = w.tile(tx, ty);
        if (t === Tile.Plaza) return true;
        const s = w.structAt(tx, ty);
        return !!s?.def.gate;
      },
      circles: (x, y, range, out) => w.circles(x, y, range, out),
      speedAt: (tx, ty) => w.speedAt(tx, ty),
    };
  }

  init(): void {
    const w = this.game.world;
    for (let i = 0; i < w.tiles.length; i += 7) {
      const t = w.tiles[i];
      if (!TILES[t].walk || t === Tile.Road || t === Tile.Plaza || t === Tile.Water) continue;
      const r = w.regions[i];
      let list = this.regionTiles.get(r);
      if (!list) this.regionTiles.set(r, (list = []));
      list.push(i);
    }
    const camp = w.gen.landmarks.find((l) => l.kind === 'bandit_camp');
    if (camp) this.zones.push({ key: 'bandit-camp', creature: 'bandit', target: 5, at: { x: camp.x, y: camp.y, r: 6 } });
    const mine = w.gen.landmarks.find((l) => l.kind === 'mine');
    if (mine) this.zones.push({ key: 'mine-bandit', creature: 'bandit', target: 2, at: { x: mine.x, y: mine.y, r: 6 } });
    for (const z of this.zones) this.zoneCount.set(z.key, 0);
    for (const e of this.game.entities.values())
      if (e.kind === 'creature' && e.zone) this.zoneCount.set(e.zone, (this.zoneCount.get(e.zone) ?? 0) + 1);
    // Populate the world right away.
    for (let i = 0; i < 12; i++) this.spawnRound(true);
  }

  step(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 6;
      this.spawnRound(false);
    }
    const players = [...this.game.players.values()].filter((p) => !p.dead);
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'creature' || e.rider) continue;
      let near = false;
      for (const p of players) {
        if (Math.abs(p.x - e.x) < ACTIVE_RANGE && Math.abs(p.y - e.y) < ACTIVE_RANGE) {
          near = true;
          break;
        }
      }
      if (!near && e.def.temperament !== 'farm' && !e.raider && !e.guard) continue;
      this.think(e, dt, players);
    }
  }

  private spawnRound(initial: boolean): void {
    const w = this.game.world;
    for (const z of this.zones) {
      const count = this.zoneCount.get(z.key) ?? 0;
      if (count >= z.target) continue;
      const def = CREATURE_BY_ID.get(z.creature)!;
      let x = 0;
      let y = 0;
      let ok = false;
      for (let attempt = 0; attempt < 8 && !ok; attempt++) {
        if (z.at) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * z.at.r;
          x = z.at.x + Math.cos(a) * r;
          y = z.at.y + Math.sin(a) * r;
        } else {
          const tiles = this.regionTiles.get(z.region!);
          if (!tiles || tiles.length === 0) break;
          const i = tiles[Math.floor(Math.random() * tiles.length)];
          x = (i % w.size) + 0.5;
          y = Math.floor(i / w.size) + 0.5;
        }
        if (this.collision.solidAt(Math.floor(x), Math.floor(y))) continue;
        if (w.settlementAt(x, y, 14)) continue;
        if (!initial && [...this.game.players.values()].some((p) => Math.hypot(p.x - x, p.y - y) < 28)) continue;
        ok = true;
      }
      if (!ok) continue;
      const pack = def.pack ? def.pack[0] + Math.floor(Math.random() * (def.pack[1] - def.pack[0] + 1)) : 1;
      for (let k = 0; k < Math.min(pack, z.target - count); k++) {
        this.spawn(z.creature, x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, z.key);
      }
    }
  }

  spawn(type: string, x: number, y: number, zone: string): Creature {
    const def = CREATURE_BY_ID.get(type)!;
    const c: Creature = {
      kind: 'creature',
      id: this.game.newEntityId(),
      def,
      x,
      y,
      angle: Math.random() * Math.PI * 2,
      vx: 0,
      vy: 0,
      hp: def.hp,
      state: 'idle',
      target: 0,
      homeX: x,
      homeY: y,
      timer: Math.random() * 3,
      windup: 0,
      cooldown: 0,
      wx: x,
      wy: y,
      zone,
      aggro: 0,
      hurtT: 0,
      lastHitBy: 0,
    };
    resolveCollisions(c, def.radius, this.collision);
    this.game.addEntity(c);
    if (zone) this.zoneCount.set(zone, (this.zoneCount.get(zone) ?? 0) + 1);
    return c;
  }

  private think(c: Creature, dt: number, players: Player[]): void {
    const def = c.def;
    if (c.hurtT > 0) c.hurtT -= dt;
    if (c.cooldown > 0) c.cooldown -= dt;
    if (c.aggro > 0) c.aggro -= dt;
    c.timer -= dt;
    if (c.raider) {
      this.game.raids.think(c, dt, players);
      return;
    }
    if (c.guard) {
      this.game.guards.think(c, dt);
      return;
    }
    if (c.foe && this.fightBack(c, dt)) return;
    const w = this.game.world;

    // Nearest player that matters.
    let nearest: Player | null = null;
    let nearestD = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = p;
      }
    }
    const sight = def.sight * (def.nocturnal && this.game.night ? 1.6 : 1);
    let speed = 0;
    let tx = c.x;
    let ty = c.y;

    if (def.temperament === 'farm') {
      if (c.timer <= 0) {
        c.timer = 3 + Math.random() * 5;
        c.wx = c.homeX + (Math.random() - 0.5) * 8;
        c.wy = c.homeY + (Math.random() - 0.5) * 8;
      }
      tx = c.wx;
      ty = c.wy;
      speed = def.speed * 0.4;
      if (def.product && c.owner) {
        c.productIn = (c.productIn ?? def.product.every) - dt;
        if (c.productIn <= 0 && !c.hasProduct) c.hasProduct = true;
      }
    } else {
      const target = c.target ? this.game.players.get(c.target) : undefined;
      const hunting =
        def.temperament === 'aggressive' || (def.temperament === 'neutral' && c.aggro > 0 && target !== undefined && target === nearest);
      if (def.temperament === 'passive' || (def.temperament === 'neutral' && c.hp < def.hp * 0.25)) {
        if (nearest && (nearestD < sight * 0.7 || c.hurtT > 0)) {
          c.state = 'flee';
          tx = c.x + (c.x - nearest.x);
          ty = c.y + (c.y - nearest.y);
          speed = def.speed;
        }
      } else if (hunting && nearest && (nearestD < sight || (c.aggro > 0 && nearestD < sight * 2))) {
        const t = c.aggro > 0 && target && !target.dead ? target : nearest;
        if (!w.settlementAt(t.x, t.y, 2) && Math.hypot(c.x - c.homeX, c.y - c.homeY) < 45) {
          c.state = 'chase';
          c.target = t.id;
          tx = t.x;
          ty = t.y;
          speed = this.attack(c, t, dt);
        } else {
          c.state = 'return';
        }
      } else if (c.state === 'chase' || c.state === 'flee') {
        c.state = 'return';
      }
      if (c.state === 'return') {
        tx = c.homeX;
        ty = c.homeY;
        speed = def.speed * 0.6;
        if (Math.hypot(c.x - c.homeX, c.y - c.homeY) < 3) c.state = 'idle';
        c.hp = Math.min(def.hp, c.hp + dt * 4);
      }
      if (c.state === 'idle' || c.state === 'wander') {
        if (c.timer <= 0) {
          c.timer = 2 + Math.random() * 6;
          if (Math.random() < 0.6) {
            c.state = 'wander';
            c.wx = c.homeX + (Math.random() - 0.5) * 16;
            c.wy = c.homeY + (Math.random() - 0.5) * 16;
          } else c.state = 'idle';
        }
        if (c.state === 'wander') {
          tx = c.wx;
          ty = c.wy;
          speed = def.speed * 0.35;
          if (Math.hypot(c.x - c.wx, c.y - c.wy) < 0.8) c.state = 'idle';
        }
      }
    }

    this.steer(c, tx, ty, speed, dt);
  }

  /** Moves a creature toward (tx, ty) at `speed`, sliding along obstacles. Returns the distance moved. */
  steer(c: Creature, tx: number, ty: number, speed: number, dt: number): number {
    const def = c.def;
    const w = this.game.world;
    const dx = tx - c.x;
    const dy = ty - c.y;
    const d = Math.hypot(dx, dy);
    const tileSpeed = w.speedAt(Math.floor(c.x), Math.floor(c.y)) || 1;
    let vx = 0;
    let vy = 0;
    if (d > 0.05 && speed > 0) {
      vx = (dx / d) * speed * tileSpeed;
      vy = (dy / d) * speed * tileSpeed;
      c.angle = Math.atan2(dy, dx);
    } else if (c.state === 'chase' && c.target) {
      const t = this.game.players.get(c.target);
      if (t) c.angle = Math.atan2(t.y - c.y, t.x - c.x);
    }
    const k = Math.min(1, dt * 8);
    c.vx += (vx - c.vx) * k;
    c.vy += (vy - c.vy) * k;
    const bx = c.x;
    const by = c.y;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    resolveCollisions(c, def.radius, this.collision);
    const moved = Math.hypot(c.x - bx, c.y - by);
    // Stuck against something: pick a new direction.
    if (!c.raider && speed > 0 && moved < speed * dt * 0.2 && c.state !== 'chase') {
      c.timer = 0;
      c.wx = c.x + (Math.random() - 0.5) * 10;
      c.wy = c.y + (Math.random() - 0.5) * 10;
    }
    return moved;
  }

  /** Steers toward (tx, ty); blocked for a moment, it sidesteps around whatever is in the way for a while. */
  pursue(c: Creature, tx: number, ty: number, speed: number, dt: number, nav: Detour): number {
    const now = this.game.tick * (1000 / TICK_RATE);
    const detour = now < nav.detourUntil;
    const moved = this.steer(c, detour ? c.x + nav.dx * 3 : tx, detour ? c.y + nav.dy * 3 : ty, speed, dt);
    if (speed > 0 && moved < speed * dt * 0.25) nav.stuck += dt;
    else nav.stuck = Math.max(0, nav.stuck - dt);
    if (nav.stuck > 0.4) {
      nav.stuck = 0;
      const a = Math.atan2(ty - c.y, tx - c.x) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.6);
      nav.dx = Math.cos(a);
      nav.dy = Math.sin(a);
      nav.detourUntil = now + 700 + Math.random() * 600;
    }
    return moved;
  }

  /**
   * Chases and bites/strikes a player: returns the speed to move at (0 when in reach). Attacks are
   * telegraphed with a wind-up before they land.
   */
  attack(c: Creature, t: Player, dt: number): number {
    const def = c.def;
    const reach = def.radius + PLAYER_RADIUS + 0.45;
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    let speed = d > reach * 0.8 ? def.speed * 0.95 : 0;
    if (c.windup > 0) {
      c.windup -= dt;
      speed *= 0.25;
      if (c.windup <= 0) {
        c.cooldown = def.attackRate;
        if (d <= reach + 0.35 && !t.dead)
          this.game.playerSystem.damage(t, def.damage * (0.85 + Math.random() * 0.3), def.name.toLowerCase(), c.x, c.y);
      }
    } else if (d <= reach && c.cooldown <= 0) {
      c.windup = def.id === 'bear' ? 0.5 : 0.35;
      this.game.emit(['atk', c.id], c.x, c.y);
    }
    return speed;
  }

  /** Like attack(), against another creature: a guard and the animals and raiders it fights. */
  attackCreature(c: Creature, t: Creature, dt: number): number {
    const def = c.def;
    const reach = def.radius + t.def.radius + 0.45;
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    let speed = d > reach * 0.8 ? def.speed * 0.95 : 0;
    if (c.windup > 0) {
      c.windup -= dt;
      speed *= 0.25;
      if (c.windup <= 0) {
        c.cooldown = def.attackRate;
        if (d <= reach + 0.35 && this.game.entities.has(t.id)) {
          t.foe = c.id;
          const crit = Math.random() < 0.1;
          this.damage(t, def.damage * (0.85 + Math.random() * 0.3) * (crit ? 1.5 : 1), null, 0.35, crit, c.x, c.y);
        }
      }
    } else if (d <= reach && c.cooldown <= 0) {
      c.windup = def.id === 'bear' ? 0.5 : def.id === 'guard' ? 0.3 : 0.35;
      this.game.emit(['atk', c.id], c.x, c.y);
    }
    return speed;
  }

  /** An animal a guard went for turns on it while it stays close. */
  private fightBack(c: Creature, dt: number): boolean {
    const t = this.game.entities.get(c.foe!);
    const passive = c.def.temperament === 'passive' || c.def.temperament === 'farm';
    if (t?.kind !== 'creature' || passive || Math.hypot(t.x - c.x, t.y - c.y) > c.def.sight) {
      c.foe = 0;
      return false;
    }
    c.state = 'chase';
    this.steer(c, t.x, t.y, this.attackCreature(c, t, dt), dt);
    return true;
  }

  /** Damage from a player, or from a trap or tower (`by` null; `fromX/fromY` set the knockback). */
  damage(c: Creature, amount: number, by: Player | null, knock: number, crit: boolean, fromX = by?.x ?? c.x, fromY = by?.y ?? c.y): void {
    c.hp -= amount;
    c.hurtT = 1.5;
    const a = Math.atan2(c.y - fromY, c.x - fromX);
    c.vx += Math.cos(a) * knock * 10;
    c.vy += Math.sin(a) * knock * 10;
    if (by) {
      c.lastHitBy = by.id;
      if (c.def.temperament !== 'passive') {
        c.aggro = 15;
        c.target = by.id;
      }
    }
    this.game.emit(['dmg', c.id, Math.round(amount), crit ? 1 : 0], c.x, c.y);
    if (c.hp <= 0) this.kill(c, by ?? this.game.players.get(c.lastHitBy) ?? null);
  }

  kill(c: Creature, by: Player | null): void {
    this.game.removeEntity(c.id);
    if (c.zone) this.zoneCount.set(c.zone, Math.max(0, (this.zoneCount.get(c.zone) ?? 1) - 1));
    if (c.guard) this.game.guards.fell(c);
    this.game.quests.onKill(c);
    this.game.emit(['die', c.id], c.x, c.y);
    const loot = [];
    for (const d of c.def.drops) {
      if (d.chance !== undefined && Math.random() >= d.chance) continue;
      const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      if (n > 0) loot.push({ id: d.item, n });
    }
    if (c.raider) loot.push(...this.game.raids.fell(c));
    this.game.combat.dropLoot(c.x, c.y, loot);
    if (by) {
      by.stats.kills++;
      by.addXp('combat', 5);
      if (c.def.crests) {
        const crests = c.def.crests[0] + Math.floor(Math.random() * (c.def.crests[1] - c.def.crests[0] + 1));
        by.crests += crests;
        by.statusDirty = true;
        this.game.emit(['pop', Math.round(c.x * 100), Math.round(c.y * 100), `+₡${crests}`, 0xf2c53d], c.x, c.y, { only: by.id });
      }
      this.game.progression.onKill(by, c.def.id);
    }
  }

  // ——— Farm animals ———

  spawnFarmAnimal(p: Player, type: string, x: number, y: number): boolean {
    const def = CREATURE_BY_ID.get(type);
    if (!def) return false;
    if (this.collision.solidAt(Math.floor(x), Math.floor(y))) return false;
    const c = this.spawn(type, x, y, '');
    c.owner = p.accountId;
    c.ownerName = p.name;
    c.productIn = def.product?.every;
    this.game.notice(p, `Your ${def.name.toLowerCase()} is settling in. Fence it in!`, 'good');
    return true;
  }

  save(): EntitySave[] {
    const out: EntitySave[] = [];
    for (const e of this.game.entities.values()) {
      // Guards are saved with their guard house.
      if (e.kind !== 'creature' || !e.owner || e.guard) continue;
      out.push({
        kind: 'animal',
        x: e.x,
        y: e.y,
        owner: e.owner,
        ownerName: e.ownerName,
        type: e.def.id,
        data: { hp: e.hp, productIn: e.productIn ?? 0, hasProduct: !!e.hasProduct, homeX: e.homeX, homeY: e.homeY },
      });
    }
    return out;
  }

  load(saved: EntitySave[]): void {
    for (const s of saved) {
      if (s.kind !== 'animal' || !s.type || !CREATURE_BY_ID.has(s.type)) continue;
      const c = this.spawn(s.type, s.x, s.y, '');
      c.owner = s.owner ?? null;
      c.ownerName = s.ownerName;
      const d = (s.data ?? {}) as { hp?: number; productIn?: number; hasProduct?: boolean; homeX?: number; homeY?: number };
      c.hp = d.hp ?? c.hp;
      c.productIn = d.productIn;
      c.hasProduct = d.hasProduct;
      c.homeX = d.homeX ?? s.x;
      c.homeY = d.homeY ?? s.y;
    }
  }
}
