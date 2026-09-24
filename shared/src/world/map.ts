// The map format: the immutable base world. It is authored by tools (the procedural generator
// today, the browser editor later) and stored as JSON in data/maps. Runtime changes (opened doors,
// broken windows, looted containers) are stored separately as deltas.
//
// Coordinates are in meters. +x is east, +y is south (screen convention). Building contents are
// stored in building-local coordinates so a building can be moved or rotated as a unit.

import { CHUNK_SIZE, TERRAIN_CELL_SIZE } from '../constants';
import type { Material } from './collision';

export const MAP_FORMAT_VERSION = 1;

/** Terrain materials, indexed by the byte stored in the terrain grid. Order is part of the format. */
export const TERRAIN_MATERIALS = [
  'grass',
  'grass_long',
  'grass_dead',
  'forest_floor',
  'dirt',
  'dirt_dry',
  'mud',
  'gravel',
  'asphalt',
  'asphalt_cracked',
  'concrete',
  'sidewalk',
  'farm_soil',
  'tilled_soil',
  'sand',
  'water_shallow',
  'water_deep',
  'rail_gravel',
  'concrete_industrial',
  'asphalt_parking',
] as const;
export type TerrainMaterial = (typeof TERRAIN_MATERIALS)[number];

export function terrainIndex(material: TerrainMaterial): number {
  return TERRAIN_MATERIALS.indexOf(material);
}

export type RoadKind = 'highway' | 'main' | 'street' | 'country' | 'dirt' | 'driveway';

/**
 * Authoring metadata shared by every map element (design plan §44). Procedural generators may
 * replace an element on "Regenerate" unless it is locked; elements placed by hand in the editor
 * are `manual` and never replaced. `gen` names the generator layer that produced an element.
 */
export interface Authoring {
  locked?: boolean;
  manual?: boolean;
  gen?: GenLayer;
}

/** Generator layers that "Generate" and "Regenerate unlocked" work on. */
export type GenLayer = 'roads' | 'parcels' | 'nature';
export const GEN_LAYERS: readonly GenLayer[] = ['roads', 'parcels', 'nature'];

export interface RoadDef extends Authoring {
  id: string;
  kind: RoadKind;
  /** Centre line. */
  points: [number, number][];
  /** Width of the driving surface. */
  width: number;
  lanes: number;
  /** Sidewalk width on each side; 0 for none. */
  sidewalk: number;
  surface: 'asphalt' | 'gravel' | 'dirt' | 'concrete';
  markings: boolean;
}

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'bathroom'
  | 'bedroom'
  | 'hallway'
  | 'garage'
  | 'utility'
  | 'dining'
  | 'office'
  | 'closet'
  | 'sales'
  | 'storage'
  | 'stockroom'
  | 'breakroom'
  | 'armory'
  | 'lockers'
  | 'cells'
  | 'lobby'
  | 'pharmacy';

export type FloorMaterial = 'wood' | 'tile' | 'carpet' | 'concrete' | 'linoleum' | 'checker' | 'darkwood';

export interface RoomDef {
  id: string;
  type: RoomType;
  name?: string;
  /** Local rectangle. */
  x: number;
  y: number;
  w: number;
  h: number;
  floor: FloorMaterial;
}

export interface WallDef {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Thickness in meters. */
  t: number;
  exterior: boolean;
  material: Material;
}

export type DoorKind = 'wood' | 'exterior' | 'glass' | 'metal' | 'garage' | 'cell' | 'plank' | 'gate';

export interface DoorDef {
  id: string;
  /** Centre of the doorway (local). */
  x: number;
  y: number;
  /** Opening width. */
  w: number;
  /** Direction along the wall, radians (0 = wall runs along +x). */
  angle: number;
  kind: DoorKind;
  /** Which end of the opening the hinge is on (-1 or 1), and which side it swings to (-1 or 1). */
  hinge: -1 | 1;
  swing: -1 | 1;
  locked?: boolean;
  /** Initially open (people left in a hurry). */
  open?: boolean;
}

export type WindowKind = 'residential' | 'storefront' | 'industrial';

export interface WindowDef {
  id: string;
  x: number;
  y: number;
  w: number;
  angle: number;
  kind: WindowKind;
}

export interface PropInstance extends Authoring {
  /** Globally unique id; containers and lights are addressed by it. */
  id: string;
  /** Prop definition id (data/world/props.json). */
  type: string;
  x: number;
  y: number;
  rot: number;
  /** Size overrides for box props. */
  w?: number;
  h?: number;
  /** Visual variant seed. */
  variant?: number;
  /** Loot table override for containers. */
  loot?: string;
}

export type RoofStyle = 'gable' | 'hip' | 'flat';

export interface RoofDef {
  style: RoofStyle;
  color: string;
  /** Ridge direction for gable roofs. */
  axis: 'x' | 'y';
}

export type BuildingType = 'house' | 'grocery' | 'gas_station' | 'police' | 'hardware' | 'shed' | 'garage' | 'restaurant' | 'office';

export interface BuildingDef extends Authoring {
  id: string;
  type: BuildingType;
  name?: string;
  /** World position of the footprint centre. */
  x: number;
  y: number;
  /** Footprint size (local). Local coordinates run from (0, 0) to (w, h). */
  w: number;
  h: number;
  /** Rotation around the centre, radians. */
  rot: number;
  exterior: { material: Material; color: string };
  rooms: RoomDef[];
  walls: WallDef[];
  doors: DoorDef[];
  windows: WindowDef[];
  props: PropInstance[];
  roof: RoofDef;
}

export type FenceKind = 'wood' | 'chainlink' | 'picket';

export interface FenceDef extends Authoring {
  id: string;
  kind: FenceKind;
  points: [number, number][];
}

export type ZoneKind = 'residential' | 'commercial' | 'forest' | 'rural' | 'industrial' | 'downtown';

export interface ZoneDef extends Authoring {
  id: string;
  name: string;
  kind: ZoneKind;
  /** Axis-aligned rectangle [x, y, w, h]. */
  rect: [number, number, number, number];
  /** Target zombie population. */
  zombies: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface TerrainLayer {
  /** Material index used for chunks that are not listed. */
  fill: number;
  /** Per-chunk run-length encoded material grids (base64), keyed "cx,cy". */
  chunks: Record<string, string>;
}

/** Biome regions (design plan §39, §46) steer the procedural generators. Order is part of the format. */
export const BIOMES = ['none', 'city', 'suburb', 'town', 'forest', 'plains', 'farmland', 'industrial', 'wilderness'] as const;
export type Biome = (typeof BIOMES)[number];

/** Biome grid resolution in meters. */
export const BIOME_CELL = 16;

export interface BiomeLayer {
  /** One byte per BIOME_CELL × BIOME_CELL cell (BIOMES index), row-major, run-length encoded + base64. */
  data: string;
}

export interface MapData {
  format: number;
  id: string;
  name: string;
  width: number;
  height: number;
  seed: number;
  terrain: TerrainLayer;
  roads: RoadDef[];
  buildings: BuildingDef[];
  props: PropInstance[];
  fences: FenceDef[];
  zones: ZoneDef[];
  spawns: SpawnPoint[];
  /** Editor-painted biomes; absent on maps that never had any. */
  biomes?: BiomeLayer;
  /** Terrain chunks ("cx,cy") the generators must not repaint (painted by hand, or locked). */
  terrainLocked?: string[];
}

export function biomeGridSize(map: Pick<MapData, 'width' | 'height'>): { cols: number; rows: number } {
  return { cols: Math.ceil(map.width / BIOME_CELL), rows: Math.ceil(map.height / BIOME_CELL) };
}

/** Decodes the biome grid (all 'none' when the map has none). */
export function decodeBiomes(map: Pick<MapData, 'width' | 'height' | 'biomes'>): Uint8Array {
  const { cols, rows } = biomeGridSize(map);
  const cells = new Uint8Array(cols * rows);
  if (!map.biomes?.data) return cells;
  const pairs = base64ToBytes(map.biomes.data);
  let o = 0;
  for (let i = 0; i + 1 < pairs.length && o < cells.length; i += 2) {
    const run = pairs[i];
    cells.fill(Math.min(BIOMES.length - 1, pairs[i + 1]), o, Math.min(cells.length, o + run));
    o += run;
  }
  return cells;
}

export function encodeBiomes(cells: Uint8Array): BiomeLayer {
  return { data: encodeRuns(cells) };
}

export function biomeAt(cells: Uint8Array, map: Pick<MapData, 'width' | 'height'>, x: number, y: number): Biome {
  const { cols, rows } = biomeGridSize(map);
  const cx = Math.floor(x / BIOME_CELL);
  const cy = Math.floor(y / BIOME_CELL);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return 'none';
  return BIOMES[cells[cy * cols + cx]] ?? 'none';
}

// ---------------------------------------------------------------------------------------------
// Chunk helpers

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): [number, number] {
  const [a, b] = key.split(',');
  return [Number(a), Number(b)];
}

export function chunkOf(x: number, y: number): [number, number] {
  return [Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)];
}

// ---------------------------------------------------------------------------------------------
// Terrain encoding

declare function btoa(data: string): string;
declare function atob(data: string): string;

const CELLS = CHUNK_SIZE / TERRAIN_CELL_SIZE;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeRuns(cells: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const value = cells[i];
    let run = 1;
    while (i + run < cells.length && cells[i + run] === value && run < 255) run++;
    out.push(run, value);
    i += run;
  }
  return bytesToBase64(new Uint8Array(out));
}

/** Run-length encodes a chunk's material grid as (count, value) byte pairs, then base64. */
export function encodeTerrainChunk(cells: Uint8Array): string {
  return encodeRuns(cells);
}

export function decodeTerrainChunk(encoded: string): Uint8Array {
  const pairs = base64ToBytes(encoded);
  const cells = new Uint8Array(CELLS * CELLS);
  let o = 0;
  for (let i = 0; i + 1 < pairs.length && o < cells.length; i += 2) {
    const run = pairs[i];
    cells.fill(pairs[i + 1], o, Math.min(cells.length, o + run));
    o += run;
  }
  return cells;
}

export function terrainChunkCells(terrain: TerrainLayer, cx: number, cy: number): Uint8Array {
  const encoded = terrain.chunks[chunkKey(cx, cy)];
  if (encoded) return decodeTerrainChunk(encoded);
  return new Uint8Array(CELLS * CELLS).fill(terrain.fill);
}

// ---------------------------------------------------------------------------------------------
// Building transforms

export interface Transform2D {
  x: number;
  y: number;
  cos: number;
  sin: number;
  /** Local-space pivot (the footprint centre). */
  px: number;
  py: number;
}

export function buildingTransform(b: BuildingDef): Transform2D {
  return { x: b.x, y: b.y, cos: Math.cos(b.rot), sin: Math.sin(b.rot), px: b.w / 2, py: b.h / 2 };
}

export function localToWorld(t: Transform2D, lx: number, ly: number): { x: number; y: number } {
  const dx = lx - t.px;
  const dy = ly - t.py;
  return { x: t.x + dx * t.cos - dy * t.sin, y: t.y + dx * t.sin + dy * t.cos };
}

export function worldToLocal(t: Transform2D, wx: number, wy: number): { x: number; y: number } {
  const dx = wx - t.x;
  const dy = wy - t.y;
  return { x: dx * t.cos + dy * t.sin + t.px, y: -dx * t.sin + dy * t.cos + t.py };
}

/** World-space corners of a building footprint as a flat polygon. */
export function buildingPolygon(b: BuildingDef): number[] {
  const t = buildingTransform(b);
  const corners = [localToWorld(t, 0, 0), localToWorld(t, b.w, 0), localToWorld(t, b.w, b.h), localToWorld(t, 0, b.h)];
  return corners.flatMap((c) => [c.x, c.y]);
}

export function buildingBounds(b: BuildingDef): { minX: number; minY: number; maxX: number; maxY: number } {
  const poly = buildingPolygon(b);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]);
    maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]);
    maxY = Math.max(maxY, poly[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

export function isInsideBuilding(b: BuildingDef, x: number, y: number, margin = 0): boolean {
  const l = worldToLocal(buildingTransform(b), x, y);
  return l.x >= -margin && l.y >= -margin && l.x <= b.w + margin && l.y <= b.h + margin;
}

export function roadBounds(r: RoadDef): { minX: number; minY: number; maxX: number; maxY: number } {
  const pad = r.width / 2 + r.sidewalk + 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of r.points) {
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad);
    maxY = Math.max(maxY, y + pad);
  }
  return { minX, minY, maxX, maxY };
}
