// Validation for maps coming from the browser editor. An admin uploads them, but a malformed map
// must never take the server down, so every element is checked before it is saved or published.

import type { ContentRegistry } from '../content/registry';
import { decodeTerrainChunk, MAP_FORMAT_VERSION, parseChunkKey, TERRAIN_MATERIALS, type MapData } from './map';

const MAX_SIZE = 8192;
const MAX_ELEMENTS = 400_000;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function str(v: unknown, max = 200): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function points(v: unknown, min: number): boolean {
  return (
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= 10_000 &&
    v.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))
  );
}

export const MAP_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;

/** Returns a list of problems (empty when the map is usable). Stops after `limit` problems. */
export function validateMap(raw: unknown, content: ContentRegistry, limit = 25): string[] {
  const errors: string[] = [];
  const fail = (m: string) => {
    if (errors.length < limit) errors.push(m);
  };
  if (!isObj(raw)) return ['The map is not an object.'];
  const m = raw as Partial<MapData> & Obj;
  if (m.format !== MAP_FORMAT_VERSION) fail(`Unsupported map format ${String(m.format)}.`);
  if (!str(m.id, 40) || !MAP_ID_PATTERN.test(m.id)) fail('Map id must be 1–40 characters of a–z, 0–9, _ or -.');
  if (!str(m.name, 80)) fail('Map name is missing or too long.');
  if (!num(m.width) || !num(m.height) || m.width < 64 || m.height < 64 || m.width > MAX_SIZE || m.height > MAX_SIZE) {
    fail(`Map size must be between 64 and ${MAX_SIZE} meters.`);
    return errors;
  }
  if (!num(m.seed)) fail('Map seed must be a number.');
  const w = m.width;
  const h = m.height;
  const inside = (x: number, y: number) => x >= -50 && y >= -50 && x <= w + 50 && y <= h + 50;

  // Terrain.
  if (!isObj(m.terrain) || !num(m.terrain.fill) || !isObj(m.terrain.chunks)) fail('Terrain layer is malformed.');
  else {
    if (m.terrain.fill < 0 || m.terrain.fill >= TERRAIN_MATERIALS.length) fail('Terrain fill material is unknown.');
    for (const [key, enc] of Object.entries(m.terrain.chunks)) {
      const [cx, cy] = parseChunkKey(key);
      if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx * 64 >= w || cy * 64 >= h || typeof enc !== 'string') {
        fail(`Terrain chunk "${key}" is invalid.`);
        continue;
      }
      try {
        const cells = decodeTerrainChunk(enc);
        if (cells.some((v) => v >= TERRAIN_MATERIALS.length)) fail(`Terrain chunk "${key}" uses an unknown material.`);
      } catch {
        fail(`Terrain chunk "${key}" cannot be decoded.`);
      }
    }
  }

  const ids = new Set<string>();
  const uniqueId = (id: unknown, where: string): boolean => {
    if (!str(id, 120)) {
      fail(`${where}: missing id.`);
      return false;
    }
    if (ids.has(id)) fail(`${where}: duplicate id "${id}".`);
    ids.add(id);
    return true;
  };
  const list = (key: 'roads' | 'buildings' | 'props' | 'fences' | 'zones' | 'spawns'): unknown[] => {
    const v = m[key];
    if (!Array.isArray(v)) {
      fail(`"${key}" must be a list.`);
      return [];
    }
    if (v.length > MAX_ELEMENTS) fail(`Too many ${key}.`);
    return v;
  };

  const checkProp = (p: unknown, where: string, local: boolean) => {
    if (!isObj(p) || !uniqueId(p.id, where)) return;
    if (!str(p.type, 60) || !content.findProp(p.type)) fail(`${where} ${String(p.id)}: unknown prop type "${String(p.type)}".`);
    if (!num(p.x) || !num(p.y) || !num(p.rot)) fail(`${where} ${p.id}: position is not a number.`);
    else if (!local && !inside(p.x, p.y)) fail(`${where} ${p.id}: outside the map.`);
    if (p.w !== undefined && (!num(p.w) || p.w <= 0 || p.w > 100)) fail(`${where} ${p.id}: bad width.`);
    if (p.h !== undefined && (!num(p.h) || p.h <= 0 || p.h > 100)) fail(`${where} ${p.id}: bad depth.`);
  };

  for (const r of list('roads')) {
    if (!isObj(r) || !uniqueId(r.id, 'Road')) continue;
    if (!points(r.points, 2)) fail(`Road ${r.id}: needs at least two points.`);
    if (!num(r.width) || r.width <= 0 || r.width > 60) fail(`Road ${r.id}: bad width.`);
    if (!num(r.sidewalk) || r.sidewalk < 0 || r.sidewalk > 10) fail(`Road ${r.id}: bad sidewalk.`);
    if (!['highway', 'main', 'street', 'country', 'dirt', 'driveway'].includes(String(r.kind))) fail(`Road ${r.id}: unknown kind.`);
  }
  for (const b of list('buildings')) {
    if (!isObj(b) || !uniqueId(b.id, 'Building')) continue;
    if (!num(b.x) || !num(b.y) || !num(b.w) || !num(b.h) || !num(b.rot) || b.w <= 0 || b.h <= 0 || b.w > 400 || b.h > 400) {
      fail(`Building ${b.id}: bad position or size.`);
      continue;
    }
    if (!inside(b.x, b.y)) fail(`Building ${b.id}: outside the map.`);
    for (const k of ['rooms', 'walls', 'doors', 'windows', 'props'] as const) {
      if (!Array.isArray(b[k])) fail(`Building ${b.id}: "${k}" must be a list.`);
    }
    if (!isObj(b.roof) || !isObj(b.exterior)) fail(`Building ${b.id}: roof or exterior missing.`);
    for (const wall of (b.walls as unknown[]) ?? []) {
      if (!isObj(wall) || ![wall.x1, wall.y1, wall.x2, wall.y2, wall.t].every(num)) fail(`Building ${b.id}: malformed wall.`);
    }
    for (const d of (b.doors as unknown[]) ?? []) {
      if (!isObj(d) || !uniqueId(d.id, `Building ${b.id} door`) || ![d.x, d.y, d.w, d.angle].every(num))
        fail(`Building ${b.id}: malformed door.`);
    }
    for (const win of (b.windows as unknown[]) ?? []) {
      if (!isObj(win) || !uniqueId(win.id, `Building ${b.id} window`) || ![win.x, win.y, win.w, win.angle].every(num))
        fail(`Building ${b.id}: malformed window.`);
    }
    for (const p of (b.props as unknown[]) ?? []) checkProp(p, `Building ${b.id} prop`, true);
  }
  for (const p of list('props')) checkProp(p, 'Prop', false);
  for (const f of list('fences')) {
    if (!isObj(f) || !uniqueId(f.id, 'Fence')) continue;
    if (!points(f.points, 2)) fail(`Fence ${f.id}: needs at least two points.`);
    if (!['wood', 'chainlink', 'picket'].includes(String(f.kind))) fail(`Fence ${f.id}: unknown kind.`);
  }
  for (const z of list('zones')) {
    if (!isObj(z) || !uniqueId(z.id, 'Zone')) continue;
    if (!Array.isArray(z.rect) || z.rect.length !== 4 || !z.rect.every(num)) fail(`Zone ${z.id}: bad rectangle.`);
    if (!num(z.zombies) || z.zombies < 0 || z.zombies > 100_000) fail(`Zone ${z.id}: bad zombie count.`);
  }
  const spawns = list('spawns');
  if (spawns.length === 0) fail('The map needs at least one spawn point.');
  for (const s of spawns) {
    if (!isObj(s) || !num(s.x) || !num(s.y) || s.x < 1 || s.y < 1 || s.x > w - 1 || s.y > h - 1) fail('A spawn point is outside the map.');
  }
  if (m.biomes !== undefined && (!isObj(m.biomes) || typeof m.biomes.data !== 'string')) fail('Biome layer is malformed.');
  if (m.terrainLocked !== undefined && (!Array.isArray(m.terrainLocked) || !m.terrainLocked.every((k) => typeof k === 'string')))
    fail('Terrain locks are malformed.');
  return errors;
}
