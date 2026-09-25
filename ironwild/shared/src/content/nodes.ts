// Resource nodes: trees, rocks, ore veins, bushes. Hitting one with the right tool yields its
// resource; depleted nodes vanish and regrow after a while (§62).

import type { ToolKind } from './items';

export interface NodeDrop {
  item: string;
  /** Multiplier on the tool's power (ores give less per hit than stone). */
  rate: number;
  /** Chance per hit; defaults to 1. */
  chance?: number;
}

export interface NodeDef {
  id: string;
  name: string;
  /** Collision radius in tiles. Trees collide on the trunk only. */
  radius: number;
  /** Drawn size in tiles (radius). */
  visual: number;
  /** Tool that works this node; 'hand' nodes can be picked with any tool or bare hands. */
  tool: ToolKind | 'hand';
  /** Minimum tool tier (stone 1, iron 2, steel 3). */
  tier: number;
  drops: NodeDrop[];
  /** Resource units before the node is depleted. */
  amount: number;
  /** Seconds (real time) until a depleted node regrows. */
  regrow: number;
  /** Solid for movement. */
  solid: boolean;
  /** Canopy drawn above characters. */
  canopy?: boolean;
  /** Skill trained by working it. */
  skill: 'mining' | 'forestry' | 'farming';
}

const N: NodeDef[] = [
  {
    id: 'tree',
    name: 'Oak',
    radius: 0.5,
    visual: 1.35,
    tool: 'axe',
    tier: 0,
    drops: [{ item: 'wood', rate: 1 }],
    amount: 24,
    regrow: 300,
    solid: true,
    canopy: true,
    skill: 'forestry',
  },
  {
    id: 'pine',
    name: 'Pine',
    radius: 0.45,
    visual: 1.2,
    tool: 'axe',
    tier: 0,
    drops: [{ item: 'wood', rate: 1 }],
    amount: 20,
    regrow: 300,
    solid: true,
    canopy: true,
    skill: 'forestry',
  },
  {
    id: 'hardwood_tree',
    name: 'Ironbark',
    radius: 0.6,
    visual: 1.6,
    tool: 'axe',
    tier: 2,
    drops: [
      { item: 'hardwood', rate: 0.5 },
      { item: 'wood', rate: 0.5 },
    ],
    amount: 30,
    regrow: 480,
    solid: true,
    canopy: true,
    skill: 'forestry',
  },
  {
    id: 'swamp_tree',
    name: 'Willow',
    radius: 0.45,
    visual: 1.3,
    tool: 'axe',
    tier: 0,
    drops: [{ item: 'wood', rate: 1 }],
    amount: 18,
    regrow: 300,
    solid: true,
    canopy: true,
    skill: 'forestry',
  },
  {
    id: 'rock',
    name: 'Rock',
    radius: 0.85,
    visual: 0.95,
    tool: 'pickaxe',
    tier: 0,
    drops: [{ item: 'stone', rate: 1 }],
    amount: 30,
    regrow: 360,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'boulder',
    name: 'Boulder',
    radius: 1.15,
    visual: 1.25,
    tool: 'pickaxe',
    tier: 1,
    drops: [{ item: 'stone', rate: 1.5 }],
    amount: 70,
    regrow: 480,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'coal_vein',
    name: 'Coal Seam',
    radius: 0.85,
    visual: 0.95,
    tool: 'pickaxe',
    tier: 1,
    drops: [
      { item: 'coal', rate: 0.5 },
      { item: 'stone', rate: 0.5 },
    ],
    amount: 24,
    regrow: 420,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'iron_vein',
    name: 'Iron Vein',
    radius: 0.85,
    visual: 0.95,
    tool: 'pickaxe',
    tier: 1,
    drops: [
      { item: 'iron_ore', rate: 0.5 },
      { item: 'stone', rate: 0.25 },
    ],
    amount: 24,
    regrow: 420,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'copper_vein',
    name: 'Copper Vein',
    radius: 0.85,
    visual: 0.95,
    tool: 'pickaxe',
    tier: 1,
    drops: [
      { item: 'copper_ore', rate: 0.5 },
      { item: 'stone', rate: 0.25 },
    ],
    amount: 24,
    regrow: 420,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'rich_iron',
    name: 'Rich Iron Deposit',
    radius: 1.1,
    visual: 1.2,
    tool: 'pickaxe',
    tier: 2,
    drops: [{ item: 'iron_ore', rate: 0.75 }],
    amount: 80,
    regrow: 600,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'silver_vein',
    name: 'Silver Vein',
    radius: 0.85,
    visual: 0.95,
    tool: 'pickaxe',
    tier: 2,
    drops: [
      { item: 'silver_ore', rate: 0.34 },
      { item: 'stone', rate: 0.5 },
    ],
    amount: 18,
    regrow: 600,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'gold_vein',
    name: 'Gold Vein',
    radius: 0.85,
    visual: 0.95,
    tool: 'pickaxe',
    tier: 2,
    drops: [
      { item: 'gold_ore', rate: 0.25 },
      { item: 'stone', rate: 0.5 },
    ],
    amount: 14,
    regrow: 720,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'gem_rock',
    name: 'Crystal Outcrop',
    radius: 0.8,
    visual: 0.9,
    tool: 'pickaxe',
    tier: 3,
    drops: [
      { item: 'rough_gem', rate: 0.2, chance: 0.35 },
      { item: 'stone', rate: 0.5 },
    ],
    amount: 12,
    regrow: 900,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'clay_deposit',
    name: 'Clay Bank',
    radius: 0.75,
    visual: 0.85,
    tool: 'pickaxe',
    tier: 0,
    drops: [{ item: 'clay', rate: 1 }],
    amount: 30,
    regrow: 360,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'sand_dune',
    name: 'Silica Sand',
    radius: 0.8,
    visual: 0.9,
    tool: 'pickaxe',
    tier: 0,
    drops: [{ item: 'sand', rate: 1 }],
    amount: 40,
    regrow: 360,
    solid: false,
    skill: 'mining',
  },
  {
    id: 'salt_deposit',
    name: 'Salt Crust',
    radius: 0.75,
    visual: 0.85,
    tool: 'pickaxe',
    tier: 1,
    drops: [{ item: 'salt', rate: 0.5 }],
    amount: 20,
    regrow: 480,
    solid: true,
    skill: 'mining',
  },
  {
    id: 'berry_bush',
    name: 'Berry Bush',
    radius: 0.55,
    visual: 0.7,
    tool: 'hand',
    tier: 0,
    drops: [{ item: 'berries', rate: 1 }],
    amount: 8,
    regrow: 180,
    solid: true,
    skill: 'farming',
  },
  {
    id: 'fiber_grass',
    name: 'Tall Grass',
    radius: 0.5,
    visual: 0.6,
    tool: 'hand',
    tier: 0,
    drops: [{ item: 'fiber', rate: 1 }],
    amount: 8,
    regrow: 150,
    solid: false,
    skill: 'farming',
  },
  {
    id: 'reeds',
    name: 'Reeds',
    radius: 0.5,
    visual: 0.65,
    tool: 'hand',
    tier: 0,
    drops: [{ item: 'fiber', rate: 1.5 }],
    amount: 10,
    regrow: 150,
    solid: false,
    skill: 'farming',
  },
  {
    id: 'mushroom_patch',
    name: 'Mushrooms',
    radius: 0.4,
    visual: 0.5,
    tool: 'hand',
    tier: 0,
    drops: [{ item: 'mushroom', rate: 1 }],
    amount: 4,
    regrow: 240,
    solid: false,
    skill: 'farming',
  },
  {
    id: 'herb_patch',
    name: 'Wild Herbs',
    radius: 0.4,
    visual: 0.5,
    tool: 'hand',
    tier: 0,
    drops: [{ item: 'herb', rate: 1 }],
    amount: 4,
    regrow: 240,
    solid: false,
    skill: 'farming',
  },
  {
    id: 'wild_wheat',
    name: 'Wild Wheat',
    radius: 0.5,
    visual: 0.6,
    tool: 'hand',
    tier: 0,
    drops: [
      { item: 'wheat', rate: 1 },
      { item: 'wheat_seeds', rate: 1, chance: 0.4 },
    ],
    amount: 6,
    regrow: 200,
    solid: false,
    skill: 'farming',
  },
  {
    id: 'cactus',
    name: 'Cactus',
    radius: 0.45,
    visual: 0.6,
    tool: 'axe',
    tier: 0,
    drops: [
      { item: 'fiber', rate: 1 },
      { item: 'wood', rate: 0.3 },
    ],
    amount: 10,
    regrow: 300,
    solid: true,
    skill: 'forestry',
  },
  {
    id: 'salvage',
    name: 'Salvage Pile',
    radius: 0.75,
    visual: 0.85,
    tool: 'pickaxe',
    tier: 0,
    drops: [
      { item: 'scrap_metal', rate: 0.5 },
      { item: 'plank', rate: 0.5 },
      { item: 'iron_rod', rate: 0.2, chance: 0.25 },
      { item: 'iron_gear', rate: 0.2, chance: 0.08 },
    ],
    amount: 16,
    regrow: 900,
    solid: true,
    skill: 'mining',
  },
];

export const NODES: readonly NodeDef[] = N;
export const NODE_BY_ID: ReadonlyMap<string, NodeDef> = new Map(N.map((n) => [n.id, n]));
export const NODE_INDEX: ReadonlyMap<string, number> = new Map(N.map((n, i) => [n.id, i]));

export function nodeDef(id: string): NodeDef {
  const d = NODE_BY_ID.get(id);
  if (!d) throw new Error(`Unknown node "${id}"`);
  return d;
}
