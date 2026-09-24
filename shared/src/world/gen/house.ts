// Procedural house interiors (design plan §43): a room program of living room, kitchen, hallway,
// bedrooms and bathroom, an optional attached garage, doors, windows and furniture.

import type { Rng } from '../../math/rng';
import type { BuildingDef, FloorMaterial, RoomDef } from '../map';
import { BuildingBuilder, EXTERIOR_WALL, INTERIOR_WALL, ROOF_COLORS, SIDING_COLORS } from './building';

export interface HouseOptions {
  width?: number;
  depth?: number;
  garage?: boolean;
}

const LIVING_FLOORS: FloorMaterial[] = ['wood', 'carpet', 'wood', 'darkwood'];
const KITCHEN_FLOORS: FloorMaterial[] = ['tile', 'linoleum', 'checker'];
const BEDROOM_FLOORS: FloorMaterial[] = ['carpet', 'wood', 'carpet'];

/** Generates an unpositioned house; call `finish(x, y, rot)` on the result's builder. */
export function generateHouse(id: string, rng: Rng, opts: HouseOptions = {}): BuildingBuilder {
  const main = opts.width ?? rng.int(11, 15);
  const depth = opts.depth ?? rng.int(9, 12);
  const garage = opts.garage ?? rng.chance(0.4);
  const garageW = garage ? 6.2 : 0;
  const total = main + garageW;
  const brick = rng.chance(0.25);
  const b = new BuildingBuilder(
    id,
    'house',
    total,
    depth,
    { material: brick ? 'brick' : 'wood', color: brick ? '#8a5a48' : rng.pick(SIDING_COLORS) },
    { style: total > depth * 1.3 || rng.chance(0.6) ? 'gable' : 'hip', color: rng.pick(ROOF_COLORS), axis: 'x' },
  );
  b.exteriorWalls();

  const hallD = 1.3;
  const frontD = Math.round(depth * rng.range(0.44, 0.52) * 2) / 2;
  const backD = depth - frontD - hallD;
  const hallY = backD;
  const frontY = backD + hallD;
  const livingW = Math.round(main * rng.range(0.52, 0.62) * 2) / 2;

  // --- Rooms -----------------------------------------------------------------------------------
  const living = b.room('living', 0, frontY, livingW, frontD, rng.pick(LIVING_FLOORS), 'Living Room');
  const kitchen = b.room('kitchen', livingW, frontY, main - livingW, frontD, rng.pick(KITCHEN_FLOORS), 'Kitchen');
  const hall = b.room('hallway', 0, hallY, main, hallD, living.floor === 'carpet' ? 'wood' : living.floor, 'Hallway');

  // Back band: bedrooms and a bathroom.
  const bathW = rng.range(2.3, 2.9);
  const remaining = main - bathW;
  const bedroomCount = remaining >= 11 ? 3 : remaining >= 6.5 ? 2 : 1;
  const bedW = remaining / bedroomCount;
  const bathIndex = rng.int(0, bedroomCount);
  const back: RoomDef[] = [];
  let x = 0;
  let bedNo = 0;
  for (let i = 0; i <= bedroomCount; i++) {
    if (i === bathIndex) {
      back.push(b.room('bathroom', x, 0, bathW, backD, 'tile', 'Bathroom'));
      x += bathW;
    } else {
      bedNo++;
      back.push(b.room('bedroom', x, 0, bedW, backD, rng.pick(BEDROOM_FLOORS), bedNo === 1 ? 'Master Bedroom' : 'Bedroom'));
      x += bedW;
    }
  }
  const garageRoom = garage ? b.room('garage', main, 0, garageW, depth, 'concrete', 'Garage') : null;

  // --- Walls -----------------------------------------------------------------------------------
  b.wall(0, hallY, main, hallY);
  b.wall(0, frontY, main, frontY);
  b.wall(livingW, frontY, livingW, depth);
  for (let i = 0; i < back.length - 1; i++) {
    const r = back[i];
    b.wall(r.x + r.w, 0, r.x + r.w, hallY);
  }
  if (garage) b.wall(main, 0, main, depth, 'wood', 0.2);

  // --- Doors -----------------------------------------------------------------------------------
  const frontDoorX = rng.range(1.2, livingW - 1.2);
  b.door(frontDoorX, depth, 'h', 'exterior', rng, { locked: rng.chance(0.45), swing: -1 });
  b.door(EXTERIOR_WALL / 2, hallY + hallD / 2, 'v', 'exterior', rng, { locked: rng.chance(0.3), w: 0.9, swing: 1 });
  b.door(rng.range(1, livingW - 1), frontY, 'h', 'wood', rng, { open: rng.chance(0.7) });
  b.door(livingW, frontY + rng.range(0.9, frontD - 0.9), 'v', 'wood', rng, { open: rng.chance(0.6) });
  for (const r of back) {
    b.door(r.x + r.w / 2 + rng.range(-r.w / 4, r.w / 4), hallY, 'h', 'wood', rng, { open: rng.chance(0.45), w: r.type === 'bathroom' ? 0.75 : 0.85 });
  }
  if (garageRoom) {
    b.door(main, frontY + frontD / 2, 'v', 'wood', rng, { open: rng.chance(0.3) });
    b.door(main + garageW / 2, depth, 'h', 'garage', rng, { locked: rng.chance(0.6), swing: -1 });
  }

  // --- Windows ---------------------------------------------------------------------------------
  b.windowsAlong('s', 0, livingW, livingW > 5 ? 2 : 1, 'residential');
  b.windowsAlong('s', livingW, main, 1, 'residential', 1.0);
  b.windowsAlong('w', frontY, depth, 1, 'residential');
  for (const r of back) {
    b.windowsAlong('n', r.x, r.x + r.w, 1, 'residential', r.type === 'bathroom' ? 0.6 : 1.2);
  }
  b.windowsAlong('w', 0, backD, 1, 'residential');
  if (!garage) {
    b.windowsAlong('e', 0, backD, 1, 'residential');
    b.windowsAlong('e', frontY, depth, 1, 'residential', 1.0);
  } else {
    b.windowsAlong('e', 1, depth / 2, 1, 'residential', 0.8);
  }

  // --- Furniture -------------------------------------------------------------------------------
  furnishLiving(b, living, rng);
  furnishKitchen(b, kitchen, rng);
  back.forEach((r, i) => (r.type === 'bathroom' ? furnishBathroom(b, r, rng) : furnishBedroom(b, r, rng, i === 0 || r.name === 'Master Bedroom')));
  if (rng.chance(0.4)) b.againstWall(hall, 'n', 'plant_pot', { w: 0.45, h: 0.45 }, rng);
  if (garageRoom) furnishGarage(b, garageRoom, rng);
  return b;
}

function furnishLiving(b: BuildingBuilder, room: RoomDef, rng: Rng): void {
  if (room.w > 3.6 && room.h > 3) b.prop('rug', room.x + room.w / 2, room.y + room.h / 2, 0, { w: Math.min(3, room.w - 1.6), h: Math.min(2, room.h - 1.6) });
  const couch = b.againstWall(room, 'n', 'couch', { w: 2.1, h: 0.9 }, rng, { along: room.w / 2 });
  if (couch) b.inRoom(room, 'coffee_table', { w: 1.2, h: 0.6 }, rng, { rot: 0, margin: 1.2 });
  b.againstWall(room, rng.chance(0.5) ? 'w' : 's', 'tv_stand', { w: 1.5, h: 0.45 }, rng);
  b.againstWall(room, 'e', 'armchair', { w: 0.9, h: 0.9 }, rng);
  if (rng.chance(0.6)) b.againstWall(room, 'w', 'bookshelf', { w: 1.0, h: 0.35 }, rng, { tall: true });
  if (rng.chance(0.5)) b.againstWall(room, 's', 'plant_pot', { w: 0.45, h: 0.45 }, rng);
}

function furnishKitchen(b: BuildingBuilder, room: RoomDef, rng: Rng): void {
  // A run of appliances and counters along the back (hallway) wall.
  const inset = INTERIOR_WALL / 2 + 0.03;
  const y = room.y + inset;
  const pieces: { type: string; w: number; h: number; loot?: string }[] = [
    { type: 'fridge', w: 0.82, h: 0.74 },
    { type: 'kitchen_counter', w: 1.4, h: 0.62, loot: 'kitchen_drawer' },
    { type: 'kitchen_sink', w: 1.0, h: 0.62 },
    { type: 'kitchen_counter', w: 1.2, h: 0.62 },
    { type: 'stove', w: 0.76, h: 0.66 },
    { type: 'kitchen_counter', w: 1.0, h: 0.62 },
  ];
  if (rng.chance(0.5)) pieces.reverse();
  let x = room.x + 0.2;
  const end = room.x + room.w - 0.2;
  for (const p of pieces) {
    let w = p.w;
    if (x + w > end) {
      if (p.type !== 'kitchen_counter' || end - x < 0.6) continue;
      w = end - x;
    }
    const cx = x + w / 2;
    const cy = y + p.h / 2;
    const rect = { x: x, y: cy - p.h / 2, w, h: p.h };
    if (b.isFree(rect, p.type === 'fridge')) {
      b.prop(p.type, cx, cy, 0, { size: { w, h: p.h }, w: p.type === 'kitchen_counter' ? w : undefined, loot: p.loot });
    }
    x += w;
  }
  if (room.w > 3.4 && room.h > 3.2) {
    const table = b.inRoom(room, 'dining_table', { w: 1.4, h: 0.85 }, rng, { rot: 0, margin: 1.0 });
    if (table) {
      b.prop('chair', table.x - 0.45, table.y + 0.7, 0);
      b.prop('chair', table.x + 0.45, table.y + 0.7, 0);
      if (rng.chance(0.6)) b.prop('chair', table.x, table.y - 0.7, Math.PI);
    }
  }
  if (rng.chance(0.3)) b.againstWall(room, 'e', 'trash_can', { w: 0.6, h: 0.6 }, rng);
}

function furnishBedroom(b: BuildingBuilder, room: RoomDef, rng: Rng, master: boolean): void {
  const double = master && room.w > 3.2;
  const bedSize = double ? { w: 1.6, h: 2.1 } : { w: 1.0, h: 2.0 };
  const bed = b.againstWall(room, 'n', double ? 'bed_double' : 'bed_single', bedSize, rng, { along: room.w / 2 + rng.range(-0.4, 0.4) });
  if (bed) {
    const side = bedSize.w / 2 + 0.33;
    const ny = room.y + EXTERIOR_WALL / 2 + 0.05 + 0.225;
    const left = { x: bed.x - side - 0.25, y: ny - 0.225, w: 0.5, h: 0.45 };
    if (b.isFree(left, false) && left.x > room.x) b.prop('nightstand', bed.x - side, ny, 0, { size: { w: 0.5, h: 0.45 } });
    const right = { x: bed.x + side - 0.25, y: ny - 0.225, w: 0.5, h: 0.45 };
    if (double && b.isFree(right, false) && right.x + right.w < room.x + room.w) b.prop('nightstand', bed.x + side, ny, 0, { size: { w: 0.5, h: 0.45 } });
  }
  const sides = rng.shuffle(['e', 'w', 's'] as const);
  b.againstWall(room, sides[0], 'wardrobe', { w: 1.2, h: 0.6 }, rng, { tall: true });
  b.againstWall(room, sides[1], 'dresser', { w: 1.2, h: 0.5 }, rng);
  if (!master && rng.chance(0.5)) b.againstWall(room, sides[2], 'desk', { w: 1.2, h: 0.6 }, rng);
  if (master && rng.chance(0.1)) b.againstWall(room, sides[2], 'gun_safe', { w: 0.75, h: 0.65 }, rng, { tall: true });
  if (rng.chance(0.3)) b.inRoom(room, 'rug', { w: 1.6, h: 1.1 }, rng, { margin: 0.4 });
}

function furnishBathroom(b: BuildingBuilder, room: RoomDef, rng: Rng): void {
  b.againstWall(room, 'n', 'toilet', { w: 0.45, h: 0.7 }, rng);
  if (room.h > 2.4) b.againstWall(room, rng.chance(0.5) ? 'e' : 'w', 'bathtub', { w: 1.7, h: 0.8 }, rng);
  else b.againstWall(room, 'e', 'shower', { w: 0.9, h: 0.9 }, rng);
  b.againstWall(room, rng.chance(0.5) ? 'w' : 'n', 'bathroom_cabinet', { w: 0.8, h: 0.5 }, rng);
}

function furnishGarage(b: BuildingBuilder, room: RoomDef, rng: Rng): void {
  if (rng.chance(0.45)) {
    b.prop(rng.pick(['car_sedan', 'car_compact', 'car_suv']), room.x + room.w / 2, room.y + room.h / 2 + 0.4, Math.PI / 2, {
      size: { w: 4.6, h: 1.9 },
      variant: rng.int(0, 1000),
    });
  }
  b.againstWall(room, 'n', 'workbench', { w: 1.8, h: 0.7 }, rng);
  b.againstWall(room, 'e', 'garage_shelf', { w: 1.8, h: 0.5 }, rng, { tall: true });
  if (rng.chance(0.6)) b.againstWall(room, 'w', 'garage_shelf', { w: 1.8, h: 0.5 }, rng, { tall: true });
  if (rng.chance(0.7)) b.againstWall(room, 'n', 'toolbox', { w: 0.6, h: 0.35 }, rng);
  if (rng.chance(0.5)) b.againstWall(room, 'e', 'lawn_mower', { w: 0.6, h: 1.0 }, rng);
  if (rng.chance(0.4)) b.againstWall(room, 'w', 'washer', { w: 0.7, h: 0.7 }, rng);
  if (rng.chance(0.25)) b.againstWall(room, 'e', 'tire_pile', { w: 0.9, h: 0.9 }, rng);
}

export function houseDef(id: string, rng: Rng, x: number, y: number, rot: number, opts?: HouseOptions): BuildingDef {
  return generateHouse(id, rng, opts).finish(x, y, rot);
}

/** A backyard shed: one room of tools and junk. */
export function generateShed(id: string, rng: Rng): BuildingBuilder {
  const w = rng.pick([3.5, 4, 4.5]);
  const h = rng.pick([3, 3.5]);
  const b = new BuildingBuilder(id, 'shed', w, h, { material: 'wood', color: rng.pick(['#7a6a52', '#6a5a4a', '#8a7a62']) }, { style: 'gable', color: rng.pick(ROOF_COLORS), axis: 'x' }, 'Shed');
  b.exteriorWalls('wood');
  const room = b.room('storage', 0, 0, w, h, 'darkwood', 'Shed');
  b.door(w / 2, h - EXTERIOR_WALL / 2, 'h', 'wood', rng, { locked: rng.chance(0.35), swing: -1, w: 0.9 });
  b.againstWall(room, 'n', rng.chance(0.5) ? 'workbench' : 'garage_shelf', { w: 1.8, h: 0.6 }, rng, { tall: true });
  b.againstWall(room, 'e', 'toolbox', { w: 0.6, h: 0.35 }, rng);
  if (rng.chance(0.5)) b.againstWall(room, 'w', 'lawn_mower', { w: 0.6, h: 1.0 }, rng);
  return b;
}

/** A small one-bedroom cabin for rural and forest locations. */
export function generateCabin(id: string, rng: Rng): BuildingBuilder {
  const w = 9;
  const h = 7.5;
  const b = new BuildingBuilder(id, 'house', w, h, { material: 'wood', color: '#6a5440' }, { style: 'gable', color: '#3e3a36', axis: 'x' }, 'Cabin');
  b.exteriorWalls('wood');
  const splitX = 5.4;
  const main = b.room('living', 0, 0, splitX, h, 'darkwood', 'Cabin');
  const bed = b.room('bedroom', splitX, 0, w - splitX, 4.4, 'wood', 'Bedroom');
  const bath = b.room('bathroom', splitX, 4.4, w - splitX, h - 4.4, 'tile', 'Bathroom');
  b.wall(splitX, 0, splitX, h);
  b.wall(splitX, 4.4, w, 4.4);
  b.door(2.4, h - EXTERIOR_WALL / 2, 'h', 'exterior', rng, { locked: rng.chance(0.5), swing: -1 });
  b.door(splitX, 2.2, 'v', 'wood', rng, { open: true });
  b.door(splitX, 5.9, 'v', 'wood', rng, { w: 0.75, open: rng.chance(0.5) });
  b.windowsAlong('n', 0, splitX, 1, 'residential');
  b.windowsAlong('w', 0, h, 1, 'residential');
  b.windowsAlong('e', 0, 4.4, 1, 'residential');
  b.windowsAlong('s', 3.6, splitX, 1, 'residential', 1.0);
  b.againstWall(main, 'n', 'kitchen_counter', { w: 1.8, h: 0.62 }, rng, { loot: 'kitchen_cabinet' });
  b.againstWall(main, 'n', 'stove', { w: 0.76, h: 0.66 }, rng);
  b.againstWall(main, 'w', 'armchair', { w: 0.9, h: 0.9 }, rng);
  b.inRoom(main, 'dining_table', { w: 1.2, h: 0.8 }, rng, { rot: 0, margin: 1.0 });
  b.againstWall(main, 'w', 'bookshelf', { w: 1.0, h: 0.35 }, rng, { tall: true });
  b.againstWall(bed, 'n', 'bed_single', { w: 1.0, h: 2.0 }, rng);
  b.againstWall(bed, 'e', 'dresser', { w: 1.2, h: 0.5 }, rng);
  if (rng.chance(0.5)) b.againstWall(bed, 'e', 'gun_safe', { w: 0.75, h: 0.65 }, rng, { tall: true });
  b.againstWall(bath, 's', 'toilet', { w: 0.45, h: 0.7 }, rng);
  b.againstWall(bath, 'e', 'bathroom_cabinet', { w: 0.8, h: 0.5 }, rng);
  return b;
}
