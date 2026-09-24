// Editor-driven procedural generation with locking (design plan §39–47, Phase 4).
//
// Everything here produces a `MapEdit` — elements to remove, elements to add and terrain chunks to
// replace — instead of mutating the map, so the editor can preview, apply and undo it.
//
// - `generateArea` fills a rectangle from its biomes: terrain, a street grid, parcels (buildings
//   along roads with driveways, mailboxes and yards) and nature (trees, undergrowth, grass).
//   With `replace`, generated content in the area on the chosen layers is removed first.
// - Locking (§44): elements with `locked` are never removed or overlapped, and elements placed by
//   hand (`manual`) are never replaced, so "Regenerate unlocked" only changes what the designer
//   has not claimed. Terrain chunks listed in `terrainLocked` are never repainted.
// - `clearArea`, `scatterArea` and `smoothTerrain` are the selection tools of §45 and §47.

import { CHUNK_SIZE } from '../../constants';
import { Noise2D } from '../../math/noise';
import { Rng } from '../../math/rng';
import {
  BIOMES,
  biomeAt,
  buildingBounds,
  chunkKey,
  decodeBiomes,
  encodeTerrainChunk,
  roadBounds,
  terrainIndex,
  type Biome,
  type BuildingDef,
  type FenceDef,
  type GenLayer,
  type MapData,
  type PropInstance,
  type RoadDef,
  type TerrainMaterial,
} from '../map';
import type { BuildingBuilder } from './building';
import { BIOME_RULES, NATURE_PROPS, weightedPick, type LotKind } from './biomes';
import { generateGasStation, generateGrocery, generateHardwareStore, generatePoliceStation } from './commercial';
import { generateCabin, generateHouse, generateShed } from './house';
import { decorateHouse, distanceToPolyline, round2, round3, TownBuilder, type Box } from './prototype-town';
import { poissonDisc } from './scatter';
import { TerrainPainter } from './terrain';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ElementCollection = 'roads' | 'buildings' | 'props' | 'fences';
export const ELEMENT_COLLECTIONS: readonly ElementCollection[] = ['roads', 'buildings', 'props', 'fences'];

export interface LayerSelection {
  terrain: boolean;
  roads: boolean;
  parcels: boolean;
  nature: boolean;
}

export interface MapEdit {
  remove: Record<ElementCollection, string[]>;
  add: { roads: RoadDef[]; buildings: BuildingDef[]; props: PropInstance[]; fences: FenceDef[] };
  /** Terrain chunks to replace: chunk key → encoded grid. */
  terrain: Record<string, string>;
}

export function emptyEdit(): MapEdit {
  return {
    remove: { roads: [], buildings: [], props: [], fences: [] },
    add: { roads: [], buildings: [], props: [], fences: [] },
    terrain: {},
  };
}

type AnyElement = RoadDef | BuildingDef | PropInstance | FenceDef;

/** The generator layer an element belongs to, or null for hand-placed elements (never regenerated). */
export function genLayerOf(collection: ElementCollection, el: AnyElement): GenLayer | null {
  if (el.manual) return null;
  if (el.gen) return el.gen;
  switch (collection) {
    case 'roads':
      return (el as RoadDef).kind === 'driveway' ? 'parcels' : 'roads';
    case 'props':
      return NATURE_PROPS.has((el as PropInstance).type) ? 'nature' : 'parcels';
    default:
      return 'parcels';
  }
}

export function elementBox(collection: ElementCollection, el: AnyElement): Box {
  switch (collection) {
    case 'roads':
      return roadBounds(el as RoadDef);
    case 'buildings':
      return buildingBounds(el as BuildingDef);
    case 'fences': {
      const xs = (el as FenceDef).points.map((p) => p[0]);
      const ys = (el as FenceDef).points.map((p) => p[1]);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    default: {
      const p = el as PropInstance;
      const r = Math.max(p.w ?? 0.5, p.h ?? 0.5) / 2;
      return { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
    }
  }
}

function centreIn(b: Box, a: Rect): boolean {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return cx >= a.x && cy >= a.y && cx <= a.x + a.w && cy <= a.y + a.h;
}

function boxInside(b: Box, a: Rect, margin = 0): boolean {
  return b.minX >= a.x + margin && b.minY >= a.y + margin && b.maxX <= a.x + a.w - margin && b.maxY <= a.y + a.h - margin;
}

function overlaps(a: Box, b: Box, margin = 0): boolean {
  return a.minX - margin < b.maxX && a.maxX + margin > b.minX && a.minY - margin < b.maxY && a.maxY + margin > b.minY;
}

function collection(map: MapData, c: ElementCollection): AnyElement[] {
  return map[c] as AnyElement[];
}

/**
 * Ids a regeneration would replace: generated, unlocked, on a selected layer, centred in the area
 * on a painted biome cell. Generators produce nothing where no biome is set, so content there is
 * left alone rather than wiped without a replacement.
 */
export function replaceable(map: MapData, area: Rect, layers: LayerSelection): MapEdit['remove'] {
  const out: MapEdit['remove'] = { roads: [], buildings: [], props: [], fences: [] };
  const biomes = decodeBiomes(map);
  for (const c of ELEMENT_COLLECTIONS) {
    for (const el of collection(map, c)) {
      if (el.locked) continue;
      const layer = genLayerOf(c, el);
      if (!layer || !layers[layer]) continue;
      const box = elementBox(c, el);
      if (!centreIn(box, area) || biomeAt(biomes, map, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2) === 'none') continue;
      out[c].push(el.id);
    }
  }
  return out;
}

/** Removes every unlocked element (hand-placed ones too) centred in the area on the chosen layers. */
export function clearArea(map: MapData, area: Rect, layers: LayerSelection): MapEdit {
  const edit = emptyEdit();
  for (const c of ELEMENT_COLLECTIONS) {
    for (const el of collection(map, c)) {
      if (el.locked) continue;
      const layer =
        genLayerOf(c, el) ??
        (c === 'props' && NATURE_PROPS.has((el as PropInstance).type) ? 'nature' : c === 'roads' ? 'roads' : 'parcels');
      if (layers[layer] && centreIn(elementBox(c, el), area)) edit.remove[c].push(el.id);
    }
  }
  return edit;
}

export interface AreaGenOptions {
  seed: number;
  area: Rect;
  layers: LayerSelection;
  /** Remove generated, unlocked content on the chosen layers first ("Regenerate"). */
  replace: boolean;
  /** Street spacing override for the road generator. */
  blockSize?: number;
}

const HARD_GROUND = new Set<number>(
  (
    [
      'asphalt',
      'asphalt_cracked',
      'concrete',
      'sidewalk',
      'concrete_industrial',
      'asphalt_parking',
      'water_shallow',
      'water_deep',
      'tilled_soil',
      'farm_soil',
    ] as TerrainMaterial[]
  ).map(terrainIndex),
);

interface Context {
  map: MapData;
  area: Rect;
  t: TownBuilder;
  biomes: Uint8Array;
  locked: Set<string>;
  /** Kept buildings (not being replaced). */
  keptBuildings: Box[];
  keptRoads: RoadDef[];
}

function biome(ctx: Context, x: number, y: number): Biome {
  return biomeAt(ctx.biomes, ctx.map, x, y);
}

/** A procedural pass over an area of an existing map (see the module comment). */
export function generateArea(map: MapData, opts: AreaGenOptions): MapEdit {
  const area = clampRect(opts.area, map);
  const edit = emptyEdit();
  if (opts.replace) edit.remove = replaceable(map, area, opts.layers);
  const removed = new Set(ELEMENT_COLLECTIONS.flatMap((c) => edit.remove[c]));
  const t = new TownBuilder(opts.seed, {
    terrain: TerrainPainter.fromLayer(map.terrain, map.width, map.height),
    prefix: `g${(opts.seed >>> 0).toString(36)}_`,
  });
  const ctx: Context = {
    map,
    area,
    t,
    biomes: decodeBiomes(map),
    locked: new Set(map.terrainLocked ?? []),
    keptBuildings: [],
    keptRoads: [],
  };
  // Everything that stays is an obstacle for new content.
  const near: Rect = { x: area.x - 60, y: area.y - 60, w: area.w + 120, h: area.h + 120 };
  for (const b of map.buildings) {
    if (removed.has(b.id)) continue;
    const box = buildingBounds(b);
    ctx.keptBuildings.push(box);
    if (overlaps(box, { minX: near.x, minY: near.y, maxX: near.x + near.w, maxY: near.y + near.h }))
      t.reserveBox(box.minX - 1.5, box.minY - 1.5, box.maxX + 1.5, box.maxY + 1.5);
  }
  for (const r of map.roads) {
    if (removed.has(r.id)) continue;
    ctx.keptRoads.push(r);
    t.existingRoads.push(r);
  }
  for (const f of map.fences) {
    if (removed.has(f.id)) continue;
    const box = elementBox('fences', f);
    if (overlaps(box, { minX: near.x, minY: near.y, maxX: near.x + near.w, maxY: near.y + near.h }))
      t.reserveBox(box.minX - 0.8, box.minY - 0.8, box.maxX + 0.8, box.maxY + 0.8);
  }
  for (const p of map.props) {
    if (removed.has(p.id) || p.x < near.x || p.y < near.y || p.x > near.x + near.w || p.y > near.y + near.h) continue;
    const r = NATURE_PROPS.has(p.type) ? 0.6 : Math.max(p.w ?? 1, p.h ?? 1) / 2 + 0.4;
    t.reserveBox(p.x - r, p.y - r, p.x + r, p.y + r);
  }

  const tag = (from: { roads: number; buildings: number; props: number; fences: number }, layer: GenLayer) => {
    for (const r of t.roads.slice(from.roads)) r.gen = r.kind === 'driveway' ? 'parcels' : layer;
    for (const b of t.buildings.slice(from.buildings)) b.gen = layer;
    for (const p of t.props.slice(from.props)) p.gen = layer;
    for (const f of t.fences.slice(from.fences)) f.gen = layer;
  };
  const mark = () => ({ roads: t.roads.length, buildings: t.buildings.length, props: t.props.length, fences: t.fences.length });

  if (opts.layers.terrain) paintTerrain(ctx, opts.seed);
  if (opts.layers.roads) {
    const m = mark();
    generateStreets(ctx, opts.blockSize);
    tag(m, 'roads');
  }
  if (opts.layers.parcels) {
    const m = mark();
    generateParcels(ctx);
    tag(m, 'parcels');
  }
  if (opts.layers.nature) {
    const m = mark();
    generateNature(ctx);
    tag(m, 'nature');
  }

  edit.add = { roads: t.roads, buildings: t.buildings, props: t.props, fences: t.fences };
  edit.terrain = terrainDiff(ctx);
  return edit;
}

function clampRect(r: Rect, map: MapData): Rect {
  const x = Math.max(0, Math.min(map.width, r.x));
  const y = Math.max(0, Math.min(map.height, r.y));
  return { x, y, w: Math.max(0, Math.min(map.width, r.x + r.w) - x), h: Math.max(0, Math.min(map.height, r.y + r.h) - y) };
}

function terrainDiff(ctx: Context): Record<string, string> {
  const { area, map, t } = ctx;
  const out: Record<string, string> = {};
  const fill = encodeTerrainChunk(new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(map.terrain.fill));
  // Buildings and driveways can paint a little outside the area.
  for (let cy = Math.max(0, Math.floor((area.y - 20) / CHUNK_SIZE)); cy <= Math.floor((area.y + area.h + 20) / CHUNK_SIZE); cy++) {
    for (let cx = Math.max(0, Math.floor((area.x - 20) / CHUNK_SIZE)); cx <= Math.floor((area.x + area.w + 20) / CHUNK_SIZE); cx++) {
      if (cx * CHUNK_SIZE >= map.width || cy * CHUNK_SIZE >= map.height) continue;
      const key = chunkKey(cx, cy);
      if (ctx.locked.has(key)) continue;
      const enc = t.terrain.encodeChunk(cx, cy);
      if (enc !== (map.terrain.chunks[key] ?? fill)) out[key] = enc;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Terrain

function paintTerrain(ctx: Context, seed: number): void {
  const { area, t } = ctx;
  const n1 = new Noise2D(seed ^ 0x51ed);
  const n2 = new Noise2D(seed ^ 0x7a11);
  // Cells under kept buildings and roads keep their ground.
  const protectedCells = new Uint8Array(Math.ceil(area.w) * Math.ceil(area.h));
  const protect = (b: Box) => {
    for (let y = Math.max(area.y, Math.floor(b.minY)); y < Math.min(area.y + area.h, Math.ceil(b.maxY)); y++) {
      for (let x = Math.max(area.x, Math.floor(b.minX)); x < Math.min(area.x + area.w, Math.ceil(b.maxX)); x++) {
        protectedCells[Math.floor(y - area.y) * Math.ceil(area.w) + Math.floor(x - area.x)] = 1;
      }
    }
  };
  for (const b of ctx.keptBuildings) protect({ minX: b.minX - 1.5, minY: b.minY - 1.5, maxX: b.maxX + 1.5, maxY: b.maxY + 1.5 });
  for (const r of ctx.keptRoads) {
    const corridor = r.width / 2 + r.sidewalk + 1.6;
    const b = roadBounds(r);
    for (let y = Math.max(area.y, Math.floor(b.minY)); y < Math.min(area.y + area.h, Math.ceil(b.maxY)); y++) {
      for (let x = Math.max(area.x, Math.floor(b.minX)); x < Math.min(area.x + area.w, Math.ceil(b.maxX)); x++) {
        if (distanceToPolyline(x + 0.5, y + 0.5, r.points) <= corridor)
          protectedCells[Math.floor(y - area.y) * Math.ceil(area.w) + Math.floor(x - area.x)] = 1;
      }
    }
  }
  t.terrain.each(area.x, area.y, area.w, area.h, (x, y) => {
    if (ctx.locked.has(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)))) return null;
    if (protectedCells[Math.floor(y - area.y) * Math.ceil(area.w) + Math.floor(x - area.x)]) return null;
    const b = biome(ctx, x, y);
    if (b === 'farmland') return Math.floor(y / 2) % 2 === 0 ? 'tilled_soil' : 'farm_soil';
    return BIOME_RULES[b].ground(n1.fbm(x / 28, y / 28, 3), n2.fbm(x / 40, y / 40, 3));
  });
}

// ---------------------------------------------------------------------------------------------
// Streets

function roadSpec(kind: 'main' | 'street' | 'country'): { width: number; sidewalk: number; markings: boolean } {
  if (kind === 'main') return { width: 9, sidewalk: 2.4, markings: true };
  if (kind === 'country') return { width: 7.5, sidewalk: 0, markings: true };
  return { width: 7, sidewalk: 1.8, markings: false };
}

/** A street grid over the urban biomes (city, town, suburb, industrial) in the area. */
function generateStreets(ctx: Context, blockOverride?: number): void {
  const { area, t } = ctx;
  const step = 8;
  const blocked = (x: number, y: number) => {
    for (const b of [...ctx.keptBuildings, ...t.buildings.map(buildingBounds)]) {
      if (x > b.minX - 5 && x < b.maxX + 5 && y > b.minY - 5 && y < b.maxY + 5) return true;
    }
    for (const r of [...ctx.keptRoads, ...t.roads]) {
      if (r.kind === 'driveway') continue;
      if (distanceToPolyline(x, y, r.points) < r.width / 2 + r.sidewalk + 3) return 'road';
    }
    return false;
  };
  const urban = (x: number, y: number) => {
    const rules = BIOME_RULES[biome(ctx, x, y)];
    return rules.block > 0 && rules.roadKind ? rules : null;
  };
  // Grid spacing: the override, or the densest urban biome present.
  let block = blockOverride ?? 0;
  if (!block) {
    for (let y = area.y; y < area.y + area.h; y += 16) {
      for (let x = area.x; x < area.x + area.w; x += 16) {
        const r = urban(x, y);
        if (r && (!block || r.block < block)) block = r.block;
      }
    }
  }
  if (!block) return;
  const lines: { vertical: boolean; at: number }[] = [];
  for (let x = area.x + block / 2; x < area.x + area.w; x += block) lines.push({ vertical: true, at: round2(x) });
  for (let y = area.y + block / 2; y < area.y + area.h; y += block) lines.push({ vertical: false, at: round2(y) });
  for (const line of lines) {
    const len = line.vertical ? area.h : area.w;
    let runStart = -1;
    let runKind: 'main' | 'street' | 'country' = 'street';
    const flush = (end: number) => {
      if (runStart < 0) return;
      const a = runStart;
      runStart = -1;
      if (end - a < 36) return;
      const spec = roadSpec(runKind);
      const pts: [number, number][] = line.vertical
        ? [
            [line.at, round2(area.y + a)],
            [line.at, round2(area.y + end)],
          ]
        : [
            [round2(area.x + a), line.at],
            [round2(area.x + end), line.at],
          ];
      t.road(runKind, pts, spec.width, spec.sidewalk, { markings: spec.markings });
    };
    for (let s = 0; s <= len; s += step) {
      const x = line.vertical ? line.at : area.x + s;
      const y = line.vertical ? area.y + s : line.at;
      const rules = urban(x, y);
      const hit = blocked(x, y);
      if (rules && hit !== true) {
        if (runStart < 0) {
          runStart = s;
          runKind = rules.roadKind!;
        }
      } else flush(s - step);
    }
    flush(len);
  }
}

// ---------------------------------------------------------------------------------------------
// Parcels: buildings along roads

function lotBuilder(kind: LotKind, id: string, rng: Rng): BuildingBuilder {
  switch (kind) {
    case 'shed':
      return generateShed(id, rng);
    case 'cabin':
      return generateCabin(id, rng);
    case 'grocery':
      return generateGrocery(id, rng);
    case 'gas_station':
      return generateGasStation(id, rng);
    case 'hardware':
      return generateHardwareStore(id, rng);
    case 'police':
      return generatePoliceStation(id, rng);
    default:
      return generateHouse(id, rng);
  }
}

const SETBACK: Record<LotKind, number> = { house: 7.5, shed: 6, cabin: 10, grocery: 26, gas_station: 16, hardware: 9, police: 9 };

/** Walks every road through the area and fills lots on both sides according to the biome. */
function generateParcels(ctx: Context): void {
  const { area, t, map } = ctx;
  const rng = t.rng;
  const roads = [...ctx.keptRoads, ...t.roads].filter((r) => r.kind === 'main' || r.kind === 'street' || r.kind === 'country');
  const areaBox: Box = { minX: area.x, minY: area.y, maxX: area.x + area.w, maxY: area.y + area.h };
  for (const road of roads) {
    if (!overlaps(roadBounds(road), areaBox)) continue;
    for (let i = 0; i + 1 < road.points.length; i++) {
      const [ax, ay] = road.points[i];
      const [bx, by] = road.points[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 10) continue;
      const tx = (bx - ax) / len;
      const ty = (by - ay) / len;
      for (const side of [-1, 1]) {
        const nx = -ty * side;
        const ny = tx * side;
        let s = rng.range(6, 14);
        while (s < len - 6) {
          const px = ax + tx * s;
          const py = ay + ty * s;
          const probe = road.width / 2 + road.sidewalk + 12;
          const rules = BIOME_RULES[biome(ctx, px + nx * probe, py + ny * probe)];
          const spacing = rules.lotSpacing;
          const kind = rules.lots.length > 0 ? weightedPick(rules.lots, rng.next()) : 'empty';
          if (kind !== 'empty') placeLot(ctx, kind, road, px, py, nx, ny, areaBox);
          s += spacing * rng.range(0.9, 1.15);
        }
      }
    }
  }
  void map;
}

function placeLot(ctx: Context, kind: LotKind, road: RoadDef, px: number, py: number, nx: number, ny: number, areaBox: Box): void {
  const { t, map } = ctx;
  const rng = t.rng;
  const builder = lotBuilder(kind, t.nextBuildingId(), rng);
  const offset = road.width / 2 + road.sidewalk + SETBACK[kind] + builder.h / 2;
  const cx = px + nx * offset;
  const cy = py + ny * offset;
  const rot = round3(Math.atan2(nx, -ny));
  const probe: BuildingDef = { ...builder.def, x: cx, y: cy, rot };
  const box = buildingBounds(probe);
  if (box.minX < 6 || box.minY < 6 || box.maxX > map.width - 6 || box.maxY > map.height - 6) return;
  if (!boxInside(box, { x: areaBox.minX, y: areaBox.minY, w: areaBox.maxX - areaBox.minX, h: areaBox.maxY - areaBox.minY }, 0.5)) return;
  // Every corner, edge midpoint and the centre must be free of other buildings, roads and fences.
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const [lx, ly] of [
    [0, 0],
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
    [0, -0.5],
    [0, 0.5],
    [-0.5, 0],
    [0.5, 0],
  ]) {
    const x = cx + lx * builder.w * c - ly * builder.h * s;
    const y = cy + lx * builder.w * s + ly * builder.h * c;
    if (!t.isFree(x, y, 1)) return;
  }
  const def = t.place(builder, round2(cx), round2(cy), rot);
  if (kind === 'house') decorateHouse(t, def, rng);
  else if (kind === 'grocery' || kind === 'gas_station' || kind === 'hardware' || kind === 'police') {
    // Paved frontage and a dumpster out back.
    const front = { x: cx - nx * (builder.h / 2), y: cy - ny * (builder.h / 2) };
    t.terrain.line(
      [
        [front.x, front.y],
        [px + nx * (road.width / 2 + road.sidewalk), py + ny * (road.width / 2 + road.sidewalk)],
      ],
      builder.w / 2,
      'asphalt_parking',
    );
    const back = { x: cx + nx * (builder.h / 2 + 3), y: cy + ny * (builder.h / 2 + 3) };
    if (t.isFree(back.x, back.y, 0.5)) t.prop('dumpster', back.x, back.y, rot);
  } else {
    t.terrain.circle(cx - nx * (builder.h / 2 + 2), cy - ny * (builder.h / 2 + 2), 3, 'dirt');
  }
}

// ---------------------------------------------------------------------------------------------
// Nature

function generateNature(ctx: Context): void {
  const { area, t } = ctx;
  const rng = t.rng;
  const present = new Set<Biome>();
  for (let y = area.y; y < area.y + area.h; y += 8) for (let x = area.x; x < area.x + area.w; x += 8) present.add(biome(ctx, x, y));
  for (const b of BIOMES) {
    if (b === 'none' || !present.has(b)) continue;
    const rules = BIOME_RULES[b];
    const inBiome = (x: number, y: number) => biome(ctx, x, y) === b;
    const soft = (x: number, y: number) => !HARD_GROUND.has(t.terrain.get(x, y));
    const scatter = (spacing: number, types: [string, number][], margin: number, ground: (x: number, y: number) => boolean) => {
      if (spacing <= 0 || types.length === 0) return;
      const pts = poissonDisc(rng, {
        x: area.x,
        y: area.y,
        w: area.w,
        h: area.h,
        spacing,
        accept: (x, y) => inBiome(x, y) && ground(x, y) && t.isFree(x, y, margin),
      });
      for (const p of pts) t.prop(weightedPick(types, rng.next()), p.x, p.y, rng.range(0, 6.28), { variant: rng.int(0, 999) });
    };
    scatter(rules.trees, rules.treeTypes, 1.5, soft);
    scatter(rules.undergrowth, rules.undergrowthTypes, 1, b === 'industrial' || b === 'city' ? () => true : soft);
    scatter(
      rules.tufts,
      [
        ['grass_tuft', 85],
        ['flowers', 15],
      ],
      0.5,
      soft,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Selection tools

export interface AreaScatterOptions {
  seed: number;
  area: Rect;
  /** Prop types, picked uniformly. */
  types: string[];
  spacing: number;
  /** Random rotation (otherwise all face north). */
  rotate: boolean;
  /** Only on these terrain materials (all when empty). */
  terrain: TerrainMaterial[];
}

/** Poisson-disc prop scattering over a selection (design plan §47). */
export function scatterArea(map: MapData, opts: AreaScatterOptions): MapEdit {
  const area = clampRect(opts.area, map);
  const edit = emptyEdit();
  if (opts.types.length === 0 || opts.spacing <= 0) return edit;
  const t = new TownBuilder(opts.seed, {
    terrain: TerrainPainter.fromLayer(map.terrain, map.width, map.height),
    prefix: `s${(opts.seed >>> 0).toString(36)}_`,
  });
  for (const b of map.buildings) {
    const box = buildingBounds(b);
    t.reserveBox(box.minX - 0.5, box.minY - 0.5, box.maxX + 0.5, box.maxY + 0.5);
  }
  for (const r of map.roads) t.existingRoads.push(r);
  for (const p of map.props) {
    if (p.x < area.x - 5 || p.y < area.y - 5 || p.x > area.x + area.w + 5 || p.y > area.y + area.h + 5) continue;
    t.reserveBox(p.x - 0.4, p.y - 0.4, p.x + 0.4, p.y + 0.4);
  }
  const allowed = new Set(opts.terrain.map(terrainIndex));
  const rng = t.rng;
  const pts = poissonDisc(rng, {
    x: area.x,
    y: area.y,
    w: area.w,
    h: area.h,
    spacing: opts.spacing,
    accept: (x, y) => (allowed.size === 0 || allowed.has(t.terrain.get(x, y))) && t.isFree(x, y, 0.3),
  });
  for (const p of pts) {
    const type = opts.types[Math.floor(rng.next() * opts.types.length)];
    t.prop(type, p.x, p.y, opts.rotate ? rng.range(0, 6.28) : 0, { variant: rng.int(0, 999), gen: 'nature' });
  }
  edit.add.props = t.props;
  return edit;
}

/** Majority filter over terrain in a selection: removes speckle and softens edges. */
export function smoothTerrain(map: MapData, rect: Rect, passes = 2): MapEdit {
  const area = clampRect(rect, map);
  const painter = TerrainPainter.fromLayer(map.terrain, map.width, map.height);
  const locked = new Set(map.terrainLocked ?? []);
  for (let pass = 0; pass < passes; pass++) {
    const src = painter.cells.slice();
    const counts = new Map<number, number>();
    for (let y = Math.floor(area.y); y < Math.ceil(area.y + area.h); y++) {
      for (let x = Math.floor(area.x); x < Math.ceil(area.x + area.w); x++) {
        if (locked.has(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)))) continue;
        counts.clear();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= map.width || yy >= map.height) continue;
            const v = src[yy * map.width + xx];
            counts.set(v, (counts.get(v) ?? 0) + 1);
          }
        }
        let best = src[y * map.width + x];
        let bestN = counts.get(best) ?? 0;
        for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
        if (bestN >= 5) painter.cells[y * map.width + x] = best;
      }
    }
  }
  const edit = emptyEdit();
  const fill = encodeTerrainChunk(new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(map.terrain.fill));
  for (let cy = Math.floor(area.y / CHUNK_SIZE); cy <= Math.floor((area.y + area.h) / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(area.x / CHUNK_SIZE); cx <= Math.floor((area.x + area.w) / CHUNK_SIZE); cx++) {
      const key = chunkKey(cx, cy);
      if (locked.has(key) || cx * CHUNK_SIZE >= map.width || cy * CHUNK_SIZE >= map.height) continue;
      const enc = painter.encodeChunk(cx, cy);
      if (enc !== (map.terrain.chunks[key] ?? fill)) edit.terrain[key] = enc;
    }
  }
  return edit;
}

/**
 * A fresh interior for a building (design plan §43): same type, position and rotation, new layout
 * from `seed`. The building gets a new id so saved world state for the old rooms does not carry
 * over to the new ones.
 */
export function regenerateInterior(def: BuildingDef, seed: number): BuildingDef {
  const rng = new Rng(seed);
  const base = def.id.replace(/~[a-z0-9]+$/, '');
  const id = `${base}~${(seed >>> 0).toString(36)}`;
  let builder: BuildingBuilder;
  switch (def.type) {
    case 'house': {
      const garage = def.rooms.some((r) => r.type === 'garage');
      builder = generateHouse(id, rng, {
        width: Math.max(9, Math.round(def.w - (garage ? 6.2 : 0))),
        depth: Math.max(8, Math.round(def.h)),
        garage,
      });
      break;
    }
    case 'shed':
      builder = def.w > 7 || def.h > 7 ? generateCabin(id, rng) : generateShed(id, rng);
      break;
    case 'grocery':
      builder = generateGrocery(id, rng, { width: def.w, depth: def.h, name: def.name });
      break;
    case 'gas_station':
      builder = generateGasStation(id, rng);
      break;
    case 'hardware':
      builder = generateHardwareStore(id, rng);
      break;
    case 'police':
      builder = generatePoliceStation(id, rng);
      break;
    default:
      builder = generateHouse(id, rng);
  }
  const out = builder.finish(def.x, def.y, def.rot);
  if (def.name && !out.name) out.name = def.name;
  if (def.gen) out.gen = def.gen;
  if (def.manual) out.manual = def.manual;
  return out;
}

/** Applies an edit to a map in place (the server and tools use this; the editor wraps it in undo). */
export function applyEdit(map: MapData, edit: MapEdit): void {
  for (const c of ELEMENT_COLLECTIONS) {
    const gone = new Set(edit.remove[c]);
    if (gone.size > 0) (map[c] as AnyElement[]) = collection(map, c).filter((el) => !gone.has(el.id));
    (map[c] as AnyElement[]).push(...(edit.add[c] as AnyElement[]));
  }
  for (const [key, enc] of Object.entries(edit.terrain)) map.terrain.chunks[key] = enc;
}
