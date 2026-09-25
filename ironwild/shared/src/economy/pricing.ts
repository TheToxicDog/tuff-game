// Market pricing (§12–14). Each settlement keeps a stock of every good it trades and a target
// stock (its normal demand). Prices rise when stock is scarce and fall when it is saturated;
// stock drifts back to the target as NPC businesses consume and produce.

import { QUALITY_PRICE } from '../constants';
import type { ItemCategory, ItemDef } from '../content/items';
import type { SettlementDef } from '../content/settlements';
import { clamp } from '../math';

/** Price elasticity: how strongly stock levels move prices. */
export const ELASTICITY = 0.6;
export const PRICE_FLOOR = 0.35;
export const PRICE_CEILING = 2.6;
/** NPC sellers charge this much over the market price. */
export const ASK_MARKUP = 1.18;
/** Game days for stock to recover halfway back to its target. */
export const RECOVERY_HALF_LIFE_DAYS = 0.5;

const TARGET_BY_CATEGORY: Record<ItemCategory, number> = {
  resource: 300,
  ore: 260,
  food: 180,
  material: 160,
  component: 70,
  tool: 12,
  weapon: 10,
  ammo: 300,
  gear: 6,
  building: 50,
  machine: 10,
  seed: 150,
  animal: 8,
  luxury: 25,
  blueprint: 2,
};

/** Normal (target) stock of an item in a settlement. */
export function targetStock(def: ItemDef, settlement: SettlementDef): number {
  const base = TARGET_BY_CATEGORY[def.category];
  // Cheap bulk goods move in larger volumes than expensive ones.
  const valueScale = clamp(Math.sqrt(10 / Math.max(def.value, 0.5)), 0.4, 2);
  return Math.max(2, Math.round(base * settlement.scale * valueScale));
}

/** Regional factor: the lowest (most local) of the item's tags wins for exports, the highest for imports. */
export function localFactor(def: ItemDef, settlement: SettlementDef): number {
  let lo = 1;
  let hi = 1;
  for (const tag of def.tags) {
    const f = settlement.factors[tag];
    if (f === undefined) continue;
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  return lo < 1 ? lo : hi;
}

export function stockFactor(stock: number, target: number): number {
  return clamp(Math.pow(target / Math.max(stock, 0.5), ELASTICITY), PRICE_FLOOR, PRICE_CEILING);
}

/** Market ("mid") price of one Standard unit at a given stock level. */
export function midPrice(def: ItemDef, settlement: SettlementDef, stock: number, target: number): number {
  return def.value * localFactor(def, settlement) * stockFactor(stock, target);
}

export const qualityMultiplier = (quality: number | undefined): number => QUALITY_PRICE[quality ?? 1] ?? 1;

/**
 * Total paid for selling `count` units one after another: every unit sold raises the stock and
 * lowers the price of the next (§13).
 */
export function saleValue(
  def: ItemDef,
  settlement: SettlementDef,
  stock: number,
  target: number,
  count: number,
  bidRate: number,
  quality?: number,
): number {
  let total = 0;
  const q = qualityMultiplier(quality);
  for (let i = 0; i < count; i++) total += midPrice(def, settlement, stock + i, target) * bidRate * q;
  return total;
}

/** Total cost of buying `count` units one after another from an NPC. */
export function purchaseCost(def: ItemDef, settlement: SettlementDef, stock: number, target: number, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += midPrice(def, settlement, stock - i, target) * ASK_MARKUP;
  return total;
}

/** Stock after `days` of recovery towards the target. */
export function recoverStock(stock: number, target: number, days: number): number {
  const keep = Math.pow(0.5, days / RECOVERY_HALF_LIFE_DAYS);
  return target + (stock - target) * keep;
}

/** Rounds Crest amounts to one decimal (prices under ₡100) or whole Crests. */
export function roundCrests(value: number): number {
  return Math.round(value * 10) / 10;
}
