// The client's partial copy of the world: chunks streamed from the server, the map elements they
// reference (reference-counted, since buildings and roads span chunks), a compiled collision world
// identical to the server's for movement prediction, and door/window/container states.

import {
  CHUNK_SIZE,
  CompiledWorld,
  decodeTerrainChunk,
  isInsideBuilding,
  parseChunkKey,
  TERRAIN_CELLS_PER_CHUNK,
  type BuildingDef,
  type ChunkPayload,
  type ContentRegistry,
  type FenceDef,
  type ObjectState,
  type PropInstance,
  type RoadDef,
} from '@tuff/shared';

export type ElementKind = 'building' | 'prop' | 'road' | 'fence';

export interface WorldListener {
  elementAdded(kind: ElementKind, def: BuildingDef | PropInstance | RoadDef | FenceDef): void;
  elementRemoved(kind: ElementKind, id: string): void;
  terrainChanged(): void;
  objectChanged(id: string): void;
}

interface ChunkRecord {
  key: string;
  cx: number;
  cy: number;
  terrain: Uint8Array;
  elements: { kind: ElementKind; id: string }[];
}

export class ClientWorld {
  readonly compiled: CompiledWorld;
  readonly chunks = new Map<string, ChunkRecord>();
  readonly buildings = new Map<string, BuildingDef>();
  readonly props = new Map<string, PropInstance>();
  readonly roads = new Map<string, RoadDef>();
  readonly fences = new Map<string, FenceDef>();
  private readonly refs = new Map<string, number>();
  private readonly listeners: WorldListener[] = [];

  constructor(
    content: ContentRegistry,
    readonly width: number,
    readonly height: number,
  ) {
    this.compiled = new CompiledWorld(content);
  }

  listen(l: WorldListener): void {
    this.listeners.push(l);
  }

  addChunk(c: ChunkPayload): void {
    const key = `${c.cx},${c.cy}`;
    if (this.chunks.has(key)) this.removeChunk(key);
    const record: ChunkRecord = { key, cx: c.cx, cy: c.cy, terrain: decodeTerrainChunk(c.terrain), elements: [] };
    const add = (kind: ElementKind, id: string, def: BuildingDef | PropInstance | RoadDef | FenceDef) => {
      record.elements.push({ kind, id });
      const n = (this.refs.get(id) ?? 0) + 1;
      this.refs.set(id, n);
      if (n > 1) return;
      switch (kind) {
        case 'building':
          this.buildings.set(id, def as BuildingDef);
          this.compiled.addBuilding(def as BuildingDef);
          break;
        case 'prop':
          this.props.set(id, def as PropInstance);
          this.compiled.addProp(def as PropInstance);
          break;
        case 'road':
          this.roads.set(id, def as RoadDef);
          break;
        case 'fence':
          this.fences.set(id, def as FenceDef);
          this.compiled.addFence(def as FenceDef);
          break;
      }
      for (const l of this.listeners) l.elementAdded(kind, def);
    };
    for (const b of c.buildings) add('building', b.id, b);
    for (const p of c.props) add('prop', p.id, p);
    for (const r of c.roads) add('road', r.id, r);
    for (const f of c.fences) add('fence', f.id, f);
    this.chunks.set(key, record);
    this.setObjectStates(c.objects);
    for (const l of this.listeners) l.terrainChanged();
  }

  removeChunk(key: string): void {
    const record = this.chunks.get(key);
    if (!record) return;
    this.chunks.delete(key);
    for (const { kind, id } of record.elements) {
      const n = (this.refs.get(id) ?? 1) - 1;
      if (n > 0) {
        this.refs.set(id, n);
        continue;
      }
      this.refs.delete(id);
      this.compiled.removeElement(id);
      if (kind === 'building') this.buildings.delete(id);
      else if (kind === 'prop') this.props.delete(id);
      else if (kind === 'road') this.roads.delete(id);
      else this.fences.delete(id);
      for (const l of this.listeners) l.elementRemoved(kind, id);
    }
    for (const l of this.listeners) l.terrainChanged();
  }

  setObjectStates(states: Record<string, ObjectState>): void {
    for (const [id, state] of Object.entries(states)) {
      if (!this.compiled.object(id)) continue;
      this.compiled.setState(id, state);
      for (const l of this.listeners) l.objectChanged(id);
    }
  }

  /** Terrain material index at a point, or -1 if the chunk is not loaded. */
  terrainAt(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const c = this.chunks.get(`${cx},${cy}`);
    if (!c) return -1;
    const lx = Math.floor(x - cx * CHUNK_SIZE);
    const ly = Math.floor(y - cy * CHUNK_SIZE);
    return c.terrain[ly * TERRAIN_CELLS_PER_CHUNK + lx];
  }

  /** The building containing a point, if any. */
  buildingAt(x: number, y: number, margin = 0): BuildingDef | null {
    for (const b of this.buildings.values()) {
      const c = this.compiled.buildings.get(b.id);
      if (!c) continue;
      if (x < c.bounds.minX - 1 || x > c.bounds.maxX + 1 || y < c.bounds.minY - 1 || y > c.bounds.maxY + 1) continue;
      if (isInsideBuilding(b, x, y, margin)) return b;
    }
    return null;
  }

  isChunkLoaded(x: number, y: number): boolean {
    return this.chunks.has(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`);
  }

  loadedChunkCoords(): [number, number][] {
    return [...this.chunks.keys()].map(parseChunkKey);
  }
}
