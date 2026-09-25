// Crafting (§17): instant recipes by hand or at a nearby station, and anvil smithing whose
// timing minigame decides the quality of what comes out (§16).

import {
  ITEM_BY_ID,
  RECIPE_BY_ID,
  STATION_STRUCTURES,
  addStack,
  averageQuality,
  hasAll,
  removeAll,
  roomFor,
  type Recipe,
} from '@ironwild/shared';
import type { Game } from './game';
import type { Player } from './player';

const STATION_RANGE = 3.5;
const SMITH_COOLDOWN_MS = 1200;

export function qualityFromScore(score: number): number {
  if (score < 0.35) return 0;
  if (score < 0.7) return 1;
  if (score < 0.86) return 2;
  if (score < 0.95) return 3;
  return 4;
}

export class CraftingSystem {
  private readonly lastSmith = new Map<number, number>();

  constructor(private readonly game: Game) {}

  /** Whether the player stands near a structure providing a crafting station. */
  nearStation(p: Player, station: string): boolean {
    if (station === 'hand') return true;
    const types = STATION_STRUCTURES[station] ?? [station];
    const w = this.game.world;
    const r = Math.ceil(STATION_RANGE);
    for (let ty = Math.floor(p.y) - r; ty <= Math.floor(p.y) + r; ty++) {
      for (let tx = Math.floor(p.x) - r; tx <= Math.floor(p.x) + r; tx++) {
        const s = w.structAt(tx, ty);
        if (!s || !types.includes(s.type)) continue;
        const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
        const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
        if (Math.hypot(nx - p.x, ny - p.y) <= STATION_RANGE) return true;
      }
    }
    return false;
  }

  known(p: Player, recipe: Recipe): boolean {
    return !recipe.research || p.unlocked.has(recipe.research);
  }

  private check(p: Player, recipe: Recipe | undefined): recipe is Recipe {
    if (!recipe || !recipe.craft) return false;
    if (!this.known(p, recipe)) {
      this.game.notice(p, 'You have not researched that yet.', 'bad');
      return false;
    }
    if (!this.nearStation(p, recipe.station)) {
      this.game.notice(p, `You need to be near a ${recipe.station === 'cooking' ? 'campfire' : recipe.station}.`, 'bad');
      return false;
    }
    return true;
  }

  craft(p: Player, recipeId: string, n: number): void {
    const recipe = RECIPE_BY_ID.get(recipeId);
    if (!this.check(p, recipe) || recipe.smith) return;
    const count = Math.max(1, Math.min(100, Math.floor(Number(n) || 1)));
    let made = 0;
    for (let i = 0; i < count; i++) {
      if (!hasAll(p.slots, recipe.inputs)) break;
      // Make sure the outputs will fit once the inputs are gone.
      const trial = p.slots.map((s) => (s ? { ...s } : null));
      removeAll(trial, recipe.inputs);
      if (recipe.outputs.some((o) => roomFor(trial, { id: o.item, n: o.n }) < o.n)) {
        if (made === 0) this.game.notice(p, 'No room in your backpack.', 'bad');
        break;
      }
      removeAll(p.slots, recipe.inputs);
      for (const o of recipe.outputs) addStack(p.slots, { id: o.item, n: o.n, ...(ITEM_BY_ID.get(o.item)?.quality ? { q: 1 } : {}) });
      made++;
    }
    if (made === 0) {
      if (!hasAll(p.slots, recipe.inputs)) this.game.notice(p, 'You are missing materials.', 'bad');
      return;
    }
    p.invDirty = true;
    const out = recipe.outputs[0];
    const def = ITEM_BY_ID.get(out.item);
    if (def?.category === 'machine') p.addXp('engineering', 2 * made);
    this.game.emit(['sfx', 'craft', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { r: 10 });
    this.game.notice(p, `Crafted ${out.n * made}× ${def?.name ?? out.item}.`, 'good');
    this.game.progression.onCraft(p, out.item, out.n * made);
  }

  smith(p: Player, recipeId: string, hits: unknown): void {
    const recipe = RECIPE_BY_ID.get(recipeId);
    if (!this.check(p, recipe) || !recipe.smith) return;
    if (!Array.isArray(hits) || hits.length !== 3 || !hits.every((h) => typeof h === 'number' && Number.isFinite(h))) return;
    const now = Date.now();
    if (now - (this.lastSmith.get(p.id) ?? 0) < SMITH_COOLDOWN_MS) return;
    this.lastSmith.set(p.id, now);
    if (!hasAll(p.slots, recipe.inputs)) {
      this.game.notice(p, 'You are missing materials.', 'bad');
      return;
    }
    const trial = p.slots.map((s) => (s ? { ...s } : null));
    removeAll(trial, recipe.inputs);
    if (recipe.outputs.some((o) => roomFor(trial, { id: o.item, n: o.n, q: 4 }) < o.n)) {
      this.game.notice(p, 'No room in your backpack.', 'bad');
      return;
    }
    const used = removeAll(p.slots, recipe.inputs);
    const accuracy = (hits as number[]).reduce((a, h) => a + Math.max(0, Math.min(1, h)), 0) / 3;
    const inputBonus = (averageQuality(used) - 1) * 0.04;
    const score = accuracy + p.skill('smithing') * 0.012 + inputBonus;
    const quality = qualityFromScore(score);
    for (const o of recipe.outputs) {
      const def = ITEM_BY_ID.get(o.item);
      addStack(p.slots, { id: o.item, n: o.n, ...(def?.quality ? { q: quality } : {}) });
    }
    p.invDirty = true;
    p.addXp('smithing', 3);
    const out = recipe.outputs[0];
    const def = ITEM_BY_ID.get(out.item);
    if (def?.quality && quality === 4) this.game.ambitions.count(p.accountId, 'masterwork', 1);
    const qName = def?.quality ? ['Crude', 'Standard', 'Fine', 'Excellent', 'Masterwork'][quality] + ' ' : '';
    this.game.emit(['sfx', 'anvil', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { r: 16 });
    this.game.notice(p, `Forged ${out.n}× ${qName}${def?.name ?? out.item}.`, quality >= 3 ? 'money' : 'good');
    this.game.progression.onCraft(p, out.item, out.n);
  }
}
