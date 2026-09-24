// Undoable edits. Every change to the map goes through a `Transaction`, which records the
// before/after state of each touched element (and terrain chunk, biome grid, spawn list), so
// undo and redo are exact and cheap even for "regenerate the whole map".

import type { BuildingDef, FenceDef, MapData, PropInstance, RoadDef, SpawnPoint, ZoneDef } from '@tuff/shared';

export type Collection = 'roads' | 'buildings' | 'props' | 'fences' | 'zones';
export type Element = RoadDef | BuildingDef | PropInstance | FenceDef | ZoneDef;

export interface ElementChange {
  coll: Collection;
  id: string;
  before: Element | null;
  after: Element | null;
}

export interface HistoryEntry {
  label: string;
  elements: ElementChange[];
  terrain: { key: string; before: string | undefined; after: string | undefined }[];
  biomes?: { before: string | undefined; after: string | undefined };
  terrainLocked?: { before: string[]; after: string[] };
  spawns?: { before: SpawnPoint[]; after: SpawnPoint[] };
  meta?: { before: Pick<MapData, 'name' | 'seed'>; after: Pick<MapData, 'name' | 'seed'> };
}

const clone = <T>(v: T): T => structuredClone(v);

/** Applies an entry to a map in one direction. Returns the elements that changed (for refreshing). */
export function applyEntry(map: MapData, entry: HistoryEntry, forward: boolean): ElementChange[] {
  const byColl = new Map<Collection, ElementChange[]>();
  for (const c of entry.elements) {
    let list = byColl.get(c.coll);
    if (!list) byColl.set(c.coll, (list = []));
    list.push(c);
  }
  for (const [coll, changes] of byColl) {
    const arr = map[coll] as Element[];
    const targets = new Map<string, Element | null>();
    for (const c of changes) targets.set(c.id, forward ? c.after : c.before);
    const next: Element[] = [];
    for (const el of arr) {
      if (!targets.has(el.id)) next.push(el);
      else {
        const t = targets.get(el.id);
        if (t) next.push(clone(t));
        targets.delete(el.id);
      }
    }
    for (const t of targets.values()) if (t) next.push(clone(t));
    (map[coll] as Element[]) = next;
  }
  for (const t of entry.terrain) {
    const v = forward ? t.after : t.before;
    if (v === undefined) delete map.terrain.chunks[t.key];
    else map.terrain.chunks[t.key] = v;
  }
  if (entry.biomes) {
    const v = forward ? entry.biomes.after : entry.biomes.before;
    if (v === undefined) delete map.biomes;
    else map.biomes = { data: v };
  }
  if (entry.terrainLocked) map.terrainLocked = [...(forward ? entry.terrainLocked.after : entry.terrainLocked.before)];
  if (entry.spawns) map.spawns = clone(forward ? entry.spawns.after : entry.spawns.before);
  if (entry.meta) Object.assign(map, forward ? entry.meta.after : entry.meta.before);
  return entry.elements;
}

/** Collects changes against the current map; `commit` hands the entry to the editor. */
export class Transaction {
  readonly entry: HistoryEntry;
  private readonly touched = new Map<string, ElementChange>();

  constructor(
    private readonly map: MapData,
    label: string,
  ) {
    this.entry = { label, elements: [], terrain: [] };
  }

  private find(coll: Collection, id: string): Element | null {
    return (this.map[coll] as Element[]).find((e) => e.id === id) ?? null;
  }

  private change(coll: Collection, id: string): ElementChange {
    const key = `${coll}:${id}`;
    let c = this.touched.get(key);
    if (!c) {
      const cur = this.find(coll, id);
      c = { coll, id, before: cur ? clone(cur) : null, after: cur ? clone(cur) : null };
      this.touched.set(key, c);
      this.entry.elements.push(c);
    }
    return c;
  }

  /** Records the original state of an element before it was modified in place (drags). */
  recordBefore(coll: Collection, id: string, before: Element | null): void {
    const c = this.change(coll, id);
    c.before = before ? clone(before) : null;
  }

  set(coll: Collection, el: Element): void {
    this.change(coll, el.id).after = clone(el);
  }

  add(coll: Collection, el: Element): void {
    this.set(coll, el);
  }

  remove(coll: Collection, id: string): void {
    this.change(coll, id).after = null;
  }

  /** Bulk variants that skip the per-element lookup (generation results). */
  addMany(coll: Collection, els: readonly Element[]): void {
    for (const el of els) {
      const c: ElementChange = { coll, id: el.id, before: null, after: clone(el) };
      this.touched.set(`${coll}:${el.id}`, c);
      this.entry.elements.push(c);
    }
  }

  removeMany(coll: Collection, ids: readonly string[]): void {
    const wanted = new Set(ids);
    for (const el of this.map[coll] as Element[]) {
      if (!wanted.has(el.id)) continue;
      const key = `${coll}:${el.id}`;
      const c = this.touched.get(key);
      if (c) c.after = null;
      else {
        const change: ElementChange = { coll, id: el.id, before: clone(el), after: null };
        this.touched.set(key, change);
        this.entry.elements.push(change);
      }
    }
  }

  terrain(key: string, after: string | undefined, before = this.map.terrain.chunks[key]): void {
    const existing = this.entry.terrain.find((t) => t.key === key);
    if (existing) existing.after = after;
    else this.entry.terrain.push({ key, before, after });
  }

  biomes(after: string | undefined, before = this.map.biomes?.data): void {
    this.entry.biomes = { before: this.entry.biomes?.before ?? before, after };
  }

  terrainLocked(after: string[]): void {
    this.entry.terrainLocked = { before: this.entry.terrainLocked?.before ?? [...(this.map.terrainLocked ?? [])], after: [...after] };
  }

  spawns(after: SpawnPoint[]): void {
    this.entry.spawns = { before: this.entry.spawns?.before ?? clone(this.map.spawns), after: clone(after) };
  }

  meta(after: Pick<MapData, 'name' | 'seed'>): void {
    this.entry.meta = { before: this.entry.meta?.before ?? { name: this.map.name, seed: this.map.seed }, after: { ...after } };
  }

  get empty(): boolean {
    return (
      this.entry.elements.length === 0 &&
      this.entry.terrain.length === 0 &&
      !this.entry.biomes &&
      !this.entry.terrainLocked &&
      !this.entry.spawns &&
      !this.entry.meta
    );
  }
}

export class History {
  private readonly done: HistoryEntry[] = [];
  private readonly undone: HistoryEntry[] = [];
  /** Changes since the last save. */
  dirty = 0;

  push(entry: HistoryEntry): void {
    this.done.push(entry);
    if (this.done.length > 200) this.done.shift();
    this.undone.length = 0;
    this.dirty++;
  }

  undo(): HistoryEntry | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    this.dirty++;
    return e;
  }

  redo(): HistoryEntry | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    this.dirty++;
    return e;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get lastLabel(): string | null {
    return this.done[this.done.length - 1]?.label ?? null;
  }

  get nextLabel(): string | null {
    return this.undone[this.undone.length - 1]?.label ?? null;
  }
}
