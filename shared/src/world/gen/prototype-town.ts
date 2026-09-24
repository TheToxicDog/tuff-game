// The first playable neighborhood (design plan §91): Route 9 running through a small town with
// a residential block, a cul-de-sac, a grocery store, gas station, police station and hardware
// store, surrounded by woods and fields. Everything is generated from a seed, so the map can be
// regenerated and then hand-edited later.

import { Noise2D } from '../../math/noise';
import { Rng } from '../../math/rng';
import {
  buildingBounds,
  buildingTransform,
  localToWorld,
  MAP_FORMAT_VERSION,
  type BuildingDef,
  type FenceDef,
  type MapData,
  type PropInstance,
  type RoadDef,
  type ZoneDef,
} from '../map';
import { rotationFacing, type BuildingBuilder, type Side } from './building';
import { generateGasStation, generateGrocery, generateHardwareStore, generatePoliceStation } from './commercial';
import { generateCabin, generateHouse, generateShed } from './house';
import { poissonDisc } from './scatter';
import { TerrainPainter } from './terrain';

export const PROTOTYPE_SIZE = 640;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

class TownBuilder {
  readonly rng: Rng;
  readonly terrain = new TerrainPainter(PROTOTYPE_SIZE, PROTOTYPE_SIZE, 'grass');
  readonly roads: RoadDef[] = [];
  readonly buildings: BuildingDef[] = [];
  readonly props: PropInstance[] = [];
  readonly fences: FenceDef[] = [];
  readonly zones: ZoneDef[] = [];
  /** Areas where scattered props must not go. */
  readonly keepOut: Box[] = [];
  private propId = 0;
  private roadId = 0;
  private buildingId = 0;
  private fenceId = 0;

  constructor(readonly seed: number) {
    this.rng = new Rng(seed);
  }

  road(kind: RoadDef['kind'], points: [number, number][], width: number, sidewalk: number, opts: Partial<RoadDef> = {}): RoadDef {
    const road: RoadDef = {
      id: `r${++this.roadId}`,
      kind,
      points,
      width,
      lanes: opts.lanes ?? (kind === 'driveway' || kind === 'dirt' ? 1 : 2),
      sidewalk,
      surface: opts.surface ?? (kind === 'dirt' ? 'dirt' : kind === 'driveway' ? 'concrete' : 'asphalt'),
      markings: opts.markings ?? (kind === 'main' || kind === 'country' || kind === 'highway'),
    };
    this.roads.push(road);
    return road;
  }

  nextBuildingId(): string {
    return `b${++this.buildingId}`;
  }

  place(builder: BuildingBuilder, x: number, y: number, rot: number): BuildingDef {
    const def = builder.finish(x, y, rot);
    this.buildings.push(def);
    const bounds = buildingBounds(def);
    this.keepOut.push({ minX: bounds.minX - 1.5, minY: bounds.minY - 1.5, maxX: bounds.maxX + 1.5, maxY: bounds.maxY + 1.5 });
    this.terrain.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 'concrete');
    return def;
  }

  prop(type: string, x: number, y: number, rot = 0, extra: Partial<PropInstance> = {}): PropInstance {
    const p: PropInstance = { id: `p${++this.propId}`, type, x: round2(x), y: round2(y), rot: round3(rot), ...extra };
    this.props.push(p);
    return p;
  }

  fence(kind: FenceDef['kind'], points: [number, number][]): void {
    this.fences.push({ id: `f${++this.fenceId}`, kind, points });
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      this.keepOut.push({ minX: Math.min(ax, bx) - 0.8, minY: Math.min(ay, by) - 0.8, maxX: Math.max(ax, bx) + 0.8, maxY: Math.max(ay, by) + 0.8 });
    }
  }

  reserveBox(minX: number, minY: number, maxX: number, maxY: number): void {
    this.keepOut.push({ minX, minY, maxX, maxY });
  }

  isFree(x: number, y: number, margin = 0): boolean {
    for (const b of this.keepOut) {
      if (x >= b.minX - margin && x <= b.maxX + margin && y >= b.minY - margin && y <= b.maxY + margin) return false;
    }
    for (const r of this.roads) {
      if (distanceToPolyline(x, y, r.points) < r.width / 2 + r.sidewalk + 1.2 + margin) return false;
    }
    return true;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function distanceToPolyline(x: number, y: number, points: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    best = Math.min(best, Math.sqrt(px * px + py * py));
  }
  return best;
}

/** Unit vector of a building's local +y (its front) in world space. */
function frontVector(rot: number): { x: number; y: number } {
  return { x: -Math.sin(rot), y: Math.cos(rot) };
}

export function generatePrototypeTown(seed = 1337): MapData {
  const t = new TownBuilder(seed);
  const rng = t.rng;
  const noise = new Noise2D(seed);
  const noise2 = new Noise2D(seed + 1);

  // --- Terrain base: grass with long / dead grass and dirt patches, forests at the edges --------
  const forestMask = (x: number, y: number): boolean => {
    const n = noise.fbm(x / 90, y / 90, 3);
    const northForest = y < 118 + n * 25;
    const westForest = x < 135 + n * 30 && (y < 290 || y > 350);
    const southWest = x < 220 && y > 470 + n * 30;
    return northForest || westForest || southWest || n > 0.42;
  };
  t.terrain.each(0, 0, PROTOTYPE_SIZE, PROTOTYPE_SIZE, (x, y) => {
    if (forestMask(x, y)) return 'forest_floor';
    const n = noise2.fbm(x / 28, y / 28, 3);
    if (n > 0.38) return 'grass_long';
    if (n < -0.42) return 'grass_dead';
    if (noise.noise(x / 9, y / 9) > 0.62) return 'dirt';
    return null;
  });
  // Farm fields in the south-east: alternating tilled rows.
  t.terrain.each(470, 405, 150, 200, (x, y) => (Math.floor(y / 2) % 2 === 0 ? 'tilled_soil' : 'farm_soil'));
  t.reserveBox(468, 403, 622, 607);

  // --- Roads ---------------------------------------------------------------------------------
  const route9West = t.road('country', [[0, 334], [40, 331], [90, 320], [130, 307], [165, 300]], 7.5, 0);
  const route9 = t.road('main', [[165, 300], [590, 300]], 8, 2.2);
  const route9East = t.road('country', [[590, 300], [615, 297], [640, 290]], 7.5, 0);
  const elmX = 240;
  const mapleX = 322;
  const oakY = 132;
  const birchY = 440;
  const elmNorth = t.road('street', [[elmX, oakY], [elmX, 300]], 7, 1.8, { markings: false });
  const elmSouth = t.road('street', [[elmX, 300], [elmX, birchY]], 7, 1.8, { markings: false });
  const maple = t.road('street', [[mapleX, oakY], [mapleX, 300]], 7, 1.8, { markings: false });
  const oak = t.road('street', [[elmX, oakY], [mapleX, oakY]], 6.5, 1.8, { markings: false });
  const birch = t.road('street', [[elmX, birchY], [338, birchY]], 7, 1.8, { markings: false });
  const trail = t.road('dirt', [[281, oakY - 4], [283, 104], [280, 78], [275, 52], [270, 30]], 4, 0);
  for (const r of [route9West, route9East]) t.terrain.line(r.points, r.width / 2 + 1.6, 'gravel');
  t.terrain.line(trail.points, 3, 'dirt');
  // Cul-de-sac bulb at the end of Birch Court.
  t.terrain.circle(338, birchY, 9, 'asphalt');
  t.reserveBox(329, birchY - 9, 347, birchY + 9);

  const curbX = (roadX: number, side: -1 | 1, road: RoadDef) => roadX + side * (road.width / 2 + road.sidewalk);

  // --- Houses along Elm (east side) and Maple (west side) ------------------------------------
  const lotCenters = [157, 187, 217, 247, 277];
  const houseRecords: { def: BuildingDef; front: Side; streetEdge: number }[] = [];
  for (const ly of lotCenters) {
    const hb = generateHouse(t.nextBuildingId(), rng);
    const rot = rotationFacing('w');
    const depth = hb.h;
    const x = curbX(elmX, 1, elmNorth) + rng.range(6.5, 9) + depth / 2;
    houseRecords.push({ def: t.place(hb, x, ly + rng.range(-2, 2), rot), front: 'w', streetEdge: curbX(elmX, 1, elmNorth) });
  }
  for (const ly of lotCenters) {
    const hb = generateHouse(t.nextBuildingId(), rng);
    const rot = rotationFacing('e');
    const x = curbX(mapleX, -1, maple) - rng.range(6.5, 9) - hb.h / 2;
    houseRecords.push({ def: t.place(hb, x, ly + rng.range(-2, 2), rot), front: 'e', streetEdge: curbX(mapleX, -1, maple) });
  }
  // Birch Court: two houses on each side.
  for (const lx of [268, 310]) {
    const north = generateHouse(t.nextBuildingId(), rng);
    const yN = birchY - birch.width / 2 - birch.sidewalk - rng.range(6.5, 8.5) - north.h / 2;
    houseRecords.push({ def: t.place(north, lx, yN, rotationFacing('s')), front: 's', streetEdge: birchY - birch.width / 2 - birch.sidewalk });
    const south = generateHouse(t.nextBuildingId(), rng);
    const yS = birchY + birch.width / 2 + birch.sidewalk + rng.range(6.5, 8.5) + south.h / 2;
    houseRecords.push({ def: t.place(south, lx, yS, rotationFacing('n')), front: 'n', streetEdge: birchY + birch.width / 2 + birch.sidewalk });
  }

  // Driveways, walkways, mailboxes, cars and yard details for every house.
  for (const rec of houseRecords) decorateHouse(t, rec.def, rng);

  // Backyard fences between Elm and Maple, and sheds in some yards.
  const fenceX = (curbX(elmX, 1, elmNorth) + curbX(mapleX, -1, maple)) / 2;
  let prevY = 142;
  for (const ly of [...lotCenters.map((y) => y + 15), 292]) {
    if (rng.chance(0.8)) t.fence(rng.pick(['wood', 'chainlink', 'wood']), [[fenceX, prevY], [fenceX, Math.min(ly, 291)]]);
    prevY = ly + 1.5;
  }
  for (const rec of houseRecords.slice(0, 8)) {
    if (!rng.chance(0.5)) continue;
    const back = frontVector(rec.def.rot);
    const sx = rec.def.x - back.x * (rec.def.h / 2 + 7);
    const sy = rec.def.y - back.y * (rec.def.h / 2 + 7) + rng.range(-6, 6);
    if (Math.abs(sx - fenceX) < 4) continue;
    const shed = generateShed(t.nextBuildingId(), rng);
    t.place(shed, sx, sy, rec.def.rot);
  }

  // --- Commercial strip along Route 9 ---------------------------------------------------------
  const southEdge = 300 + route9.width / 2 + route9.sidewalk;
  const northEdge = 300 - route9.width / 2 - route9.sidewalk;

  // Police station with a side parking lot.
  const police = t.place(generatePoliceStation(t.nextBuildingId(), rng), 207, southEdge + 9 + 12, rotationFacing('n'));
  t.terrain.rect(165, southEdge + 1, 24, 36, 'asphalt_parking');
  t.reserveBox(165, southEdge + 1, 189, southEdge + 37);
  t.terrain.rect(191, southEdge + 1, 32, 8, 'concrete');
  parkingRow(t, 168, southEdge + 5, 3, 2.9, 'v', rng, ['police_car', 'police_car', 'car_sedan'], 0.9);
  t.prop('dumpster', 207, police.y + 12 + 3.2, 0);
  t.prop('bench', 198, southEdge + 2.2, 0);
  t.prop('streetlight', 186, southEdge + 1, 0);

  // Hardware store.
  const hardware = t.place(generateHardwareStore(t.nextBuildingId(), rng), 291, southEdge + 8 + 11, rotationFacing('n'));
  t.terrain.rect(274, southEdge + 1, 34, 7, 'asphalt_parking');
  t.prop('car_pickup', 300, southEdge + 4, 0.05, { variant: rng.int(0, 999) });
  t.prop('dumpster', 280, hardware.y + 11 + 3, 0);
  t.prop('pallet', 303, hardware.y + 11 + 3.2, 0.2);

  // Grocery store with a large front lot.
  const groceryY = southEdge + 30 + 16;
  const grocery = t.place(generateGrocery(t.nextBuildingId(), rng), 418, groceryY, rotationFacing('n'));
  t.terrain.rect(388, southEdge + 1, 62, 28, 'asphalt_parking');
  t.reserveBox(388, southEdge + 1, 450, southEdge + 29);
  for (let x = 392; x < 446; x += 2.9) {
    t.prop('parking_line', x, southEdge + 6, 0);
    t.prop('parking_line', x, southEdge + 22, 0);
  }
  parkingRow(t, 393.4, southEdge + 6, 18, 2.9, 'v', rng, ['car_sedan', 'car_compact', 'car_suv', 'van'], 0.35);
  parkingRow(t, 393.4, southEdge + 22, 18, 2.9, 'v', rng, ['car_sedan', 'car_compact', 'car_suv', 'car_pickup'], 0.3);
  for (let i = 0; i < 4; i++) t.prop('shopping_cart', rng.range(392, 446), southEdge + rng.range(9, 19), rng.range(0, 6.28));
  t.prop('dumpster', 405, grocery.y + 16 + 3, 0);
  t.prop('dumpster', 409, grocery.y + 16 + 3, 0.1);
  t.terrain.rect(395, grocery.y + 16, 46, 10, 'concrete');
  t.prop('blood_stain', 408, southEdge + 27, 0.4);
  t.prop('blood_stain', 431, southEdge + 26, 2.1);
  t.prop('trash_pile', 420, southEdge + 27.5, 0);

  // Gas station on the north side.
  const gasShopY = northEdge - 26;
  const gas = t.place(generateGasStation(t.nextBuildingId(), rng), 522, gasShopY, rotationFacing('s'));
  t.terrain.rect(496, gasShopY - 7, 54, northEdge - gasShopY + 7, 'concrete');
  const canopyY = northEdge - 11;
  t.prop('gas_canopy', 521, canopyY, 0, { w: 16, h: 8 });
  for (const px of [514, 528]) {
    t.prop('gas_pump', px, canopyY - 1.4, 0);
    t.prop('gas_pump', px, canopyY + 1.4, 0);
  }
  t.prop('car_compact', 510, canopyY + 3.6, 0.02, { variant: rng.int(0, 999) });
  t.prop('dumpster', 537, gas.y - 8, 0);
  t.prop('trash_can', 516, gasShopY + 6.5, 0);
  t.prop('oil_stain', 521, canopyY + 2, 0);
  t.reserveBox(496, gasShopY - 7, 550, northEdge);

  // Cabin at the end of the forest trail.
  const cabin = t.place(generateCabin(t.nextBuildingId(), rng), 262, 22, rotationFacing('e'));
  t.terrain.circle(cabin.x + 7, cabin.y, 5, 'dirt');

  // --- Street furniture -----------------------------------------------------------------------
  for (let x = 185; x < 590; x += 30) {
    const north = Math.round((x - 185) / 30) % 2 === 0;
    t.prop('streetlight', x, north ? northEdge + 0.6 : southEdge - 0.6, 0);
  }
  for (const [x, y] of [[elmX + 5.6, 212], [mapleX - 5.6, 180], [elmX - 5.6, 380]] as [number, number][]) t.prop('streetlight', x, y, 0);
  for (const [x, y] of [[elmX + 5, 150], [mapleX - 5, 260], [elmX - 5, 330], [470, northEdge + 0.8], [262, birchY + 5]] as [number, number][]) t.prop('fire_hydrant', x, y, 0);
  t.prop('bench', 470, southEdge - 1, 0);

  // Abandoned and crashed cars on Route 9.
  t.prop('car_sedan', 214, 297.5, 0.12, { variant: rng.int(0, 999) });
  t.prop('car_suv', 219.5, 301.5, -0.55, { variant: rng.int(0, 999) });
  t.prop('van', 372, 302, Math.PI + 0.04, { variant: rng.int(0, 999) });
  t.prop('car_compact', 560, 298, 0.35, { variant: rng.int(0, 999) });
  t.prop('car_pickup', 96, 322, -0.3, { variant: rng.int(0, 999) });
  t.prop('debris', 217, 299, 0);
  t.prop('blood_stain', 222, 297, 1.2);

  // --- Nature: forests, yard trees, bushes -----------------------------------------------------
  const trees = poissonDisc(rng, {
    x: 0,
    y: 0,
    w: PROTOTYPE_SIZE,
    h: PROTOTYPE_SIZE,
    spacing: 4.6,
    accept: (x, y) => t.terrain.is(x, y, 'forest_floor') && t.isFree(x, y, 1.5),
  });
  for (const p of trees) {
    const r = rng.next();
    const type = r < 0.55 ? 'tree_pine' : r < 0.8 ? 'tree_oak' : r < 0.94 ? 'tree_birch' : 'tree_dead';
    t.prop(type, p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });
  }
  const undergrowth = poissonDisc(rng, {
    x: 0,
    y: 0,
    w: PROTOTYPE_SIZE,
    h: PROTOTYPE_SIZE,
    spacing: 7,
    accept: (x, y) => t.terrain.is(x, y, 'forest_floor') && t.isFree(x, y, 1),
  });
  for (const p of undergrowth) {
    const r = rng.next();
    const type = r < 0.6 ? 'bush' : r < 0.75 ? 'rock' : r < 0.87 ? 'log' : r < 0.95 ? 'stump' : 'leaves';
    t.prop(type, p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });
  }
  // Open-ground trees and bushes, sparser, away from roads and buildings.
  const openTrees = poissonDisc(rng, {
    x: 0,
    y: 0,
    w: PROTOTYPE_SIZE,
    h: PROTOTYPE_SIZE,
    spacing: 13,
    accept: (x, y) => !t.terrain.is(x, y, 'forest_floor') && t.isFree(x, y, 2.5) && noise2.noise(x / 40, y / 40) > -0.1,
  });
  for (const p of openTrees) {
    const r = rng.next();
    const type = r < 0.45 ? 'tree_oak' : r < 0.7 ? 'tree_birch' : r < 0.85 ? 'bush_large' : 'bush';
    t.prop(type, p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });
  }
  const tufts = poissonDisc(rng, {
    x: 0,
    y: 0,
    w: PROTOTYPE_SIZE,
    h: PROTOTYPE_SIZE,
    spacing: 9,
    accept: (x, y) => (t.terrain.is(x, y, 'grass_long') || t.terrain.is(x, y, 'grass')) && t.isFree(x, y, 0.5),
  });
  for (const p of tufts) t.prop(rng.chance(0.85) ? 'grass_tuft' : 'flowers', p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });

  // --- Zones ------------------------------------------------------------------------------------
  t.zones.push(
    { id: 'z_residential', name: 'Elm & Maple', kind: 'residential', rect: [232, 124, 98, 170], zombies: 55 },
    { id: 'z_commercial', name: 'Route 9 Strip', kind: 'commercial', rect: [160, 294, 400, 84], zombies: 60 },
    { id: 'z_grocery', name: 'Pine Valley Market', kind: 'commercial', rect: [395, 336, 46, 32], zombies: 22 },
    { id: 'z_birch', name: 'Birch Court', kind: 'residential', rect: [232, 400, 120, 80], zombies: 22 },
    { id: 'z_gas', name: 'Gas-N-Go', kind: 'commercial', rect: [490, 250, 64, 44], zombies: 8 },
    { id: 'z_north_woods', name: 'North Woods', kind: 'forest', rect: [0, 0, 640, 115], zombies: 14 },
    { id: 'z_west_woods', name: 'West Woods', kind: 'forest', rect: [0, 115, 150, 525], zombies: 10 },
    { id: 'z_fields', name: 'Hollis Farm Fields', kind: 'rural', rect: [460, 390, 180, 250], zombies: 8 },
  );

  const map: MapData = {
    format: MAP_FORMAT_VERSION,
    id: 'prototype',
    name: 'Pine Valley',
    width: PROTOTYPE_SIZE,
    height: PROTOTYPE_SIZE,
    seed,
    terrain: t.terrain.toLayer(),
    roads: t.roads,
    buildings: t.buildings,
    props: t.props,
    fences: t.fences,
    zones: t.zones,
    spawns: [
      { x: 22, y: 327 },
      { x: 272, y: 42 },
      { x: 628, y: 285 },
      { x: 600, y: 350 },
    ],
  };
  return map;
}

function parkingRow(
  t: TownBuilder,
  x0: number,
  y: number,
  slots: number,
  spacing: number,
  orientation: 'v' | 'h',
  rng: Rng,
  types: string[],
  chance: number,
): void {
  for (let i = 0; i < slots; i++) {
    if (!rng.chance(chance)) continue;
    const x = x0 + i * spacing;
    const rot = (orientation === 'v' ? Math.PI / 2 : 0) + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.06, 0.06);
    t.prop(rng.pick(types), x, y + rng.range(-0.2, 0.2), rot, { variant: rng.int(0, 999) });
  }
}

function decorateHouse(t: TownBuilder, def: BuildingDef, rng: Rng): void {
  const tr = buildingTransform(def);
  const front = frontVector(def.rot);
  const garageDoor = def.doors.find((d) => d.kind === 'garage');
  const frontDoor = def.doors.find((d) => d.kind === 'exterior' && d.y > def.h - 1);
  // Driveway from the garage (or beside the house) to the street.
  const driveLocalX = garageDoor ? garageDoor.x : def.w - 1.6;
  const driveStart = localToWorld(tr, driveLocalX, def.h + (garageDoor ? 0 : -3));
  const driveEnd = { x: driveStart.x + front.x * 10.5, y: driveStart.y + front.y * 10.5 };
  const drive = t.road('driveway', [[round2(driveStart.x), round2(driveStart.y)], [round2(driveEnd.x), round2(driveEnd.y)]], 3.2, 0);
  void drive;
  if (rng.chance(0.5)) {
    const cx = driveStart.x + front.x * (garageDoor ? 4 : 6);
    const cy = driveStart.y + front.y * (garageDoor ? 4 : 6);
    t.prop(rng.pick(['car_sedan', 'car_compact', 'car_suv', 'car_pickup']), cx, cy, Math.atan2(front.y, front.x) + (rng.chance(0.5) ? Math.PI : 0), { variant: rng.int(0, 999) });
  }
  // Front walkway.
  if (frontDoor) {
    const start = localToWorld(tr, frontDoor.x, def.h);
    t.road('driveway', [[round2(start.x), round2(start.y)], [round2(start.x + front.x * 9), round2(start.y + front.y * 9)]], 1.2, 0, { surface: 'concrete' });
  }
  // Mailbox and trash can at the curb.
  const curb = localToWorld(tr, driveLocalX + 2.4, def.h + 9.5);
  t.prop('mailbox', curb.x, curb.y, 0);
  if (rng.chance(0.55)) {
    const bin = localToWorld(tr, driveLocalX - 2.4, def.h + 9.2);
    t.prop('trash_can', bin.x, bin.y, 0);
  }
  // Bushes along the front wall and a tree or two in the yard.
  for (let i = 0; i < rng.int(1, 3); i++) {
    const lx = rng.range(0.8, def.w - 0.8);
    if (garageDoor && Math.abs(lx - garageDoor.x) < 2.2) continue;
    if (frontDoor && Math.abs(lx - frontDoor.x) < 1.4) continue;
    const p = localToWorld(tr, lx, def.h + 0.9);
    t.prop('bush', p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });
  }
  for (let i = 0; i < rng.int(2, 4); i++) {
    const lx = rng.chance(0.5) ? -rng.range(2.5, 5) : def.w + rng.range(2.5, 5);
    const ly = rng.range(-9, def.h + 5);
    const p = localToWorld(tr, lx, ly);
    if (t.isFree(p.x, p.y, 1)) t.prop(rng.chance(0.6) ? 'tree_oak' : 'tree_birch', p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });
  }
  if (rng.chance(0.3)) {
    const p = localToWorld(tr, rng.range(1, def.w - 1), -rng.range(3, 6));
    t.prop(rng.pick(['leaves', 'trash_pile', 'picnic_table']), p.x, p.y, rng.range(0, 6.28));
  }
  // Keep the yard around the drive clear of scattered trees.
  t.reserveBox(Math.min(driveStart.x, driveEnd.x) - 2, Math.min(driveStart.y, driveEnd.y) - 2, Math.max(driveStart.x, driveEnd.x) + 2, Math.max(driveStart.y, driveEnd.y) + 2);
}
