// Slot inventories (§37): a fixed number of slots, each holding one stack. Items with quality
// only stack with the same quality.

import { STANDARD_QUALITY } from './constants';
import { ITEM_BY_ID } from './content/items';

export interface ItemStack {
  id: string;
  n: number;
  /** Quality tier 0–4 for items that have quality. */
  q?: number;
}

export type Slots = (ItemStack | null)[];

export function normalizeQuality(id: string, q: number | undefined): number | undefined {
  const def = ITEM_BY_ID.get(id);
  if (!def?.quality) return undefined;
  return q === undefined ? STANDARD_QUALITY : Math.max(0, Math.min(4, Math.round(q)));
}

export function makeStack(id: string, n: number, q?: number): ItemStack {
  const quality = normalizeQuality(id, q);
  return quality === undefined ? { id, n } : { id, n, q: quality };
}

export const sameKind = (a: ItemStack, b: ItemStack): boolean => a.id === b.id && (a.q ?? -1) === (b.q ?? -1);

export function stackLimit(id: string): number {
  return ITEM_BY_ID.get(id)?.stack ?? 1;
}

export function countItem(slots: Slots, id: string, q?: number): number {
  let n = 0;
  for (const s of slots) if (s && s.id === id && (q === undefined || s.q === q)) n += s.n;
  return n;
}

/** How many units of `stack` would fit. */
export function roomFor(slots: Slots, stack: ItemStack): number {
  const limit = stackLimit(stack.id);
  let room = 0;
  for (const s of slots) {
    if (!s) room += limit;
    else if (sameKind(s, stack)) room += Math.max(0, limit - s.n);
    if (room >= stack.n) return stack.n;
  }
  return room;
}

/** Adds as much of `stack` as fits; returns the number of units that did not fit. */
export function addStack(slots: Slots, stack: ItemStack): number {
  const limit = stackLimit(stack.id);
  let left = stack.n;
  for (const s of slots) {
    if (left <= 0) break;
    if (s && sameKind(s, stack) && s.n < limit) {
      const take = Math.min(left, limit - s.n);
      s.n += take;
      left -= take;
    }
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i]) continue;
    const take = Math.min(left, limit);
    slots[i] = { ...stack, n: take };
    left -= take;
  }
  return left;
}

export function hasAll(slots: Slots, reqs: readonly { item: string; n: number }[]): boolean {
  const need = new Map<string, number>();
  for (const r of reqs) need.set(r.item, (need.get(r.item) ?? 0) + r.n);
  for (const [id, n] of need) if (countItem(slots, id) < n) return false;
  return true;
}

/** Removes `n` units of an item, lowest quality first. Returns the removed stacks. */
export function removeItem(slots: Slots, id: string, n: number): ItemStack[] {
  const removed: ItemStack[] = [];
  let left = n;
  const order = slots
    .map((s, i) => ({ s, i }))
    .filter((e) => e.s && e.s.id === id)
    .sort((a, b) => (a.s!.q ?? 1) - (b.s!.q ?? 1));
  for (const { s, i } of order) {
    if (left <= 0) break;
    const take = Math.min(left, s!.n);
    s!.n -= take;
    left -= take;
    const prev = removed.find((r) => r.q === s!.q);
    if (prev) prev.n += take;
    else removed.push(s!.q === undefined ? { id, n: take } : { id, n: take, q: s!.q });
    if (s!.n <= 0) slots[i] = null;
  }
  return removed;
}

export function removeAll(slots: Slots, reqs: readonly { item: string; n: number }[]): ItemStack[] {
  const out: ItemStack[] = [];
  for (const r of reqs) out.push(...removeItem(slots, r.item, r.n));
  return out;
}

/** Average quality of removed stacks (Standard if none have quality). */
export function averageQuality(stacks: readonly ItemStack[]): number {
  let total = 0;
  let n = 0;
  for (const s of stacks) {
    if (s.q === undefined) continue;
    total += s.q * s.n;
    n += s.n;
  }
  return n === 0 ? STANDARD_QUALITY : total / n;
}

/**
 * Moves (or merges, or swaps) up to `count` units from one slot to another, possibly between two
 * slot arrays. Returns false if nothing moved.
 */
export function moveBetween(from: Slots, fi: number, to: Slots, ti: number, count?: number): boolean {
  const src = from[fi];
  if (!src || fi < 0 || ti < 0 || ti >= to.length) return false;
  if (from === to && fi === ti) return false;
  const n = Math.max(1, Math.min(count ?? src.n, src.n));
  const dst = to[ti];
  if (!dst) {
    to[ti] = { ...src, n };
    src.n -= n;
    if (src.n <= 0) from[fi] = null;
    return true;
  }
  if (sameKind(dst, src)) {
    const room = stackLimit(src.id) - dst.n;
    const take = Math.min(room, n);
    if (take <= 0) return false;
    dst.n += take;
    src.n -= take;
    if (src.n <= 0) from[fi] = null;
    return true;
  }
  // Different items: swap whole stacks.
  if (n !== src.n) return false;
  from[fi] = dst;
  to[ti] = src;
  return true;
}

export function emptySlots(n: number): Slots {
  return Array.from({ length: n }, () => null);
}

export function cloneSlots(slots: Slots): Slots {
  return slots.map((s) => (s ? { ...s } : null));
}
