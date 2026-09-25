// Town projects (§53–54): what each settlement wants built, in order. Anyone can deliver the goods
// at the contract board (paid a little above market); finishing a project makes the town prosper,
// deepens its market and puts the new building in town for everyone to see.

export interface TownProject {
  id: string;
  settlement: string;
  title: string;
  desc: string;
  needs: { item: string; n: number }[];
  /** Prosperity added when it is finished. */
  prosperity: number;
  /** Market depth multiplier from then on (markets absorb more before prices move). */
  scale?: number;
  /** What appears in town: a structure type, placed near the square (or on the river, for a wheel). */
  build: { type: string; near: 'square' | 'river' | 'shore' };
}

export const TOWN_PROJECTS: readonly TownProject[] = [
  {
    id: 'westhaven_mill',
    settlement: 'westhaven',
    title: 'Repair the town mill wheel',
    desc: 'The old mill wheel on the river has rotted through. Rebuild it and the town can grind its own grain again.',
    needs: [
      { item: 'plank', n: 120 },
      { item: 'iron_gear', n: 12 },
      { item: 'iron_plate', n: 6 },
    ],
    prosperity: 6000,
    build: { type: 'water_wheel', near: 'river' },
  },
  {
    id: 'westhaven_warehouse',
    settlement: 'westhaven',
    title: 'Build a warehouse',
    desc: 'Traders could stock far more if they had somewhere to keep it. Markets here will take bigger loads.',
    needs: [
      { item: 'plank', n: 300 },
      { item: 'stone_brick', n: 160 },
      { item: 'iron_rod', n: 30 },
    ],
    prosperity: 10000,
    scale: 1.3,
    build: { type: 'warehouse', near: 'square' },
  },
  {
    id: 'westhaven_clock',
    settlement: 'westhaven',
    title: 'Raise a clock tower',
    desc: 'A proper town keeps proper time. The finest gears in the valley, please.',
    needs: [
      { item: 'stone_brick', n: 200 },
      { item: 'glass', n: 30 },
      { item: 'precision_gear', n: 8 },
    ],
    prosperity: 20000,
    build: { type: 'clock_tower', near: 'square' },
  },
  {
    id: 'stonehaven_lift',
    settlement: 'stonehaven',
    title: 'Build a mine lift',
    desc: 'Hauling ore up by hand is killing the miners. A headframe and winding wheel would change everything.',
    needs: [
      { item: 'hardwood_plank', n: 120 },
      { item: 'iron_rod', n: 30 },
      { item: 'rope', n: 40 },
      { item: 'iron_gear', n: 10 },
    ],
    prosperity: 6000,
    scale: 1.2,
    build: { type: 'mine_lift', near: 'square' },
  },
  {
    id: 'stonehaven_granary',
    settlement: 'stonehaven',
    title: 'Stock a food store',
    desc: 'Winters up here are long. A stone food store, and the village will pay better for food all year.',
    needs: [
      { item: 'stone_brick', n: 150 },
      { item: 'bread', n: 120 },
      { item: 'cooked_meat', n: 80 },
    ],
    prosperity: 8000,
    scale: 1.2,
    build: { type: 'granary', near: 'square' },
  },
  {
    id: 'greenfield_granary',
    settlement: 'greenfield',
    title: 'Build a granary',
    desc: 'The harvest rots in the fields for want of a dry store. A granary, and farm markets will run deeper.',
    needs: [
      { item: 'plank', n: 240 },
      { item: 'stone_brick', n: 80 },
      { item: 'iron_rod', n: 20 },
    ],
    prosperity: 6000,
    scale: 1.3,
    build: { type: 'granary', near: 'square' },
  },
  {
    id: 'greenfield_windmill',
    settlement: 'greenfield',
    title: 'Raise a village windmill',
    desc: 'Greenfield has wind in plenty and grain in plenty. It only lacks a mill.',
    needs: [
      { item: 'plank', n: 200 },
      { item: 'rope', n: 40 },
      { item: 'iron_gear', n: 10 },
    ],
    prosperity: 8000,
    build: { type: 'windmill', near: 'square' },
  },
  {
    id: 'port_lighthouse',
    settlement: 'port_meridian',
    title: 'Light the harbour',
    desc: 'Ships will not risk the coast at night without a light. Build a lighthouse and trade will grow.',
    needs: [
      { item: 'stone_brick', n: 240 },
      { item: 'glass', n: 40 },
      { item: 'copper_plate', n: 20 },
      { item: 'electric_lamp', n: 4 },
    ],
    prosperity: 12000,
    scale: 1.25,
    build: { type: 'lighthouse', near: 'shore' },
  },
  {
    id: 'port_warehouse',
    settlement: 'port_meridian',
    title: 'Build a bonded warehouse',
    desc: 'Goods waiting for a ship need a safe, dry place. The export agent will take far bigger lots.',
    needs: [
      { item: 'hardwood_plank', n: 200 },
      { item: 'steel_plate', n: 40 },
      { item: 'packed_plates', n: 10 },
    ],
    prosperity: 16000,
    scale: 1.3,
    build: { type: 'warehouse', near: 'square' },
  },
];

export const PROJECT_BY_ID: ReadonlyMap<string, TownProject> = new Map(TOWN_PROJECTS.map((p) => [p.id, p]));

/** A settlement's projects in order. */
export const projectsFor = (settlement: string): TownProject[] => TOWN_PROJECTS.filter((p) => p.settlement === settlement);
