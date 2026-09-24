// The server's view of the world: the immutable base map compiled into colliders and objects,
// plus every runtime difference (door states, generated container contents, building loot plans)
// with dirty tracking so only changes are written to storage (design plan §50).

import {
  Block,
  CHUNK_SIZE,
  chunkKey,
  CompiledWorld,
  buildingBounds,
  buildingTransform,
  localToWorld,
  roadBounds,
  TERRAIN_CELLS_PER_CHUNK,
  encodeTerrainChunk,
  type BuildingDef,
  type ChunkPayload,
  type ContentRegistry,
  type FenceDef,
  type MapData,
  type ObjectState,
  type PropInstance,
  type RoadDef,
  type Rng,
} from '@tuff/shared';
import {
  emptyChanges,
  type BuildingLootState,
  type ContainerContents,
  type WorldChanges,
  type WorldSnapshot,
} from '../persistence/storage';

interface ChunkElements {
  roads: RoadDef[];
  buildings: BuildingDef[];
  props: PropInstance[];
  fences: FenceDef[];
}

export class WorldState {
  readonly compiled: CompiledWorld;
  readonly chunksX: number;
  readonly chunksY: number;
  private readonly chunkElements = new Map<string, ChunkElements>();
  /** Object id → chunks containing the element that owns the object. */
  private readonly objectChunks = new Map<string, string[]>();
  /** Element id → object ids it owns (for chunk payload object states). */
  private readonly elementObjects = new Map<string, string[]>();
  readonly containers = new Map<string, ContainerContents>();
  readonly buildingLoot = new Map<string, BuildingLootState>();
  private readonly buildingsByChunk = new Map<string, BuildingDef[]>();
  changes: WorldChanges = emptyChanges();
  private readonly fillTerrain: string;

  constructor(
    readonly map: MapData,
    content: ContentRegistry,
  ) {
    this.compiled = new CompiledWorld(content);
    this.chunksX = Math.ceil(map.width / CHUNK_SIZE);
    this.chunksY = Math.ceil(map.height / CHUNK_SIZE);
    this.fillTerrain = encodeTerrainChunk(new Uint8Array(TERRAIN_CELLS_PER_CHUNK * TERRAIN_CELLS_PER_CHUNK).fill(map.terrain.fill));

    for (const b of map.buildings) {
      const before = new Set([...this.compiled.doors.keys(), ...this.compiled.windows.keys(), ...this.compiled.containers.keys()]);
      this.compiled.addBuilding(b);
      const owned = [...this.compiled.doors.keys(), ...this.compiled.windows.keys(), ...this.compiled.containers.keys()].filter((id) => !before.has(id));
      const keys = this.index(buildingBounds(b), (e) => e.buildings.push(b));
      for (const k of keys) {
        let list = this.buildingsByChunk.get(k);
        if (!list) this.buildingsByChunk.set(k, (list = []));
        list.push(b);
      }
      this.registerObjects(b.id, owned, keys);
    }
    for (const p of map.props) {
      this.compiled.addProp(p);
      const def = content.findProp(p.type);
      const half = Math.max(def?.w ?? 1, def?.h ?? 1, (def?.r ?? 0.5) * 2, p.w ?? 0, p.h ?? 0) / 2 + 3;
      const keys = this.index({ minX: p.x - half, minY: p.y - half, maxX: p.x + half, maxY: p.y + half }, (e) => e.props.push(p));
      if (this.compiled.containers.has(p.id)) this.registerObjects(p.id, [p.id], keys);
    }
    for (const f of map.fences) {
      this.compiled.addFence(f);
      const xs = f.points.map((pt) => pt[0]);
      const ys = f.points.map((pt) => pt[1]);
      this.index({ minX: Math.min(...xs) - 1, minY: Math.min(...ys) - 1, maxX: Math.max(...xs) + 1, maxY: Math.max(...ys) + 1 }, (e) => e.fences.push(f));
    }
    for (const r of map.roads) this.index(roadBounds(r), (e) => e.roads.push(r));
  }

  private index(b: { minX: number; minY: number; maxX: number; maxY: number }, add: (e: ChunkElements) => void): string[] {
    const keys: string[] = [];
    const x0 = Math.max(0, Math.floor(b.minX / CHUNK_SIZE));
    const y0 = Math.max(0, Math.floor(b.minY / CHUNK_SIZE));
    const x1 = Math.min(this.chunksX - 1, Math.floor(b.maxX / CHUNK_SIZE));
    const y1 = Math.min(this.chunksY - 1, Math.floor(b.maxY / CHUNK_SIZE));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = chunkKey(cx, cy);
        let e = this.chunkElements.get(key);
        if (!e) this.chunkElements.set(key, (e = { roads: [], buildings: [], props: [], fences: [] }));
        add(e);
        keys.push(key);
      }
    }
    return keys;
  }

  private registerObjects(elementId: string, objectIds: string[], keys: string[]): void {
    this.elementObjects.set(elementId, objectIds);
    for (const id of objectIds) this.objectChunks.set(id, keys);
  }

  /** Restores deltas from storage. */
  load(snapshot: WorldSnapshot): void {
    for (const [id, state] of snapshot.objects) {
      if (this.compiled.object(id)) this.compiled.setState(id, state);
    }
    for (const [id, c] of snapshot.containers) this.containers.set(id, c);
    for (const [id, b] of snapshot.buildings) this.buildingLoot.set(id, b);
    this.changes = emptyChanges();
  }

  /** Chunks whose clients must hear about a change to this object. */
  chunksOfObject(id: string): string[] {
    return this.objectChunks.get(id) ?? [];
  }

  setObjectState(id: string, patch: ObjectState): ObjectState {
    const current = { ...this.compiled.stateOf(id), ...patch };
    // Drop fields that match the base-map default, keeping the stored delta minimal.
    const defaults = this.compiled.defaultState(id);
    for (const key of Object.keys(current) as (keyof ObjectState)[]) {
      if (current[key] === defaults[key]) delete current[key];
    }
    this.compiled.setState(id, current);
    this.changes.objects.set(id, Object.keys(current).length === 0 ? null : current);
    return this.compiled.effectiveState(id);
  }

  setContainer(id: string, contents: ContainerContents): void {
    this.containers.set(id, contents);
    this.changes.containers.set(id, contents);
  }

  markContainerDirty(id: string): void {
    const c = this.containers.get(id);
    if (c) this.changes.containers.set(id, c);
  }

  setBuildingLoot(id: string, state: BuildingLootState): void {
    this.buildingLoot.set(id, state);
    this.changes.buildings.set(id, state);
  }

  takeChanges(): WorldChanges {
    const c = this.changes;
    this.changes = emptyChanges();
    return c;
  }

  chunkPayload(cx: number, cy: number): ChunkPayload {
    const key = chunkKey(cx, cy);
    const e = this.chunkElements.get(key) ?? { roads: [], buildings: [], props: [], fences: [] };
    const objects: Record<string, ObjectState> = {};
    const collect = (elementId: string) => {
      for (const id of this.elementObjects.get(elementId) ?? []) {
        const s = this.compiled.stateOf(id);
        if (Object.keys(s).length > 0) objects[id] = s;
      }
    };
    for (const b of e.buildings) collect(b.id);
    for (const p of e.props) collect(p.id);
    return {
      cx,
      cy,
      terrain: this.map.terrain.chunks[key] ?? this.fillTerrain,
      roads: e.roads,
      buildings: e.buildings,
      props: e.props,
      fences: e.fences,
      objects,
    };
  }

  buildingAt(x: number, y: number): BuildingDef | null {
    const list = this.buildingsByChunk.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)));
    if (!list) return null;
    for (const b of list) {
      const c = this.compiled.buildings.get(b.id);
      if (!c) continue;
      const l = { x: x - c.transform.x, y: y - c.transform.y };
      const lx = l.x * c.transform.cos + l.y * c.transform.sin + c.transform.px;
      const ly = -l.x * c.transform.sin + l.y * c.transform.cos + c.transform.py;
      if (lx >= 0 && ly >= 0 && lx <= b.w && ly <= b.h) return b;
    }
    return null;
  }

  inBounds(x: number, y: number, margin = 1): boolean {
    return x >= margin && y >= margin && x <= this.map.width - margin && y <= this.map.height - margin;
  }

  isWalkable(x: number, y: number, radius: number): boolean {
    return this.inBounds(x, y, 2) && !this.compiled.collision.overlapsCircle(x, y, radius, Block.Zombie | Block.Player);
  }

  /** A random walkable point inside a building's rooms, or null. */
  randomIndoorPoint(b: BuildingDef, rng: Rng): { x: number; y: number } | null {
    if (b.rooms.length === 0) return null;
    const t = buildingTransform(b);
    for (let i = 0; i < 12; i++) {
      const room = rng.pick(b.rooms);
      const lx = room.x + rng.range(0.6, Math.max(0.61, room.w - 0.6));
      const ly = room.y + rng.range(0.6, Math.max(0.61, room.h - 0.6));
      const p = localToWorld(t, lx, ly);
      if (this.isWalkable(p.x, p.y, 0.35)) return p;
    }
    return null;
  }

  /** A random walkable point in a rectangle. */
  randomPointIn(rect: [number, number, number, number], rng: Rng): { x: number; y: number } | null {
    for (let i = 0; i < 20; i++) {
      const x = rect[0] + rng.next() * rect[2];
      const y = rect[1] + rng.next() * rect[3];
      if (this.isWalkable(x, y, 0.4)) return { x, y };
    }
    return null;
  }

  buildingsIn(rect: [number, number, number, number]): BuildingDef[] {
    return this.map.buildings.filter((b) => b.x >= rect[0] && b.y >= rect[1] && b.x <= rect[0] + rect[2] && b.y <= rect[1] + rect[3]);
  }
}
