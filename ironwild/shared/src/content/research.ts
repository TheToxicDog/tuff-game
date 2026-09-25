// Engineering research (§51). Knowledge comes from discovering resources, crafting new things,
// completing contracts and running machines. Some nodes also need a blueprint (§52).

export interface ResearchNode {
  id: string;
  name: string;
  cost: number;
  requires: string[];
  /** Blueprint item that must have been read before this can be researched. */
  blueprint?: string;
  desc: string;
  /** Column/row in the research screen. */
  col: number;
  row: number;
}

export const RESEARCH: readonly ResearchNode[] = [
  { id: 'smithing', name: 'Smithing', cost: 10, requires: [], desc: 'Anvil, iron tools, plates, rods and gears.', col: 0, row: 1 },
  { id: 'masonry', name: 'Masonry', cost: 8, requires: [], desc: 'Stone walls, floors and bricks.', col: 0, row: 0 },
  {
    id: 'fortification',
    name: 'Fortification',
    cost: 20,
    requires: [],
    desc: 'Spike traps and arrow towers against raids.',
    col: 0,
    row: 2,
  },
  { id: 'agriculture', name: 'Agriculture', cost: 12, requires: [], desc: 'Hoes, tilling and planting crops.', col: 0, row: 3 },
  { id: 'cooking', name: 'Cooking', cost: 15, requires: ['agriculture'], desc: 'Ovens and hearty stews.', col: 1, row: 3 },
  {
    id: 'husbandry',
    name: 'Animal Husbandry',
    cost: 30,
    requires: ['agriculture'],
    desc: 'Pen gates; keep chickens, sheep and cows.',
    col: 1,
    row: 4,
  },
  { id: 'transport', name: 'Transport', cost: 35, requires: ['smithing'], desc: 'Hand carts and large backpacks.', col: 1, row: 2 },
  {
    id: 'mechanics',
    name: 'Mechanical Power',
    cost: 20,
    requires: ['smithing'],
    desc: 'Water wheels, hand cranks, shafts and gearboxes.',
    col: 1,
    row: 1,
  },
  { id: 'commerce', name: 'Commerce', cost: 25, requires: ['smithing'], desc: 'Shipping crates and shop stands.', col: 1, row: 0 },
  {
    id: 'ore_processing',
    name: 'Ore Processing',
    cost: 35,
    requires: ['mechanics'],
    desc: 'Crushers and ore washers: more metal per ore.',
    col: 2,
    row: 0,
  },
  { id: 'metal_forming', name: 'Metal Forming', cost: 35, requires: ['mechanics'], desc: 'The mechanical press.', col: 2, row: 1 },
  { id: 'milling', name: 'Milling', cost: 25, requires: ['mechanics'], desc: 'Millstones and mechanical saws.', col: 2, row: 2 },
  {
    id: 'logistics',
    name: 'Logistics',
    cost: 45,
    requires: ['mechanics'],
    desc: 'Conveyors, hoppers, splitters, filters and crates.',
    col: 2,
    row: 3,
  },
  { id: 'wind_power', name: 'Wind Power', cost: 30, requires: ['mechanics'], desc: 'Windmills and speed gearboxes.', col: 2, row: 4 },
  {
    id: 'steel',
    name: 'Steelmaking',
    cost: 80,
    requires: ['ore_processing', 'metal_forming'],
    desc: 'Blast furnaces, steel tools and parts.',
    col: 3,
    row: 1,
  },
  {
    id: 'railways',
    name: 'Railways',
    cost: 60,
    requires: ['logistics'],
    desc: 'Rails, stations and minecarts that haul goods on their own.',
    col: 3,
    row: 3,
  },
  {
    id: 'electricity',
    name: 'Electricity',
    cost: 90,
    requires: ['steel'],
    desc: 'Generators, power poles, lamps and the lathe.',
    col: 4,
    row: 1,
  },
  {
    id: 'industry',
    name: 'Industrial Production',
    cost: 140,
    requires: ['electricity'],
    desc: 'Electric motors and packagers.',
    col: 5,
    row: 1,
  },
  { id: 'jewelcraft', name: 'Gem Cutting', cost: 40, requires: ['smithing'], desc: 'Cut rough gems on the anvil.', col: 3, row: 4 },
  {
    id: 'precision',
    name: 'Precision Engineering',
    cost: 110,
    requires: ['steel', 'logistics'],
    blueprint: 'assembler_blueprint',
    desc: 'Assemblers: bearings, gearbox units, industrial pumps.',
    col: 4,
    row: 2,
  },
  {
    id: 'steam',
    name: 'Steam Power',
    cost: 160,
    requires: ['precision'],
    blueprint: 'steam_blueprint',
    desc: 'Pumps, pipes, boilers and steam engines: 32 RPM and 256 torque from coal.',
    col: 5,
    row: 2,
  },
];

export const RESEARCH_BY_ID: ReadonlyMap<string, ResearchNode> = new Map(RESEARCH.map((r) => [r.id, r]));

/** Knowledge rewards. */
export const KNOWLEDGE = {
  discoverItem: 2,
  firstCraft: 3,
  firstSettlementSale: 2,
  machineOutput: 0.02,
  tutorialStep: 4,
} as const;
