// Wildlife, bandits and farm animals.

export type Temperament = 'passive' | 'neutral' | 'aggressive' | 'farm' | 'guard';

export interface CreatureDrop {
  item: string;
  min: number;
  max: number;
  chance?: number;
}

export interface CreatureDef {
  id: string;
  name: string;
  hp: number;
  radius: number;
  speed: number;
  temperament: Temperament;
  damage: number;
  /** Seconds between attacks. */
  attackRate: number;
  /** Tiles at which aggressive creatures notice players (doubled at night for wolves). */
  sight: number;
  drops: CreatureDrop[];
  /** Crests carried (bandits). */
  crests?: [number, number];
  /** Farm animals: product and seconds between products. */
  product?: { item: string; every: number };
  /** Runs in packs of this size. */
  pack?: [number, number];
  nocturnal?: boolean;
}

export const CREATURES: readonly CreatureDef[] = [
  {
    id: 'rabbit',
    name: 'Rabbit',
    hp: 18,
    radius: 0.3,
    speed: 5.6,
    temperament: 'passive',
    damage: 0,
    attackRate: 1,
    sight: 6,
    drops: [
      { item: 'raw_meat', min: 1, max: 1 },
      { item: 'raw_hide', min: 1, max: 1, chance: 0.3 },
    ],
  },
  {
    id: 'deer',
    name: 'Deer',
    hp: 60,
    radius: 0.55,
    speed: 6.2,
    temperament: 'passive',
    damage: 0,
    attackRate: 1,
    sight: 9,
    drops: [
      { item: 'raw_meat', min: 2, max: 3 },
      { item: 'raw_hide', min: 1, max: 2 },
      { item: 'antler', min: 1, max: 1, chance: 0.5 },
    ],
  },
  {
    id: 'boar',
    name: 'Boar',
    hp: 90,
    radius: 0.55,
    speed: 5.2,
    temperament: 'neutral',
    damage: 12,
    attackRate: 1.1,
    sight: 5,
    drops: [
      { item: 'raw_meat', min: 2, max: 4 },
      { item: 'raw_hide', min: 1, max: 1 },
    ],
  },
  {
    id: 'wolf',
    name: 'Wolf',
    hp: 70,
    radius: 0.5,
    speed: 5.9,
    temperament: 'aggressive',
    damage: 10,
    attackRate: 1.0,
    sight: 8,
    pack: [2, 3],
    nocturnal: true,
    drops: [
      { item: 'raw_meat', min: 1, max: 2 },
      { item: 'wolf_pelt', min: 1, max: 1 },
    ],
  },
  {
    id: 'bear',
    name: 'Bear',
    hp: 260,
    radius: 0.85,
    speed: 5.3,
    temperament: 'aggressive',
    damage: 26,
    attackRate: 1.4,
    sight: 7,
    drops: [
      { item: 'raw_meat', min: 4, max: 6 },
      { item: 'bear_hide', min: 1, max: 1 },
    ],
  },
  {
    id: 'bandit',
    name: 'Bandit',
    hp: 120,
    radius: 0.45,
    speed: 4.7,
    temperament: 'aggressive',
    damage: 13,
    attackRate: 1.1,
    sight: 11,
    crests: [8, 40],
    drops: [
      { item: 'iron_ingot', min: 1, max: 2, chance: 0.4 },
      { item: 'scrap_metal', min: 1, max: 3, chance: 0.6 },
      { item: 'cooked_meat', min: 1, max: 2, chance: 0.4 },
      { item: 'steam_blueprint', min: 1, max: 1, chance: 0.01 },
      { item: 'assembler_blueprint', min: 1, max: 1, chance: 0.02 },
    ],
  },
  {
    id: 'chicken',
    name: 'Chicken',
    hp: 20,
    radius: 0.3,
    speed: 2.5,
    temperament: 'farm',
    damage: 0,
    attackRate: 1,
    sight: 3,
    drops: [{ item: 'raw_meat', min: 1, max: 1 }],
    product: { item: 'egg', every: 120 },
  },
  {
    id: 'sheep',
    name: 'Sheep',
    hp: 50,
    radius: 0.5,
    speed: 2.5,
    temperament: 'farm',
    damage: 0,
    attackRate: 1,
    sight: 3,
    drops: [{ item: 'raw_meat', min: 2, max: 3 }],
    product: { item: 'wool', every: 240 },
  },
  {
    id: 'cow',
    name: 'Cow',
    hp: 90,
    radius: 0.7,
    speed: 2.2,
    temperament: 'farm',
    damage: 0,
    attackRate: 1,
    sight: 3,
    drops: [
      { item: 'raw_meat', min: 4, max: 6 },
      { item: 'raw_hide', min: 2, max: 2 },
    ],
    product: { item: 'milk', every: 300 },
  },
  {
    id: 'horse',
    name: 'Horse',
    hp: 140,
    radius: 0.7,
    speed: 3,
    temperament: 'farm',
    damage: 0,
    attackRate: 1,
    sight: 3,
    drops: [],
  },
  {
    // Hired at a guard house (§42); never spawns in the wild.
    id: 'guard',
    name: 'Guard',
    hp: 260,
    radius: 0.45,
    speed: 5.2,
    temperament: 'guard',
    damage: 22,
    attackRate: 0.9,
    sight: 10,
    drops: [],
  },
];

export const CREATURE_BY_ID: ReadonlyMap<string, CreatureDef> = new Map(CREATURES.map((c) => [c.id, c]));

export function creatureDef(id: string): CreatureDef {
  const d = CREATURE_BY_ID.get(id);
  if (!d) throw new Error(`Unknown creature "${id}"`);
  return d;
}

/** Riding speed multiplier on a horse. */
export const HORSE_SPEED = 1.75;

/** Guards (§42): wages per game day, paid in advance for one of these spans (at most GUARD_MAX_DAYS ahead). */
export const GUARD_WAGE = 150;
export const GUARD_TERMS = [1, 3, 7] as const;
export const GUARD_MAX_DAYS = 14;
/** How far from their house guards fight, and the game minutes before a fallen guard is replaced. */
export const GUARD_LEASH = 14;
export const GUARD_REPLACE_MINUTES = 120;
