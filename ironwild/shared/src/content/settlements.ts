// Settlements, their NPC professions and what drives their local economies (§5–6, §12, §55).

import type { MarketTag } from './items';

export interface Profession {
  id: string;
  title: string;
  /** Tags of items this trader buys from players. */
  buys: MarketTag[];
  /** Items this trader stocks and sells. */
  sells: string[];
  /** Fraction of the market price paid to players (generalists pay less). */
  bidRate: number;
  /** NPC coat colour. */
  color: number;
  lines: string[];
}

export const PROFESSIONS: readonly Profession[] = [
  {
    id: 'general',
    title: 'General Store',
    buys: [
      'wood',
      'stone',
      'ore',
      'metal',
      'food',
      'farm',
      'hunt',
      'herbal',
      'tool',
      'weapon',
      'gear',
      'building',
      'machine',
      'component',
      'luxury',
      'animal',
    ],
    sells: ['berries', 'bread', 'cooked_meat', 'rope', 'torch', 'plank', 'wheat_seeds', 'arrow', 'fiber'],
    bidRate: 0.6,
    color: 0x6d8f5a,
    lines: ["If it's useful, I'll buy it. Don't expect a specialist's price, mind.", 'Everything has a buyer. Usually me.'],
  },
  {
    id: 'lumber',
    title: 'Lumber Merchant',
    buys: ['wood'],
    sells: ['wood', 'hardwood', 'plank', 'hardwood_plank', 'charcoal'],
    bidRate: 0.9,
    color: 0x8a5a33,
    lines: ['Good timber keeps this town standing.', 'Planks sell better than logs. Just saying.'],
  },
  {
    id: 'miner',
    title: 'Mining Supply',
    buys: ['ore', 'stone'],
    sells: ['stone', 'coal', 'iron_ore', 'copper_ore', 'clay', 'sand', 'gravel', 'stone_brick'],
    bidRate: 0.9,
    color: 0x6a6f78,
    lines: ['Ore is cheap up here. Carry it somewhere hungrier.', 'The deeper veins are richer — and meaner.'],
  },
  {
    id: 'blacksmith',
    title: 'Blacksmith',
    buys: ['ore', 'metal', 'weapon'],
    sells: ['iron_ingot', 'copper_ingot', 'iron_plate', 'iron_rod', 'iron_gear', 'iron_sword', 'furnace', 'anvil'],
    bidRate: 0.9,
    color: 0x55595f,
    lines: ['Raw ore is fine. Ingots are better. Plates, better still.', 'A masterwork blade sells for three times a plain one.'],
  },
  {
    id: 'tool_dealer',
    title: 'Tool Dealer',
    buys: ['tool', 'gear'],
    sells: [
      'stone_axe',
      'stone_pickaxe',
      'iron_axe',
      'iron_pickaxe',
      'hammer',
      'hoe',
      'bow',
      'stone_spear',
      'medium_backpack',
      'large_backpack',
      'hand_cart',
    ],
    bidRate: 0.85,
    color: 0x9a6b3f,
    lines: ['An iron pickaxe pays for itself before lunch.', 'Bigger backpack, fewer trips.'],
  },
  {
    id: 'butcher',
    title: 'Butcher',
    buys: ['hunt'],
    sells: ['raw_meat', 'cooked_meat', 'raw_hide', 'leather'],
    bidRate: 0.9,
    color: 0xa0453c,
    lines: ['Wolf pelts, deer hides — bring them to me.', 'Cook it first and it keeps better. Sells better too.'],
  },
  {
    id: 'baker',
    title: 'Baker',
    buys: ['food'],
    sells: ['bread', 'flour', 'wheat', 'berries', 'vegetable_stew'],
    bidRate: 0.9,
    color: 0xd9b27c,
    lines: ['Flour from a millstone is finer than anything ground by hand.', 'Fresh bread! Well — fresh enough.'],
  },
  {
    id: 'farmer',
    title: 'Farmer',
    buys: ['farm', 'food'],
    sells: ['wheat_seeds', 'carrot', 'potato', 'cotton_seeds', 'wheat', 'egg', 'milk', 'wool', 'fiber'],
    bidRate: 0.9,
    color: 0x7a9a3f,
    lines: ['Till it, plant it, wait. Farming is patient money.', 'Seeds are cheap. Harvests are not.'],
  },
  {
    id: 'stable',
    title: 'Stable Keeper',
    buys: ['animal'],
    sells: ['chicken', 'sheep', 'cow', 'horse', 'fence', 'pen_gate'],
    bidRate: 0.8,
    color: 0x8a6a45,
    lines: ['Keep them fenced and they will keep you fed.', 'A horse makes a long road short.'],
  },
  {
    id: 'engineer',
    title: 'Engineer',
    buys: ['component', 'machine', 'blueprint'],
    sells: [
      'shaft',
      'gearbox',
      'water_wheel',
      'hand_crank',
      'windmill',
      'crusher',
      'press',
      'millstone',
      'saw',
      'washer',
      'conveyor',
      'hopper',
      'storage_crate',
      'shipping_crate',
      'iron_gear',
      'copper_wire',
      'assembler_blueprint',
    ],
    bidRate: 0.9,
    color: 0x4f6f8f,
    lines: [
      'A water wheel turns all day and never asks for wages.',
      'Watch your stress. A stalled line earns nothing.',
      'Gears trade speed for strength. Mind the ratio.',
    ],
  },
  {
    id: 'jeweler',
    title: 'Jeweler',
    buys: ['luxury'],
    sells: ['rough_gem', 'cut_gem', 'silver_ingot', 'gold_ingot'],
    bidRate: 0.9,
    color: 0x9a3f7a,
    lines: ['A flawless cut is worth nearly thrice the rough stone.', 'Silver and gold come from the high mountains.'],
  },
  {
    id: 'builder',
    title: 'Builder',
    buys: ['building', 'stone', 'wood'],
    sells: [
      'workbench',
      'campfire',
      'chest',
      'bed',
      'wood_wall',
      'stone_wall',
      'wood_door',
      'wood_floor',
      'stone_floor',
      'fence',
      'torch',
      'land_claim',
      'stone_brick',
      'brick',
      'glass',
    ],
    bidRate: 0.85,
    color: 0xb07a45,
    lines: ['Claim your land before someone else does.', 'Walls keep bandits honest.'],
  },
  {
    id: 'doctor',
    title: 'Doctor',
    buys: ['herbal'],
    sells: ['herb', 'vegetable_stew', 'milk'],
    bidRate: 0.95,
    color: 0xe8e8e8,
    lines: ['Herbs from the marsh make the best remedies.', 'Eat properly. You heal faster on a full stomach.'],
  },
  {
    id: 'fishmonger',
    title: 'Fishmonger',
    buys: ['fish'],
    sells: ['perch', 'mackerel', 'cooked_fish', 'fishing_rod', 'rope'],
    bidRate: 0.95,
    color: 0x3f7a9a,
    lines: ['Fresh off the boats, or fresh off your line — I buy both.', 'Salmon and sea bass fetch the best prices.'],
  },
  {
    id: 'importer',
    title: 'Importer',
    buys: ['luxury', 'import'],
    sells: ['spices', 'silk', 'tea', 'glass', 'steel_ingot', 'copper_ingot'],
    bidRate: 0.8,
    color: 0xa0522d,
    lines: [
      'Spices from the south, silk from the east. The valley pays well for both.',
      'Buy here, sell inland. That is how merchants get rich.',
    ],
  },
  {
    id: 'exporter',
    title: 'Export Agent',
    buys: ['component', 'machine', 'metal', 'tool', 'weapon', 'luxury'],
    sells: ['shipping_crate'],
    bidRate: 0.97,
    color: 0x2f4f7a,
    lines: [
      'The ships carry anything well made: gears, plates, pumps, tools.',
      'Raw ore is ballast. Bring me finished goods and I pay top Crest.',
    ],
  },
  {
    id: 'provisioner',
    title: 'Provisioner',
    buys: ['food', 'farm', 'hunt', 'wood'],
    sells: ['bread', 'cooked_meat', 'plank', 'torch'],
    bidRate: 0.95,
    color: 0xc98a3e,
    lines: ['Miners eat like bears. Bring food and I pay well.', 'Timber is scarce up here.'],
  },
  {
    id: 'farm_supply',
    title: 'Farm Supply',
    buys: ['tool', 'machine', 'component', 'metal'],
    sells: ['hoe', 'wooden_club', 'fence', 'rope', 'hammer'],
    bidRate: 0.95,
    color: 0x5a7a3f,
    lines: ['We grow food, not iron. We pay well for tools and machines.', 'A millstone would change everything out here.'],
  },
  {
    id: 'board',
    title: 'Contract Board',
    buys: [],
    sells: [],
    bidRate: 0,
    color: 0xc9a046,
    lines: ['Bulk orders, good money, firm deadlines.'],
  },
  {
    id: 'exchange',
    title: 'Exchange Clerk',
    buys: [],
    sells: [],
    bidRate: 0,
    color: 0x3f5670,
    lines: ['Post a buy order and let the miners come to you.'],
  },
];

export const PROFESSION_BY_ID: ReadonlyMap<string, Profession> = new Map(PROFESSIONS.map((p) => [p.id, p]));

export interface ContractTemplate {
  item: string;
  min: number;
  max: number;
}

export interface SettlementDef {
  id: string;
  name: string;
  kind: 'town' | 'village';
  /** Radius of the protected area in tiles. */
  radius: number;
  /** Market size: scales how much a settlement can absorb before prices fall. */
  scale: number;
  traders: string[];
  /** Local price factors by market tag (below 1: produced here, cheap; above 1: in demand). */
  factors: Partial<Record<MarketTag, number>>;
  contracts: ContractTemplate[];
  /** Traders that open stalls as the settlement prospers from trade (§54). */
  growth: { at: number; trader: string }[];
  desc: string;
  /** Built on the coast, with a pier and a ship. */
  coastal?: boolean;
}

export const SETTLEMENTS: readonly SettlementDef[] = [
  {
    id: 'westhaven',
    name: 'Westhaven',
    kind: 'town',
    radius: 15,
    scale: 1,
    traders: [
      'general',
      'lumber',
      'blacksmith',
      'tool_dealer',
      'butcher',
      'baker',
      'engineer',
      'builder',
      'jeweler',
      'doctor',
      'board',
      'exchange',
    ],
    factors: { machine: 0.95, component: 1.05, luxury: 1.1, metal: 1.05 },
    contracts: [
      { item: 'plank', min: 60, max: 240 },
      { item: 'iron_ingot', min: 20, max: 120 },
      { item: 'iron_plate', min: 15, max: 80 },
      { item: 'iron_gear', min: 10, max: 60 },
      { item: 'copper_wire', min: 40, max: 200 },
      { item: 'bread', min: 20, max: 80 },
      { item: 'stone_brick', min: 40, max: 200 },
      { item: 'steel_ingot', min: 20, max: 100 },
      { item: 'leather', min: 10, max: 40 },
    ],
    growth: [
      { at: 8000, trader: 'miner' },
      { at: 20000, trader: 'farmer' },
      { at: 45000, trader: 'stable' },
    ],
    desc: 'The river town at the heart of the valley. Everything is for sale here, for a price.',
  },
  {
    id: 'stonehaven',
    name: 'Stonehaven',
    kind: 'village',
    radius: 12,
    scale: 0.6,
    traders: ['general', 'miner', 'blacksmith', 'provisioner', 'tool_dealer', 'board'],
    factors: { ore: 0.6, stone: 0.7, metal: 0.85, food: 1.45, farm: 1.3, hunt: 1.2, wood: 1.35, tool: 1.15, building: 1.1 },
    contracts: [
      { item: 'bread', min: 20, max: 100 },
      { item: 'cooked_meat', min: 20, max: 80 },
      { item: 'plank', min: 60, max: 200 },
      { item: 'iron_pickaxe', min: 2, max: 6 },
      { item: 'wood', min: 80, max: 300 },
      { item: 'torch', min: 20, max: 60 },
    ],
    growth: [
      { at: 4000, trader: 'lumber' },
      { at: 10000, trader: 'butcher' },
      { at: 25000, trader: 'engineer' },
      { at: 40000, trader: 'builder' },
    ],
    desc: 'A mining village in the highlands. Ore and coal are cheap; food and timber are not.',
  },
  {
    id: 'greenfield',
    name: 'Greenfield',
    kind: 'village',
    radius: 12,
    scale: 0.6,
    traders: ['general', 'farmer', 'baker', 'butcher', 'stable', 'farm_supply', 'board'],
    factors: {
      food: 0.7,
      farm: 0.7,
      animal: 0.85,
      hunt: 0.9,
      tool: 1.35,
      metal: 1.3,
      machine: 1.4,
      component: 1.3,
      ore: 1.25,
      building: 1.15,
    },
    contracts: [
      { item: 'iron_gear', min: 10, max: 40 },
      { item: 'millstone', min: 1, max: 2 },
      { item: 'hoe', min: 3, max: 10 },
      { item: 'iron_plate', min: 10, max: 60 },
      { item: 'shaft', min: 4, max: 16 },
      { item: 'plank', min: 50, max: 150 },
    ],
    growth: [
      { at: 4000, trader: 'blacksmith' },
      { at: 10000, trader: 'tool_dealer' },
      { at: 25000, trader: 'engineer' },
      { at: 40000, trader: 'builder' },
    ],
    desc: 'Farming country. Food is cheap and plentiful; tools and machines are dear.',
  },
  {
    id: 'port_meridian',
    name: 'Port Meridian',
    kind: 'town',
    radius: 13,
    scale: 0.9,
    coastal: true,
    traders: ['general', 'fishmonger', 'importer', 'exporter', 'provisioner', 'builder', 'board'],
    factors: { component: 1.2, machine: 1.15, luxury: 1.2, metal: 1.1, wood: 1.25, fish: 0.75, food: 1.05, import: 0.7, ore: 1.1 },
    contracts: [
      { item: 'gearbox_unit', min: 2, max: 8 },
      { item: 'steel_plate', min: 10, max: 50 },
      { item: 'iron_gear', min: 10, max: 60 },
      { item: 'cooked_fish', min: 20, max: 80 },
      { item: 'rope', min: 20, max: 80 },
      { item: 'hardwood_plank', min: 40, max: 160 },
      { item: 'bread', min: 20, max: 80 },
    ],
    growth: [
      { at: 6000, trader: 'blacksmith' },
      { at: 15000, trader: 'jeweler' },
      { at: 30000, trader: 'engineer' },
    ],
    desc: 'The harbour on the south coast. Ships bring spices, silk and tea, and carry away whatever the valley makes.',
  },
];

export const SETTLEMENT_BY_ID: ReadonlyMap<string, SettlementDef> = new Map(SETTLEMENTS.map((s) => [s.id, s]));

export const NPC_FIRST_NAMES = [
  'Marta',
  'Bram',
  'Odile',
  'Tomas',
  'Hilde',
  'Corin',
  'Agnes',
  'Pell',
  'Rosa',
  'Edric',
  'Wenna',
  'Garrick',
  'Ilse',
  'Doran',
  'Fenna',
  'Hugo',
  'Liesl',
  'Mattias',
  'Nell',
  'Osric',
  'Petra',
  'Rolf',
  'Sabine',
  'Ulric',
];
