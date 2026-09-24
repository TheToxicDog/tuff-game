// Inventory data model shared by server (authority) and client (display, capacity previews).
//
// A player carries items in three places:
//   - five quick slots (holsters, slings, belt pouches) that hold one stack each and cost weight
//     but not container volume — the item in the selected slot is what the player holds;
//   - pockets, a small fixed-volume container;
//   - an equipped backpack (a container item whose `contents` hold items).

import type { ContentRegistry } from '../content/registry';
import type { ItemDef } from '../content/types';

export interface ItemStack {
  /** Unique instance id (server assigned). */
  uid: number;
  /** Item definition id. */
  id: string;
  qty: number;
  /** Condition 0..1 for degradable items. */
  cond?: number;
  /** Loaded rounds for firearms. */
  ammo?: number;
  /** Battery charge 0..1 for lights. */
  charge?: number;
  /** Remaining applications for multi-use consumables. */
  uses?: number;
  /** Contents of container items (backpacks, bags). */
  contents?: ItemStack[];
}

export const QUICK_SLOT_COUNT = 5;
export const QUICK_SLOT_NAMES = ['Primary', 'Secondary', 'Melee', 'Medical', 'Utility'] as const;

export const POCKETS = { volume: 4, maxWeight: 8 } as const;

/** Carried weight (kg) above which the player slows down, and the weight at which sprinting stops. */
export const ENCUMBRANCE = { comfortable: 16, heavy: 28, max: 45 } as const;

export interface PlayerInventory {
  slots: (ItemStack | null)[];
  pockets: ItemStack[];
  back: ItemStack | null;
}

export function emptyInventory(): PlayerInventory {
  return { slots: Array.from({ length: QUICK_SLOT_COUNT }, () => null), pockets: [], back: null };
}

/** Where a stack lives. Container ids refer to world containers or corpses. */
export type InvLocation =
  | { kind: 'pockets' }
  | { kind: 'backpack' }
  | { kind: 'back' }
  | { kind: 'slot'; index: number }
  | { kind: 'container'; id: string }
  | { kind: 'floor' };

export function stackWeight(content: ContentRegistry, stack: ItemStack): number {
  const def = content.findItem(stack.id);
  let weight = (def?.weight ?? 0) * stack.qty;
  if (stack.contents) for (const inner of stack.contents) weight += stackWeight(content, inner);
  return weight;
}

export function stackVolume(content: ContentRegistry, stack: ItemStack): number {
  const def = content.findItem(stack.id);
  return (def?.volume ?? 0) * stack.qty;
}

export interface Usage {
  weight: number;
  volume: number;
}

export function usageOf(content: ContentRegistry, items: readonly ItemStack[]): Usage {
  let weight = 0;
  let volume = 0;
  for (const s of items) {
    weight += stackWeight(content, s);
    volume += stackVolume(content, s);
  }
  return { weight, volume };
}

export function inventoryWeight(content: ContentRegistry, inv: PlayerInventory): number {
  let weight = 0;
  for (const s of inv.slots) if (s) weight += stackWeight(content, s);
  for (const s of inv.pockets) weight += stackWeight(content, s);
  if (inv.back) weight += stackWeight(content, inv.back);
  return weight;
}

/** Movement speed multiplier from carried weight (and the worn backpack). */
export function encumbranceSpeed(content: ContentRegistry, inv: PlayerInventory): number {
  const weight = inventoryWeight(content, inv);
  let factor = 1;
  if (weight > ENCUMBRANCE.comfortable) {
    const over = (weight - ENCUMBRANCE.comfortable) / (ENCUMBRANCE.max - ENCUMBRANCE.comfortable);
    factor = Math.max(0.45, 1 - over * 0.55);
  }
  const backDef = inv.back ? content.findItem(inv.back.id) : undefined;
  if (backDef?.container) factor *= backDef.container.speedFactor;
  return factor;
}

export function canSprintWithWeight(content: ContentRegistry, inv: PlayerInventory): boolean {
  return inventoryWeight(content, inv) < ENCUMBRANCE.heavy;
}

/** Capacity of a location, or null when it has no volume limit (quick slots, floor). */
export function capacityOf(content: ContentRegistry, inv: PlayerInventory, loc: InvLocation, containerVolume?: number): Usage | null {
  switch (loc.kind) {
    case 'pockets':
      return { volume: POCKETS.volume, weight: POCKETS.maxWeight };
    case 'backpack': {
      const def = inv.back ? content.findItem(inv.back.id) : undefined;
      return def?.container ? { volume: def.container.volume, weight: def.container.maxWeight } : null;
    }
    case 'container':
      return containerVolume !== undefined ? { volume: containerVolume, weight: Infinity } : null;
    default:
      return null;
  }
}

/** True for items that can merge into one stack. */
export function canStack(a: ItemStack, b: ItemStack, def: ItemDef): boolean {
  return (
    a.id === b.id &&
    def.stackSize > 1 &&
    a.cond === undefined &&
    b.cond === undefined &&
    a.ammo === undefined &&
    b.ammo === undefined &&
    a.uses === undefined &&
    b.uses === undefined &&
    a.charge === undefined &&
    b.charge === undefined &&
    !a.contents &&
    !b.contents
  );
}

/**
 * Adds a stack to a list, merging into existing stacks where possible. Mutates the list and the
 * incoming stack's quantity. Returns the stacks that were created or grown.
 */
export function addToList(content: ContentRegistry, list: ItemStack[], stack: ItemStack, newUid: () => number): void {
  const def = content.findItem(stack.id);
  if (def && def.stackSize > 1) {
    for (const existing of list) {
      if (stack.qty <= 0) break;
      if (!canStack(existing, stack, def) || existing.qty >= def.stackSize) continue;
      const moved = Math.min(stack.qty, def.stackSize - existing.qty);
      existing.qty += moved;
      stack.qty -= moved;
    }
    while (stack.qty > def.stackSize) {
      list.push({ ...stack, uid: newUid(), qty: def.stackSize });
      stack.qty -= def.stackSize;
    }
  }
  if (stack.qty > 0) list.push(stack);
}

/** Total quantity of items matching a predicate anywhere in the player's inventory. */
export function countItems(inv: PlayerInventory, predicate: (s: ItemStack) => boolean): number {
  let total = 0;
  forEachStack(inv, (s) => {
    if (predicate(s)) total += s.qty;
  });
  return total;
}

/** Visits every stack the player carries, including backpack contents. */
export function forEachStack(inv: PlayerInventory, fn: (stack: ItemStack, list: ItemStack[] | null) => void): void {
  for (const s of inv.slots) if (s) fn(s, null);
  for (const s of inv.pockets) fn(s, inv.pockets);
  if (inv.back) {
    fn(inv.back, null);
    for (const s of inv.back.contents ?? []) fn(s, inv.back.contents!);
  }
}

export function findStack(inv: PlayerInventory, uid: number): { stack: ItemStack; loc: InvLocation } | null {
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (s?.uid === uid) return { stack: s, loc: { kind: 'slot', index: i } };
  }
  for (const s of inv.pockets) if (s.uid === uid) return { stack: s, loc: { kind: 'pockets' } };
  if (inv.back) {
    if (inv.back.uid === uid) return { stack: inv.back, loc: { kind: 'back' } };
    for (const s of inv.back.contents ?? []) if (s.uid === uid) return { stack: s, loc: { kind: 'backpack' } };
  }
  return null;
}

/** Items carrying a tag, e.g. a can opener for canned food. */
export function hasToolTag(content: ContentRegistry, inv: PlayerInventory, tag: string): boolean {
  let found = false;
  forEachStack(inv, (s) => {
    if (!found && content.findItem(s.id)?.tags?.includes(tag)) found = true;
  });
  return found;
}

/** Natural quick slot for an item: 0 primary (long guns), 1 secondary (handguns), 2 melee, 3 medical, 4 utility. */
export function preferredSlot(def: ItemDef): number | null {
  if (def.firearm) return def.tags?.includes('handgun') ? 1 : 0;
  if (def.melee) return 2;
  if (def.light) return 4;
  return null;
}

export function reserveAmmo(content: ContentRegistry, inv: PlayerInventory, caliber: string): number {
  return countItems(inv, (s) => content.findItem(s.id)?.ammo?.caliber === caliber);
}
