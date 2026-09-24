// Item descriptions for the inventory UI: short meta lines, stat blocks and verbs.

import { stackWeight, type ContentRegistry, type ItemDef, type ItemStack } from '@tuff/shared';

const CATEGORY_NAMES: Record<string, string> = {
  food: 'Food',
  drink: 'Drink',
  medical: 'Medical',
  weapon: 'Weapon',
  ammo: 'Ammunition',
  tool: 'Tool',
  container: 'Bag',
  material: 'Material',
  hygiene: 'Hygiene',
  electronics: 'Electronics',
  literature: 'Reading',
  fuel: 'Fuel',
  junk: 'Junk',
  collectible: 'Valuable',
  furniture: 'Furniture',
};

export function categoryName(def: ItemDef): string {
  if (def.firearm) return 'Firearm';
  if (def.melee) return 'Melee Weapon';
  return CATEGORY_NAMES[def.category] ?? def.category;
}

export function kg(v: number): string {
  if (v < 0.095) return `${Math.round(v * 1000)} g`;
  return `${v.toFixed(v < 10 ? 1 : 0)} kg`;
}

export function conditionLabel(cond: number): string {
  if (cond > 0.85) return 'Pristine';
  if (cond > 0.6) return 'Worn';
  if (cond > 0.35) return 'Damaged';
  if (cond > 0.12) return 'Badly damaged';
  return 'Nearly broken';
}

/** One-line summary shown under the item name. */
export function itemMeta(content: ContentRegistry, def: ItemDef, stack: ItemStack, magAmmo?: number): string {
  const parts: string[] = [];
  if (def.firearm) parts.push(`${magAmmo ?? stack.ammo ?? 0}/${def.firearm.magazine} ${def.firearm.caliber}`);
  if (stack.uses !== undefined && def.uses) parts.push(`${stack.uses}/${def.uses} uses`);
  if (stack.charge !== undefined && def.light) parts.push(`${Math.round(stack.charge * 100)}% battery`);
  if (stack.cond !== undefined && def.durability) parts.push(conditionLabel(stack.cond));
  if (def.container && stack.contents) parts.push(`${stack.contents.length} item${stack.contents.length === 1 ? '' : 's'} inside`);
  parts.push(kg(stackWeight(content, stack)));
  return parts.join(' · ');
}

export interface StatLine {
  label: string;
  value: string;
}

export function itemStats(def: ItemDef): StatLine[] {
  const out: StatLine[] = [{ label: 'Type', value: categoryName(def) }];
  out.push({ label: 'Weight', value: kg(def.weight) });
  out.push({ label: 'Volume', value: `${def.volume.toFixed(def.volume < 1 ? 2 : 1)} L` });
  if (def.firearm) {
    const f = def.firearm;
    out.push({ label: 'Damage', value: f.pellets ? `${f.damage} × ${f.pellets}` : `${f.damage}` });
    out.push({ label: 'Capacity', value: `${f.magazine} rounds` });
    out.push({ label: 'Fire rate', value: `${f.rpm} rpm${f.automatic ? ' (auto)' : ''}` });
    out.push({ label: 'Range', value: `${f.range} m` });
    out.push({ label: 'Noise', value: f.noise > 70 ? 'Deafening' : f.noise > 50 ? 'Very loud' : 'Loud' });
  }
  if (def.melee) {
    const m = def.melee;
    out.push({ label: 'Damage', value: `${m.damage} (${m.damageType})` });
    out.push({ label: 'Reach', value: `${m.reach.toFixed(1)} m` });
    out.push({ label: 'Speed', value: m.windup + m.recovery < 0.6 ? 'Fast' : m.windup + m.recovery < 0.9 ? 'Average' : 'Slow' });
  }
  if (def.nutrition) {
    const n = def.nutrition;
    if (n.hunger) out.push({ label: 'Hunger', value: signed(n.hunger) });
    if (n.thirst) out.push({ label: 'Thirst', value: signed(n.thirst) });
    if (n.calories) out.push({ label: 'Calories', value: `${n.calories}` });
  }
  if (def.medical) out.push({ label: 'Treats', value: def.medical.treatments.join(', ') });
  if (def.container) {
    out.push({ label: 'Capacity', value: `${def.container.volume} L` });
    out.push({ label: 'Max load', value: kg(def.container.maxWeight) });
  }
  if (def.light) out.push({ label: 'Light range', value: `${def.light.range} m` });
  if (def.ammo) out.push({ label: 'Caliber', value: def.ammo.caliber });
  return out;
}

function signed(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/** The verb for "using" an item, or null if it has no direct use. */
export function useVerb(def: ItemDef): string | null {
  if (def.container) return 'Wear';
  if (def.firearm || def.melee) return 'Equip';
  if (def.id === 'batteries') return 'Replace batteries';
  if (def.category === 'drink') return 'Drink';
  if (def.nutrition) return 'Eat';
  if (def.medical) {
    const t = def.medical.treatments;
    if (t.includes('painkiller') || t.includes('antibiotic')) return 'Take';
    return 'Apply';
  }
  return null;
}
