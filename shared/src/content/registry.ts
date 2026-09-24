import type { ContentBundle, FirearmDef, ItemDef, MeleeDef, PropDef, ZombieArchetypeDef } from './types';

/** Lookup tables over loaded content. Item indices are stable for a given bundle and are used as
 * compact network ids. */
export class ContentRegistry {
  readonly items: readonly ItemDef[];
  readonly zombies: readonly ZombieArchetypeDef[];
  readonly props: readonly PropDef[];
  readonly hash: string;
  private readonly itemMap = new Map<string, ItemDef>();
  private readonly itemIndexMap = new Map<string, number>();
  private readonly zombieMap = new Map<string, ZombieArchetypeDef>();
  private readonly propMap = new Map<string, PropDef>();

  constructor(bundle: ContentBundle) {
    this.hash = bundle.hash;
    this.items = bundle.items;
    this.zombies = bundle.zombies;
    this.props = bundle.props;
    bundle.items.forEach((item, index) => {
      this.itemMap.set(item.id, item);
      this.itemIndexMap.set(item.id, index);
    });
    for (const z of bundle.zombies) this.zombieMap.set(z.id, z);
    for (const p of bundle.props) this.propMap.set(p.id, p);
  }

  hasItem(id: string): boolean {
    return this.itemMap.has(id);
  }

  item(id: string): ItemDef {
    const def = this.itemMap.get(id);
    if (!def) throw new Error(`Unknown item "${id}"`);
    return def;
  }

  findItem(id: string): ItemDef | undefined {
    return this.itemMap.get(id);
  }

  itemIndex(id: string): number {
    const index = this.itemIndexMap.get(id);
    if (index === undefined) throw new Error(`Unknown item "${id}"`);
    return index;
  }

  itemAt(index: number): ItemDef | undefined {
    return this.items[index];
  }

  zombie(id: string): ZombieArchetypeDef {
    const def = this.zombieMap.get(id);
    if (!def) throw new Error(`Unknown zombie archetype "${id}"`);
    return def;
  }

  zombieIndex(id: string): number {
    return this.zombies.findIndex((z) => z.id === id);
  }

  prop(id: string): PropDef {
    const def = this.propMap.get(id);
    if (!def) throw new Error(`Unknown prop "${id}"`);
    return def;
  }

  findProp(id: string): PropDef | undefined {
    return this.propMap.get(id);
  }

  /** Items that carry the given tag. */
  itemsWithTag(tag: string): ItemDef[] {
    return this.items.filter((item) => item.tags?.includes(tag));
  }
}

/** What the player's hands can do right now: a firearm, a melee weapon, or bare fists. */
export interface WeaponProfile {
  itemId: string | null;
  melee: MeleeDef | null;
  firearm: FirearmDef | null;
  equipTime: number;
}

export const FISTS: MeleeDef = {
  damage: 9,
  reach: 1.05,
  arc: 70,
  windup: 0.1,
  recovery: 0.3,
  stamina: 0.035,
  knockback: 2.2,
  maxTargets: 1,
  noise: 5,
  damageType: 'blunt',
  knockdown: 0.04,
  structureDamage: 0.3,
};

/** Every player can shove, regardless of what they are holding. */
export const SHOVE: MeleeDef = {
  damage: 2,
  reach: 1.2,
  arc: 120,
  windup: 0.07,
  recovery: 0.42,
  stamina: 0.09,
  knockback: 5.5,
  maxTargets: 3,
  noise: 4,
  damageType: 'blunt',
  knockdown: 0.35,
  structureDamage: 0,
};

export const UNARMED: WeaponProfile = { itemId: null, melee: FISTS, firearm: null, equipTime: 0.15 };

export function weaponProfile(item: ItemDef | undefined | null): WeaponProfile {
  if (!item) return UNARMED;
  if (item.firearm) {
    return { itemId: item.id, melee: null, firearm: item.firearm, equipTime: item.firearm.equipTime ?? 0.45 };
  }
  if (item.melee) {
    return { itemId: item.id, melee: item.melee, firearm: null, equipTime: item.melee.equipTime ?? 0.3 };
  }
  // Holding a non-weapon item: you punch while holding it.
  return { itemId: item.id, melee: FISTS, firearm: null, equipTime: 0.2 };
}
