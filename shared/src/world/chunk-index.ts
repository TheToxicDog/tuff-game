// Splits a map into chunk payloads — the same shape the server streams to game clients. The map
// editor uses it to feed its working copy of a map through the game's own world and renderers.

import { CHUNK_SIZE, TERRAIN_CELLS_PER_CHUNK } from '../constants';
import type { ContentRegistry } from '../content/registry';
import type { ChunkPayload } from '../network/protocol';
import {
  buildingBounds,
  chunkKey,
  encodeTerrainChunk,
  roadBounds,
  type BuildingDef,
  type FenceDef,
  type MapData,
  type PropInstance,
  type RoadDef,
} from './map';

interface Bucket {
  roads: RoadDef[];
  buildings: BuildingDef[];
  props: PropInstance[];
  fences: FenceDef[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function propIndexBounds(content: ContentRegistry, p: PropInstance): Bounds {
  const def = content.findProp(p.type);
  const half = Math.max(def?.w ?? 1, def?.h ?? 1, (def?.r ?? 0.5) * 2, p.w ?? 0, p.h ?? 0) / 2 + 3;
  return { minX: p.x - half, minY: p.y - half, maxX: p.x + half, maxY: p.y + half };
}

export function fenceIndexBounds(f: FenceDef): Bounds {
  const xs = f.points.map((pt) => pt[0]);
  const ys = f.points.map((pt) => pt[1]);
  return { minX: Math.min(...xs) - 1, minY: Math.min(...ys) - 1, maxX: Math.max(...xs) + 1, maxY: Math.max(...ys) + 1 };
}

/** Chunk keys a bounding box touches, clipped to the map. */
export function chunkKeysIn(map: Pick<MapData, 'width' | 'height'>, b: Bounds): string[] {
  const keys: string[] = [];
  const x0 = Math.max(0, Math.floor(b.minX / CHUNK_SIZE));
  const y0 = Math.max(0, Math.floor(b.minY / CHUNK_SIZE));
  const x1 = Math.min(Math.ceil(map.width / CHUNK_SIZE) - 1, Math.floor(b.maxX / CHUNK_SIZE));
  const y1 = Math.min(Math.ceil(map.height / CHUNK_SIZE) - 1, Math.floor(b.maxY / CHUNK_SIZE));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) keys.push(chunkKey(cx, cy));
  return keys;
}

export class MapChunkIndex {
  private readonly buckets = new Map<string, Bucket>();
  private readonly fill: string;

  constructor(
    private readonly map: MapData,
    content: ContentRegistry,
  ) {
    this.fill = encodeTerrainChunk(new Uint8Array(TERRAIN_CELLS_PER_CHUNK * TERRAIN_CELLS_PER_CHUNK).fill(map.terrain.fill));
    for (const b of map.buildings) this.add(buildingBounds(b), (k) => k.buildings.push(b));
    for (const p of map.props) this.add(propIndexBounds(content, p), (k) => k.props.push(p));
    for (const f of map.fences) this.add(fenceIndexBounds(f), (k) => k.fences.push(f));
    for (const r of map.roads) this.add(roadBounds(r), (k) => k.roads.push(r));
  }

  private add(b: Bounds, put: (bucket: Bucket) => void): void {
    for (const key of chunkKeysIn(this.map, b)) {
      let bucket = this.buckets.get(key);
      if (!bucket) this.buckets.set(key, (bucket = { roads: [], buildings: [], props: [], fences: [] }));
      put(bucket);
    }
  }

  get chunksX(): number {
    return Math.ceil(this.map.width / CHUNK_SIZE);
  }

  get chunksY(): number {
    return Math.ceil(this.map.height / CHUNK_SIZE);
  }

  payload(cx: number, cy: number): ChunkPayload {
    const key = chunkKey(cx, cy);
    const b = this.buckets.get(key) ?? { roads: [], buildings: [], props: [], fences: [] };
    return {
      cx,
      cy,
      terrain: this.map.terrain.chunks[key] ?? this.fill,
      roads: b.roads,
      buildings: b.buildings,
      props: b.props,
      fences: b.fences,
      structures: [],
      objects: {},
    };
  }
}
