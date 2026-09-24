// Crafting, cooking and construction requirements (design plan §56–58). The client uses these to
// show what can be made right now; the server uses exactly the same checks before it consumes
// anything.

import type { ContentRegistry } from '../content/registry';
import type { ItemDef, RecipeDef, RecipeIngredient, StationKind } from '../content/types';
import { forEachStack, hasToolTag, type ItemStack, type PlayerInventory } from './inventory';

/** Readable names for tool and ingredient tags. */
export const TAG_NAMES: Record<string, string> = {
  pot: 'Cooking Pot',
  pan: 'Frying Pan',
  cookware: 'Pot or Pan',
  can_opener: 'Can Opener',
  hammer: 'Hammer',
  saw: 'Saw',
  crowbar: 'Crowbar',
  fire: 'Lighter or Matches',
  vegetable: 'Any Vegetable',
  furniture_wood: 'Wooden Furniture',
};

export const STATION_NAMES: Record<StationKind, string> = {
  heat: 'a heat source (stove or fire)',
  workbench: 'a workbench',
};

export function tagName(tag: string): string {
  return TAG_NAMES[tag] ?? tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ingredientName(content: ContentRegistry, ing: RecipeIngredient): string {
  if (ing.item) return content.findItem(ing.item)?.name ?? ing.item;
  return tagName(ing.tag ?? '');
}

function matches(def: ItemDef | undefined, ing: RecipeIngredient): boolean {
  if (!def) return false;
  if (ing.item) return def.id === ing.item;
  return !!ing.tag && (def.tags?.includes(ing.tag) ?? false);
}

/** How many units of an ingredient the player carries. */
export function countIngredient(content: ContentRegistry, inv: PlayerInventory, ing: RecipeIngredient): number {
  let n = 0;
  forEachStack(inv, (s) => {
    if (s.contents?.length) return;
    if (matches(content.findItem(s.id), ing)) n += s.qty;
  });
  return n;
}

export interface RequirementStatus {
  label: string;
  have: number;
  need: number;
  ok: boolean;
}

export interface CraftCheck {
  ok: boolean;
  /** The first unmet requirement, as a sentence. */
  problem: string | null;
  inputs: RequirementStatus[];
  tools: RequirementStatus[];
  station: boolean;
}

/** Checks ingredients, tools and station for a recipe. */
export function checkRecipe(
  content: ContentRegistry,
  inv: PlayerInventory,
  recipe: RecipeDef,
  stations: ReadonlySet<StationKind>,
): CraftCheck {
  const inputs = recipe.inputs.map((ing) => {
    const have = countIngredient(content, inv, ing);
    return { label: ingredientName(content, ing), have, need: ing.qty, ok: have >= ing.qty };
  });
  const tools = (recipe.tools ?? []).map((tag) => {
    const have = hasToolTag(content, inv, tag) ? 1 : 0;
    return { label: tagName(tag), have, need: 1, ok: have > 0 };
  });
  const station = !recipe.station || stations.has(recipe.station);
  let problem: string | null = null;
  if (!station && recipe.station) problem = `You need to be at ${STATION_NAMES[recipe.station]}.`;
  else if (tools.some((t) => !t.ok)) problem = `You need a ${tools.find((t) => !t.ok)!.label.toLowerCase()}.`;
  else if (inputs.some((i) => !i.ok)) {
    const miss = inputs.find((i) => !i.ok)!;
    problem = `You need ${miss.need - miss.have} more ${miss.label.toLowerCase()}.`;
  }
  return { ok: problem === null, problem, inputs, tools, station };
}

/** Checks the materials and tools for a construction. */
export function checkMaterials(
  content: ContentRegistry,
  inv: PlayerInventory,
  materials: readonly { item: string; qty: number }[],
  tools: readonly string[],
): CraftCheck {
  return checkRecipe(
    content,
    inv,
    {
      id: '',
      name: '',
      category: 'carpentry',
      time: 1,
      inputs: materials.map((m) => ({ item: m.item, qty: m.qty })),
      tools: [...tools],
      outputs: [],
    },
    new Set(),
  );
}

/**
 * Picks the stacks to consume for a list of ingredients: returns `{ uid, qty }` pairs, or null if
 * the inventory does not hold enough. Stacks inside worn containers count; tools are never used
 * as ingredients unless the recipe asks for that exact item.
 */
export function planConsumption(
  content: ContentRegistry,
  inv: PlayerInventory,
  inputs: readonly RecipeIngredient[],
): { uid: number; qty: number }[] | null {
  const reserved = new Map<number, number>();
  const plan: { uid: number; qty: number }[] = [];
  for (const ing of inputs) {
    let need = ing.qty;
    const candidates: ItemStack[] = [];
    forEachStack(inv, (s) => {
      if (!s.contents?.length && matches(content.findItem(s.id), ing)) candidates.push(s);
    });
    // Use up small and damaged stacks first.
    candidates.sort((a, b) => a.qty - b.qty);
    for (const s of candidates) {
      if (need <= 0) break;
      const free = s.qty - (reserved.get(s.uid) ?? 0);
      if (free <= 0) continue;
      const take = Math.min(free, need);
      reserved.set(s.uid, (reserved.get(s.uid) ?? 0) + take);
      plan.push({ uid: s.uid, qty: take });
      need -= take;
    }
    if (need > 0) return null;
  }
  return plan;
}
