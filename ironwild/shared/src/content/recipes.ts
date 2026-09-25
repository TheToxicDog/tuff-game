// Recipes. Crafting recipes (craft: true) happen instantly in the player's hands or at a nearby
// station; anvil recipes run the smithing minigame and roll quality. Machine recipes are processed
// over time by furnaces and powered machines, and may have fractional yields (10 ore → 7 ingots).

import { DRILL_TIME, NODES, drillable } from './nodes';

export interface RecipeStack {
  item: string;
  n: number;
}

export interface Recipe {
  id: string;
  station: string;
  inputs: RecipeStack[];
  outputs: RecipeStack[];
  /** Seconds per operation for machines (at 16 RPM for powered ones). */
  time: number;
  craft?: boolean;
  /** Anvil recipes roll quality from the smithing minigame. */
  smith?: boolean;
  /** Research node that unlocks it. Omitted: known from the start. */
  research?: string;
  /** Machine mode (press, assembler) the recipe needs. */
  mode?: string;
  /** Fluid the machine must have in its tank for each operation (refineries). */
  fluid?: { fluid: string; amount: number };
}

export const CRAFT_STATIONS = ['hand', 'workbench', 'anvil', 'cooking'] as const;
export type CraftStation = (typeof CRAFT_STATIONS)[number];

/** Which placed structure provides each crafting station. */
export const STATION_STRUCTURES: Record<string, string[]> = {
  workbench: ['workbench'],
  anvil: ['anvil'],
  cooking: ['campfire', 'oven'],
};

export const STATION_NAMES: Record<string, string> = {
  hand: 'Hand',
  workbench: 'Workbench',
  anvil: 'Anvil',
  cooking: 'Campfire',
  furnace: 'Furnace',
  oven: 'Oven',
  blast_furnace: 'Blast Furnace',
  campfire: 'Campfire',
  crusher: 'Crusher',
  washer: 'Ore Washer',
  press: 'Mechanical Press',
  millstone: 'Millstone',
  saw: 'Mechanical Saw',
  assembler: 'Assembler',
  steam: 'Steam Engine',
  boiler: 'Boiler',
  pump: 'Mechanical Pump',
  lathe: 'Lathe',
  packager: 'Packager',
  refinery: 'Refinery',
  pumpjack: 'Pumpjack',
  drill: 'Mechanical Drill',
};

/** Fish that cook into grilled fish. */
export const FISH = ['perch', 'trout', 'carp', 'pike', 'salmon', 'mackerel', 'sea_bass'] as const;

const R: Recipe[] = [];
const s = (item: string, n = 1): RecipeStack => ({ item, n });

function craft(id: string, station: CraftStation, outputs: RecipeStack[], inputs: RecipeStack[], research?: string, smith = false): void {
  R.push({ id, station, outputs, inputs, time: 0, craft: true, research, smith: smith || undefined });
}

function machine(id: string, station: string, inputs: RecipeStack[], outputs: RecipeStack[], time: number, mode?: string): void {
  R.push({ id, station, inputs, outputs, time, mode });
}

// ——— By hand ———
craft('campfire', 'hand', [s('campfire')], [s('wood', 5), s('stone', 3)]);
craft('workbench', 'hand', [s('workbench')], [s('wood', 12), s('stone', 6)]);
craft('rope', 'hand', [s('rope')], [s('fiber', 3)]);
craft('wooden_club', 'hand', [s('wooden_club')], [s('wood', 6)]);
craft('torch', 'hand', [s('torch', 2)], [s('wood', 1), s('fiber', 1)]);
craft('wood_wall', 'hand', [s('wood_wall')], [s('wood', 5)]);
craft('wood_floor', 'hand', [s('wood_floor', 2)], [s('wood', 2)]);
craft('fence', 'hand', [s('fence', 2)], [s('wood', 3)]);
craft('hammer', 'hand', [s('hammer')], [s('wood', 4), s('stone', 4)]);
craft('fishing_rod', 'hand', [s('fishing_rod')], [s('wood', 3), s('fiber', 5)]);

// ——— Workbench ———
craft('plank', 'workbench', [s('plank', 2)], [s('wood', 1)]);
craft('hardwood_plank', 'workbench', [s('hardwood_plank', 2)], [s('hardwood', 1)]);
craft('stone_axe', 'workbench', [s('stone_axe')], [s('wood', 6), s('stone', 6), s('rope', 1)]);
craft('stone_pickaxe', 'workbench', [s('stone_pickaxe')], [s('wood', 6), s('stone', 8), s('rope', 1)]);
craft('stone_spear', 'workbench', [s('stone_spear')], [s('wood', 8), s('stone', 3), s('rope', 1)]);
craft('bow', 'workbench', [s('bow')], [s('wood', 6), s('rope', 3)]);
craft('arrow', 'workbench', [s('arrow', 6)], [s('wood', 2), s('stone', 1), s('fiber', 1)]);
craft('furnace', 'workbench', [s('furnace')], [s('stone', 25), s('wood', 5)]);
craft('chest', 'workbench', [s('chest')], [s('plank', 8)]);
craft('wood_door', 'workbench', [s('wood_door')], [s('plank', 6)]);
craft('bed', 'workbench', [s('bed')], [s('plank', 10), s('fiber', 10)]);
craft('leather', 'workbench', [s('leather')], [s('raw_hide', 2)]);
craft('flour_by_hand', 'workbench', [s('flour')], [s('wheat', 2)]);
craft('medium_backpack', 'workbench', [s('medium_backpack')], [s('leather', 6), s('rope', 4)]);
craft('stone_wall', 'workbench', [s('stone_wall')], [s('stone', 8)], 'masonry');
craft('stone_floor', 'workbench', [s('stone_floor', 2)], [s('stone', 4)], 'masonry');
craft('stone_brick', 'workbench', [s('stone_brick')], [s('stone', 2)], 'masonry');
craft('anvil', 'workbench', [s('anvil')], [s('iron_ingot', 6), s('stone', 10)], 'smithing');
craft('land_claim', 'workbench', [s('land_claim')], [s('plank', 20), s('iron_plate', 2), s('rope', 4)], 'smithing');
craft('hoe', 'workbench', [s('hoe')], [s('wood', 5), s('stone', 3), s('rope', 1)], 'agriculture');
craft('pen_gate', 'workbench', [s('pen_gate')], [s('wood', 4), s('rope', 1)], 'husbandry');
craft('hand_cart', 'workbench', [s('hand_cart')], [s('plank', 16), s('iron_rod', 2), s('rope', 2)], 'transport');
craft('spike_trap', 'workbench', [s('spike_trap', 2)], [s('plank', 4), s('iron_rod', 1)], 'fortification');
craft(
  'arrow_tower',
  'workbench',
  [s('arrow_tower')],
  [s('plank', 16), s('stone_brick', 12), s('iron_plate', 2), s('bow', 1)],
  'fortification',
);
craft('wagon', 'workbench', [s('wagon')], [s('hardwood_plank', 20), s('iron_rod', 6), s('leather', 4), s('iron_plate', 2)], 'transport');
craft('rail', 'workbench', [s('rail', 8)], [s('iron_rod', 2), s('plank', 4)], 'railways');
craft('rail_station', 'workbench', [s('rail_station')], [s('rail', 2), s('plank', 8), s('iron_gear', 1)], 'railways');
craft('minecart', 'workbench', [s('minecart')], [s('iron_plate', 4), s('iron_rod', 2), s('iron_gear', 2)], 'railways');
craft('large_backpack', 'workbench', [s('large_backpack')], [s('leather', 12), s('rope', 6), s('iron_rod', 2)], 'transport');
// Mechanical parts
craft('shaft', 'workbench', [s('shaft', 2)], [s('iron_rod', 1), s('plank', 2)], 'mechanics');
craft('gearbox', 'workbench', [s('gearbox')], [s('iron_gear', 2), s('plank', 4), s('iron_plate', 1)], 'mechanics');
craft('water_wheel', 'workbench', [s('water_wheel')], [s('plank', 20), s('iron_rod', 2), s('iron_plate', 1)], 'mechanics');
craft('hand_crank', 'workbench', [s('hand_crank')], [s('plank', 4), s('iron_rod', 1), s('iron_gear', 1)], 'mechanics');
craft('windmill', 'workbench', [s('windmill')], [s('plank', 24), s('rope', 6), s('iron_gear', 2), s('iron_rod', 2)], 'wind_power');
craft('speed_gearbox', 'workbench', [s('speed_gearbox')], [s('iron_gear', 3), s('plank', 4), s('iron_plate', 2)], 'wind_power');
craft('crusher', 'workbench', [s('crusher')], [s('stone', 30), s('iron_plate', 4), s('iron_gear', 2)], 'ore_processing');
craft('washer', 'workbench', [s('washer')], [s('plank', 12), s('iron_plate', 2), s('iron_gear', 1)], 'ore_processing');
craft('press', 'workbench', [s('press')], [s('iron_plate', 6), s('iron_gear', 2), s('iron_rod', 2)], 'metal_forming');
craft('millstone', 'workbench', [s('millstone')], [s('stone', 30), s('iron_gear', 1), s('plank', 4)], 'milling');
craft('saw', 'workbench', [s('saw')], [s('iron_plate', 3), s('iron_gear', 1), s('plank', 8)], 'milling');
craft('conveyor', 'workbench', [s('conveyor', 4)], [s('leather', 1), s('plank', 4), s('iron_rod', 1)], 'logistics');
craft('hopper', 'workbench', [s('hopper')], [s('iron_plate', 3), s('plank', 2)], 'logistics');
craft('splitter', 'workbench', [s('splitter')], [s('conveyor', 2), s('iron_gear', 1)], 'logistics');
craft('filter', 'workbench', [s('filter')], [s('conveyor', 2), s('iron_gear', 1), s('iron_plate', 1)], 'logistics');
craft('storage_crate', 'workbench', [s('storage_crate')], [s('plank', 12), s('iron_rod', 2)], 'logistics');
craft('shipping_crate', 'workbench', [s('shipping_crate')], [s('plank', 16), s('iron_plate', 2)], 'commerce');
craft('shop_stand', 'workbench', [s('shop_stand')], [s('plank', 20), s('rope', 4), s('iron_rod', 2)], 'commerce');
craft('oven', 'workbench', [s('oven')], [s('brick', 20), s('iron_plate', 2)], 'cooking');
craft('blast_furnace', 'workbench', [s('blast_furnace')], [s('brick', 40), s('iron_plate', 10), s('stone_brick', 20)], 'steel');
craft('assembler', 'workbench', [s('assembler')], [s('steel_plate', 8), s('steel_gear', 6), s('copper_wire', 20)], 'precision');
craft('pumpjack', 'workbench', [s('pumpjack')], [s('steel_plate', 8), s('iron_gear', 6), s('pipe', 4)], 'petroleum');
craft('refinery', 'workbench', [s('refinery')], [s('steel_plate', 10), s('pipe', 8), s('valve', 4), s('copper_wire', 20)], 'petroleum');
craft('generator', 'workbench', [s('generator')], [s('iron_plate', 6), s('copper_wire', 24), s('iron_gear', 2)], 'electricity');
craft('power_pole', 'workbench', [s('power_pole', 2)], [s('wood', 4), s('copper_wire', 4), s('glass', 1)], 'electricity');
craft('electric_lamp', 'workbench', [s('electric_lamp', 2)], [s('glass', 2), s('copper_wire', 3), s('iron_rod', 1)], 'electricity');
craft('obelisk', 'workbench', [s('obelisk')], [s('stone_brick', 500), s('gold_ingot', 40), s('cut_gem', 10)], 'grand_works');
craft(
  'grand_fountain',
  'workbench',
  [s('grand_fountain')],
  [s('stone_brick', 800), s('silver_ingot', 60), s('copper_plate', 60), s('pipe', 40), s('industrial_pump', 4)],
  'grand_works',
);
craft(
  'statue_of_industry',
  'workbench',
  [s('statue_of_industry')],
  [s('steel_plate', 200), s('precision_gear', 60), s('gold_ingot', 50)],
  'grand_works',
);
craft(
  'beacon_of_progress',
  'workbench',
  [s('beacon_of_progress')],
  [s('circuit', 100), s('steel_plate', 150), s('electric_lamp', 30), s('cut_gem', 20), s('glass', 60)],
  'grand_works',
);
craft('drill', 'workbench', [s('drill')], [s('steel_plate', 8), s('steel_gear', 4), s('iron_rod', 6), s('iron_gear', 4)], 'deep_mining');
craft('lathe', 'workbench', [s('lathe')], [s('steel_plate', 6), s('iron_gear', 4), s('copper_wire', 12)], 'electricity');
craft('electric_motor', 'workbench', [s('electric_motor')], [s('iron_plate', 4), s('copper_wire', 16), s('spring', 2)], 'industry');
craft('packager', 'workbench', [s('packager')], [s('plank', 20), s('iron_plate', 4), s('spring', 4), s('valve', 1)], 'industry');
craft('pipe', 'workbench', [s('pipe', 4)], [s('copper_plate', 1)], 'steam');
craft('pump', 'workbench', [s('pump')], [s('iron_plate', 3), s('iron_gear', 2), s('copper_plate', 2)], 'steam');
craft('fluid_tank', 'workbench', [s('fluid_tank')], [s('copper_plate', 6), s('iron_rod', 4)], 'steam');
craft('boiler', 'workbench', [s('boiler')], [s('steel_plate', 6), s('brick', 16), s('copper_plate', 4)], 'steam');
craft(
  'steam_engine',
  'workbench',
  [s('steam_engine')],
  [s('steel_plate', 12), s('steel_gear', 8), s('iron_plate', 10), s('copper_plate', 6)],
  'steam',
);

// ——— Cooking (near a campfire or oven) ———
craft('vegetable_stew', 'cooking', [s('vegetable_stew')], [s('carrot', 1), s('potato', 1), s('mushroom', 1)], 'cooking');
craft('bread_by_hand', 'cooking', [s('bread')], [s('flour', 2)]);

// ——— Anvil (smithing minigame, quality) ———
craft('iron_plate', 'anvil', [s('iron_plate')], [s('iron_ingot', 1)], 'smithing', true);
craft('iron_rod', 'anvil', [s('iron_rod', 2)], [s('iron_ingot', 1)], 'smithing', true);
craft('iron_gear', 'anvil', [s('iron_gear')], [s('iron_plate', 2)], 'smithing', true);
craft('copper_plate', 'anvil', [s('copper_plate')], [s('copper_ingot', 1)], 'smithing', true);
craft('copper_wire', 'anvil', [s('copper_wire', 2)], [s('copper_ingot', 1)], 'smithing', true);
craft('iron_axe', 'anvil', [s('iron_axe')], [s('iron_ingot', 3), s('wood', 4)], 'smithing', true);
craft('iron_pickaxe', 'anvil', [s('iron_pickaxe')], [s('iron_ingot', 3), s('wood', 4)], 'smithing', true);
craft('iron_sword', 'anvil', [s('iron_sword')], [s('iron_ingot', 4), s('leather', 1)], 'smithing', true);
craft('steel_plate', 'anvil', [s('steel_plate')], [s('steel_ingot', 1)], 'steel', true);
craft('steel_gear', 'anvil', [s('steel_gear')], [s('steel_plate', 2)], 'steel', true);
craft('steel_axe', 'anvil', [s('steel_axe')], [s('steel_ingot', 3), s('hardwood', 2)], 'steel', true);
craft('steel_pickaxe', 'anvil', [s('steel_pickaxe')], [s('steel_ingot', 3), s('hardwood', 2)], 'steel', true);
craft('steel_sword', 'anvil', [s('steel_sword')], [s('steel_ingot', 4), s('leather', 1)], 'steel', true);
craft('cut_gem', 'anvil', [s('cut_gem')], [s('rough_gem', 1)], 'jewelcraft', true);

// ——— Furnace (fuel) ———
machine('smelt_iron_ore', 'furnace', [s('iron_ore')], [s('iron_ingot', 0.7)], 3);
machine('smelt_copper_ore', 'furnace', [s('copper_ore')], [s('copper_ingot', 0.7)], 3);
machine('smelt_crushed_iron', 'furnace', [s('crushed_iron')], [s('iron_ingot', 0.85)], 3);
machine('smelt_crushed_copper', 'furnace', [s('crushed_copper')], [s('copper_ingot', 0.85)], 3);
machine('smelt_washed_iron', 'furnace', [s('iron_concentrate')], [s('iron_ingot', 1)], 3);
machine('smelt_washed_copper', 'furnace', [s('copper_concentrate')], [s('copper_ingot', 1)], 3);
machine('smelt_silver', 'furnace', [s('silver_ore')], [s('silver_ingot', 0.7)], 4);
machine('smelt_gold', 'furnace', [s('gold_ore')], [s('gold_ingot', 0.7)], 4);
machine('smelt_scrap', 'furnace', [s('scrap_metal')], [s('iron_ingot', 0.5)], 3);
machine('smelt_sand', 'furnace', [s('sand')], [s('glass', 1)], 2.5);
machine('fire_clay', 'furnace', [s('clay')], [s('brick', 1)], 2.5);
machine('char_wood', 'furnace', [s('wood')], [s('charcoal', 1)], 4);
machine('furnace_meat', 'furnace', [s('raw_meat')], [s('cooked_meat', 1)], 3);

// ——— Campfire (fuel) ———
machine('cook_meat', 'campfire', [s('raw_meat')], [s('cooked_meat', 1)], 4);

for (const fish of FISH) {
  machine(`cook_${fish}`, 'campfire', [s(fish)], [s('cooked_fish', 1)], 3);
  machine(`oven_${fish}`, 'oven', [s(fish)], [s('cooked_fish', 1)], 2);
}

// ——— Oven ———
machine('bake_bread', 'oven', [s('flour')], [s('bread', 1)], 4);
machine('oven_meat', 'oven', [s('raw_meat')], [s('cooked_meat', 1)], 2.5);

// ——— Refinery (electric, crude oil piped in) ———
R.push({
  id: 'refine_fuel',
  station: 'refinery',
  inputs: [],
  outputs: [s('fuel_oil', 2)],
  time: 3,
  mode: 'fuel',
  fluid: { fluid: 'crude', amount: 20 },
});
R.push({
  id: 'refine_lubricant',
  station: 'refinery',
  inputs: [],
  outputs: [s('lubricant', 1)],
  time: 3,
  mode: 'lubricant',
  fluid: { fluid: 'crude', amount: 20 },
});
R.push({
  id: 'refine_plastic',
  station: 'refinery',
  inputs: [],
  outputs: [s('plastic', 2)],
  time: 4,
  mode: 'plastic',
  fluid: { fluid: 'crude', amount: 20 },
});

// ——— Lathe (electric) ———
machine('turn_spring', 'lathe', [s('iron_rod')], [s('spring', 2)], 2);
machine('turn_valve', 'lathe', [s('iron_rod'), s('copper_plate')], [s('valve', 1)], 3);
machine('turn_precision_gear', 'lathe', [s('steel_gear')], [s('precision_gear', 1)], 4);

// ——— Packager (electric) ———
machine('pack_gears', 'packager', [s('iron_gear', 10), s('plank')], [s('packed_gears', 1)], 3);
machine('pack_plates', 'packager', [s('iron_plate', 10), s('plank')], [s('packed_plates', 1)], 3);
machine('pack_steel', 'packager', [s('steel_plate', 10), s('plank')], [s('packed_steel', 1)], 3);
machine('pack_wire', 'packager', [s('copper_wire', 20), s('plank')], [s('packed_wire', 1)], 3);
machine('pack_bread', 'packager', [s('bread', 10), s('plank')], [s('packed_bread', 1)], 3);

// ——— Blast furnace ———
machine('make_steel', 'blast_furnace', [s('iron_ingot'), s('coal')], [s('steel_ingot', 1)], 5);

// ——— Powered machines (times at 16 RPM) ———
machine('crush_iron', 'crusher', [s('iron_ore')], [s('crushed_iron', 1)], 1.5);
machine('crush_copper', 'crusher', [s('copper_ore')], [s('crushed_copper', 1)], 1.5);
machine('crush_stone', 'crusher', [s('stone')], [s('gravel', 1)], 1);
machine('crush_gravel', 'crusher', [s('gravel')], [s('sand', 1)], 1);
machine('wash_iron', 'washer', [s('crushed_iron')], [s('iron_concentrate', 1)], 1.5);
machine('wash_copper', 'washer', [s('crushed_copper')], [s('copper_concentrate', 1)], 1.5);
machine('wash_gravel', 'washer', [s('gravel')], [s('sand', 1)], 1);
machine('press_iron_plate', 'press', [s('iron_ingot')], [s('iron_plate', 1)], 2, 'plate');
machine('press_copper_plate', 'press', [s('copper_ingot')], [s('copper_plate', 1)], 2, 'plate');
machine('press_steel_plate', 'press', [s('steel_ingot')], [s('steel_plate', 1)], 2, 'plate');
machine('press_iron_gear', 'press', [s('iron_plate')], [s('iron_gear', 1)], 2.5, 'gear');
machine('press_steel_gear', 'press', [s('steel_plate')], [s('steel_gear', 1)], 2.5, 'gear');
machine('press_iron_rod', 'press', [s('iron_ingot')], [s('iron_rod', 2)], 2, 'rod');
machine('press_copper_wire', 'press', [s('copper_ingot')], [s('copper_wire', 3)], 2, 'wire');
machine('press_pipe', 'press', [s('copper_plate')], [s('pipe', 4)], 2, 'pipe');
machine('mill_wheat', 'millstone', [s('wheat')], [s('flour', 1)], 2.5);
machine('saw_wood', 'saw', [s('wood')], [s('plank', 4)], 1.2);
machine('saw_hardwood', 'saw', [s('hardwood')], [s('hardwood_plank', 4)], 1.5);
machine('assemble_bearing', 'assembler', [s('steel_plate')], [s('bearing', 2)], 3, 'bearing');
machine('assemble_gearbox', 'assembler', [s('steel_gear', 2), s('steel_plate', 1)], [s('gearbox_unit', 1)], 6, 'gearbox_unit');
machine('assemble_circuit', 'assembler', [s('copper_wire', 6), s('plastic', 2), s('glass', 1)], [s('circuit', 1)], 4, 'circuit');
machine(
  'assemble_pump',
  'assembler',
  [s('gearbox_unit', 1), s('steel_plate', 2), s('copper_wire', 6), s('bearing', 2)],
  [s('industrial_pump', 1)],
  10,
  'industrial_pump',
);

// Mechanical drills: one load of whatever the vein, seam or rock under them gives by the pickaxe (§62).
for (const n of NODES)
  if (drillable(n))
    machine(
      `drill_${n.id}`,
      'drill',
      [],
      n.drops.map((d) => s(d.item, Math.round(d.rate * (d.chance ?? 1) * 100) / 100)),
      DRILL_TIME,
      n.id,
    );

export const RECIPES: readonly Recipe[] = R;
export const RECIPE_BY_ID: ReadonlyMap<string, Recipe> = new Map(R.map((r) => [r.id, r]));

/** Machine recipes for a station (and mode, if the machine has modes). */
export function machineRecipes(station: string, mode?: string): Recipe[] {
  return R.filter((r) => !r.craft && r.station === station && (mode === undefined || r.mode === undefined || r.mode === mode));
}

export function craftRecipes(station?: string): Recipe[] {
  return R.filter((r) => r.craft && (station === undefined || r.station === station));
}
