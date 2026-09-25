// Bandit raids and defenses (§42). A claim full of machines and goods draws attention: while its
// owner (or a member) is around, a band of raiders occasionally gathers at the edge of the wilds,
// is announced, and marches on the richest storage. They smash through walls, doors and fences in
// their way, fight defenders, rob chests and crates and sabotage machines, then run for it with
// what they carry. Killing a raider drops its loot. Spike traps and arrow towers help; walls buy
// time. Damaged structures mend slowly once the raid is over.

import { ITEM_BY_ID, TICK_RATE, TILES, type ItemStack, type Slots } from '@ironwild/shared';
import { circleHitsBox } from './building';
import type { Arrow, Creature } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import { structureSolid, type Structure } from './world';

export interface RaiderState {
  raid: number;
  phase: 'march' | 'flee';
  /** Structure being robbed or sabotaged. */
  goal: number;
  /** Structure being smashed to get through. */
  bash: number;
  loot: ItemStack[];
  jobs: number;
  stuck: number;
  detourUntil: number;
  dx: number;
  dy: number;
}

interface Raid {
  id: number;
  claim: number;
  x: number;
  y: number;
  radius: number;
  owner: string | null;
  ownerName: string;
  /** Where the band gathers, and where survivors run back to. */
  fromX: number;
  fromY: number;
  size: number;
  arriveAt: number;
  spawned: boolean;
  fleeAt: number;
  endAt: number;
  raiders: Set<number>;
  fallen: number;
  /** Value of goods carried off. */
  lost: number;
}

const CHECK_SECONDS = 20;
/** Claims worth less than this (structures plus contents, in base value) are left alone. */
export const RAID_MIN_WEALTH = 3000;
/** Game minutes between raids on the same claim, and the grace after a claim first qualifies. */
const COOLDOWN_MINUTES = 2 * 1440;
const GRACE_MINUTES = 720;
const WARNING_MS = 25_000;
const RAID_MS = 150_000;
const ESCAPE_MS = 60_000;
const BASH_DAMAGE = 26;
/** Raiders break through these; anything else they walk around. */
const BASHABLE = new Set(['wood_wall', 'stone_wall', 'wood_door', 'fence', 'pen_gate', 'arrow_tower', 'spike_trap']);
const TOWER_ARROW_SPEED = 22;
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

export class RaidSystem {
  private readonly raids = new Map<number, Raid>();
  private nextId = 1;
  /** Claim id → game minute of its last raid (or grace start). */
  private readonly lastRaid = new Map<number, number>();
  private checkT = CHECK_SECONDS;
  private readonly damaged = new Set<Structure>();

  constructor(private readonly game: Game) {}

  init(): void {
    for (const s of this.game.world.structures.values()) if (s.hp < s.def.hp) this.damaged.add(s);
  }

  /** Simulation time in ms (raids run on game ticks, not wall time). */
  private get clock(): number {
    return this.game.tick * (1000 / TICK_RATE);
  }

  get active(): boolean {
    return this.raids.size > 0;
  }

  step(dt: number): void {
    const now = this.clock;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = CHECK_SECONDS;
      this.consider();
    }
    for (const raid of this.raids.values()) this.stepRaid(raid, now);
    this.stepTowers(dt);
    this.stepTraps(now);
    if (this.game.tick % TICK_RATE === 0 && this.raids.size === 0) this.mend();
  }

  // ——— Starting raids ———

  private consider(): void {
    if (this.raids.size > 0) return;
    const minutes = this.game.minutes;
    for (const claim of this.game.world.claims) {
      const last = this.lastRaid.get(claim.id);
      if (last !== undefined && minutes - last < COOLDOWN_MINUTES) continue;
      if (!this.defenderNear(claim)) continue;
      const wealth = this.wealth(claim);
      if (wealth < RAID_MIN_WEALTH) continue;
      if (last === undefined) {
        // Word of a new fortune takes a while to reach the bandits.
        this.lastRaid.set(claim.id, minutes - COOLDOWN_MINUTES + GRACE_MINUTES);
        continue;
      }
      const chance = Math.min(0.12, 0.02 + (wealth - RAID_MIN_WEALTH) / 100_000) * (this.game.night ? 1.5 : 1);
      if (Math.random() >= chance) continue;
      this.start(claim);
      return;
    }
  }

  /** Base value of everything on a claim: structures and what they hold. */
  wealth(claim: Structure): number {
    const r = claim.def.claimRadius ?? 0;
    const value = (id: string) => ITEM_BY_ID.get(id)?.value ?? 0;
    const slots = (list: Slots | null | undefined) => (list ?? []).reduce((sum, it) => sum + (it ? value(it.id) * it.n : 0), 0);
    let total = 0;
    for (const s of this.game.world.structures.values()) {
      if (Math.abs(s.x - claim.x) > r || Math.abs(s.y - claim.y) > r) continue;
      total += value(s.def.item) + slots(s.store);
      if (s.machine) total += slots(s.machine.in) + slots(s.machine.fuel) + slots(s.machine.out);
      for (const it of s.items ?? []) total += value(it.item);
    }
    return Math.round(total);
  }

  private canDefend(p: Player, claim: Structure): boolean {
    if (!claim.owner) return false;
    return (
      p.accountId === claim.owner ||
      !!claim.members?.some((m) => m.id === p.accountId) ||
      this.game.companies.sameCompany(p.accountId, claim.owner)
    );
  }

  private defenderNear(claim: Structure): boolean {
    for (const p of this.game.players.values())
      if (!p.dead && this.canDefend(p, claim) && Math.hypot(p.x - claim.x, p.y - claim.y) < 45) return true;
    return false;
  }

  /** Sends a band of raiders against a claim (after a warning). Returns false if there is nowhere to gather. */
  start(claim: Structure, delayMs = WARNING_MS): boolean {
    const w = this.game.world;
    const wealth = this.wealth(claim);
    const size = Math.max(2, Math.min(6, 2 + Math.floor((wealth - RAID_MIN_WEALTH) / 5000)));
    const camp = w.gen.landmarks.find((l) => l.kind === 'bandit_camp');
    const base = camp ? Math.atan2(camp.y - claim.y, camp.x - claim.x) : Math.random() * Math.PI * 2;
    let from: { x: number; y: number } | null = null;
    for (let k = 0; k < 24 && !from; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      const d = 26 + Math.random() * 6;
      const x = claim.x + 0.5 + Math.cos(a) * d;
      const y = claim.y + 0.5 + Math.sin(a) * d;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (!w.inside(tx, ty) || this.game.creatures.collision.solidAt(tx, ty) || !TILES[w.tile(tx, ty)].land) continue;
      if (w.settlementAt(x, y, 12) || w.claimAt(tx, ty)) continue;
      from = { x, y };
    }
    if (!from) return false;
    const now = this.clock;
    const raid: Raid = {
      id: this.nextId++,
      claim: claim.id,
      x: claim.x + 0.5,
      y: claim.y + 0.5,
      radius: claim.def.claimRadius ?? 15,
      owner: claim.owner,
      ownerName: claim.ownerName,
      fromX: from.x,
      fromY: from.y,
      size,
      arriveAt: now + delayMs,
      spawned: false,
      fleeAt: 0,
      endAt: 0,
      raiders: new Set(),
      fallen: 0,
      lost: 0,
    };
    this.raids.set(raid.id, raid);
    this.lastRaid.set(claim.id, this.game.minutes);
    const a = Math.atan2(from.y - raid.y, from.x - raid.x);
    const dir = DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
    this.tell(raid, `⚔ ${size} bandits are gathering to raid ${raid.ownerName}'s land from the ${dir}! Get ready.`, 'bad');
    this.game.broadcastChat('', `Scouts report bandits heading for ${raid.ownerName}'s land.`, 'system');
    this.game.emit(['sfx', 'horn', Math.round(raid.x * 100), Math.round(raid.y * 100)], raid.x, raid.y, { r: 70 });
    this.game.log(`raid ${raid.id} on claim ${claim.id} (${raid.ownerName}, wealth ${wealth}): ${size} raiders`);
    return true;
  }

  /** Tells the claim's people (anywhere) and anyone nearby. */
  private tell(raid: Raid, text: string, kind: 'info' | 'good' | 'bad'): void {
    const claim = this.game.world.structures.get(raid.claim);
    for (const p of this.game.players.values()) {
      const near = Math.hypot(p.x - raid.x, p.y - raid.y) < 70;
      if (near || (claim && this.canDefend(p, claim)) || p.accountId === raid.owner) this.game.notice(p, text, kind);
    }
  }

  private stepRaid(raid: Raid, now: number): void {
    if (!raid.spawned) {
      if (now < raid.arriveAt) return;
      raid.spawned = true;
      raid.fleeAt = now + RAID_MS;
      raid.endAt = raid.fleeAt + ESCAPE_MS;
      for (let i = 0; i < raid.size; i++) {
        const c = this.game.creatures.spawn('bandit', raid.fromX + (Math.random() - 0.5) * 3, raid.fromY + (Math.random() - 0.5) * 3, '');
        c.homeX = raid.fromX;
        c.homeY = raid.fromY;
        c.raider = { raid: raid.id, phase: 'march', goal: 0, bash: 0, loot: [], jobs: 0, stuck: 0, detourUntil: 0, dx: 0, dy: 0 };
        raid.raiders.add(c.id);
      }
      this.tell(raid, 'The raiders are here!', 'bad');
      return;
    }
    if (now >= raid.fleeAt) {
      for (const id of raid.raiders) {
        const c = this.game.entities.get(id);
        if (c?.kind === 'creature' && c.raider) c.raider.phase = 'flee';
      }
    }
    if (now >= raid.endAt) for (const id of [...raid.raiders]) this.escape(raid, id);
    for (const id of raid.raiders) if (!this.game.entities.has(id)) raid.raiders.delete(id);
    if (raid.raiders.size === 0) this.finish(raid);
  }

  private finish(raid: Raid): void {
    this.raids.delete(raid.id);
    this.lastRaid.set(raid.claim, this.game.minutes);
    const lost = raid.lost > 0 ? ` They got away with ₡${Math.round(raid.lost)} worth of goods.` : ' Nothing was taken.';
    this.tell(
      raid,
      `The raid on ${raid.ownerName}'s land is over: ${raid.fallen} of ${raid.size} raiders fell.${lost}`,
      raid.lost > 0 ? 'info' : 'good',
    );
  }

  /** A raider made it back out: gone, with whatever it carried. */
  private escape(raid: Raid, id: number): void {
    const c = this.game.entities.get(id);
    raid.raiders.delete(id);
    if (c?.kind !== 'creature' || !c.raider) return;
    for (const s of c.raider.loot) raid.lost += (ITEM_BY_ID.get(s.id)?.value ?? 0) * s.n;
    this.game.removeEntity(id);
  }

  /** A raider was killed: returns the loot it carried, to drop where it fell. */
  fell(c: Creature): ItemStack[] {
    const r = c.raider!;
    const raid = this.raids.get(r.raid);
    if (raid) {
      raid.fallen++;
      raid.raiders.delete(c.id);
    }
    const loot = r.loot;
    r.loot = [];
    return loot;
  }

  // ——— Raider behaviour ———

  think(c: Creature, dt: number, players: Player[]): void {
    const r = c.raider!;
    const raid = this.raids.get(r.raid);
    const creatures = this.game.creatures;
    if (!raid) {
      this.game.removeEntity(c.id);
      return;
    }
    const w = this.game.world;
    const now = this.clock;

    // Fight anyone who gets close (or hit us); fleeing raiders only swing at those in the way.
    let foe: Player | null = null;
    let foeD = r.phase === 'flee' ? 2.2 : 6;
    for (const p of players) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < foeD) {
        foe = p;
        foeD = d;
      }
    }
    if (!foe && c.aggro > 0 && r.phase === 'march') {
      const t = this.game.players.get(c.target);
      if (t && !t.dead && Math.hypot(t.x - c.x, t.y - c.y) < 12) foe = t;
    }
    if (foe) {
      c.state = 'chase';
      c.target = foe.id;
      r.bash = 0;
      creatures.steer(c, foe.x, foe.y, creatures.attack(c, foe, dt), dt);
      return;
    }
    c.state = 'wander';

    let tx = raid.fromX;
    let ty = raid.fromY;
    if (r.phase === 'march') {
      let goal = r.goal ? w.structures.get(r.goal) : undefined;
      if (!goal) {
        goal = this.pickGoal(raid, c);
        r.goal = goal?.id ?? 0;
        if (!goal) r.phase = 'flee';
      }
      if (goal) {
        tx = goal.x + goal.w / 2;
        ty = goal.y + goal.h / 2;
        if (circleHitsBox(c.x, c.y, c.def.radius + 0.7, goal.x, goal.y, goal.w, goal.h)) {
          c.angle = Math.atan2(ty - c.y, tx - c.x);
          creatures.steer(c, c.x, c.y, 0, dt);
          if (this.windup(c, dt)) this.strike(c, raid, goal);
          return;
        }
      }
    }
    if (r.phase === 'flee' && Math.hypot(c.x - raid.fromX, c.y - raid.fromY) < 2.5) {
      this.escape(raid, c.id);
      return;
    }

    // Smashing through a wall in the way.
    if (r.bash) {
      const s = w.structures.get(r.bash);
      if (!s || (!structureSolid(s) && !s.def.gate) || !circleHitsBox(c.x, c.y, c.def.radius + 1.1, s.x, s.y, s.w, s.h)) r.bash = 0;
      else {
        c.angle = Math.atan2(s.y + 0.5 - c.y, s.x + 0.5 - c.x);
        creatures.steer(c, c.x, c.y, 0, dt);
        if (this.windup(c, dt)) this.damageStructure(s, BASH_DAMAGE * (0.85 + Math.random() * 0.3));
        return;
      }
    }

    if (now < r.detourUntil) {
      tx = c.x + r.dx * 3;
      ty = c.y + r.dy * 3;
    }
    const speed = c.def.speed * (r.phase === 'flee' ? 1 : 0.85);
    const moved = creatures.steer(c, tx, ty, speed, dt);
    if (moved < speed * dt * 0.25) r.stuck += dt;
    else r.stuck = Math.max(0, r.stuck - dt);
    if (r.stuck > 0.4) {
      r.stuck = 0;
      const blocker = this.blocker(c, tx, ty);
      if (blocker) r.bash = blocker.id;
      else {
        const a = Math.atan2(ty - c.y, tx - c.x) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.6);
        r.dx = Math.cos(a);
        r.dy = Math.sin(a);
        r.detourUntil = now + 700 + Math.random() * 600;
      }
    }
  }

  /** Telegraphed swing at a structure: true when it lands. */
  private windup(c: Creature, dt: number): boolean {
    if (c.windup > 0) {
      c.windup -= dt;
      if (c.windup <= 0) {
        c.cooldown = c.def.attackRate;
        return true;
      }
    } else if (c.cooldown <= 0) {
      c.windup = 0.45;
      this.game.emit(['atk', c.id], c.x, c.y);
    }
    return false;
  }

  /** The wall, door or fence blocking the way toward (tx, ty), if any. */
  private blocker(c: Creature, tx: number, ty: number): Structure | null {
    const w = this.game.world;
    const a = Math.atan2(ty - c.y, tx - c.x);
    for (const off of [0, 0.6, -0.6, 1.1, -1.1]) {
      const x = Math.floor(c.x + Math.cos(a + off) * (c.def.radius + 0.55));
      const y = Math.floor(c.y + Math.sin(a + off) * (c.def.radius + 0.55));
      const s = w.structAt(x, y);
      if (s && BASHABLE.has(s.type) && (structureSolid(s) || s.def.gate)) return s;
    }
    return null;
  }

  /** Richest storage first, then working machines; nearer is better. */
  private pickGoal(raid: Raid, c: Creature): Structure | undefined {
    const w = this.game.world;
    const r = raid.radius;
    let best: Structure | undefined;
    let bestScore = 0;
    for (const s of w.structures.values()) {
      if (Math.abs(s.x + 0.5 - raid.x) > r + 1 || Math.abs(s.y + 0.5 - raid.y) > r + 1) continue;
      let score = 0;
      if (s.store && !s.def.only) score = s.store.reduce((sum, it) => sum + (it ? (ITEM_BY_ID.get(it.id)?.value ?? 0) * it.n : 0), 0) * 2;
      else if (s.machine && s.machine.wear < 0.9) score = 30 + (ITEM_BY_ID.get(s.def.item)?.value ?? 0) / 20;
      if (score <= 0) continue;
      score /= 1 + Math.hypot(s.x - c.x, s.y - c.y) / 12;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** Robs storage (then runs) or sabotages a machine (then moves on). */
  private strike(c: Creature, raid: Raid, s: Structure): void {
    const r = c.raider!;
    const name = s.def.name;
    if (s.store?.some((it) => it)) {
      const taken = s.store
        .map((it, i) => ({ it, i }))
        .filter((x) => x.it)
        .sort((a, b) => (ITEM_BY_ID.get(b.it!.id)?.value ?? 0) * b.it!.n - (ITEM_BY_ID.get(a.it!.id)?.value ?? 0) * a.it!.n)
        .slice(0, 2);
      for (const { it, i } of taken) {
        r.loot.push(it!);
        s.store[i] = null;
      }
      this.game.factory.contentsChanged(s);
      this.tell(raid, `Bandits are making off with the contents of ${raid.ownerName}'s ${name}! Stop them!`, 'bad');
      this.game.emit(['sfx', 'pickup', Math.round((s.x + 0.5) * 100), Math.round((s.y + 0.5) * 100)], s.x, s.y, { r: 20 });
      r.jobs++;
      r.phase = 'flee';
      r.goal = 0;
      return;
    }
    if (s.machine) {
      s.machine.wear = Math.min(1, s.machine.wear + 0.3);
      s.machine.progress = 0;
      this.game.emit(['hit', Math.round((s.x + s.w / 2) * 100), Math.round((s.y + s.h / 2) * 100), 'metal'], s.x, s.y);
      this.tell(raid, `Bandits are wrecking ${raid.ownerName}'s ${name}!`, 'bad');
      r.jobs++;
    }
    r.goal = 0;
    if (r.jobs >= 2) r.phase = 'flee';
  }

  // ——— Structures ———

  /** Damages a structure; at zero health it breaks and spills what it held. */
  damageStructure(s: Structure, amount: number): void {
    if (!this.game.world.structures.has(s.id)) return;
    s.hp -= amount;
    const material = s.type.startsWith('stone') ? 'stone' : s.def.machine || s.def.tower ? 'metal' : 'wood';
    this.game.emit(['hit', Math.round((s.x + s.w / 2) * 100), Math.round((s.y + s.h / 2) * 100), material], s.x, s.y);
    if (s.hp > 0) {
      this.damaged.add(s);
      this.sendHp(s);
      return;
    }
    const spill = this.game.factory.contents(s);
    this.game.building.remove(s);
    this.damaged.delete(s);
    this.game.combat.dropLoot(s.x + s.w / 2, s.y + s.h / 2, spill);
    this.game.emit(['sfx', 'break', Math.round((s.x + 0.5) * 100), Math.round((s.y + 0.5) * 100)], s.x, s.y, { r: 30 });
    const owner = s.owner ? this.game.byAccount.get(s.owner) : undefined;
    if (owner) this.game.notice(owner, `Your ${s.def.name} was destroyed.`, 'bad');
  }

  /** Sends health to clients in 10 % steps. */
  private sendHp(s: Structure): void {
    const bucket = s.hp >= s.def.hp ? 10 : Math.floor((s.hp / s.def.hp) * 10);
    if (bucket === s.hpSent) return;
    s.hpSent = bucket;
    this.game.structVisual(s);
  }

  /** Between raids, damaged structures mend by 1 % a second. */
  private mend(): void {
    for (const s of this.damaged) {
      if (!this.game.world.structures.has(s.id)) {
        this.damaged.delete(s);
        continue;
      }
      s.hp = Math.min(s.def.hp, s.hp + s.def.hp * 0.01);
      if (s.hp >= s.def.hp) this.damaged.delete(s);
      this.sendHp(s);
    }
  }

  // ——— Defenses ———

  private hostile(e: Creature): boolean {
    if (e.rider) return false;
    return !!e.raider || e.def.temperament === 'aggressive' || (e.def.temperament === 'neutral' && e.aggro > 0);
  }

  private stepTraps(now: number): void {
    const w = this.game.world;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'creature' || !this.hostile(e) || (e.trapAt ?? 0) > now) continue;
      const s = w.structAt(Math.floor(e.x), Math.floor(e.y));
      if (!s?.def.trap) continue;
      e.trapAt = now + 700;
      this.game.creatures.damage(e, s.def.trap, null, 0.15, false, s.x + 0.5, s.y + 0.5);
      this.damageStructure(s, 8);
    }
  }

  private stepTowers(dt: number): void {
    for (const s of this.game.world.towers) {
      s.timer = (s.timer ?? 0) - dt;
      if (s.timer > 0) continue;
      s.timer = 0.3;
      const spec = s.def.tower!;
      const cx = s.x + 0.5;
      const cy = s.y + 0.5;
      let target: Creature | null = null;
      let best = spec.range;
      for (const e of this.game.entities.values()) {
        if (e.kind !== 'creature' || !this.hostile(e)) continue;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d < best) {
          best = d;
          target = e;
        }
      }
      if (!target) continue;
      const ammo = s.store?.findIndex((it) => it?.id === 'arrow') ?? -1;
      if (ammo < 0) {
        s.timer = 2;
        continue;
      }
      const stack = s.store![ammo]!;
      stack.n -= 1;
      if (stack.n <= 0) s.store![ammo] = null;
      // Lead the target a little.
      const t = best / TOWER_ARROW_SPEED;
      const ax = target.x + target.vx * t - cx;
      const ay = target.y + target.vy * t - cy;
      const angle = Math.atan2(ay, ax);
      const arrow: Arrow = {
        kind: 'arrow',
        id: this.game.newEntityId(),
        x: cx + Math.cos(angle) * 0.7,
        y: cy + Math.sin(angle) * 0.7,
        vx: Math.cos(angle) * TOWER_ARROW_SPEED,
        vy: Math.sin(angle) * TOWER_ARROW_SPEED,
        angle,
        damage: spec.damage,
        owner: 0,
        life: spec.range / TOWER_ARROW_SPEED + 0.25,
        high: true,
      };
      this.game.addEntity(arrow);
      this.game.emit(['sfx', 'bow', Math.round(cx * 100), Math.round(cy * 100)], cx, cy, { r: 20 });
      s.timer = spec.every;
    }
  }

  /** Raids in progress (for /raid and tests). */
  list(): { id: number; claim: number; raiders: number; spawned: boolean }[] {
    return [...this.raids.values()].map((r) => ({ id: r.id, claim: r.claim, raiders: r.raiders.size, spawned: r.spawned }));
  }
}
