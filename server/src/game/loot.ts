// Loot generation (design plan §31): containers roll their own table, lazily, the first time
// anyone opens them. Houses additionally roll a building-level plan — e.g. whether this house has a
// firearm and which drawer, closet or nightstand hides it (§9).

import { hash32, hashString, Rng, type ContentRegistry, type ItemStack, type LootTableDef, type ServerConfig } from '@tuff/shared';
import type { BuildingLootState } from '../persistence/storage';
import type { WorldState } from './world-state';

let uidCounter = 0;

/** Item instance ids: random 40-bit prefix + counter, unique without a persistent sequence. */
export function newUid(): number {
  uidCounter = (uidCounter + 1) % 4096;
  return Math.floor(Math.random() * 2 ** 40) * 4096 + uidCounter;
}

export class LootGenerator {
  constructor(
    private readonly content: ContentRegistry,
    private readonly tables: Map<string, LootTableDef>,
    private readonly config: ServerConfig,
    private readonly worldSeed: number,
  ) {}

  hasTable(id: string): boolean {
    return this.tables.has(id);
  }

  /** Rolls a table into item stacks. */
  roll(tableId: string, rng: Rng, depth = 0): ItemStack[] {
    const table = this.tables.get(tableId);
    if (!table || depth > 6) return [];
    if (depth === 0 && table.empty && rng.chance(Math.min(0.95, table.empty / Math.max(0.2, this.config.loot.abundance)))) return [];
    const abundance = depth === 0 ? this.config.loot.abundance : 1;
    const rolls = Math.round(rng.int(table.rolls[0], table.rolls[1]) * abundance);
    const out: ItemStack[] = [];
    for (let i = 0; i < rolls; i++) {
      const entry = rng.weighted(table.entries, (e) => e.weight);
      if (entry.table) {
        out.push(...this.roll(entry.table, rng, depth + 1));
        continue;
      }
      if (!entry.item) continue;
      const def = this.content.findItem(entry.item);
      if (!def) continue;
      const qty = Math.max(1, rng.int(entry.min ?? 1, Math.max(entry.min ?? 1, entry.max ?? 1)));
      const stack: ItemStack = { uid: newUid(), id: def.id, qty: Math.min(qty, def.stackSize) };
      if (def.durability || def.melee || def.firearm) {
        const [a, b] = entry.condition ?? [0.6, 1];
        stack.cond = Math.round(rng.range(a, b) * 100) / 100;
      }
      if (def.firearm) {
        const [a, b] = entry.loaded ?? [0, 1];
        stack.ammo = Math.round(rng.range(a, b) * def.firearm.magazine);
        if (entry.companionAmmo) {
          const ammoDef = this.content.items.find((it) => it.ammo?.caliber === def.firearm!.caliber);
          const rounds = rng.int(entry.companionAmmo[0], entry.companionAmmo[1]);
          if (ammoDef && rounds > 0) out.push({ uid: newUid(), id: ammoDef.id, qty: rounds });
        }
      }
      if (def.uses) stack.uses = Math.max(1, Math.round(def.uses * rng.range(0.3, 1)));
      if (def.light) stack.charge = Math.round(rng.range(0.2, 1) * 100) / 100;
      out.push(stack);
    }
    return mergeStacks(this.content, out);
  }

  /**
   * Generates the contents of a world container the first time it is opened. Deterministic for a
   * given world seed and container id, so two servers with the same seed agree.
   */
  generateContainer(world: WorldState, containerId: string): ItemStack[] {
    const container = world.compiled.containers.get(containerId);
    if (!container) return [];
    const rng = new Rng(hash32(this.worldSeed, hashString(containerId)));
    const items = this.roll(container.loot, rng);
    if (container.buildingId) {
      const plan = this.buildingPlan(world, container.buildingId);
      for (const extra of plan.extra[containerId] ?? []) items.push(...this.roll(extra, rng));
    }
    return items;
  }

  /** Rolls (once) the building-wide loot plan for a house: its hidden firearm, if any. */
  buildingPlan(world: WorldState, buildingId: string): BuildingLootState {
    const existing = world.buildingLoot.get(buildingId);
    if (existing) return existing;
    const plan: BuildingLootState = { rolled: true, extra: {} };
    const building = world.map.buildings.find((b) => b.id === buildingId);
    if (building?.type === 'house') {
      const rng = new Rng(hash32(this.worldSeed, hashString(buildingId), 0x6a11));
      if (rng.chance(this.config.loot.houseFirearmChance)) {
        const hiding = [...world.compiled.containers.values()].filter(
          (c) => c.buildingId === buildingId && ['nightstand', 'wardrobe', 'dresser', 'bed_single', 'bed_double', 'garage_shelf', 'gun_safe', 'desk'].includes(c.propType),
        );
        if (hiding.length > 0) {
          const spot = rng.pick(hiding);
          plan.extra[spot.id] = ['house_firearm'];
        }
      }
    }
    world.setBuildingLoot(buildingId, plan);
    return plan;
  }

  /** Random pocket contents for a freshly killed zombie. */
  zombiePockets(rng: Rng): ItemStack[] {
    if (!rng.chance(0.35)) return [];
    return this.roll(rng.chance(0.7) ? 'personal' : rng.chance(0.5) ? 'snacks' : 'junk', rng, 1);
  }
}

export function mergeStacks(content: ContentRegistry, stacks: ItemStack[]): ItemStack[] {
  const out: ItemStack[] = [];
  for (const s of stacks) {
    const def = content.findItem(s.id);
    const plain = s.cond === undefined && s.ammo === undefined && s.uses === undefined && s.charge === undefined && !s.contents;
    const match = plain && def && def.stackSize > 1 ? out.find((o) => o.id === s.id && o.cond === undefined && o.ammo === undefined && o.uses === undefined && o.charge === undefined && !o.contents && o.qty < def.stackSize) : undefined;
    if (match && def) {
      const moved = Math.min(s.qty, def.stackSize - match.qty);
      match.qty += moved;
      if (s.qty - moved > 0) out.push({ ...s, qty: s.qty - moved });
    } else {
      out.push(s);
    }
  }
  return out;
}
