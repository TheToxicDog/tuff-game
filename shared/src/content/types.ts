// Data-driven content definitions. Everything here is loaded from JSON files in /data — no item,
// weapon or prop needs its own code file.

import type { Material } from '../world/collision';

export const ITEM_CATEGORIES = [
  'food',
  'drink',
  'medical',
  'weapon',
  'ammo',
  'tool',
  'container',
  'material',
  'hygiene',
  'electronics',
  'literature',
  'fuel',
  'junk',
  'collectible',
  'furniture',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface Nutrition {
  /** Food energy, informational for now. */
  calories?: number;
  /** Hunger satisfied (positive) — needs are in [0, 100] where 100 = fully satisfied. */
  hunger?: number;
  /** Thirst satisfied (positive) or caused (negative). */
  thirst?: number;
  /** Stress change (negative relaxes). */
  stress?: number;
  /** Energy change. */
  energy?: number;
}

export interface ConsumeDef {
  /** Seconds it takes to eat, drink or apply. */
  time: number;
  /** Tool tags required in the inventory (e.g. `can_opener`). Any tool with the tag works. */
  requires?: string[];
  /** Item id left behind after consumption (e.g. an empty can). */
  leaves?: string;
}

export const TREATMENTS = ['bandage', 'disinfect', 'painkiller', 'antibiotic', 'splint', 'suture'] as const;
export type Treatment = (typeof TREATMENTS)[number];

export interface MedicalDef {
  treatments: Treatment[];
  /** 0..1 — how good the treatment is (sterile gauze 1.0, ripped cloth 0.35). */
  quality: number;
  /** For painkillers: pain suppressed while active (0..100). */
  painRelief?: number;
  /** Effect duration in game minutes (painkillers, antibiotics). */
  duration?: number;
}

export type DamageType = 'blunt' | 'sharp' | 'bullet' | 'shove';

export interface MeleeDef {
  damage: number;
  /** Reach from the player's centre, in meters. */
  reach: number;
  /** Total swing arc in degrees. */
  arc: number;
  /** Seconds between starting the swing and the hit. */
  windup: number;
  /** Seconds after the hit before the next swing can start. */
  recovery: number;
  /** Stamina cost per swing (stamina is 0..1). */
  stamina: number;
  /** Knockback speed applied to hit zombies (m/s). */
  knockback: number;
  maxTargets: number;
  noise: number;
  damageType: 'blunt' | 'sharp';
  /** Chance to knock a zombie down on hit. */
  knockdown: number;
  /** Multiplier for damage against doors and windows. */
  structureDamage?: number;
  equipTime?: number;
}

export interface FirearmDef {
  caliber: string;
  damage: number;
  pellets?: number;
  /** Rounds per minute. */
  rpm: number;
  automatic?: boolean;
  magazine: number;
  /** Seconds for a full reload, or per round when `reloadPerRound` is set. */
  reloadTime: number;
  reloadPerRound?: boolean;
  /** Half-angle spread in degrees when hip firing. */
  hipSpread: number;
  /** Half-angle spread in degrees when fully aimed. */
  aimSpread: number;
  /** Seconds to reach full precision while holding precision aim. */
  aimTime: number;
  /** Bloom added per shot (bloom multiplies spread by 1 + bloom). */
  recoil: number;
  /** Bloom recovered per second. */
  recoilRecovery: number;
  range: number;
  /** Bodies a round can pass through. */
  penetration: number;
  noise: number;
  knockback: number;
  headshotMultiplier?: number;
  /** Visual camera kick in meters. */
  kick?: number;
  equipTime?: number;
}

export interface ContainerItemDef {
  /** Liters of internal volume. */
  volume: number;
  /** Maximum kilograms the container can hold. */
  maxWeight: number;
  /** Multiplier applied to movement speed while worn (1 = no penalty). */
  speedFactor: number;
}

export interface LightDef {
  range: number;
  /** Cone half-angle in degrees. */
  cone: number;
  /** Battery life in real seconds at full charge. */
  battery: number;
}

export interface ItemDef {
  id: string;
  name: string;
  description?: string;
  category: ItemCategory;
  /** Kilograms per unit. */
  weight: number;
  /** Liters per unit. */
  volume: number;
  stackSize: number;
  tags?: string[];
  /** Icon shape used by the procedural icon renderer. */
  icon?: string;
  /** Primary colour of the icon / world sprite. */
  color?: string;
  /** Maximum durability (hits or shots) for degradable items. */
  durability?: number;
  /** Number of applications for multi-use consumables (bottles, kits). */
  uses?: number;
  nutrition?: Nutrition;
  consume?: ConsumeDef;
  medical?: MedicalDef;
  melee?: MeleeDef;
  firearm?: FirearmDef;
  ammo?: { caliber: string };
  container?: ContainerItemDef;
  light?: LightDef;
  /** Carried furniture: the prop it was picked up from (generated, see `furnitureItems`). */
  furniture?: string;
}

// ---------------------------------------------------------------------------------------------
// Crafting and cooking (design plan §57–58)

/** A place that enables certain recipes: a heat source for cooking, a workbench for carpentry. */
export type StationKind = 'heat' | 'workbench';
export const STATION_KINDS: readonly StationKind[] = ['heat', 'workbench'];

export interface RecipeIngredient {
  /** A specific item, or any item carrying `tag`. Exactly one is set. */
  item?: string;
  tag?: string;
  qty: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  description?: string;
  category: 'cooking' | 'survival' | 'carpentry' | 'medical';
  /** Station the player must stand next to, if any. */
  station?: StationKind;
  /** Real seconds the work takes. */
  time: number;
  /** Consumed ingredients. */
  inputs: RecipeIngredient[];
  /** Tool tags that must be carried but are not consumed. */
  tools?: string[];
  outputs: { item: string; qty: number }[];
}

// ---------------------------------------------------------------------------------------------
// Construction (design plan §54–56)

export type ConstructionKind = 'wall' | 'door' | 'fence' | 'gate' | 'floor' | 'container' | 'station' | 'fire';

export interface ConstructionDef {
  id: string;
  name: string;
  description?: string;
  category: 'walls' | 'fences' | 'floors' | 'storage' | 'utility';
  kind: ConstructionKind;
  /** Footprint: length along the local x axis and depth along y (meters). */
  w: number;
  h: number;
  blocks: BlockName[];
  material: Material;
  hp: number;
  /** Real seconds of building. */
  time: number;
  materials: { item: string; qty: number }[];
  /** Tool tags required (e.g. `hammer`). */
  tools: string[];
  /** Width of the door or gate opening in the middle of the piece. */
  opening?: number;
  container?: { name: string; volume: number };
  station?: StationKind;
  light?: { radius: number; color: string; intensity: number };
  /** Game minutes one load of fuel burns (fires). */
  burnMinutes?: number;
  /** Item that refuels it (fires). */
  fuel?: string;
  /** Renderer style key. */
  style: string;
  color?: string;
}

// ---------------------------------------------------------------------------------------------
// Loot

export interface LootEntry {
  /** Item id — exactly one of `item` or `table` must be set. */
  item?: string;
  /** Nested loot table id. */
  table?: string;
  weight: number;
  min?: number;
  max?: number;
  /** Condition range for degradable items. */
  condition?: [number, number];
  /** Fraction of the magazine that is loaded, for firearms. */
  loaded?: [number, number];
  /** Loose rounds of the firearm's caliber that come with it. */
  companionAmmo?: [number, number];
}

export interface LootTableDef {
  id: string;
  /** Number of rolls [min, max]. */
  rolls: [number, number];
  /** Chance that the container is empty regardless of rolls. */
  empty?: number;
  entries: LootEntry[];
}

// ---------------------------------------------------------------------------------------------
// Zombies

export interface ZombieArchetypeDef {
  id: string;
  /** Default spawn weight; servers can override the distribution in their config. */
  weight: number;
  /** Speed range when shambling / investigating (m/s). */
  walkSpeed: [number, number];
  /** Speed range when chasing (m/s). */
  chaseSpeed: [number, number];
  health: [number, number];
  attackDamage: [number, number];
  /** Seconds of telegraphed wind-up before an attack lands. */
  attackWindup: number;
  attackCooldown: number;
  /** Sight distance in full daylight (meters). */
  sightRange: number;
  /** Hearing multiplier (1 = normal). */
  hearing: number;
  /** 0..1 — resistance to being knocked down. */
  stability: number;
}

// ---------------------------------------------------------------------------------------------
// Props and furniture

export type PropLayer = 'ground' | 'low' | 'tall' | 'canopy';
export type BlockName = 'player' | 'zombie' | 'sight' | 'bullet';

export interface PropContainerDef {
  name: string;
  loot: string;
  /** Seconds it takes to search the container the first time. */
  searchTime: number;
  volume: number;
}

export interface PropDef {
  id: string;
  name: string;
  shape: 'box' | 'circle' | 'none';
  /** Default footprint in meters (box). Instances may override. */
  w?: number;
  h?: number;
  /** Radius for circle shapes. */
  r?: number;
  blocks: BlockName[];
  material: Material;
  layer: PropLayer;
  /** Drawing style key used by the renderer. */
  style: string;
  color?: string;
  container?: PropContainerDef;
  /** Light emitted when the world has power (streetlights, lamps). */
  light?: { radius: number; color: string; intensity: number };
  /** Somewhere to sleep; quality 0..1 scales how well you rest. */
  sleep?: { quality: number };
  /** Crafting station provided by this prop (a working gas stove is a heat source). */
  station?: StationKind;
  /** Furniture that can be picked up and carried (kilograms). */
  movable?: { weight: number };
}

// ---------------------------------------------------------------------------------------------
// Server configuration

export interface ServerConfig {
  name: string;
  motd: string;
  maxPlayers: number;
  pvp: boolean;
  map: string;
  realSecondsPerDay: number;
  startHour: number;
  zombies: {
    populationMultiplier: number;
    distribution: Record<string, number>;
    /** Game hours before a cleared zone regains one zombie per chunk. */
    respawnGameHours: number;
    maxActive: number;
    corpseLifetimeMinutes: number;
  };
  loot: {
    abundance: number;
    houseFirearmChance: number;
  };
  death: {
    dropInventory: boolean;
    xpLossFraction: number;
    weaknessMinutes: number;
    respawnDelaySeconds: number;
  };
  /** Optional; defaults apply when missing (server/src/game/survival.ts). */
  sleep?: {
    /** World clock multiplier while every online player is asleep. */
    fastForward: number;
  };
  /** Optional; defaults apply when missing (server/src/game/building.ts). */
  building?: {
    /** Whether players may damage structures they have no rights to (defaults to the PvP flag). */
    griefing?: boolean;
    /** Maximum structures per account. */
    maxPerPlayer: number;
  };
  player: {
    startingItems: { item: string; qty: number; slot?: number }[];
  };
}

/** The subset of content every client needs, sent in the welcome message. */
export interface ContentBundle {
  hash: string;
  items: ItemDef[];
  zombies: ZombieArchetypeDef[];
  props: PropDef[];
  recipes: RecipeDef[];
  constructions: ConstructionDef[];
}

/** Item id for a piece of carried furniture. */
export function furnitureItemId(propId: string): string {
  return `furniture_${propId}`;
}

/**
 * Item definitions for carried furniture, generated from movable props so every piece of
 * furniture can be picked up without writing an item by hand. Furniture is bulky: it only fits in
 * a quick slot (your hands) and its weight slows you down.
 */
export function furnitureItems(props: readonly PropDef[]): ItemDef[] {
  return props
    .filter((p) => p.movable)
    .map((p) => ({
      id: furnitureItemId(p.id),
      name: p.name,
      description: 'Furniture. Carry it in your hands and place it with build mode (B).',
      category: 'furniture' as const,
      weight: p.movable!.weight,
      volume: 60,
      stackSize: 1,
      tags: ['furniture', `furniture_${p.material}`],
      icon: 'box',
      color: p.color ?? '#7a6a52',
      furniture: p.id,
    }));
}
