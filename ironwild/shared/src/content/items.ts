// Every item in the game. Base values are in Crests (₡) and are what a balanced, well-supplied
// market pays for a Standard-quality unit; settlements scale them by local supply and demand.

export type ItemCategory =
  | 'resource'
  | 'ore'
  | 'food'
  | 'material'
  | 'component'
  | 'tool'
  | 'weapon'
  | 'ammo'
  | 'gear'
  | 'building'
  | 'machine'
  | 'seed'
  | 'animal'
  | 'luxury'
  | 'blueprint';

/** Market tags decide which NPC professions trade an item. */
export type MarketTag =
  | 'wood'
  | 'stone'
  | 'ore'
  | 'metal'
  | 'food'
  | 'farm'
  | 'hunt'
  | 'herbal'
  | 'tool'
  | 'weapon'
  | 'gear'
  | 'building'
  | 'machine'
  | 'component'
  | 'luxury'
  | 'animal'
  | 'blueprint'
  | 'fish'
  | 'import';

export type ToolKind = 'fist' | 'axe' | 'pickaxe' | 'sword' | 'spear' | 'club' | 'hammer' | 'hoe' | 'bow' | 'rod';

export interface ToolStats {
  kind: ToolKind;
  /** Gathering tier: which nodes it can work (0 hand, 1 stone, 2 iron, 3 steel). */
  tier: number;
  /** Resources per hit on a matching node. */
  power: number;
  damage: number;
  /** Swings per second. */
  rate: number;
  /** Reach beyond the player's body, in tiles. */
  reach: number;
}

export interface FoodStats {
  hunger: number;
  heal?: number;
  buff?: 'strength' | 'stamina' | 'regen';
  buffSeconds?: number;
}

export type IconShape =
  | 'log'
  | 'plank'
  | 'stone'
  | 'fiber'
  | 'berry'
  | 'mushroom'
  | 'herb'
  | 'meat'
  | 'hide'
  | 'antler'
  | 'ore'
  | 'crushed'
  | 'dust'
  | 'ingot'
  | 'plate'
  | 'rod'
  | 'gear'
  | 'wire'
  | 'sack'
  | 'bread'
  | 'bowl'
  | 'gem'
  | 'cutgem'
  | 'brick'
  | 'glass'
  | 'lump'
  | 'rope'
  | 'seed'
  | 'wheat'
  | 'carrot'
  | 'potato'
  | 'cotton'
  | 'egg'
  | 'bottle'
  | 'wool'
  | 'scrap'
  | 'bearing'
  | 'box'
  | 'pump'
  | 'axe'
  | 'pickaxe'
  | 'sword'
  | 'spear'
  | 'club'
  | 'hammer'
  | 'hoe'
  | 'bow'
  | 'arrow'
  | 'fishing_rod'
  | 'fish'
  | 'boot'
  | 'backpack'
  | 'scroll'
  | 'structure';

export interface IconSpec {
  shape: IconShape;
  color: number;
  accent?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  tags: MarketTag[];
  /** Base market value in Crests. */
  value: number;
  stack: number;
  icon: IconSpec;
  desc?: string;
  tool?: ToolStats;
  food?: FoodStats;
  /** Smelting operations one unit of this fuel powers. */
  fuel?: number;
  /** Structure placed by this item. */
  place?: string;
  /** Backpack capacity in slots when equipped (used). */
  backpack?: number;
  /** Items with quality carry a Crude…Masterwork tier. */
  quality?: boolean;
  /** Crop grown when planted on farmland. */
  plant?: string;
  /** Research node a blueprint teaches. */
  teaches?: string;
  /** Animal spawned when used inside a pen. */
  animal?: string;
  /** Vehicle spawned when used. */
  vehicle?: 'cart' | 'wagon' | 'minecart';
}

type Extra = Partial<Omit<ItemDef, 'id' | 'name' | 'category' | 'value' | 'stack' | 'icon' | 'tags'>>;

const defs: ItemDef[] = [];
function item(
  id: string,
  name: string,
  category: ItemCategory,
  tags: MarketTag[],
  value: number,
  stack: number,
  icon: IconSpec,
  extra: Extra = {},
): void {
  defs.push({ id, name, category, tags, value, stack, icon, ...extra });
}

const tool = (kind: ToolKind, tier: number, power: number, damage: number, rate: number, reach: number): ToolStats => ({
  kind,
  tier,
  power,
  damage,
  rate,
  reach,
});

// ——— Raw resources ———
item('wood', 'Wood Log', 'resource', ['wood'], 2, 100, { shape: 'log', color: 0x9a6b3f, accent: 0xd9b27c }, { fuel: 2 });
item('hardwood', 'Hardwood Log', 'resource', ['wood'], 6, 100, { shape: 'log', color: 0x5e3b22, accent: 0xb3875a }, { fuel: 3 });
item('stone', 'Stone', 'resource', ['stone'], 1, 100, { shape: 'stone', color: 0x9aa0a6 });
item('fiber', 'Plant Fiber', 'resource', ['farm'], 1, 100, { shape: 'fiber', color: 0x8fbf5a });
item('clay', 'Clay', 'resource', ['stone'], 2, 100, { shape: 'lump', color: 0xb8764f });
item('sand', 'Sand', 'resource', ['stone'], 1.5, 100, { shape: 'dust', color: 0xe3cf8f });
item('salt', 'Salt', 'resource', ['food'], 6, 50, { shape: 'dust', color: 0xf2f0ea });
item('herb', 'Wild Herbs', 'resource', ['herbal'], 5, 50, { shape: 'herb', color: 0x5aa25a, accent: 0xc6e07a });
item('raw_hide', 'Raw Hide', 'resource', ['hunt'], 6, 50, { shape: 'hide', color: 0xa87a52 });
item('wolf_pelt', 'Wolf Pelt', 'resource', ['hunt'], 14, 50, { shape: 'hide', color: 0x8d9096 });
item('bear_hide', 'Bear Hide', 'resource', ['hunt', 'luxury'], 40, 20, { shape: 'hide', color: 0x5b4030 });
item('antler', 'Antler', 'resource', ['hunt'], 12, 50, { shape: 'antler', color: 0xe6d6b0 });
item('wool', 'Wool', 'resource', ['farm'], 9, 50, { shape: 'wool', color: 0xf3efe6 });
item('cotton', 'Cotton', 'resource', ['farm'], 5, 100, { shape: 'cotton', color: 0xfafafa, accent: 0x9ab86a });
item('scrap_metal', 'Scrap Metal', 'resource', ['metal'], 6, 50, { shape: 'scrap', color: 0x8a7f74, accent: 0xb5552e });

// ——— Ores ———
item('iron_ore', 'Iron Ore', 'ore', ['ore'], 8, 50, { shape: 'ore', color: 0x8c8c8c, accent: 0xc26a3a });
item('copper_ore', 'Copper Ore', 'ore', ['ore'], 7, 50, { shape: 'ore', color: 0x8c8c8c, accent: 0x3fb3a0 });
item('coal', 'Coal', 'ore', ['ore'], 5, 50, { shape: 'ore', color: 0x35363a, accent: 0x18181a }, { fuel: 8 });
item('silver_ore', 'Silver Ore', 'ore', ['ore', 'luxury'], 22, 50, { shape: 'ore', color: 0x8c8c8c, accent: 0xe4e8f0 });
item('gold_ore', 'Gold Ore', 'ore', ['ore', 'luxury'], 45, 50, { shape: 'ore', color: 0x8c8c8c, accent: 0xf2c53d });
item('rough_gem', 'Rough Ruby', 'luxury', ['luxury'], 180, 20, { shape: 'gem', color: 0xc23a52 });
item('crushed_iron', 'Crushed Iron Ore', 'ore', ['ore'], 10, 50, { shape: 'crushed', color: 0x9c7a64, accent: 0xc26a3a });
item('crushed_copper', 'Crushed Copper Ore', 'ore', ['ore'], 9, 50, { shape: 'crushed', color: 0x7f9690, accent: 0x3fb3a0 });
item('iron_concentrate', 'Washed Iron', 'ore', ['ore'], 12.5, 50, { shape: 'dust', color: 0xb5643a });
item('copper_concentrate', 'Washed Copper', 'ore', ['ore'], 11, 50, { shape: 'dust', color: 0x46b8a4 });
item('gravel', 'Gravel', 'material', ['stone'], 1.5, 100, { shape: 'crushed', color: 0xa39e96, accent: 0x7c776f });

// ——— Food & farming ———
item('berries', 'Berries', 'food', ['food'], 2, 50, { shape: 'berry', color: 0xc2304a }, { food: { hunger: 6 } });
item('mushroom', 'Mushroom', 'food', ['food', 'herbal'], 4, 50, { shape: 'mushroom', color: 0xc9573c }, { food: { hunger: 8 } });
item('raw_meat', 'Raw Meat', 'food', ['hunt', 'food'], 4, 50, { shape: 'meat', color: 0xd0605e }, { food: { hunger: 5 } });
item(
  'cooked_meat',
  'Cooked Meat',
  'food',
  ['food'],
  8,
  50,
  { shape: 'meat', color: 0x9a5530 },
  { food: { hunger: 28, heal: 6, buff: 'strength', buffSeconds: 90 } },
);
item('wheat', 'Wheat', 'food', ['farm', 'food'], 3, 100, { shape: 'wheat', color: 0xe0b84c });
item('wheat_seeds', 'Wheat Seeds', 'seed', ['farm'], 1, 100, { shape: 'seed', color: 0xc9a046 }, { plant: 'wheat' });
item('carrot', 'Carrot', 'food', ['farm', 'food'], 3, 50, { shape: 'carrot', color: 0xf08a24 }, { food: { hunger: 7 }, plant: 'carrot' });
item('potato', 'Potato', 'food', ['farm', 'food'], 3, 50, { shape: 'potato', color: 0xc9a06a }, { food: { hunger: 6 }, plant: 'potato' });
item('cotton_seeds', 'Cotton Seeds', 'seed', ['farm'], 1.5, 100, { shape: 'seed', color: 0xeae3d2 }, { plant: 'cotton' });
item('egg', 'Egg', 'food', ['farm', 'food'], 4, 50, { shape: 'egg', color: 0xf5ecd7 }, { food: { hunger: 5 } });
item('milk', 'Milk', 'food', ['farm', 'food'], 8, 20, { shape: 'bottle', color: 0xf7f7f2 }, { food: { hunger: 8, heal: 4 } });
item('flour', 'Flour', 'material', ['food'], 6, 50, { shape: 'sack', color: 0xf0e8d6 });
item(
  'bread',
  'Bread',
  'food',
  ['food'],
  12,
  50,
  { shape: 'bread', color: 0xc98a3e },
  { food: { hunger: 32, buff: 'stamina', buffSeconds: 120 } },
);
item(
  'vegetable_stew',
  'Vegetable Stew',
  'food',
  ['food'],
  18,
  20,
  { shape: 'bowl', color: 0xd9822b },
  { food: { hunger: 40, heal: 10, buff: 'regen', buffSeconds: 120 } },
);

// ——— Fish (§11) ———
item(
  'perch',
  'Perch',
  'food',
  ['food', 'hunt', 'fish'],
  4,
  50,
  { shape: 'fish', color: 0x8fa35a, accent: 0xd9822b },
  { food: { hunger: 4 } },
);
item(
  'trout',
  'River Trout',
  'food',
  ['food', 'hunt', 'fish'],
  8,
  50,
  { shape: 'fish', color: 0x9aa88f, accent: 0xd06080 },
  { food: { hunger: 5 } },
);
item(
  'carp',
  'Carp',
  'food',
  ['food', 'hunt', 'fish'],
  6,
  50,
  { shape: 'fish', color: 0xb58a3e, accent: 0x7a5a2a },
  { food: { hunger: 5 } },
);
item(
  'pike',
  'Pike',
  'food',
  ['food', 'hunt', 'fish'],
  13,
  50,
  { shape: 'fish', color: 0x5f7a4a, accent: 0xc6d08a },
  { food: { hunger: 6 } },
);
item(
  'salmon',
  'Salmon',
  'food',
  ['food', 'hunt', 'fish', 'luxury'],
  16,
  50,
  { shape: 'fish', color: 0xa0a8b0, accent: 0xf08a6a },
  { food: { hunger: 6 } },
);
item(
  'mackerel',
  'Mackerel',
  'food',
  ['food', 'hunt', 'fish'],
  6,
  50,
  { shape: 'fish', color: 0x3f6f9a, accent: 0xbfe3f0 },
  { food: { hunger: 5 } },
);
item(
  'sea_bass',
  'Sea Bass',
  'food',
  ['food', 'hunt', 'fish'],
  12,
  50,
  { shape: 'fish', color: 0x6f7c8f, accent: 0xe4e8f0 },
  { food: { hunger: 6 } },
);
item(
  'cooked_fish',
  'Grilled Fish',
  'food',
  ['food', 'fish'],
  11,
  50,
  { shape: 'fish', color: 0xc98a3e, accent: 0x7a4e2d },
  { food: { hunger: 24, heal: 8, buff: 'regen', buffSeconds: 60 } },
);

// ——— Imports (Port Meridian) ———
item('spices', 'Spices', 'luxury', ['food', 'luxury', 'import'], 28, 50, { shape: 'sack', color: 0xc2552e, accent: 0xf2c53d });
item('silk', 'Silk', 'luxury', ['luxury', 'import'], 44, 50, { shape: 'wool', color: 0xb05ac2, accent: 0xf0c8f5 });
item(
  'tea',
  'Tea',
  'food',
  ['food', 'import'],
  16,
  50,
  { shape: 'sack', color: 0x5a8a4a, accent: 0xc6e07a },
  { food: { hunger: 3, buff: 'stamina', buffSeconds: 180 } },
);
item('soggy_boot', 'Soggy Boot', 'resource', ['hunt'], 0.5, 10, { shape: 'boot', color: 0x5c3a20 });

// ——— Materials ———
item('plank', 'Plank', 'material', ['wood', 'building'], 1.5, 100, { shape: 'plank', color: 0xc99a5b }, { fuel: 1 });
item('hardwood_plank', 'Hardwood Plank', 'material', ['wood', 'building'], 4, 100, { shape: 'plank', color: 0x7a4e2d });
item('charcoal', 'Charcoal', 'material', ['wood'], 4, 50, { shape: 'lump', color: 0x2b2b2e }, { fuel: 6 });
item('rope', 'Rope', 'material', ['farm', 'building'], 4, 50, { shape: 'rope', color: 0xc9b07a });
item('leather', 'Leather', 'material', ['hunt'], 15, 50, { shape: 'hide', color: 0x8a5a33, accent: 0x5c3a20 });
item('stone_brick', 'Stone Brick', 'material', ['stone', 'building'], 3, 100, { shape: 'brick', color: 0xa5a8ad });
item('brick', 'Clay Brick', 'material', ['stone', 'building'], 4, 100, { shape: 'brick', color: 0xb5553a });
item('glass', 'Glass', 'material', ['building'], 5, 100, { shape: 'glass', color: 0xbfe3f0 });

// ——— Metals & components ———
item('iron_ingot', 'Iron Ingot', 'material', ['metal'], 19, 50, { shape: 'ingot', color: 0xa9afb8 }, { quality: true });
item('copper_ingot', 'Copper Ingot', 'material', ['metal'], 17, 50, { shape: 'ingot', color: 0xd27a45 }, { quality: true });
item('steel_ingot', 'Steel Ingot', 'material', ['metal'], 34, 50, { shape: 'ingot', color: 0x6f7c8f }, { quality: true });
item('silver_ingot', 'Silver Ingot', 'material', ['metal', 'luxury'], 48, 50, { shape: 'ingot', color: 0xe4e8f0 });
item('gold_ingot', 'Gold Ingot', 'material', ['metal', 'luxury'], 95, 50, { shape: 'ingot', color: 0xf2c53d });
item('iron_plate', 'Iron Plate', 'material', ['metal', 'component'], 27, 50, { shape: 'plate', color: 0xa9afb8 }, { quality: true });
item('copper_plate', 'Copper Plate', 'material', ['metal', 'component'], 24, 50, { shape: 'plate', color: 0xd27a45 }, { quality: true });
item('steel_plate', 'Steel Plate', 'material', ['metal', 'component'], 46, 50, { shape: 'plate', color: 0x6f7c8f }, { quality: true });
item('iron_rod', 'Iron Rod', 'component', ['metal', 'component'], 12, 50, { shape: 'rod', color: 0xa9afb8 }, { quality: true });
item('iron_gear', 'Iron Gear', 'component', ['component'], 38, 50, { shape: 'gear', color: 0xa9afb8 }, { quality: true });
item('steel_gear', 'Steel Gear', 'component', ['component'], 58, 50, { shape: 'gear', color: 0x6f7c8f }, { quality: true });
item('copper_wire', 'Copper Wire', 'component', ['component'], 8, 100, { shape: 'wire', color: 0xd27a45 });
item('bearing', 'Bearing', 'component', ['component'], 30, 50, { shape: 'bearing', color: 0x8e99a8 });
item('gearbox_unit', 'Gearbox Unit', 'component', ['component'], 140, 20, { shape: 'box', color: 0x6f7c8f, accent: 0xe0b84c });
item('industrial_pump', 'Industrial Pump', 'component', ['component', 'machine'], 410, 10, { shape: 'pump', color: 0x3f6f9a });
// ——— Petroleum ———
item('fuel_oil', 'Fuel Oil', 'material', ['ore', 'machine'], 16, 50, { shape: 'bottle', color: 0x3a2e2a, accent: 0xd9822b }, { fuel: 20 });
item(
  'lubricant',
  'Lubricant',
  'material',
  ['machine', 'component'],
  24,
  50,
  { shape: 'bottle', color: 0xd9b23d, accent: 0x7a5a2a },
  { desc: 'Oil a machine (Repair in its panel): fixes wear and keeps it from wearing for a day.' },
);
item('plastic', 'Plastic', 'material', ['component'], 20, 100, { shape: 'plate', color: 0xeaf0f2, accent: 0x9ad0e0 });
item('circuit', 'Circuit Board', 'component', ['component'], 110, 50, { shape: 'box', color: 0x3f7a4f, accent: 0xd9b23d });
item('spring', 'Spring', 'component', ['component'], 14, 50, { shape: 'wire', color: 0xb0b5bd });
item('valve', 'Valve', 'component', ['component'], 42, 50, { shape: 'pump', color: 0xc27a45 });
item('precision_gear', 'Precision Gear', 'component', ['component'], 95, 50, { shape: 'gear', color: 0xd9dde3 });
// Packed goods: crates of ten (or twenty) made by a packager; worth a little more than loose.
item('packed_gears', 'Crate of Iron Gears', 'component', ['component'], 420, 20, { shape: 'box', color: 0x8a6a45, accent: 0xa9afb8 });
item('packed_plates', 'Crate of Iron Plates', 'component', ['metal', 'component'], 300, 20, {
  shape: 'box',
  color: 0x8a6a45,
  accent: 0xc4cad3,
});
item('packed_steel', 'Crate of Steel Plates', 'component', ['metal', 'component'], 510, 20, {
  shape: 'box',
  color: 0x8a6a45,
  accent: 0x6f7c8f,
});
item('packed_wire', 'Spool Crate of Copper Wire', 'component', ['component'], 180, 20, { shape: 'box', color: 0x8a6a45, accent: 0xd27a45 });
item('packed_bread', 'Crate of Bread', 'food', ['food'], 135, 20, { shape: 'box', color: 0x8a6a45, accent: 0xc98a3e });
item('cut_gem', 'Cut Ruby', 'luxury', ['luxury'], 310, 20, { shape: 'cutgem', color: 0xe0405e }, { quality: true });

// ——— Tools & weapons ———
item('stone_axe', 'Stone Axe', 'tool', ['tool'], 12, 1, { shape: 'axe', color: 0x9aa0a6 }, { tool: tool('axe', 1, 2, 12, 2.2, 1.35) });
item(
  'stone_pickaxe',
  'Stone Pickaxe',
  'tool',
  ['tool'],
  12,
  1,
  { shape: 'pickaxe', color: 0x9aa0a6 },
  { tool: tool('pickaxe', 1, 2, 10, 2.0, 1.35) },
);
item(
  'iron_axe',
  'Iron Axe',
  'tool',
  ['tool'],
  90,
  1,
  { shape: 'axe', color: 0xc4cad3 },
  { tool: tool('axe', 2, 4, 18, 2.3, 1.4), quality: true },
);
item(
  'iron_pickaxe',
  'Iron Pickaxe',
  'tool',
  ['tool'],
  95,
  1,
  { shape: 'pickaxe', color: 0xc4cad3 },
  { tool: tool('pickaxe', 2, 4, 15, 2.1, 1.4), quality: true },
);
item(
  'steel_axe',
  'Steel Axe',
  'tool',
  ['tool'],
  260,
  1,
  { shape: 'axe', color: 0x7f8ea3 },
  { tool: tool('axe', 3, 6, 26, 2.4, 1.45), quality: true },
);
item(
  'steel_pickaxe',
  'Steel Pickaxe',
  'tool',
  ['tool'],
  280,
  1,
  { shape: 'pickaxe', color: 0x7f8ea3 },
  { tool: tool('pickaxe', 3, 6, 22, 2.2, 1.45), quality: true },
);
item(
  'hammer',
  "Builder's Hammer",
  'tool',
  ['tool'],
  20,
  1,
  { shape: 'hammer', color: 0x9aa0a6 },
  { tool: tool('hammer', 0, 1, 8, 2.5, 1.4), desc: 'Hit your own structures to pick them back up.' },
);
item(
  'hoe',
  'Hoe',
  'tool',
  ['tool', 'farm'],
  25,
  1,
  { shape: 'hoe', color: 0x9aa0a6 },
  { tool: tool('hoe', 0, 1, 6, 2.2, 1.4), desc: 'Right click grass or dirt to till farmland.' },
);
item(
  'wooden_club',
  'Wooden Club',
  'weapon',
  ['weapon'],
  5,
  1,
  { shape: 'club', color: 0x9a6b3f },
  { tool: tool('club', 0, 1, 17, 2.0, 1.4) },
);
item(
  'stone_spear',
  'Stone Spear',
  'weapon',
  ['weapon'],
  18,
  1,
  { shape: 'spear', color: 0x9aa0a6 },
  { tool: tool('spear', 0, 1, 21, 1.6, 2.3) },
);
item(
  'iron_sword',
  'Iron Sword',
  'weapon',
  ['weapon'],
  120,
  1,
  { shape: 'sword', color: 0xc4cad3 },
  { tool: tool('sword', 0, 1, 30, 2.2, 1.7), quality: true },
);
item(
  'steel_sword',
  'Steel Sword',
  'weapon',
  ['weapon'],
  320,
  1,
  { shape: 'sword', color: 0x7f8ea3 },
  { tool: tool('sword', 0, 1, 42, 2.3, 1.75), quality: true },
);
item(
  'bow',
  'Hunting Bow',
  'weapon',
  ['weapon', 'hunt'],
  45,
  1,
  { shape: 'bow', color: 0x9a6b3f },
  { tool: tool('bow', 0, 1, 24, 1.1, 1.2), desc: 'Hold left click to draw, release to shoot. Uses arrows.' },
);
item('arrow', 'Arrow', 'ammo', ['weapon', 'hunt'], 2, 100, { shape: 'arrow', color: 0x9a6b3f });
item(
  'fishing_rod',
  'Fishing Rod',
  'tool',
  ['tool', 'hunt'],
  14,
  1,
  { shape: 'fishing_rod', color: 0x9a6b3f },
  { tool: tool('rod', 0, 1, 3, 1.5, 1.2), desc: 'Click to cast into water, and click again the moment the float dips.' },
);

// ——— Gear ———
item(
  'medium_backpack',
  'Medium Backpack',
  'gear',
  ['gear'],
  150,
  1,
  { shape: 'backpack', color: 0x8a5a33 },
  { backpack: 24, desc: 'Use to upgrade your backpack to 24 slots.' },
);
item(
  'large_backpack',
  'Large Backpack',
  'gear',
  ['gear'],
  600,
  1,
  { shape: 'backpack', color: 0x5c6e3a },
  { backpack: 32, desc: 'Use to upgrade your backpack to 32 slots.' },
);
item(
  'freight_pack',
  'Freight Pack',
  'gear',
  ['gear'],
  2400,
  1,
  { shape: 'backpack', color: 0x3f5670 },
  { backpack: 40, desc: 'Use to upgrade your backpack to 40 slots.' },
);

// ——— Blueprints ———
item(
  'steam_blueprint',
  'Blueprint: Steam Engine',
  'blueprint',
  ['blueprint'],
  900,
  1,
  { shape: 'scroll', color: 0x5b8fd1 },
  { teaches: 'steam', desc: 'Use to learn how to build steam engines (needs Steam Power research).' },
);
item(
  'assembler_blueprint',
  'Blueprint: Assembler',
  'blueprint',
  ['blueprint'],
  600,
  1,
  { shape: 'scroll', color: 0x5bd18f },
  { teaches: 'precision', desc: 'Use to learn how to build assemblers (needs Precision Engineering research).' },
);

// ——— Placeables (buildings and machines) ———
const place = (
  id: string,
  name: string,
  category: 'building' | 'machine',
  value: number,
  stack: number,
  color: number,
  desc: string,
  tags: MarketTag[] = [category === 'machine' ? 'machine' : 'building'],
): void => item(id, name, category, tags, value, stack, { shape: 'structure', color }, { place: id, desc });

place('campfire', 'Campfire', 'building', 6, 10, 0xe07b39, 'Cook raw meat. Burns wood.');
place('workbench', 'Workbench', 'building', 20, 10, 0xb07a45, 'Craft tools, building parts and machines near it.');
place('furnace', 'Furnace', 'building', 25, 10, 0x8a8f96, 'Smelts ore into ingots. Needs fuel.');
place('anvil', 'Anvil', 'building', 60, 10, 0x55595f, 'Forge ingots into plates, gears, tools and weapons.');
place('chest', 'Wooden Chest', 'building', 12, 10, 0xa36f3c, 'Stores 16 stacks.');
place('bed', 'Bed', 'building', 30, 5, 0xb85c5c, 'Your respawn point.');
place('wood_wall', 'Wooden Wall', 'building', 4, 50, 0xa36f3c, 'Blocks movement.');
place('stone_wall', 'Stone Wall', 'building', 8, 50, 0x9aa0a6, 'A sturdier wall.');
place('wood_door', 'Wooden Door', 'building', 10, 20, 0xc08850, 'Only you and your claim members can open it.');
place('wood_floor', 'Wooden Floor', 'building', 2, 100, 0xc99a5b, 'Decorative floor.');
place('stone_floor', 'Stone Floor', 'building', 4, 100, 0xa5a8ad, 'Decorative floor.');
place('fence', 'Fence', 'building', 3, 50, 0x9a6b3f, 'Keeps animals in (and out).');
place('torch', 'Torch', 'building', 3, 50, 0xf2b53d, 'Light at night.');
place('land_claim', 'Land Claim', 'building', 250, 5, 0xd9b23d, 'Claims the land around it (15 tiles in every direction).');
place('water_wheel', 'Water Wheel', 'machine', 160, 10, 0x8a6a45, 'Place on a river. 16 RPM, 100 torque.');
place('windmill', 'Windmill', 'machine', 220, 10, 0xd6c7a6, 'Wind power: 8–16 RPM depending on height, 64 torque.');
place('hand_crank', 'Hand Crank', 'machine', 45, 10, 0x9a6b3f, 'Hold E to turn it: 8 RPM, 32 torque.');
place('shaft', 'Shaft', 'machine', 30, 50, 0xb0b5bd, 'Carries rotation in a straight line.');
place('gearbox', 'Gearbox', 'machine', 140, 20, 0x8e7a55, 'Connects shafts on all four sides.');
place(
  'speed_gearbox',
  'Speed Gearbox',
  'machine',
  180,
  20,
  0xc9973a,
  'The arrow side turns twice as fast (and costs twice the stress per machine).',
);
place('crusher', 'Crusher', 'machine', 320, 10, 0x7d8189, 'Ore → crushed ore (better smelting yield). 40 torque.');
place('washer', 'Ore Washer', 'machine', 260, 10, 0x4f8fb8, 'Crushed ore → washed ore. Must touch water. 20 torque.');
place('press', 'Mechanical Press', 'machine', 380, 10, 0x6d7482, 'Ingots → plates, rods, gears, wire. 30 torque.');
place('millstone', 'Millstone', 'machine', 180, 10, 0xa8a196, 'Wheat → flour. 20 torque.');
place('saw', 'Mechanical Saw', 'machine', 240, 10, 0xb0453c, 'Logs → 4 planks. 25 torque.');
place('conveyor', 'Conveyor', 'machine', 16, 100, 0x3d3f45, 'Moves items. Needs rotation from an adjacent shaft or gearbox.');
place('hopper', 'Hopper', 'machine', 60, 20, 0x6a6f78, 'Pulls items from behind and pushes them forward. No power needed.');
place('splitter', 'Splitter', 'machine', 70, 20, 0x3f6f9a, 'Alternates items between its outputs.');
place('filter', 'Filter', 'machine', 90, 20, 0x7a3f9a, 'Sends one item type straight on, everything else to the sides.');
place('storage_crate', 'Storage Crate', 'machine', 40, 20, 0x8a6a45, 'Stores 24 stacks. Accepts conveyors.');
place(
  'shipping_crate',
  'Shipping Crate',
  'machine',
  120,
  10,
  0x3f7a4f,
  'Every dawn a merchant wagon sells its contents at the nearest settlement (10 % haulage fee).',
);
place('shop_stand', 'Shop Stand', 'building', 150, 5, 0xc0503f, 'Sell your goods to other players at your own prices.');
place('oven', 'Oven', 'machine', 80, 10, 0xb5553a, 'Flour → bread. Needs fuel.');
place('blast_furnace', 'Blast Furnace', 'machine', 900, 5, 0x6a4a3a, 'Iron ingot + coal → steel. Needs fuel.');
place('assembler', 'Assembler', 'machine', 1600, 5, 0x4a6a8a, 'Builds components from parts. 60 torque.');
place('steam_engine', 'Steam Engine', 'machine', 2400, 5, 0x8a3a2a, 'Runs on steam from a boiler: 32 RPM, 256 torque, 10 steam/s.');
place(
  'boiler',
  'Boiler',
  'machine',
  1500,
  5,
  0x6a4a3a,
  'Burns fuel to turn water into steam, 20/s. Water in at the back and sides, steam out the front.',
);
place(
  'pump',
  'Mechanical Pump',
  'machine',
  280,
  10,
  0x3f6f9a,
  'Place it touching water and give it rotation: 20 water/s at 16 RPM. 8 stress.',
);
place('pipe', 'Pipe', 'machine', 8, 100, 0xc27a45, 'Carries water or steam between pumps, tanks, boilers and engines.');
place('fluid_tank', 'Fluid Tank', 'machine', 200, 10, 0x9a6b3f, 'Holds 2000 units of water or steam in a pipe network.');
place('pen_gate', 'Pen Gate', 'building', 12, 20, 0x9a6b3f, 'A fence gate you can walk through.');
place('spike_trap', 'Spike Trap', 'building', 14, 20, 0x8a8f96, 'Hurts bandits and wild animals that step on it. Wears out.');
place(
  'arrow_tower',
  'Arrow Tower',
  'building',
  260,
  5,
  0x7a5230,
  'Shoots bandits and predators within 9 tiles, over walls. Load it with arrows (E, or by conveyor).',
);

item(
  'hand_cart',
  'Hand Cart',
  'gear',
  ['gear'],
  90,
  5,
  { shape: 'box', color: 0x9a6b3f, accent: 0x5c3a20 },
  { vehicle: 'cart', desc: 'Use to set it down, then hold E next to it to pull it: 24 slots of storage on wheels.' },
);

item(
  'wagon',
  'Wagon',
  'gear',
  ['gear'],
  420,
  2,
  { shape: 'box', color: 0x8a5a33, accent: 0xe8e0c8 },
  { vehicle: 'wagon', desc: 'Set it down, then ride a horse up to it and press G to hitch it: 48 slots on four wheels.' },
);
item(
  'minecart',
  'Minecart',
  'gear',
  ['gear', 'machine'],
  160,
  5,
  { shape: 'box', color: 0x55595f, accent: 0x9aa0a6 },
  {
    vehicle: 'minecart',
    desc: 'Set it on a rail: it runs by itself, stops at stations to load or unload, and turns back at the end of the line.',
  },
);
place(
  'pumpjack',
  'Pumpjack',
  'machine',
  1800,
  5,
  0x55595f,
  'Stand it over an oil seep in the desert and give it rotation: 12 crude oil/s at 16 RPM. 40 stress.',
);
place(
  'refinery',
  'Refinery',
  'machine',
  2600,
  5,
  0x6f7c8f,
  'Pipe crude oil in: makes fuel oil, lubricant or plastic. Runs on electricity (80).',
);
place(
  'generator',
  'Generator',
  'machine',
  950,
  5,
  0x3f6f9a,
  'Turns rotation into electricity: 100 power at 16 RPM (more when faster). 64 stress.',
);
place(
  'power_pole',
  'Power Pole',
  'machine',
  40,
  50,
  0x7a5230,
  'Carries power: poles within 9 tiles wire themselves together; devices use a pole within 3.',
);
place(
  'electric_motor',
  'Electric Motor',
  'machine',
  780,
  5,
  0x3f5670,
  'Rotation from electricity anywhere on the grid: 16 RPM, 48 torque, draws 100 power.',
);
place('electric_lamp', 'Electric Lamp', 'building', 60, 20, 0xf2e6a0, 'Bright light at night. Draws 6 power.');
place('lathe', 'Lathe', 'machine', 1500, 5, 0x6d7482, 'Turns springs, valves and precision gears. Runs on electricity (50).');
place('packager', 'Packager', 'machine', 1200, 5, 0x9a6b3f, 'Packs goods into crates worth more than loose. Runs on electricity (40).');
place(
  'drill',
  'Mechanical Drill',
  'machine',
  1100,
  5,
  0x8e6f3f,
  'Stand it over an ore vein, a coal seam or a rock and turn it (48 stress): it mines without end and pushes what it digs out of its front.',
);
// Monuments: no trader buys them (tags []), and once raised they stand for good.
place('obelisk', 'Stone Obelisk', 'building', 8400, 1, 0xd8cfb8, 'A monument (+3 prestige). Once raised it stands for good.', []);
place(
  'grand_fountain',
  'Grand Fountain',
  'building',
  8680,
  1,
  0x4f8fd0,
  'A monument (+4 prestige). Anyone resting by it gets their wind back faster. Once raised it stands for good.',
  [],
);
place(
  'statue_of_industry',
  'Statue of Industry',
  'building',
  19650,
  1,
  0xb08d57,
  'A monument (+6 prestige) bearing your name. Once raised it stands for good.',
  [],
);
place(
  'beacon_of_progress',
  'Beacon of Progress',
  'building',
  26200,
  1,
  0xf2e6a0,
  'A monument (+8 prestige): at night, with 40 power from a pole, it lights up the valley and shows on every map. Once raised it stands for good.',
  [],
);
place('rail', 'Rail', 'machine', 6, 100, 0x7a5230, 'Track for minecarts. Joins the rails next to it; E on a junction flips its switch.');
place(
  'rail_station',
  'Rail Station',
  'machine',
  90,
  20,
  0x3f7a4f,
  'Minecarts stop here to load from or unload into what stands beside it. E changes the mode.',
);

// ——— Animals (placed as live animals) ———
item('chicken', 'Chicken', 'animal', ['animal'], 25, 5, { shape: 'egg', color: 0xffffff, accent: 0xe03b2b }, { animal: 'chicken' });
item('sheep', 'Sheep', 'animal', ['animal'], 90, 5, { shape: 'wool', color: 0xf3efe6, accent: 0x333333 }, { animal: 'sheep' });
item('cow', 'Cow', 'animal', ['animal'], 220, 5, { shape: 'bottle', color: 0xffffff, accent: 0x222222 }, { animal: 'cow' });
item('horse', 'Horse', 'animal', ['animal'], 400, 1, { shape: 'hide', color: 0x8a5a33, accent: 0x3a2515 }, { animal: 'horse' });

export const ITEMS: readonly ItemDef[] = defs;
export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(defs.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID.get(id);
  if (!d) throw new Error(`Unknown item "${id}"`);
  return d;
}

export const isItem = (id: unknown): id is string => typeof id === 'string' && ITEM_BY_ID.has(id);

/** Whether an item is equipment the player keeps when they die (§39). */
export function keptOnDeath(def: ItemDef): boolean {
  return def.category === 'tool' || def.category === 'weapon' || def.category === 'gear' || def.category === 'blueprint';
}

export const FIST: ToolStats = { kind: 'fist', tier: 0, power: 1, damage: 7, rate: 2.6, reach: 1.15 };
