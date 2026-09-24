// Validation for raw JSON content. Data files are written by hand (and later by tools), so every
// field is checked with a readable error that names the file and path.

import {
  ITEM_CATEGORIES,
  TREATMENTS,
  type ItemDef,
  type LootTableDef,
  type PropDef,
  type ServerConfig,
  type ZombieArchetypeDef,
} from './types';

type Obj = Record<string, unknown>;

const MATERIALS = [
  'brick',
  'concrete',
  'wood',
  'drywall',
  'metal',
  'glass',
  'foliage',
  'fabric',
  'plastic',
  'stone',
];

export class ContentErrors {
  readonly errors: string[] = [];

  add(message: string): void {
    this.errors.push(message);
  }

  get ok(): boolean {
    return this.errors.length === 0;
  }

  throwIfAny(): void {
    if (this.errors.length > 0) {
      throw new Error(`Content validation failed:\n  - ${this.errors.join('\n  - ')}`);
    }
  }
}

class Checker {
  constructor(
    private readonly errors: ContentErrors,
    private readonly where: string,
  ) {}

  fail(path: string, message: string): void {
    this.errors.add(`${this.where}: ${path}: ${message}`);
  }

  object(value: unknown, path: string): Obj | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'expected an object');
      return null;
    }
    return value as Obj;
  }

  string(o: Obj, key: string, path: string, required = true): string | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || v.length === 0) {
      this.fail(`${path}.${key}`, 'expected a non-empty string');
      return undefined;
    }
    return v;
  }

  number(
    o: Obj,
    key: string,
    path: string,
    opts: { min?: number; max?: number; int?: boolean; required?: boolean } = {},
  ): number | undefined {
    const v = o[key];
    if (v === undefined && opts.required === false) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(`${path}.${key}`, 'expected a number');
      return undefined;
    }
    if (opts.int && !Number.isInteger(v)) this.fail(`${path}.${key}`, 'expected an integer');
    if (opts.min !== undefined && v < opts.min) this.fail(`${path}.${key}`, `must be ≥ ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) this.fail(`${path}.${key}`, `must be ≤ ${opts.max}`);
    return v;
  }

  boolean(o: Obj, key: string, path: string, required = false): boolean | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'boolean') {
      this.fail(`${path}.${key}`, 'expected a boolean');
      return undefined;
    }
    return v;
  }

  range(o: Obj, key: string, path: string, required = true, min = -Infinity): [number, number] | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      this.fail(`${path}.${key}`, 'expected [min, max]');
      return undefined;
    }
    const [a, b] = v as [number, number];
    if (a > b) this.fail(`${path}.${key}`, 'min is greater than max');
    if (a < min) this.fail(`${path}.${key}`, `values must be ≥ ${min}`);
    return [a, b];
  }

  stringArray(o: Obj, key: string, path: string, required = false): string[] | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
      this.fail(`${path}.${key}`, 'expected an array of strings');
      return undefined;
    }
    return v as string[];
  }

  oneOf<T extends string>(o: Obj, key: string, path: string, values: readonly T[], required = true): T | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || !values.includes(v as T)) {
      this.fail(`${path}.${key}`, `expected one of ${values.join(', ')}`);
      return undefined;
    }
    return v as T;
  }
}

const ID_PATTERN = /^[a-z0-9_]+$/;

function checkId(c: Checker, o: Obj, path: string): string | undefined {
  const id = c.string(o, 'id', path);
  if (id && !ID_PATTERN.test(id)) c.fail(`${path}.id`, 'ids must be lowercase snake_case');
  return id;
}

/** Validates an array of raw item definitions. Returns the (unchanged) definitions. */
export function validateItems(raw: unknown, where: string, errors: ContentErrors): ItemDef[] {
  const c = new Checker(errors, where);
  if (!Array.isArray(raw)) {
    c.fail('$', 'expected an array of items');
    return [];
  }
  const items: ItemDef[] = [];
  raw.forEach((entry, i) => {
    const o = c.object(entry, `[${i}]`);
    if (!o) return;
    const id = checkId(c, o, `[${i}]`);
    const path = id ?? `[${i}]`;
    c.string(o, 'name', path);
    c.string(o, 'description', path, false);
    c.oneOf(o, 'category', path, ITEM_CATEGORIES);
    c.number(o, 'weight', path, { min: 0, max: 200 });
    c.number(o, 'volume', path, { min: 0, max: 200 });
    c.number(o, 'stackSize', path, { min: 1, max: 1000, int: true });
    c.stringArray(o, 'tags', path);
    c.string(o, 'icon', path, false);
    c.string(o, 'color', path, false);
    c.number(o, 'durability', path, { min: 1, required: false });
    c.number(o, 'uses', path, { min: 1, int: true, required: false });
    if (o.nutrition !== undefined) {
      const n = c.object(o.nutrition, `${path}.nutrition`);
      if (n) {
        for (const key of ['calories', 'hunger', 'thirst', 'stress', 'energy']) {
          c.number(n, key, `${path}.nutrition`, { required: false, min: -100, max: 2000 });
        }
      }
    }
    if (o.consume !== undefined) {
      const k = c.object(o.consume, `${path}.consume`);
      if (k) {
        c.number(k, 'time', `${path}.consume`, { min: 0, max: 60 });
        c.stringArray(k, 'requires', `${path}.consume`);
        c.string(k, 'leaves', `${path}.consume`, false);
      }
    }
    if (o.medical !== undefined) {
      const m = c.object(o.medical, `${path}.medical`);
      if (m) {
        const list = c.stringArray(m, 'treatments', `${path}.medical`, true);
        for (const t of list ?? []) {
          if (!TREATMENTS.includes(t as never)) c.fail(`${path}.medical.treatments`, `unknown treatment "${t}"`);
        }
        c.number(m, 'quality', `${path}.medical`, { min: 0, max: 1 });
        c.number(m, 'painRelief', `${path}.medical`, { min: 0, max: 100, required: false });
        c.number(m, 'duration', `${path}.medical`, { min: 0, required: false });
      }
    }
    if (o.melee !== undefined) {
      const m = c.object(o.melee, `${path}.melee`);
      if (m) {
        const p = `${path}.melee`;
        c.number(m, 'damage', p, { min: 0 });
        c.number(m, 'reach', p, { min: 0.5, max: 3 });
        c.number(m, 'arc', p, { min: 10, max: 360 });
        c.number(m, 'windup', p, { min: 0, max: 2 });
        c.number(m, 'recovery', p, { min: 0, max: 3 });
        c.number(m, 'stamina', p, { min: 0, max: 1 });
        c.number(m, 'knockback', p, { min: 0 });
        c.number(m, 'maxTargets', p, { min: 1, int: true });
        c.number(m, 'noise', p, { min: 0 });
        c.oneOf(m, 'damageType', p, ['blunt', 'sharp'] as const);
        c.number(m, 'knockdown', p, { min: 0, max: 1 });
        c.number(m, 'structureDamage', p, { min: 0, required: false });
        c.number(m, 'equipTime', p, { min: 0, required: false });
      }
    }
    if (o.firearm !== undefined) {
      const f = c.object(o.firearm, `${path}.firearm`);
      if (f) {
        const p = `${path}.firearm`;
        c.string(f, 'caliber', p);
        c.number(f, 'damage', p, { min: 0 });
        c.number(f, 'pellets', p, { min: 1, int: true, required: false });
        c.number(f, 'rpm', p, { min: 1, max: 1500 });
        c.boolean(f, 'automatic', p);
        c.number(f, 'magazine', p, { min: 1, int: true });
        c.number(f, 'reloadTime', p, { min: 0.05, max: 10 });
        c.boolean(f, 'reloadPerRound', p);
        c.number(f, 'hipSpread', p, { min: 0, max: 45 });
        c.number(f, 'aimSpread', p, { min: 0, max: 45 });
        c.number(f, 'aimTime', p, { min: 0.01, max: 5 });
        c.number(f, 'recoil', p, { min: 0, max: 5 });
        c.number(f, 'recoilRecovery', p, { min: 0 });
        c.number(f, 'range', p, { min: 1, max: 500 });
        c.number(f, 'penetration', p, { min: 1, int: true });
        c.number(f, 'noise', p, { min: 0 });
        c.number(f, 'knockback', p, { min: 0 });
        c.number(f, 'headshotMultiplier', p, { min: 1, required: false });
        c.number(f, 'kick', p, { min: 0, required: false });
        c.number(f, 'equipTime', p, { min: 0, required: false });
      }
    }
    if (o.ammo !== undefined) {
      const a = c.object(o.ammo, `${path}.ammo`);
      if (a) c.string(a, 'caliber', `${path}.ammo`);
    }
    if (o.container !== undefined) {
      const k = c.object(o.container, `${path}.container`);
      if (k) {
        c.number(k, 'volume', `${path}.container`, { min: 0.1 });
        c.number(k, 'maxWeight', `${path}.container`, { min: 0.1 });
        c.number(k, 'speedFactor', `${path}.container`, { min: 0.5, max: 1 });
      }
    }
    if (o.light !== undefined) {
      const l = c.object(o.light, `${path}.light`);
      if (l) {
        c.number(l, 'range', `${path}.light`, { min: 1 });
        c.number(l, 'cone', `${path}.light`, { min: 1, max: 180 });
        c.number(l, 'battery', `${path}.light`, { min: 1 });
      }
    }
    items.push(o as unknown as ItemDef);
  });
  return items;
}

export function validateLootTables(raw: unknown, where: string, errors: ContentErrors): LootTableDef[] {
  const c = new Checker(errors, where);
  if (!Array.isArray(raw)) {
    c.fail('$', 'expected an array of loot tables');
    return [];
  }
  const tables: LootTableDef[] = [];
  raw.forEach((entry, i) => {
    const o = c.object(entry, `[${i}]`);
    if (!o) return;
    const id = checkId(c, o, `[${i}]`);
    const path = id ?? `[${i}]`;
    c.range(o, 'rolls', path, true, 0);
    c.number(o, 'empty', path, { min: 0, max: 1, required: false });
    if (!Array.isArray(o.entries) || o.entries.length === 0) {
      c.fail(`${path}.entries`, 'expected a non-empty array');
    } else {
      o.entries.forEach((e, j) => {
        const eo = c.object(e, `${path}.entries[${j}]`);
        if (!eo) return;
        const ep = `${path}.entries[${j}]`;
        const hasItem = typeof eo.item === 'string';
        const hasTable = typeof eo.table === 'string';
        if (hasItem === hasTable) c.fail(ep, 'set exactly one of "item" or "table"');
        c.number(eo, 'weight', ep, { min: 0 });
        c.number(eo, 'min', ep, { min: 1, int: true, required: false });
        c.number(eo, 'max', ep, { min: 1, int: true, required: false });
        c.range(eo, 'condition', ep, false, 0);
        c.range(eo, 'loaded', ep, false, 0);
        c.range(eo, 'companionAmmo', ep, false, 0);
      });
    }
    tables.push(o as unknown as LootTableDef);
  });
  return tables;
}

export function validateZombies(raw: unknown, where: string, errors: ContentErrors): ZombieArchetypeDef[] {
  const c = new Checker(errors, where);
  if (!Array.isArray(raw)) {
    c.fail('$', 'expected an array of zombie archetypes');
    return [];
  }
  const list: ZombieArchetypeDef[] = [];
  raw.forEach((entry, i) => {
    const o = c.object(entry, `[${i}]`);
    if (!o) return;
    const path = checkId(c, o, `[${i}]`) ?? `[${i}]`;
    c.number(o, 'weight', path, { min: 0 });
    c.range(o, 'walkSpeed', path, true, 0);
    c.range(o, 'chaseSpeed', path, true, 0);
    c.range(o, 'health', path, true, 1);
    c.range(o, 'attackDamage', path, true, 0);
    c.number(o, 'attackWindup', path, { min: 0.05, max: 3 });
    c.number(o, 'attackCooldown', path, { min: 0.1, max: 5 });
    c.number(o, 'sightRange', path, { min: 1, max: 200 });
    c.number(o, 'hearing', path, { min: 0, max: 5 });
    c.number(o, 'stability', path, { min: 0, max: 1 });
    list.push(o as unknown as ZombieArchetypeDef);
  });
  return list;
}

export function validateProps(raw: unknown, where: string, errors: ContentErrors): PropDef[] {
  const c = new Checker(errors, where);
  if (!Array.isArray(raw)) {
    c.fail('$', 'expected an array of props');
    return [];
  }
  const list: PropDef[] = [];
  raw.forEach((entry, i) => {
    const o = c.object(entry, `[${i}]`);
    if (!o) return;
    const path = checkId(c, o, `[${i}]`) ?? `[${i}]`;
    c.string(o, 'name', path);
    const shape = c.oneOf(o, 'shape', path, ['box', 'circle', 'none'] as const);
    if (shape === 'box') {
      c.number(o, 'w', path, { min: 0.05, max: 100 });
      c.number(o, 'h', path, { min: 0.05, max: 100 });
    } else if (shape === 'circle') {
      c.number(o, 'r', path, { min: 0.02, max: 50 });
    }
    const blocks = c.stringArray(o, 'blocks', path, true);
    for (const b of blocks ?? []) {
      if (!['player', 'zombie', 'sight', 'bullet'].includes(b)) c.fail(`${path}.blocks`, `unknown flag "${b}"`);
    }
    c.oneOf(o, 'material', path, MATERIALS as never[]);
    c.oneOf(o, 'layer', path, ['ground', 'low', 'tall', 'canopy'] as const);
    c.string(o, 'style', path);
    c.string(o, 'color', path, false);
    if (o.container !== undefined) {
      const k = c.object(o.container, `${path}.container`);
      if (k) {
        c.string(k, 'name', `${path}.container`);
        c.string(k, 'loot', `${path}.container`);
        c.number(k, 'searchTime', `${path}.container`, { min: 0, max: 10 });
        c.number(k, 'volume', `${path}.container`, { min: 0.1 });
      }
    }
    if (o.light !== undefined) {
      const l = c.object(o.light, `${path}.light`);
      if (l) {
        c.number(l, 'radius', `${path}.light`, { min: 0.5 });
        c.string(l, 'color', `${path}.light`);
        c.number(l, 'intensity', `${path}.light`, { min: 0, max: 2 });
      }
    }
    list.push(o as unknown as PropDef);
  });
  return list;
}

export function validateServerConfig(raw: unknown, where: string, errors: ContentErrors): ServerConfig {
  const c = new Checker(errors, where);
  const o = c.object(raw, '$') ?? {};
  c.string(o, 'name', '$');
  c.string(o, 'motd', '$', false);
  c.number(o, 'maxPlayers', '$', { min: 1, max: 64, int: true });
  c.boolean(o, 'pvp', '$', true);
  c.string(o, 'map', '$');
  c.number(o, 'realSecondsPerDay', '$', { min: 60 });
  c.number(o, 'startHour', '$', { min: 0, max: 23.99 });
  const z = c.object(o.zombies, '$.zombies');
  if (z) {
    c.number(z, 'populationMultiplier', '$.zombies', { min: 0, max: 10 });
    c.object(z.distribution, '$.zombies.distribution');
    c.number(z, 'respawnGameHours', '$.zombies', { min: 0 });
    c.number(z, 'maxActive', '$.zombies', { min: 0, int: true });
    c.number(z, 'corpseLifetimeMinutes', '$.zombies', { min: 1 });
  }
  const l = c.object(o.loot, '$.loot');
  if (l) {
    c.number(l, 'abundance', '$.loot', { min: 0, max: 10 });
    c.number(l, 'houseFirearmChance', '$.loot', { min: 0, max: 1 });
  }
  const d = c.object(o.death, '$.death');
  if (d) {
    c.boolean(d, 'dropInventory', '$.death', true);
    c.number(d, 'xpLossFraction', '$.death', { min: 0, max: 1 });
    c.number(d, 'weaknessMinutes', '$.death', { min: 0 });
    c.number(d, 'respawnDelaySeconds', '$.death', { min: 0 });
  }
  const p = c.object(o.player, '$.player');
  if (p && !Array.isArray(p.startingItems)) c.fail('$.player.startingItems', 'expected an array');
  return o as unknown as ServerConfig;
}

/** Cross-reference checks that need every content type loaded. */
export function validateReferences(
  items: ItemDef[],
  lootTables: LootTableDef[],
  props: PropDef[],
  config: ServerConfig | null,
  zombies: ZombieArchetypeDef[],
  errors: ContentErrors,
): void {
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) errors.add(`items: duplicate item id "${item.id}"`);
    itemIds.add(item.id);
  }
  const calibers = new Set(items.filter((i) => i.ammo).map((i) => i.ammo!.caliber));
  const tags = new Set(items.flatMap((i) => i.tags ?? []));
  for (const item of items) {
    if (item.firearm && !calibers.has(item.firearm.caliber)) {
      errors.add(`items: ${item.id} uses caliber "${item.firearm.caliber}" but no ammo item provides it`);
    }
    if (item.consume?.leaves && !itemIds.has(item.consume.leaves)) {
      errors.add(`items: ${item.id} leaves unknown item "${item.consume.leaves}"`);
    }
    for (const tag of item.consume?.requires ?? []) {
      if (!tags.has(tag)) errors.add(`items: ${item.id} requires tag "${tag}" that no item has`);
    }
    if ((item.category === 'food' || item.category === 'drink') && !item.consume) {
      errors.add(`items: ${item.id} is ${item.category} but has no "consume" block`);
    }
  }
  const tableIds = new Set<string>();
  for (const t of lootTables) {
    if (tableIds.has(t.id)) errors.add(`loot: duplicate table id "${t.id}"`);
    tableIds.add(t.id);
  }
  for (const t of lootTables) {
    for (const e of t.entries) {
      if (e.item && !itemIds.has(e.item)) errors.add(`loot: ${t.id} references unknown item "${e.item}"`);
      if (e.table && !tableIds.has(e.table)) errors.add(`loot: ${t.id} references unknown table "${e.table}"`);
    }
  }
  const propIds = new Set<string>();
  for (const p of props) {
    if (propIds.has(p.id)) errors.add(`props: duplicate prop id "${p.id}"`);
    propIds.add(p.id);
    if (p.container && !tableIds.has(p.container.loot)) {
      errors.add(`props: ${p.id} uses unknown loot table "${p.container.loot}"`);
    }
  }
  if (config) {
    const zombieIds = new Set(zombies.map((z) => z.id));
    for (const id of Object.keys(config.zombies.distribution)) {
      if (!zombieIds.has(id)) errors.add(`config: zombie distribution references unknown archetype "${id}"`);
    }
    for (const s of config.player.startingItems) {
      if (!itemIds.has(s.item)) errors.add(`config: starting item "${s.item}" does not exist`);
    }
  }
}
