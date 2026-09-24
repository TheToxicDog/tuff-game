// Player-built structures (design plan §54–56): walls, doors, fences, floors, crates, stations,
// fires and placed furniture. They are world deltas owned by an account, never part of the map
// file. Placement rules live here so the build-mode ghost on the client and the authoritative
// check on the server agree.

import type { ContentRegistry } from '../content/registry';
import type { BlockName, ConstructionDef, ConstructionKind, PropDef, StationKind } from '../content/types';
import { Block, type CollisionWorld, type Material } from './collision';

/** Structure type used for furniture placed from the inventory. */
export const FURNITURE_STRUCTURE = 'furniture';

/** Maximum distance from the player to a structure being placed. */
export const BUILD_RANGE = 4;

/** Placement grid and rotation steps. */
export const BUILD_GRID = 0.5;
export const BUILD_ROTATION_STEP = Math.PI / 4;

export interface StructureDef {
  id: string;
  /** Construction id, or FURNITURE_STRUCTURE. */
  type: string;
  /** Prop type for placed furniture. */
  prop?: string;
  x: number;
  y: number;
  rot: number;
  /** Account id of the builder, who may lock, dismantle and share it. */
  owner: string;
  ownerName: string;
}

/** Everything the simulation and renderer need to know about a structure's shape. */
export interface StructureShape {
  kind: ConstructionKind | 'furniture';
  name: string;
  w: number;
  h: number;
  /** Circle radius for round furniture (0 for boxes). */
  r: number;
  blocks: BlockName[];
  material: Material;
  maxHp: number;
  opening: number;
  container: { name: string; volume: number } | null;
  station: StationKind | null;
  sleep: number | null;
  construction: ConstructionDef | null;
  prop: PropDef | null;
}

export function structureShape(content: ContentRegistry, type: string, prop?: string): StructureShape | null {
  if (type === FURNITURE_STRUCTURE) {
    const p = prop ? content.findProp(prop) : undefined;
    if (!p) return null;
    return {
      kind: 'furniture',
      name: p.name,
      w: p.shape === 'circle' ? (p.r ?? 0.3) * 2 : (p.w ?? 1),
      h: p.shape === 'circle' ? (p.r ?? 0.3) * 2 : (p.h ?? 1),
      r: p.shape === 'circle' ? (p.r ?? 0.3) : 0,
      blocks: p.shape === 'none' ? [] : p.blocks,
      material: p.material,
      maxHp: Math.round(40 + (p.movable?.weight ?? 10) * 3),
      opening: 0,
      container: p.container ? { name: p.container.name, volume: p.container.volume } : null,
      station: p.station ?? null,
      sleep: p.sleep?.quality ?? null,
      construction: null,
      prop: p,
    };
  }
  const c = content.findConstruction(type);
  if (!c) return null;
  return {
    kind: c.kind,
    name: c.name,
    w: c.w,
    h: c.h,
    r: 0,
    blocks: c.blocks,
    material: c.material,
    maxHp: c.hp,
    opening: c.opening ?? 0,
    container: c.container ?? null,
    station: c.station ?? null,
    sleep: null,
    construction: c,
    prop: null,
  };
}

/** Snaps a placement to the build grid and rotation steps. */
export function snapPlacement(x: number, y: number, rot: number): { x: number; y: number; rot: number } {
  const step = BUILD_ROTATION_STEP;
  let r = Math.round(rot / step) * step;
  r = Math.atan2(Math.sin(r), Math.cos(r));
  // Keep exact values for the common right angles so colliders line up.
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: round(Math.round(x / BUILD_GRID) * BUILD_GRID), y: round(Math.round(y / BUILD_GRID) * BUILD_GRID), rot: round(r) };
}

/** Local → world for a structure placement. */
export function structurePoint(s: { x: number; y: number; rot: number }, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(s.rot);
  const n = Math.sin(s.rot);
  return { x: s.x + lx * c - ly * n, y: s.y + lx * n + ly * c };
}

/** Axis-aligned bounds of a placed structure. */
export function structureBounds(
  s: { x: number; y: number; rot: number },
  shape: Pick<StructureShape, 'w' | 'h'>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const c = Math.abs(Math.cos(s.rot));
  const n = Math.abs(Math.sin(s.rot));
  const ex = (c * shape.w + n * shape.h) / 2;
  const ey = (n * shape.w + c * shape.h) / 2;
  return { minX: s.x - ex, minY: s.y - ey, maxX: s.x + ex, maxY: s.y + ey };
}

/** Circles covering a footprint, used for overlap tests (local coordinates). */
function footprintSamples(shape: StructureShape): { x: number; y: number; r: number }[] {
  if (shape.r > 0) return [{ x: 0, y: 0, r: Math.max(0.05, shape.r - 0.04) }];
  const thin = Math.min(shape.w, shape.h);
  const long = Math.max(shape.w, shape.h);
  const alongX = shape.w >= shape.h;
  // Thin pieces (walls, fences) may meet other walls end to end and at corners.
  const r = Math.max(0.05, Math.min(0.3, thin / 2 - 0.03));
  const inset = thin < 0.6 ? 0.26 : r + 0.04;
  const out: { x: number; y: number; r: number }[] = [];
  const rows = thin < 0.6 ? 1 : Math.max(1, Math.ceil((thin - 2 * inset) / (r * 1.6)) + 1);
  const cols = Math.max(1, Math.ceil((long - 2 * inset) / (r * 1.6)) + 1);
  for (let j = 0; j < rows; j++) {
    const b = rows === 1 ? 0 : -thin / 2 + inset + ((thin - 2 * inset) * j) / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const a = cols === 1 ? 0 : -long / 2 + inset + ((long - 2 * inset) * i) / (cols - 1);
      out.push(alongX ? { x: a, y: b, r } : { x: b, y: a, r });
    }
  }
  return out;
}

export interface PlacementContext {
  content: ContentRegistry;
  collision: CollisionWorld;
  mapWidth: number;
  mapHeight: number;
  /** Returns true when a circle overlaps a character (players, zombies). */
  occupied?: (x: number, y: number, r: number) => boolean;
  /** Returns true when a floor already covers this point. */
  floorAt?: (x: number, y: number) => boolean;
}

/** Why a structure cannot be placed there, or null when it can. */
export function placementProblem(
  ctx: PlacementContext,
  type: string,
  prop: string | undefined,
  x: number,
  y: number,
  rot: number,
  from: { x: number; y: number },
): string | null {
  const shape = structureShape(ctx.content, type, prop);
  if (!shape) return 'You cannot build that.';
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rot)) return 'Invalid position.';
  if (Math.hypot(x - from.x, y - from.y) > BUILD_RANGE + Math.max(shape.w, shape.h) / 2) return 'Too far away.';
  const b = structureBounds({ x, y, rot }, shape);
  if (b.minX < 2 || b.minY < 2 || b.maxX > ctx.mapWidth - 2 || b.maxY > ctx.mapHeight - 2) return 'Too close to the edge of the world.';
  const samples = footprintSamples(shape);
  if (shape.kind === 'floor') {
    for (const s of samples) {
      const p = structurePoint({ x, y, rot }, s.x, s.y);
      if (ctx.floorAt?.(p.x, p.y)) return 'There is already a floor there.';
    }
    // Floors go under everything but not through walls.
    for (const s of samples) {
      const p = structurePoint({ x, y, rot }, s.x, s.y);
      if (ctx.collision.overlapsCircle(p.x, p.y, 0.05, Block.Player | Block.Sight)) return 'Something is in the way.';
    }
    return null;
  }
  for (const s of samples) {
    const p = structurePoint({ x, y, rot }, s.x, s.y);
    if (ctx.collision.overlapsCircle(p.x, p.y, s.r, Block.Player | Block.Zombie)) return 'Something is in the way.';
    if (ctx.occupied?.(p.x, p.y, s.r)) return 'Someone is standing there.';
  }
  return null;
}
