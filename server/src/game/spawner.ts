// Zombie population management (design plan §16 and §75).
//
// Each zone has a target population. Zombies in chunks near players are real entities with full
// AI; everywhere else they exist only as dormant records (position, archetype, health) — the
// "statistical state". Chunks wake up as players approach and fall asleep a while after they
// leave. Killed zombies lower a zone's population, which then recovers slowly, so cleared areas
// stay noticeably safer for a while. New zombies only ever appear in chunks away from players.

import { CHUNK_SIZE, chunkKey, chunkOf, Rng, type ZoneDef } from '@tuff/shared';
import type { DormantZombie, ZoneState } from '../persistence/storage';
import { Player, Transform, Zombie } from './components';
import type { Game } from './game';

/** Chunks within this Chebyshev distance of a player are simulated. */
const ACTIVE_RADIUS = 2;
/** Seconds a chunk stays active after the last player leaves its neighbourhood. */
const SLEEP_DELAY = 20;
const MIN_RESPAWN_DISTANCE = 90;

export class Spawner {
  readonly dormant = new Map<string, DormantZombie[]>();
  readonly zones = new Map<string, ZoneState>();
  private readonly active = new Set<string>();
  private readonly idle = new Map<string, number>();
  private timer = 0;

  constructor(private readonly game: Game) {}

  load(chunks: Map<string, DormantZombie[]>, zones: Map<string, ZoneState>): void {
    for (const [k, list] of chunks) this.dormant.set(k, list);
    for (const [k, z] of zones) this.zones.set(k, z);
  }

  /**
   * Distributes each zone's initial population across the map (first launch only, or with
   * `onlyNew` for zones that have no state yet — added when a map is republished).
   */
  populate(rng: Rng, onlyNew = false): number {
    const game = this.game;
    const mult = game.config.zombies.populationMultiplier;
    let total = 0;
    for (const zone of game.world.map.zones) {
      if (onlyNew && this.zones.has(zone.id)) continue;
      const count = Math.round(zone.zombies * mult);
      let placed = 0;
      const buildings = game.world.buildingsIn(zone.rect);
      for (let i = 0; i < count; i++) {
        const indoors = buildings.length > 0 && rng.chance(0.35);
        const pos = indoors ? game.world.randomIndoorPoint(rng.pick(buildings), rng) : game.world.randomPointIn(zone.rect, rng);
        if (!pos) continue;
        this.addDormant(this.makeRecord(pos.x, pos.y, zone, rng));
        placed++;
      }
      this.zones.set(zone.id, { population: placed, lastRespawn: game.minutes });
      game.world.changes.zones.set(zone.id, this.zones.get(zone.id)!);
      total += placed;
    }
    return total;
  }

  private makeRecord(x: number, y: number, zone: ZoneDef, rng: Rng): DormantZombie {
    const dist = this.game.config.zombies.distribution;
    const archs = this.game.content.zombies;
    const arch = rng.weighted(archs, (a) => dist[a.id] ?? a.weight);
    return { x, y, arch: arch.id, look: rng.nextU32(), zone: zone.id, hp: 1 };
  }

  private addDormant(rec: DormantZombie): void {
    const [cx, cy] = chunkOf(rec.x, rec.y);
    const key = chunkKey(cx, cy);
    let list = this.dormant.get(key);
    if (!list) this.dormant.set(key, (list = []));
    list.push(rec);
    this.game.world.changes.chunks.set(key, list);
  }

  isActive(key: string): boolean {
    return this.active.has(key);
  }

  get activeChunkCount(): number {
    return this.active.size;
  }

  get dormantCount(): number {
    let n = 0;
    for (const list of this.dormant.values()) n += list.length;
    return n;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    const elapsed = 1 - this.timer;
    this.timer = 1;
    const game = this.game;

    // Which chunks should be awake?
    const wanted = new Set<string>();
    for (const e of game.ecs.query(Player, Transform)) {
      const t = game.ecs.get(e, Transform)!;
      const [pcx, pcy] = chunkOf(t.x, t.y);
      for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
        for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) wanted.add(chunkKey(pcx + dx, pcy + dy));
      }
    }
    for (const key of wanted) {
      this.idle.delete(key);
      if (!this.active.has(key)) this.wake(key);
    }
    for (const key of [...this.active]) {
      if (wanted.has(key)) continue;
      const t = (this.idle.get(key) ?? 0) + elapsed;
      if (t >= SLEEP_DELAY) {
        this.sleep(key);
        this.idle.delete(key);
      } else {
        this.idle.set(key, t);
      }
    }
    // Zombies that wandered out of the simulated area fall asleep where they stand.
    for (const e of game.ecs.query(Zombie, Transform)) {
      const t = game.ecs.get(e, Transform)!;
      const z = game.ecs.get(e, Zombie)!;
      const [cx, cy] = chunkOf(t.x, t.y);
      if (this.active.has(chunkKey(cx, cy)) || z.state === 'chase') {
        z.idleOutside = 0;
        continue;
      }
      z.idleOutside += elapsed;
      if (z.idleOutside > 10) {
        this.addDormant({ x: t.x, y: t.y, arch: z.arch.id, look: z.look, zone: z.zone, hp: Math.max(0.1, z.hp / z.maxHp) });
        game.despawnEntity(e);
      }
    }
    this.respawn();
  }

  private wake(key: string): void {
    this.active.add(key);
    const list = this.dormant.get(key);
    if (!list || list.length === 0) return;
    const max = this.game.config.zombies.maxActive;
    const remaining: DormantZombie[] = [];
    for (const rec of list) {
      if (this.game.ecs.count(Zombie) >= max) {
        remaining.push(rec);
        continue;
      }
      // The map may have changed under a dormant zombie (a republished map, a new wall).
      if (!this.game.world.isWalkable(rec.x, rec.y, 0.3)) {
        this.onZombieKilled(rec.zone);
        continue;
      }
      this.game.spawnZombie(rec);
    }
    if (remaining.length > 0) this.dormant.set(key, remaining);
    else this.dormant.delete(key);
    this.game.world.changes.chunks.set(key, remaining.length > 0 ? remaining : null);
  }

  /** Turns the zombies standing in a chunk back into dormant records. */
  private sleep(key: string): void {
    this.active.delete(key);
    const game = this.game;
    for (const e of game.ecs.query(Zombie, Transform)) {
      const t = game.ecs.get(e, Transform)!;
      const [cx, cy] = chunkOf(t.x, t.y);
      if (chunkKey(cx, cy) !== key) continue;
      const z = game.ecs.get(e, Zombie)!;
      if (z.state === 'chase') continue;
      this.addDormant({ x: t.x, y: t.y, arch: z.arch.id, look: z.look, zone: z.zone, hp: Math.max(0.1, z.hp / z.maxHp) });
      game.despawnEntity(e);
    }
  }

  /** Dormant-izes every live zombie (on shutdown) so positions persist. */
  sleepAll(): void {
    for (const key of [...this.active]) this.sleep(key);
    const game = this.game;
    for (const e of game.ecs.query(Zombie, Transform)) {
      const t = game.ecs.get(e, Transform)!;
      const z = game.ecs.get(e, Zombie)!;
      this.addDormant({ x: t.x, y: t.y, arch: z.arch.id, look: z.look, zone: z.zone, hp: Math.max(0.1, z.hp / z.maxHp) });
      game.despawnEntity(e);
    }
  }

  onZombieKilled(zone: string): void {
    const z = this.zones.get(zone);
    if (!z) return;
    z.population = Math.max(0, z.population - 1);
    this.game.world.changes.zones.set(zone, z);
  }

  /** Slowly refills depleted zones, only in chunks no player is near. */
  private respawn(): void {
    const game = this.game;
    const hours = game.config.zombies.respawnGameHours;
    if (hours <= 0) return;
    const players = game.ecs.query(Player, Transform).map((e) => game.ecs.get(e, Transform)!);
    for (const zone of game.world.map.zones) {
      const state = this.zones.get(zone.id);
      if (!state) continue;
      const target = Math.round(zone.zombies * game.config.zombies.populationMultiplier);
      const elapsedHours = (game.minutes - state.lastRespawn) / 60;
      const due = Math.floor((elapsedHours * target) / hours);
      if (due < 1) continue;
      state.lastRespawn = game.minutes;
      const deficit = target - state.population;
      for (let i = 0; i < Math.min(due, deficit); i++) {
        const pos = game.world.randomPointIn(zone.rect, game.rng);
        if (!pos) continue;
        if (players.some((p) => Math.hypot(p.x - pos.x, p.y - pos.y) < MIN_RESPAWN_DISTANCE)) continue;
        const [cx, cy] = chunkOf(pos.x, pos.y);
        if (this.active.has(chunkKey(cx, cy))) continue;
        this.addDormant(this.makeRecord(pos.x, pos.y, zone, game.rng));
        state.population++;
      }
      game.world.changes.zones.set(zone.id, state);
    }
  }
}

export { CHUNK_SIZE };
