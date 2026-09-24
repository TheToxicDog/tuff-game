// Server-authoritative inventory operations: moving stacks between pockets, backpack, quick slots,
// world containers, corpses and the floor; eating, drinking and medical treatment; reload ammo.
// Every request from a client is validated here — the client only ever asks.

import {
  addToList,
  applyTreatment,
  BODY_PARTS,
  canStack,
  capacityOf,
  countItems,
  findStack,
  forEachStack,
  hasToolTag,
  INTERACT_RANGE,
  planConsumption,
  POCKETS,
  preferredSlot,
  QUICK_SLOT_COUNT,
  stackVolume,
  stackWeight,
  usageOf,
  type ContainerView,
  type InvLocation,
  type ItemDef,
  type ItemStack,
  type PlayerInventory,
  type WorldItemView,
} from '@tuff/shared';
import { Corpse, GroundItem, Player, Transform, type PlayerComp } from './components';
import type { Game } from './game';
import { newUid } from './loot';

const FLOOR_RANGE = 2.4;
const CORPSE_RANGE = 2.2;

type Loc = InvLocation;

interface ListRef {
  items: ItemStack[];
  /** Volume / weight limits, or null for unlimited. */
  capacity: { volume: number; weight: number } | null;
  onChange: () => void;
}

export class InventoryService {
  constructor(private readonly game: Game) {}

  private get content() {
    return this.game.content;
  }

  // --- Helpers --------------------------------------------------------------------------------

  private def(stack: ItemStack): ItemDef | undefined {
    return this.content.findItem(stack.id);
  }

  private playerList(p: PlayerComp, kind: 'pockets' | 'backpack'): ListRef | null {
    const inv = p.inventory;
    if (kind === 'pockets') {
      return {
        items: inv.pockets,
        capacity: { volume: POCKETS.volume, weight: POCKETS.maxWeight },
        onChange: () => (p.inventoryDirty = true),
      };
    }
    if (!inv.back) return null;
    const cap = capacityOf(this.content, inv, { kind: 'backpack' });
    inv.back.contents ??= [];
    return { items: inv.back.contents, capacity: cap, onChange: () => (p.inventoryDirty = true) };
  }

  /** Resolves an open external container (world container or corpse) the player may access. */
  private externalList(e: number, p: PlayerComp, id: string): ListRef | null {
    if (p.openContainer !== id || !this.inRangeOf(e, id)) return null;
    if (id.startsWith('e:')) {
      const ent = Number(id.slice(2));
      const corpse = this.game.ecs.get(ent, Corpse);
      if (!corpse) return null;
      return {
        items: corpse.items,
        capacity: null,
        onChange: () => {
          this.game.persistCorpse(ent);
          this.game.pushContainer(id);
        },
      };
    }
    const container = this.game.world.compiled.containers.get(id);
    const contents = this.game.world.containers.get(id);
    if (!container || !contents) return null;
    return {
      items: contents.items,
      capacity: { volume: container.volume, weight: Infinity },
      onChange: () => {
        this.game.world.markContainerDirty(id);
        this.game.pushContainer(id);
      },
    };
  }

  /** True when the player entity is close enough to use the container. */
  inRangeOf(e: number, id: string): boolean {
    const t = this.game.ecs.get(e, Transform);
    if (!t) return false;
    if (id === 'floor') return true;
    if (id.startsWith('e:')) {
      const ct = this.game.ecs.get(Number(id.slice(2)), Transform);
      return !!ct && Math.hypot(ct.x - t.x, ct.y - t.y) <= CORPSE_RANGE;
    }
    const c = this.game.world.compiled.containers.get(id);
    return !!c && Math.hypot(c.x - t.x, c.y - t.y) <= INTERACT_RANGE + c.radius * 0.85;
  }

  floorItems(e: number): { entity: number; stack: ItemStack }[] {
    const t = this.game.ecs.get(e, Transform);
    if (!t) return [];
    const out: { entity: number; stack: ItemStack }[] = [];
    for (const id of this.game.spatial.query(t.x, t.y, FLOOR_RANGE)) {
      const g = this.game.ecs.get(id, GroundItem);
      const gt = this.game.ecs.get(id, Transform);
      if (g && gt && Math.hypot(gt.x - t.x, gt.y - t.y) <= FLOOR_RANGE) out.push({ entity: id, stack: g.stack });
    }
    return out;
  }

  floorView(e: number): WorldItemView[] {
    return this.floorItems(e).map((f) => ({ entity: f.entity, stack: f.stack }));
  }

  containerView(id: string): ContainerView | null {
    if (id.startsWith('e:')) {
      const corpse = this.game.ecs.get(Number(id.slice(2)), Corpse);
      if (!corpse) return null;
      return { id, name: corpse.player ? `${corpse.name}'s body` : 'Corpse', volume: 0, items: corpse.items };
    }
    const c = this.game.world.compiled.containers.get(id);
    const contents = this.game.world.containers.get(id);
    if (!c || !contents) return null;
    return { id, name: c.name, volume: c.volume, items: contents.items };
  }

  private fits(list: ListRef, stack: ItemStack, qty: number): string | null {
    const def = this.def(stack);
    if (!def) return 'Unknown item.';
    if (!list.capacity) return null;
    const usage = usageOf(this.content, list.items);
    const addVolume = def.volume * qty + (stack.contents ? usageOf(this.content, stack.contents).volume : 0);
    const addWeight = (stackWeight(this.content, stack) / Math.max(1, stack.qty)) * qty;
    if (usage.volume + addVolume > list.capacity.volume + 1e-6) return 'Not enough room.';
    if (usage.weight + addWeight > list.capacity.weight + 1e-6) return 'Too heavy for that bag.';
    return null;
  }

  /** Tries to put a stack somewhere sensible in the player's inventory. Returns false if it does not fit. */
  autoPlace(p: PlayerComp, stack: ItemStack): boolean {
    const def = this.def(stack);
    if (!def) return false;
    const inv = p.inventory;
    // Weapons and tools go to their natural quick slot if it is free.
    const preferred = preferredSlot(def);
    if (preferred !== null && !inv.slots[preferred] && !stack.contents?.length) {
      inv.slots[preferred] = stack;
      p.inventoryDirty = true;
      return true;
    }
    if (def.container && !inv.back && !stack.contents?.length) {
      inv.back = stack;
      p.inventoryDirty = true;
      return true;
    }
    for (const kind of ['backpack', 'pockets'] as const) {
      const list = this.playerList(p, kind);
      if (!list || stack.contents?.length) continue;
      if (this.fits(list, stack, stack.qty) === null) {
        addToList(this.content, list.items, stack, newUid);
        p.inventoryDirty = true;
        return true;
      }
    }
    // Last resort: any free quick slot for bulky items.
    if (!stack.contents?.length && (def.firearm || def.melee || def.volume > 1.5)) {
      const free = inv.slots.findIndex((s) => s === null);
      if (free >= 0) {
        inv.slots[free] = stack;
        p.inventoryDirty = true;
        return true;
      }
    }
    return false;
  }

  // --- Moving stacks --------------------------------------------------------------------------

  move(e: number, p: PlayerComp, uid: number, from: Loc, to: Loc, qtyRaw?: number): string | null {
    if (sameLoc(from, to)) return null;
    const source = this.takeFrom(e, p, uid, from);
    if (!source) return 'That item is not there any more.';
    const { stack } = source;
    const qty = Math.max(1, Math.min(stack.qty, Math.floor(qtyRaw ?? stack.qty)));
    const moving: ItemStack = qty === stack.qty ? stack : { ...stack, uid: newUid(), qty };
    const error = this.putInto(e, p, moving, to, stack.uid === p.inventory.back?.uid);
    if (error) return error;
    if (qty === stack.qty) source.remove();
    else {
      stack.qty -= qty;
      source.changed();
    }
    return null;
  }

  /** Finds a stack at a location and returns handles to remove or update it. */
  private takeFrom(e: number, p: PlayerComp, uid: number, loc: Loc): { stack: ItemStack; remove: () => void; changed: () => void } | null {
    const inv = p.inventory;
    switch (loc.kind) {
      case 'pockets':
      case 'backpack': {
        const list = this.playerList(p, loc.kind);
        const i = list?.items.findIndex((s) => s.uid === uid) ?? -1;
        if (!list || i < 0) return null;
        return {
          stack: list.items[i],
          remove: () => {
            const j = list.items.findIndex((s) => s.uid === uid);
            if (j >= 0) list.items.splice(j, 1);
            list.onChange();
          },
          changed: list.onChange,
        };
      }
      case 'slot': {
        const index = loc.index;
        const s = inv.slots[index];
        if (!s || s.uid !== uid) return null;
        return {
          stack: s,
          remove: () => {
            inv.slots[index] = null;
            p.inventoryDirty = true;
          },
          changed: () => (p.inventoryDirty = true),
        };
      }
      case 'back': {
        const s = inv.back;
        if (!s || s.uid !== uid) return null;
        return {
          stack: s,
          remove: () => {
            inv.back = null;
            p.inventoryDirty = true;
          },
          changed: () => (p.inventoryDirty = true),
        };
      }
      case 'container': {
        const list = this.externalList(e, p, loc.id);
        const i = list?.items.findIndex((s) => s.uid === uid) ?? -1;
        if (!list || i < 0) return null;
        return {
          stack: list.items[i],
          remove: () => {
            const j = list.items.findIndex((s) => s.uid === uid);
            if (j >= 0) list.items.splice(j, 1);
            list.onChange();
          },
          changed: list.onChange,
        };
      }
      case 'floor': {
        const found = this.floorItems(e).find((f) => f.stack.uid === uid);
        if (!found) return null;
        return {
          stack: found.stack,
          remove: () => this.game.removeGroundItem(found.entity),
          changed: () => this.game.persistGroundItem(found.entity),
        };
      }
    }
  }

  private putInto(e: number, p: PlayerComp, stack: ItemStack, to: Loc, isBackItem: boolean): string | null {
    const def = this.def(stack);
    if (!def) return 'Unknown item.';
    const inv = p.inventory;
    const hasContents = (stack.contents?.length ?? 0) > 0;
    switch (to.kind) {
      case 'pockets':
      case 'backpack': {
        if (isBackItem && to.kind === 'backpack') return 'A bag cannot go inside itself.';
        if (hasContents) return 'Empty the bag first.';
        const list = this.playerList(p, to.kind);
        if (!list) return 'You are not carrying a bag.';
        const err = this.fits(list, stack, stack.qty);
        if (err) return err;
        addToList(this.content, list.items, stack, newUid);
        list.onChange();
        return null;
      }
      case 'slot': {
        if (to.index < 0 || to.index >= QUICK_SLOT_COUNT) return 'Invalid slot.';
        if (hasContents) return 'Empty the bag first.';
        const existing = inv.slots[to.index];
        if (existing) {
          if (canStack(existing, stack, def) && existing.qty + stack.qty <= def.stackSize) {
            existing.qty += stack.qty;
            p.inventoryDirty = true;
            return null;
          }
          return 'That slot is already in use.';
        }
        inv.slots[to.index] = stack;
        p.inventoryDirty = true;
        return null;
      }
      case 'back': {
        if (!def.container) return 'That is not a bag.';
        if (inv.back) return 'You are already carrying a bag.';
        inv.back = stack;
        stack.contents ??= [];
        p.inventoryDirty = true;
        return null;
      }
      case 'container': {
        const list = this.externalList(e, p, to.id);
        if (!list) return 'That container is out of reach.';
        const err = this.fits(list, stack, stack.qty);
        if (err) return err;
        addToList(this.content, list.items, stack, newUid);
        list.onChange();
        return null;
      }
      case 'floor': {
        const t = this.game.ecs.get(e, Transform);
        if (!t) return 'Nowhere to drop it.';
        this.game.spawnGroundItem(t.x + this.game.rng.range(-0.4, 0.4), t.y + this.game.rng.range(-0.4, 0.4), stack);
        return null;
      }
    }
  }

  takeAll(e: number, p: PlayerComp, containerId: string): string | null {
    const list = containerId === 'floor' ? null : this.externalList(e, p, containerId);
    const stacks = containerId === 'floor' ? this.floorItems(e).map((f) => f.stack) : list?.items.slice();
    if (!stacks) return 'That container is out of reach.';
    let skipped = 0;
    for (const s of stacks) {
      const err = this.move(e, p, s.uid, containerId === 'floor' ? { kind: 'floor' } : { kind: 'container', id: containerId }, {
        kind: 'backpack',
      });
      if (err === null) continue;
      if (
        this.move(e, p, s.uid, containerId === 'floor' ? { kind: 'floor' } : { kind: 'container', id: containerId }, {
          kind: 'pockets',
        }) === null
      )
        continue;
      skipped++;
    }
    return skipped > 0 ? `${skipped} item${skipped === 1 ? '' : 's'} did not fit.` : null;
  }

  unload(p: PlayerComp, uid: number): string | null {
    const found = findStack(p.inventory, uid);
    if (!found) return 'That item is not there any more.';
    const def = this.def(found.stack);
    if (!def?.firearm) return 'That is not a firearm.';
    const held = found.loc.kind === 'slot' && found.loc.index === p.sim.slot;
    const rounds = held ? p.sim.magAmmo : (found.stack.ammo ?? 0);
    if (rounds <= 0) return 'It is already empty.';
    const ammoDef = this.content.items.find((i) => i.ammo?.caliber === def.firearm!.caliber);
    if (!ammoDef) return 'No matching ammunition type.';
    const loose: ItemStack = { uid: newUid(), id: ammoDef.id, qty: rounds };
    if (!this.autoPlace(p, loose)) return 'No room for the rounds.';
    found.stack.ammo = 0;
    if (held) p.sim.magAmmo = 0;
    p.inventoryDirty = true;
    return null;
  }

  /** Removes `rounds` loose rounds of a caliber (reloading). */
  consumeAmmo(p: PlayerComp, caliber: string, rounds: number): void {
    let remaining = rounds;
    const lists: ItemStack[][] = [p.inventory.pockets, p.inventory.back?.contents ?? []];
    for (const list of lists) {
      for (let i = list.length - 1; i >= 0 && remaining > 0; i--) {
        const s = list[i];
        if (this.def(s)?.ammo?.caliber !== caliber) continue;
        const take = Math.min(remaining, s.qty);
        s.qty -= take;
        remaining -= take;
        if (s.qty <= 0) list.splice(i, 1);
      }
    }
    for (let i = 0; i < p.inventory.slots.length && remaining > 0; i++) {
      const s = p.inventory.slots[i];
      if (!s || this.def(s)?.ammo?.caliber !== caliber) continue;
      const take = Math.min(remaining, s.qty);
      s.qty -= take;
      remaining -= take;
      if (s.qty <= 0) p.inventory.slots[i] = null;
    }
    p.inventoryDirty = true;
  }

  // --- Using items ----------------------------------------------------------------------------

  /** Validates a use request and returns the timed action to start, or an error message. */
  beginUse(e: number, p: PlayerComp, uid: number, woundId?: number): string | null {
    const found = findStack(p.inventory, uid);
    if (!found) return 'That item is not there any more.';
    const stack = found.stack;
    const def = this.def(stack);
    if (!def) return 'Unknown item.';
    if (def.container && found.loc.kind !== 'back') {
      if (p.inventory.back) return 'You are already carrying a bag.';
      return this.move(e, p, uid, found.loc, { kind: 'back' });
    }
    if (def.id === 'batteries') return this.useBatteries(p, found.stack, found.loc);
    if (def.firearm || def.melee) {
      if (found.loc.kind === 'slot') return 'It is already in a quick slot.';
      const slot = preferredSlot(def);
      const target = slot !== null && !p.inventory.slots[slot] ? slot : p.inventory.slots.findIndex((s) => s === null);
      if (target === null || target < 0) return 'All quick slots are full.';
      return this.move(e, p, uid, found.loc, { kind: 'slot', index: target });
    }
    if (def.light) return 'Press F to use a light.';
    if (!def.consume && !def.medical) return 'You cannot use that.';
    for (const tag of def.consume?.requires ?? []) {
      if (!hasToolTag(this.content, p.inventory, tag)) return `You need a ${tag.replace(/_/g, ' ')} to open it.`;
    }
    if (def.medical && !def.nutrition) {
      // Check there is something to treat before starting the timer.
      const probe = structuredClone(p.body);
      const ok = def.medical.treatments.some(
        (t) => applyTreatment(probe, t, def.medical!.quality, this.game.minutes, def.medical!.duration ?? 240, woundId).ok,
      );
      if (!ok) return applyTreatment(probe, def.medical.treatments[0], 1, this.game.minutes, 0, woundId).message;
    }
    const verb = def.category === 'drink' ? 'Drinking' : def.category === 'food' ? 'Eating' : def.medical ? 'Treating' : 'Using';
    this.game.startAction(e, p, {
      kind: 'consume',
      label: `${verb} ${def.name}`,
      duration: def.consume?.time ?? 3,
      target: '',
      uid,
      woundId,
    });
    return null;
  }

  /** Called when a consume action completes. Returns a message to show. */
  finishUse(e: number, p: PlayerComp, uid: number, woundId?: number): string | null {
    const found = findStack(p.inventory, uid);
    if (!found) return null;
    const stack = found.stack;
    const def = this.def(stack);
    if (!def) return null;
    let message: string | null = null;
    if (def.nutrition) {
      const n = def.nutrition;
      p.needs.hunger = clampNeed(p.needs.hunger + (n.hunger ?? 0));
      p.needs.thirst = clampNeed(p.needs.thirst + (n.thirst ?? 0));
      p.needs.energy = clampNeed(p.needs.energy + (n.energy ?? 0));
      p.needs.stress = clampNeed(p.needs.stress + (n.stress ?? 0));
      if (def.category === 'food') message = `You eat the ${def.name.toLowerCase()}.`;
      else if (def.category === 'drink') message = `You drink the ${def.name.toLowerCase()}.`;
    }
    if (def.medical) {
      const results = def.medical.treatments.map((t) =>
        applyTreatment(p.body, t, def.medical!.quality, this.game.minutes, def.medical!.duration ?? 240, woundId),
      );
      const ok = results.filter((r) => r.ok);
      message = ok.length > 0 ? ok.map((r) => r.message).join(' ') : (results[0]?.message ?? null);
      if (ok.length === 0) return message;
      this.game.sound('bandage', e, 0.6);
    }
    // Consume one unit.
    if (stack.uses !== undefined) {
      stack.uses -= 1;
      if (stack.uses <= 0) this.removeStack(p, uid);
    } else if (stack.qty > 1) {
      stack.qty -= 1;
    } else {
      this.removeStack(p, uid);
    }
    if (def.consume?.leaves) {
      const leftover: ItemStack = { uid: newUid(), id: def.consume.leaves, qty: 1 };
      if (!this.autoPlace(p, leftover)) {
        const t = this.game.ecs.get(e, Transform);
        if (t) this.game.spawnGroundItem(t.x, t.y, leftover);
      }
    }
    p.inventoryDirty = true;
    p.statusDirty = true;
    return message;
  }

  private useBatteries(p: PlayerComp, batteries: ItemStack, loc: Loc): string | null {
    let light: ItemStack | null = null;
    forEachStack(p.inventory, (s) => {
      if (!light && this.def(s)?.light && (s.charge ?? 1) < 0.99) light = s;
    });
    if (!light) return 'You have no light that needs batteries.';
    (light as ItemStack).charge = 1;
    batteries.qty -= 1;
    if (batteries.qty <= 0) this.removeStack(p, batteries.uid);
    p.inventoryDirty = true;
    p.statusDirty = true;
    void loc;
    return null;
  }

  /** Removes `qty` units from a carried stack (crafting ingredients, building materials). */
  consumeUnits(p: PlayerComp, uid: number, qty: number): void {
    const found = findStack(p.inventory, uid);
    if (!found) return;
    if (found.stack.qty > qty) found.stack.qty -= qty;
    else this.removeStack(p, uid);
    p.inventoryDirty = true;
  }

  /** Consumes a list of item requirements; returns false (consuming nothing) if any is missing. */
  consumeMaterials(p: PlayerComp, materials: readonly { item: string; qty: number }[]): boolean {
    const plan = planConsumption(
      this.content,
      p.inventory,
      materials.map((m) => ({ item: m.item, qty: m.qty })),
    );
    if (!plan) return false;
    for (const { uid, qty } of plan) this.consumeUnits(p, uid, qty);
    return true;
  }

  /** Gives items to a player, dropping what does not fit at their feet. */
  giveItems(e: number, p: PlayerComp, items: readonly { item: string; qty: number }[]): void {
    const t = this.game.ecs.get(e, Transform);
    for (const { item, qty } of items) {
      const def = this.content.findItem(item);
      if (!def || qty <= 0) continue;
      let left = qty;
      while (left > 0) {
        const n = Math.min(left, def.stackSize);
        left -= n;
        const stack: ItemStack = { uid: newUid(), id: def.id, qty: n };
        if (def.durability) stack.cond = 1;
        if (!this.autoPlace(p, stack) && t) this.game.spawnGroundItem(t.x, t.y, stack);
      }
    }
  }

  private removeStack(p: PlayerComp, uid: number): void {
    const inv = p.inventory;
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i]?.uid === uid) inv.slots[i] = null;
    inv.pockets = inv.pockets.filter((s) => s.uid !== uid);
    if (inv.back?.contents) inv.back.contents = inv.back.contents.filter((s) => s.uid !== uid);
    p.inventoryDirty = true;
  }

  /** The player's first light item (flashlight, lantern), if any. */
  lightItem(inv: PlayerInventory): ItemStack | null {
    let found: ItemStack | null = null;
    forEachStack(inv, (s) => {
      if (!found && this.def(s)?.light) found = s;
    });
    return found;
  }

  totalOf(p: PlayerComp, itemId: string): number {
    return countItems(p.inventory, (s) => s.id === itemId);
  }

  /** Gives a new character its starting kit. */
  giveStartingItems(e: number, p: PlayerComp): void {
    for (const s of this.game.config.player.startingItems) {
      const def = this.content.findItem(s.item);
      if (!def) continue;
      const stack: ItemStack = { uid: newUid(), id: def.id, qty: Math.min(s.qty, def.stackSize) };
      if (def.uses) stack.uses = def.uses;
      if (def.light) stack.charge = 1;
      if (def.firearm) stack.ammo = def.firearm.magazine;
      if (s.slot !== undefined && !p.inventory.slots[s.slot]) p.inventory.slots[s.slot] = stack;
      else if (!this.autoPlace(p, stack)) {
        const t = this.game.ecs.get(e, Transform);
        if (t) this.game.spawnGroundItem(t.x, t.y, stack);
      }
    }
    p.inventoryDirty = true;
  }

  /** Everything a player carries, for dropping onto their corpse. */
  strip(p: PlayerComp): ItemStack[] {
    const out: ItemStack[] = [];
    for (let i = 0; i < p.inventory.slots.length; i++) {
      const s = p.inventory.slots[i];
      if (s) {
        if (this.def(s)?.firearm && i === p.sim.slot) s.ammo = p.sim.magAmmo;
        out.push(s);
      }
    }
    out.push(...p.inventory.pockets);
    if (p.inventory.back) out.push(p.inventory.back);
    p.inventory.slots.fill(null);
    p.inventory.pockets = [];
    p.inventory.back = null;
    p.inventoryDirty = true;
    return out;
  }

  /** Player entity for a given account id, if online. */
  playerOf(e: number): PlayerComp | undefined {
    return this.game.ecs.get(e, Player);
  }

  stackVolume(stack: ItemStack): number {
    return stackVolume(this.content, stack);
  }
}

function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function sameLoc(a: Loc, b: Loc): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'slot' && b.kind === 'slot') return a.index === b.index;
  if (a.kind === 'container' && b.kind === 'container') return a.id === b.id;
  return true;
}

export function isBodyPart(v: unknown): boolean {
  return typeof v === 'string' && (BODY_PARTS as readonly string[]).includes(v);
}
