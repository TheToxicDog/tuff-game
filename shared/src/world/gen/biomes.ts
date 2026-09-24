// Biome rules (design plan §46): what the procedural generators put where. A biome decides the
// ground, how dense trees and undergrowth are, what gets built along its roads and how far apart
// its streets are.

import type { Biome, TerrainMaterial } from '../map';

export type LotKind = 'house' | 'shed' | 'cabin' | 'grocery' | 'gas_station' | 'hardware' | 'police';

export interface BiomeRules {
  label: string;
  /** Editor overlay colour. */
  color: string;
  /** Ground material from two noise values in [-1, 1]. */
  ground(n1: number, n2: number): TerrainMaterial | null;
  /** Poisson spacing for trees (0 = none) and the tree mix. */
  trees: number;
  treeTypes: [string, number][];
  /** Undergrowth spacing and mix (bushes, rocks, logs). */
  undergrowth: number;
  undergrowthTypes: [string, number][];
  /** Grass tuft / flower spacing (0 = none). */
  tufts: number;
  /** What is built along roads here, with weights ('empty' leaves a lot free). */
  lots: [LotKind | 'empty', number][];
  /** Distance between lots along a road. */
  lotSpacing: number;
  /** Street grid block size for the road generator (0 = no streets). */
  block: number;
  roadKind: 'main' | 'street' | 'country' | null;
  /** Suggested zombies per hectare for zones. */
  zombiesPerHectare: number;
}

const grassy = (n1: number, n2: number): TerrainMaterial | null => {
  if (n2 > 0.38) return 'grass_long';
  if (n2 < -0.42) return 'grass_dead';
  if (n1 > 0.62) return 'dirt';
  return 'grass';
};

export const BIOME_RULES: Record<Biome, BiomeRules> = {
  none: {
    label: 'None',
    color: 'transparent',
    ground: () => null,
    trees: 0,
    treeTypes: [],
    undergrowth: 0,
    undergrowthTypes: [],
    tufts: 0,
    lots: [],
    lotSpacing: 30,
    block: 0,
    roadKind: null,
    zombiesPerHectare: 0,
  },
  city: {
    label: 'City',
    color: '#8a8f99',
    ground: (n1) => (n1 > 0.5 ? 'asphalt_cracked' : n1 < -0.55 ? 'grass_dead' : 'concrete'),
    trees: 34,
    treeTypes: [
      ['tree_oak', 2],
      ['tree_birch', 1],
    ],
    undergrowth: 22,
    undergrowthTypes: [
      ['trash_pile', 3],
      ['debris', 2],
      ['blood_stain', 1],
      ['oil_stain', 1],
    ],
    tufts: 0,
    lots: [
      ['grocery', 2],
      ['hardware', 3],
      ['gas_station', 2],
      ['police', 1],
      ['house', 6],
    ],
    lotSpacing: 36,
    block: 72,
    roadKind: 'main',
    zombiesPerHectare: 12,
  },
  suburb: {
    label: 'Suburb',
    color: '#b8a878',
    ground: grassy,
    trees: 16,
    treeTypes: [
      ['tree_oak', 5],
      ['tree_birch', 3],
      ['bush_large', 2],
    ],
    undergrowth: 20,
    undergrowthTypes: [
      ['bush', 6],
      ['leaves', 2],
      ['trash_pile', 1],
    ],
    tufts: 10,
    lots: [
      ['house', 12],
      ['empty', 2],
    ],
    lotSpacing: 30,
    block: 110,
    roadKind: 'street',
    zombiesPerHectare: 4,
  },
  town: {
    label: 'Small Town',
    color: '#c89868',
    ground: grassy,
    trees: 18,
    treeTypes: [
      ['tree_oak', 5],
      ['tree_birch', 2],
    ],
    undergrowth: 22,
    undergrowthTypes: [
      ['bush', 5],
      ['trash_pile', 1],
      ['debris', 1],
    ],
    tufts: 10,
    lots: [
      ['house', 10],
      ['hardware', 1],
      ['grocery', 1],
      ['gas_station', 1],
      ['empty', 3],
    ],
    lotSpacing: 32,
    block: 100,
    roadKind: 'street',
    zombiesPerHectare: 5,
  },
  forest: {
    label: 'Forest',
    color: '#3f6a3a',
    ground: (n1, n2) => (n2 > 0.55 ? 'grass_long' : n1 > 0.7 ? 'dirt' : 'forest_floor'),
    trees: 4.6,
    treeTypes: [
      ['tree_pine', 55],
      ['tree_oak', 25],
      ['tree_birch', 14],
      ['tree_dead', 6],
    ],
    undergrowth: 7,
    undergrowthTypes: [
      ['bush', 60],
      ['rock', 15],
      ['log', 12],
      ['stump', 8],
      ['leaves', 5],
    ],
    tufts: 0,
    lots: [
      ['cabin', 1],
      ['empty', 24],
    ],
    lotSpacing: 60,
    block: 0,
    roadKind: null,
    zombiesPerHectare: 0.4,
  },
  plains: {
    label: 'Plains',
    color: '#a8b860',
    ground: (n1, n2) => (n2 > 0.3 ? 'grass_long' : n2 < -0.35 ? 'grass_dead' : n1 > 0.72 ? 'dirt_dry' : 'grass'),
    trees: 22,
    treeTypes: [
      ['tree_oak', 5],
      ['tree_birch', 2],
      ['bush_large', 3],
    ],
    undergrowth: 16,
    undergrowthTypes: [
      ['bush', 5],
      ['rock', 2],
    ],
    tufts: 7,
    lots: [
      ['house', 1],
      ['shed', 1],
      ['empty', 10],
    ],
    lotSpacing: 70,
    block: 0,
    roadKind: 'country',
    zombiesPerHectare: 0.5,
  },
  farmland: {
    label: 'Farmland',
    color: '#8a6a3a',
    ground: () => null,
    trees: 40,
    treeTypes: [['tree_oak', 1]],
    undergrowth: 0,
    undergrowthTypes: [],
    tufts: 12,
    lots: [
      ['house', 2],
      ['shed', 2],
      ['empty', 8],
    ],
    lotSpacing: 80,
    block: 0,
    roadKind: 'country',
    zombiesPerHectare: 0.4,
  },
  industrial: {
    label: 'Industrial',
    color: '#6a6a78',
    ground: (n1, n2) => (n2 > 0.45 ? 'gravel' : n1 > 0.55 ? 'asphalt_cracked' : 'concrete_industrial'),
    trees: 0,
    treeTypes: [],
    undergrowth: 14,
    undergrowthTypes: [
      ['pallet', 3],
      ['barrel', 3],
      ['tire_pile', 2],
      ['debris', 2],
      ['oil_stain', 2],
    ],
    tufts: 0,
    lots: [
      ['hardware', 3],
      ['shed', 3],
      ['empty', 2],
    ],
    lotSpacing: 40,
    block: 90,
    roadKind: 'main',
    zombiesPerHectare: 3,
  },
  wilderness: {
    label: 'Wilderness',
    color: '#5a7048',
    ground: (n1, n2) => (n2 > 0.2 ? 'grass_long' : n1 > 0.4 ? 'forest_floor' : n1 < -0.5 ? 'dirt' : 'grass_dead'),
    trees: 9,
    treeTypes: [
      ['tree_pine', 4],
      ['tree_dead', 2],
      ['tree_birch', 2],
    ],
    undergrowth: 9,
    undergrowthTypes: [
      ['bush', 5],
      ['rock', 3],
      ['log', 2],
      ['stump', 2],
    ],
    tufts: 9,
    lots: [
      ['cabin', 1],
      ['empty', 30],
    ],
    lotSpacing: 70,
    block: 0,
    roadKind: null,
    zombiesPerHectare: 0.3,
  },
};

/** Props the nature generator places; everything else outdoors belongs to parcels. */
export const NATURE_PROPS = new Set([
  'tree_oak',
  'tree_pine',
  'tree_birch',
  'tree_dead',
  'stump',
  'log',
  'bush',
  'bush_large',
  'rock',
  'grass_tuft',
  'flowers',
  'leaves',
]);

export function weightedPick<T>(entries: readonly [T, number][], r: number): T {
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let x = r * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x <= 0) return v;
  }
  return entries[entries.length - 1][0];
}
