// Placeable structures: building pieces, stations, machines and logistics blocks. Structures sit
// on the tile grid; `rot` turns them clockwise in 90° steps. Local directions below are for
// rot = 0 (facing north).

import type { Dir } from '../constants';
import type { ElectricSpec } from '../factory/electric';
import type { FluidSpec } from '../factory/fluids';

/** A face through which a kinetic block passes rotation. `group` separates gear stages. */
export interface KineticPort {
  /** Tile offset inside the footprint (unrotated). */
  dx: number;
  dy: number;
  face: Dir;
  group: number;
}

export interface KineticSpec {
  role: 'source' | 'shaft' | 'gearbox' | 'consumer';
  /** Transmitting blocks: the faces they connect on. Consumers accept rotation on any face. */
  ports?: KineticPort[];
  /** Speed of each group relative to group 0 (gearboxes). */
  ratios?: number[];
  /** Sources: nominal speed and torque. */
  rpm?: number;
  torque?: number;
  /** Consumers: torque needed at 16 RPM. */
  stress?: number;
}

export interface MachineSpec {
  /** Recipe station processed by this machine. */
  station: string;
  /** Burns fuel. */
  fuel?: boolean;
  /** Needs rotation. */
  powered?: boolean;
  /** Must touch a water tile. */
  water?: boolean;
  /** Units the input buffer holds per slot. */
  buffer: number;
  /** Output direction relative to the facing (0 = front). */
  modes?: string[];
  /** Runs on electricity from a nearby power pole. */
  electric?: boolean;
}

export type LogisticsKind = 'conveyor' | 'splitter' | 'filter' | 'hopper';

export interface StructureDef {
  id: string;
  name: string;
  /** Item consumed to place it and refunded when picked up. */
  item: string;
  size: [number, number];
  solid: boolean;
  /** Floors live on their own layer under other structures. */
  layer: 'floor' | 'object';
  hp: number;
  placement: 'land' | 'water' | 'any' | 'farmland';
  kinetic?: KineticSpec;
  machine?: MachineSpec;
  container?: number;
  logistics?: LogisticsKind;
  /** Station usable for hand crafting while standing near it. */
  station?: string;
  door?: boolean;
  bed?: boolean;
  claimRadius?: number;
  shop?: boolean;
  shipping?: boolean;
  light?: number;
  /** Players can walk through (drawn low). */
  low?: boolean;
  /** Blocks animals but not players (gates). */
  gate?: boolean;
  /** Research needed to place it (in addition to owning the item). */
  hint?: string;
  /** Spike traps: damage dealt to hostile creatures standing on it. */
  trap?: number;
  /** Defensive towers: range in tiles, damage per arrow and seconds between shots. */
  tower?: { range: number; damage: number; every: number };
  /** Pipes, tanks and the machines that pump, boil or burn fluids. */
  fluid?: FluidSpec;
  /** Track for minecarts; stations also load and unload them. */
  rail?: 'track' | 'station';
  /** Generators, poles and everything that runs on electricity. */
  electric?: ElectricSpec;
}

const axis = (group = 0): KineticPort[] => [
  { dx: 0, dy: 0, face: 1, group },
  { dx: 0, dy: 0, face: 3, group },
];
const allFaces = (group = 0): KineticPort[] => [0, 1, 2, 3].map((face) => ({ dx: 0, dy: 0, face: face as Dir, group }));

const S: StructureDef[] = [
  // ——— Building pieces ———
  { id: 'wood_wall', name: 'Wooden Wall', item: 'wood_wall', size: [1, 1], solid: true, layer: 'object', hp: 250, placement: 'land' },
  { id: 'stone_wall', name: 'Stone Wall', item: 'stone_wall', size: [1, 1], solid: true, layer: 'object', hp: 600, placement: 'land' },
  {
    id: 'wood_door',
    name: 'Wooden Door',
    item: 'wood_door',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 220,
    placement: 'land',
    door: true,
  },
  { id: 'wood_floor', name: 'Wooden Floor', item: 'wood_floor', size: [1, 1], solid: false, layer: 'floor', hp: 100, placement: 'any' },
  { id: 'stone_floor', name: 'Stone Floor', item: 'stone_floor', size: [1, 1], solid: false, layer: 'floor', hp: 200, placement: 'any' },
  { id: 'fence', name: 'Fence', item: 'fence', size: [1, 1], solid: true, layer: 'object', hp: 120, placement: 'land', low: true },
  {
    id: 'pen_gate',
    name: 'Pen Gate',
    item: 'pen_gate',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 120,
    placement: 'land',
    low: true,
    gate: true,
  },
  {
    id: 'torch',
    name: 'Torch',
    item: 'torch',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 40,
    placement: 'land',
    light: 6,
    low: true,
  },
  {
    id: 'land_claim',
    name: 'Land Claim',
    item: 'land_claim',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 800,
    placement: 'land',
    claimRadius: 15,
  },
  {
    id: 'spike_trap',
    name: 'Spike Trap',
    item: 'spike_trap',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 160,
    placement: 'land',
    low: true,
    trap: 18,
  },
  {
    id: 'arrow_tower',
    name: 'Arrow Tower',
    item: 'arrow_tower',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 900,
    placement: 'land',
    container: 4,
    tower: { range: 9, damage: 20, every: 1.3 },
  },
  { id: 'bed', name: 'Bed', item: 'bed', size: [1, 1], solid: false, layer: 'object', hp: 150, placement: 'land', bed: true, low: true },
  {
    id: 'crop',
    name: 'Crop',
    item: 'wheat_seeds',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 20,
    placement: 'farmland',
    low: true,
  },
  {
    id: 'chest',
    name: 'Wooden Chest',
    item: 'chest',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 200,
    placement: 'land',
    container: 16,
  },
  {
    id: 'shop_stand',
    name: 'Shop Stand',
    item: 'shop_stand',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 300,
    placement: 'land',
    container: 12,
    shop: true,
  },

  // ——— Crafting stations ———
  {
    id: 'campfire',
    name: 'Campfire',
    item: 'campfire',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 100,
    placement: 'land',
    station: 'campfire',
    light: 7,
    low: true,
    machine: { station: 'campfire', fuel: true, buffer: 20 },
  },
  {
    id: 'workbench',
    name: 'Workbench',
    item: 'workbench',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 200,
    placement: 'land',
    station: 'workbench',
  },
  {
    id: 'anvil',
    name: 'Anvil',
    item: 'anvil',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    station: 'anvil',
  },
  {
    id: 'furnace',
    name: 'Furnace',
    item: 'furnace',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'land',
    light: 5,
    machine: { station: 'furnace', fuel: true, buffer: 50 },
  },
  {
    id: 'oven',
    name: 'Oven',
    item: 'oven',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'land',
    light: 4,
    machine: { station: 'oven', fuel: true, buffer: 50 },
  },
  {
    id: 'blast_furnace',
    name: 'Blast Furnace',
    item: 'blast_furnace',
    size: [2, 2],
    solid: true,
    layer: 'object',
    hp: 1200,
    placement: 'land',
    light: 7,
    machine: { station: 'blast_furnace', fuel: true, buffer: 50 },
  },

  // ——— Power ———
  {
    id: 'water_wheel',
    name: 'Water Wheel',
    item: 'water_wheel',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'water',
    kinetic: { role: 'source', ports: axis(), rpm: 16, torque: 100 },
  },
  {
    id: 'windmill',
    name: 'Windmill',
    item: 'windmill',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'land',
    kinetic: { role: 'source', ports: [{ dx: 0, dy: 0, face: 2, group: 0 }], rpm: 12, torque: 64 },
  },
  {
    id: 'hand_crank',
    name: 'Hand Crank',
    item: 'hand_crank',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 150,
    placement: 'land',
    kinetic: { role: 'source', ports: axis(), rpm: 8, torque: 32 },
  },
  {
    id: 'steam_engine',
    name: 'Steam Engine',
    item: 'steam_engine',
    size: [2, 2],
    solid: true,
    layer: 'object',
    hp: 1200,
    placement: 'land',
    light: 5,
    kinetic: {
      role: 'source',
      ports: [
        { dx: 0, dy: 0, face: 0, group: 0 },
        { dx: 1, dy: 0, face: 0, group: 0 },
      ],
      rpm: 32,
      torque: 256,
    },
    machine: { station: 'steam', buffer: 0 },
    fluid: { role: 'engine', capacity: 60 },
  },
  {
    id: 'boiler',
    name: 'Boiler',
    item: 'boiler',
    size: [2, 2],
    solid: true,
    layer: 'object',
    hp: 900,
    placement: 'land',
    light: 4,
    machine: { station: 'boiler', fuel: true, buffer: 0 },
    fluid: { role: 'boiler', capacity: 100 },
  },
  {
    id: 'pump',
    name: 'Mechanical Pump',
    item: 'pump',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 8 },
    machine: { station: 'pump', powered: true, water: true, buffer: 0 },
    fluid: { role: 'pump', capacity: 0 },
  },
  {
    id: 'pipe',
    name: 'Pipe',
    item: 'pipe',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 100,
    placement: 'land',
    low: true,
    fluid: { role: 'pipe', capacity: 50 },
  },
  {
    id: 'fluid_tank',
    name: 'Fluid Tank',
    item: 'fluid_tank',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    fluid: { role: 'tank', capacity: 2000 },
  },
  {
    id: 'shaft',
    name: 'Shaft',
    item: 'shaft',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 120,
    placement: 'any',
    low: true,
    kinetic: { role: 'shaft', ports: axis() },
  },
  {
    id: 'gearbox',
    name: 'Gearbox',
    item: 'gearbox',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 300,
    placement: 'any',
    kinetic: { role: 'gearbox', ports: allFaces() },
  },
  {
    id: 'speed_gearbox',
    name: 'Speed Gearbox',
    item: 'speed_gearbox',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 300,
    placement: 'any',
    kinetic: {
      role: 'gearbox',
      ports: [
        { dx: 0, dy: 0, face: 0, group: 1 },
        { dx: 0, dy: 0, face: 1, group: 0 },
        { dx: 0, dy: 0, face: 2, group: 0 },
        { dx: 0, dy: 0, face: 3, group: 0 },
      ],
      ratios: [1, 2],
    },
  },

  // ——— Machines (front = output) ———
  {
    id: 'crusher',
    name: 'Crusher',
    item: 'crusher',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 40 },
    machine: { station: 'crusher', powered: true, buffer: 20 },
  },
  {
    id: 'washer',
    name: 'Ore Washer',
    item: 'washer',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'any',
    kinetic: { role: 'consumer', stress: 20 },
    machine: { station: 'washer', powered: true, water: true, buffer: 20 },
  },
  {
    id: 'press',
    name: 'Mechanical Press',
    item: 'press',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 30 },
    machine: { station: 'press', powered: true, buffer: 20, modes: ['plate', 'gear', 'rod', 'wire', 'pipe'] },
  },
  {
    id: 'millstone',
    name: 'Millstone',
    item: 'millstone',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 20 },
    machine: { station: 'millstone', powered: true, buffer: 30 },
  },
  {
    id: 'saw',
    name: 'Mechanical Saw',
    item: 'saw',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 400,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 25 },
    machine: { station: 'saw', powered: true, buffer: 30 },
  },
  {
    id: 'assembler',
    name: 'Assembler',
    item: 'assembler',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 600,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 60 },
    machine: { station: 'assembler', powered: true, buffer: 20, modes: ['bearing', 'gearbox_unit', 'industrial_pump'] },
  },

  // ——— Logistics ———
  {
    id: 'generator',
    name: 'Generator',
    item: 'generator',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    kinetic: { role: 'consumer', stress: 64 },
    electric: { role: 'generator', power: 100 },
  },
  {
    id: 'power_pole',
    name: 'Power Pole',
    item: 'power_pole',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 150,
    placement: 'land',
    electric: { role: 'pole', power: 0 },
  },
  {
    id: 'electric_motor',
    name: 'Electric Motor',
    item: 'electric_motor',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    kinetic: { role: 'source', ports: allFaces(), rpm: 16, torque: 48 },
    electric: { role: 'motor', power: 100 },
  },
  {
    id: 'electric_lamp',
    name: 'Electric Lamp',
    item: 'electric_lamp',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 80,
    placement: 'land',
    light: 9,
    low: true,
    electric: { role: 'lamp', power: 6 },
  },
  {
    id: 'lathe',
    name: 'Lathe',
    item: 'lathe',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    machine: { station: 'lathe', buffer: 20, electric: true },
    electric: { role: 'machine', power: 50 },
  },
  {
    id: 'packager',
    name: 'Packager',
    item: 'packager',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 500,
    placement: 'land',
    machine: { station: 'packager', buffer: 40, electric: true },
    electric: { role: 'machine', power: 40 },
  },
  {
    id: 'rail',
    name: 'Rail',
    item: 'rail',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 150,
    placement: 'any',
    low: true,
    rail: 'track',
  },
  {
    id: 'rail_station',
    name: 'Rail Station',
    item: 'rail_station',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 300,
    placement: 'any',
    low: true,
    rail: 'station',
  },
  {
    id: 'conveyor',
    name: 'Conveyor',
    item: 'conveyor',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 100,
    placement: 'any',
    low: true,
    logistics: 'conveyor',
  },
  {
    id: 'splitter',
    name: 'Splitter',
    item: 'splitter',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 150,
    placement: 'any',
    low: true,
    logistics: 'splitter',
  },
  {
    id: 'filter',
    name: 'Filter',
    item: 'filter',
    size: [1, 1],
    solid: false,
    layer: 'object',
    hp: 150,
    placement: 'any',
    low: true,
    logistics: 'filter',
  },
  {
    id: 'hopper',
    name: 'Hopper',
    item: 'hopper',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 250,
    placement: 'any',
    logistics: 'hopper',
    container: 5,
  },
  {
    id: 'storage_crate',
    name: 'Storage Crate',
    item: 'storage_crate',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 300,
    placement: 'any',
    container: 24,
  },
  {
    id: 'shipping_crate',
    name: 'Shipping Crate',
    item: 'shipping_crate',
    size: [1, 1],
    solid: true,
    layer: 'object',
    hp: 300,
    placement: 'land',
    container: 24,
    shipping: true,
  },
];

export const STRUCTURES: readonly StructureDef[] = S;
export const STRUCTURE_BY_ID: ReadonlyMap<string, StructureDef> = new Map(S.map((s) => [s.id, s]));

export function structureDef(id: string): StructureDef {
  const d = STRUCTURE_BY_ID.get(id);
  if (!d) throw new Error(`Unknown structure "${id}"`);
  return d;
}

/** Footprint size after rotation. */
export function rotatedSize(def: StructureDef, rot: number): [number, number] {
  return rot & 1 ? [def.size[1], def.size[0]] : [def.size[0], def.size[1]];
}

/** Maps a local (unrotated) tile offset to a rotated offset within the rotated footprint. */
export function rotateOffset(dx: number, dy: number, def: StructureDef, rot: number): [number, number] {
  const [w, h] = def.size;
  switch (rot & 3) {
    case 0:
      return [dx, dy];
    case 1:
      return [h - 1 - dy, dx];
    case 2:
      return [w - 1 - dx, h - 1 - dy];
    default:
      return [dy, w - 1 - dx];
  }
}

/** Rotated kinetic ports of a structure placed at (x, y) with `rot`, in world tiles. */
export function worldPorts(def: StructureDef, x: number, y: number, rot: number): { x: number; y: number; face: Dir; group: number }[] {
  const ports = def.kinetic?.ports ?? [];
  return ports.map((p) => {
    const [ox, oy] = rotateOffset(p.dx, p.dy, def, rot);
    return { x: x + ox, y: y + oy, face: ((p.face + rot) & 3) as Dir, group: p.group };
  });
}
