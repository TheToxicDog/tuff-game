// Editor tools (design plan §39–47). Each tool handles pointer and key input and draws its own
// preview; every change goes through a Transaction so it can be undone.

import type { Graphics } from 'pixi.js';
import {
  BIOME_CELL,
  BIOME_RULES,
  BIOMES,
  biomeGridSize,
  buildingBounds,
  buildingTransform,
  CHUNK_SIZE,
  chunkKey,
  clearArea,
  decodeTerrainChunk,
  distanceToPolyline,
  ELEMENT_COLLECTIONS,
  elementBox,
  encodeTerrainChunk,
  generateArea,
  generateCabin,
  generateGasStation,
  generateGrocery,
  generateHardwareStore,
  generateHouse,
  generatePoliceStation,
  generateShed,
  isInsideBuilding,
  localToWorld,
  scatterArea,
  smoothTerrain,
  TERRAIN_MATERIALS,
  terrainIndex,
  worldToLocal,
  type Biome,
  type BuildingBuilder,
  type BuildingDef,
  type FenceDef,
  type FenceKind,
  type LayerSelection,
  type MapEdit,
  type PropInstance,
  type Rect,
  type RoadDef,
  type RoadKind,
  type TerrainMaterial,
  type ZoneDef,
  type ZoneKind,
} from '@tuff/shared';
import { Rng } from '@tuff/shared';
import { clear, h } from '../ui/dom';
import type { Editor, SelectionItem } from './editor';
import type { Collection, Element } from './history';

export type ToolId = 'select' | 'terrain' | 'biome' | 'road' | 'building' | 'prop' | 'fence' | 'zone' | 'spawn' | 'area';

export interface Pointer {
  sx: number;
  sy: number;
  x: number;
  y: number;
  inside: boolean;
}

export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  readonly shortcut: string;
  readonly hint: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(p: Pointer, e: MouseEvent): void;
  pointerMove?(p: Pointer, e: MouseEvent): void;
  pointerUp?(p: Pointer, e: MouseEvent): void;
  doubleClick?(p: Pointer, e: MouseEvent): void;
  /** Right click without dragging. */
  secondary?(p: Pointer, e: MouseEvent): void;
  /** Shift + wheel (brush size, rotation). Return true when handled. */
  wheel?(dir: number): boolean;
  key?(e: KeyboardEvent): boolean;
  drawOverlay?(g: Graphics): void;
  panel(): HTMLElement | null;
}

const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
const round2 = (v: number) => Math.round(v * 100) / 100;
const clone = <T>(v: T): T => structuredClone(v);

/** Numeric input bound to a getter and setter. */
export function numberField(
  label: string,
  get: () => number,
  set: (v: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
): HTMLElement {
  const input = h('input', { type: 'number', value: String(get()) });
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.step = String(opts.step ?? 1);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) set(Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, v)));
    input.value = String(get());
  });
  return h('label', { class: 'ed-field' }, h('span', null, label), input);
}

export function selectField<T extends string>(
  label: string,
  values: readonly T[],
  get: () => T,
  set: (v: T) => void,
  names?: (v: T) => string,
): HTMLElement {
  const sel = h('select', { class: 'ed-select' });
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = names ? names(v) : v;
    sel.append(o);
  }
  sel.value = get();
  sel.addEventListener('change', () => set(sel.value as T));
  return h('label', { class: 'ed-field' }, h('span', null, label), sel);
}

export function checkField(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' });
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return h('label', { class: 'ed-check' }, input, label);
}

export function button(label: string, run: () => void, cls = 'btn small'): HTMLButtonElement {
  return h('button', { class: cls, on: { click: () => run() } }, label);
}

// =============================================================================================
// Select & move

type Drag =
  | {
      kind: 'move';
      x0: number;
      y0: number;
      originals: Map<string, { coll: Collection; el: Element }>;
      spawns: { x: number; y: number }[] | null;
      moved: boolean;
    }
  | { kind: 'point'; coll: 'roads' | 'fences'; id: string; index: number; original: Element }
  | { kind: 'zone'; id: string; corner: number; original: ZoneDef }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'interior'; building: string; prop: string; original: BuildingDef; x0: number; y0: number };

class SelectTool implements Tool {
  readonly id = 'select';
  readonly label = 'Select';
  readonly shortcut = 'KeyV';
  readonly hint =
    'Click to select, drag to move · Shift adds · R rotates · L locks · Del deletes · double-click a building to edit its interior';
  private drag: Drag | null = null;

  constructor(private readonly ed: Editor) {}

  private handleAt(p: Pointer): { coll: 'roads' | 'fences'; id: string; index: number } | null {
    if (this.ed.selection.length !== 1) return null;
    const s = this.ed.selection[0];
    if (s.coll !== 'roads' && s.coll !== 'fences') return null;
    const el = this.ed.find(s.coll, s.id) as RoadDef | FenceDef | undefined;
    if (!el) return null;
    const r = this.ed.px(9);
    const index = el.points.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < r);
    return index >= 0 ? { coll: s.coll, id: s.id, index } : null;
  }

  private zoneCorner(p: Pointer): { id: string; corner: number } | null {
    if (this.ed.selection.length !== 1 || this.ed.selection[0].coll !== 'zones') return null;
    const z = this.ed.find('zones', this.ed.selection[0].id) as ZoneDef | undefined;
    if (!z) return null;
    const [x, y, w, hh] = z.rect;
    const corners = [
      [x, y],
      [x + w, y],
      [x + w, y + hh],
      [x, y + hh],
    ];
    const r = this.ed.px(9);
    const corner = corners.findIndex(([cx, cy]) => Math.abs(cx - p.x) < r && Math.abs(cy - p.y) < r);
    return corner >= 0 ? { id: z.id, corner } : null;
  }

  pointerDown(p: Pointer, e: MouseEvent): void {
    const ed = this.ed;
    if (ed.interior) {
      const hit = ed.hitInterior(p.x, p.y);
      if (hit) {
        ed.selectedInteriorProp = hit.prop.id;
        this.drag = { kind: 'interior', building: hit.building.id, prop: hit.prop.id, original: clone(hit.building), x0: p.x, y0: p.y };
        ed.ui.refreshInspector();
        return;
      }
      const b = ed.find('buildings', ed.interior) as BuildingDef | undefined;
      if (b && isInsideBuilding(b, p.x, p.y)) {
        ed.selectedInteriorProp = null;
        ed.ui.refreshInspector();
        return;
      }
      ed.enterInterior(null);
    }
    const handle = this.handleAt(p);
    if (handle) {
      this.drag = { kind: 'point', ...handle, original: clone(ed.find(handle.coll, handle.id)!) };
      return;
    }
    const corner = this.zoneCorner(p);
    if (corner) {
      this.drag = { kind: 'zone', ...corner, original: clone(ed.find('zones', corner.id) as ZoneDef) };
      return;
    }
    // Alt-click on a selected road or fence inserts a point.
    if (e.altKey && ed.selection.length === 1 && (ed.selection[0].coll === 'roads' || ed.selection[0].coll === 'fences')) {
      const s = ed.selection[0] as { coll: 'roads' | 'fences'; id: string };
      const el = ed.find(s.coll, s.id) as RoadDef | FenceDef;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i + 1 < el.points.length; i++) {
        const d = distanceToPolyline(p.x, p.y, [el.points[i], el.points[i + 1]]);
        if (d < bestD) [best, bestD] = [i, d];
      }
      if (best >= 0 && bestD < 6) {
        const tx = ed.begin('Insert point');
        const next = clone(el);
        next.points.splice(best + 1, 0, [round2(p.x), round2(p.y)]);
        tx.set(s.coll, lockEdited(next));
        ed.commit(tx);
        return;
      }
    }
    const hit = ed.hitTest(p.x, p.y);
    if (hit) {
      const already = ed.selection.some((s) => s.coll === hit.coll && s.id === hit.id);
      if (e.shiftKey) {
        ed.select(already ? ed.selection.filter((s) => !(s.coll === hit.coll && s.id === hit.id)) : [...ed.selection, hit]);
        return;
      }
      if (!already) ed.select([hit]);
      const originals = new Map<string, { coll: Collection; el: Element }>();
      for (const s of ed.selection) {
        if (s.coll === 'spawns') continue;
        const el = ed.find(s.coll, s.id);
        if (el) originals.set(`${s.coll}:${s.id}`, { coll: s.coll, el: clone(el) });
      }
      const spawns = ed.selection.some((s) => s.coll === 'spawns') ? clone(ed.map.spawns) : null;
      this.drag = { kind: 'move', x0: p.x, y0: p.y, originals, spawns, moved: false };
      return;
    }
    if (!e.shiftKey) ed.select([]);
    this.drag = { kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  pointerMove(p: Pointer, e: MouseEvent): void {
    const d = this.drag;
    const ed = this.ed;
    if (!d) return;
    if (d.kind === 'box') {
      d.x1 = p.x;
      d.y1 = p.y;
      ed.redraw();
      return;
    }
    if (d.kind === 'move') {
      let dx = p.x - d.x0;
      let dy = p.y - d.y0;
      if (!e.altKey) {
        dx = snap(dx);
        dy = snap(dy);
      }
      if (!d.moved && Math.hypot(dx, dy) < 0.25) return;
      d.moved = true;
      const bounds = [];
      for (const { coll, el } of d.originals.values()) {
        const moved = translate(coll, el, dx, dy);
        replaceInMap(ed, coll, moved);
        const b0 = ed.boundsOf(coll, el);
        const b1 = ed.boundsOf(coll, moved);
        if (b0) bounds.push(b0);
        if (b1) bounds.push(b1);
      }
      if (d.spawns) {
        for (const s of ed.selection) {
          if (s.coll !== 'spawns') continue;
          const o = d.spawns[Number(s.id)];
          ed.map.spawns[Number(s.id)] = { x: round2(o.x + dx), y: round2(o.y + dy) };
        }
      }
      ed.refreshBounds(bounds);
      return;
    }
    if (d.kind === 'point') {
      const el = clone(d.original) as RoadDef | FenceDef;
      el.points[d.index] = [round2(e.altKey ? p.x : snap(p.x)), round2(e.altKey ? p.y : snap(p.y))];
      const before = ed.find(d.coll, d.id)!;
      replaceInMap(ed, d.coll, el);
      ed.refreshBounds([ed.boundsOf(d.coll, before)!, ed.boundsOf(d.coll, el)!]);
      return;
    }
    if (d.kind === 'zone') {
      const [x, y, w, hh] = d.original.rect;
      let x0 = x;
      let y0 = y;
      let x1 = x + w;
      let y1 = y + hh;
      if (d.corner === 0 || d.corner === 3) x0 = snap(p.x, 1);
      else x1 = snap(p.x, 1);
      if (d.corner === 0 || d.corner === 1) y0 = snap(p.y, 1);
      else y1 = snap(p.y, 1);
      const z = clone(d.original);
      z.rect = [Math.min(x0, x1), Math.min(y0, y1), Math.max(2, Math.abs(x1 - x0)), Math.max(2, Math.abs(y1 - y0))];
      replaceInMap(ed, 'zones', z);
      ed.redraw();
      return;
    }
    if (d.kind === 'interior') {
      const b = clone(d.original);
      const prop = b.props.find((pp) => pp.id === d.prop)!;
      const t = buildingTransform(b);
      const start = worldToLocal(t, d.x0, d.y0);
      const now = worldToLocal(t, p.x, p.y);
      const lx = prop.x + now.x - start.x;
      const ly = prop.y + now.y - start.y;
      prop.x = round2(e.altKey ? lx : snap(lx, 0.1));
      prop.y = round2(e.altKey ? ly : snap(ly, 0.1));
      replaceInMap(ed, 'buildings', b);
      ed.refreshBounds([buildingBounds(b)]);
    }
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    const ed = this.ed;
    if (!d) return;
    if (d.kind === 'box') {
      const r = normRect(d.x0, d.y0, d.x1, d.y1);
      if (r.w < 0.5 && r.h < 0.5) return;
      ed.select([...ed.selection, ...elementsIn(ed, r)]);
      return;
    }
    if (d.kind === 'move') {
      if (!d.moved) return;
      const tx = ed.begin(d.originals.size + (d.spawns ? 1 : 0) > 1 ? 'Move selection' : 'Move');
      for (const { coll, el } of d.originals.values()) {
        const now = lockEdited(clone(ed.find(coll, el.id)!));
        replaceInMap(ed, coll, now);
        tx.recordBefore(coll, el.id, el);
        tx.set(coll, now);
      }
      if (d.spawns) tx.entry.spawns = { before: d.spawns, after: clone(ed.map.spawns) };
      ed.pushApplied(tx);
      return;
    }
    if (d.kind === 'point' || d.kind === 'zone' || d.kind === 'interior') {
      const coll: Collection = d.kind === 'point' ? d.coll : d.kind === 'zone' ? 'zones' : 'buildings';
      const id = d.kind === 'point' ? d.id : d.kind === 'zone' ? d.id : d.building;
      const tx = ed.begin(d.kind === 'point' ? 'Move point' : d.kind === 'zone' ? 'Resize zone' : 'Move furniture');
      const now = lockEdited(clone(ed.find(coll, id)!));
      replaceInMap(ed, coll, now);
      tx.recordBefore(coll, id, d.original);
      tx.set(coll, now);
      ed.pushApplied(tx);
      ed.ui.refreshInspector();
    }
  }

  doubleClick(p: Pointer): void {
    const hit = this.ed.hitTest(p.x, p.y);
    if (hit?.coll === 'buildings') this.ed.enterInterior(hit.id);
  }

  secondary(p: Pointer): void {
    const handle = this.handleAt(p);
    if (!handle) return;
    const el = clone(this.ed.find(handle.coll, handle.id)!) as RoadDef | FenceDef;
    if (el.points.length <= 2) {
      this.ed.ui.toast('A road or fence needs at least two points.', 'warn');
      return;
    }
    el.points.splice(handle.index, 1);
    const tx = this.ed.begin('Delete point');
    tx.set(handle.coll, lockEdited(el));
    this.ed.commit(tx);
  }

  key(e: KeyboardEvent): boolean {
    const ed = this.ed;
    if (e.code === 'Delete' || e.code === 'Backspace') {
      deleteSelection(ed);
      return true;
    }
    if (e.code === 'KeyR') {
      rotateSelection(ed, ((e.shiftKey ? 90 : 15) * Math.PI) / 180);
      return true;
    }
    if (e.code === 'KeyL') {
      toggleLock(ed);
      return true;
    }
    if (e.code === 'KeyI' && ed.selection.length === 1 && ed.selection[0].coll === 'buildings') {
      ed.enterInterior(ed.selection[0].id);
      return true;
    }
    return false;
  }

  drawOverlay(g: Graphics): void {
    const d = this.drag;
    if (d?.kind !== 'box') return;
    const r = normRect(d.x0, d.y0, d.x1, d.y1);
    g.rect(r.x, r.y, r.w, r.h)
      .fill({ color: 0xffe070, alpha: 0.08 })
      .stroke({ color: 0xffe070, width: this.ed.px(1.5) });
  }

  panel(): HTMLElement {
    return h('div', { class: 'fine' }, this.hint);
  }
}

/** Editing a generated element claims it: it is locked so "Regenerate unlocked" keeps it (§44). */
export function lockEdited<T extends Element>(el: T): T {
  if (!el.manual) el.locked = true;
  return el;
}

function translate(coll: Collection, el: Element, dx: number, dy: number): Element {
  const out = clone(el);
  switch (coll) {
    case 'buildings':
    case 'props': {
      const o = out as BuildingDef | PropInstance;
      o.x = round2(o.x + dx);
      o.y = round2(o.y + dy);
      break;
    }
    case 'roads':
    case 'fences':
      (out as RoadDef | FenceDef).points = (out as RoadDef | FenceDef).points.map(([x, y]) => [round2(x + dx), round2(y + dy)]);
      break;
    case 'zones': {
      const z = out as ZoneDef;
      z.rect = [round2(z.rect[0] + dx), round2(z.rect[1] + dy), z.rect[2], z.rect[3]];
      break;
    }
  }
  return out;
}

/** Replaces an element in the working map in place (live previews during drags). */
export function replaceInMap(ed: Editor, coll: Collection, el: Element): void {
  const arr = ed.map[coll] as Element[];
  const i = arr.findIndex((e) => e.id === el.id);
  if (i >= 0) arr[i] = el;
  else arr.push(el);
}

function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function elementsIn(ed: Editor, r: Rect): SelectionItem[] {
  const out: SelectionItem[] = [];
  const inside = (x: number, y: number) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  const layer = (coll: Collection | 'spawns') => {
    const visible = coll === 'spawns' ? ed.layers.spawns : ed.layers[coll === 'zones' ? 'zones' : coll];
    return visible && !ed.lockedLayers.has(coll);
  };
  for (const c of ELEMENT_COLLECTIONS) {
    if (!layer(c)) continue;
    for (const el of ed.map[c] as Element[]) {
      const b = elementBox(c, el as never);
      if (inside((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)) out.push({ coll: c, id: el.id });
    }
  }
  if (layer('zones'))
    for (const z of ed.map.zones) if (inside(z.rect[0] + z.rect[2] / 2, z.rect[1] + z.rect[3] / 2)) out.push({ coll: 'zones', id: z.id });
  if (layer('spawns')) ed.map.spawns.forEach((s, i) => inside(s.x, s.y) && out.push({ coll: 'spawns', id: String(i) }));
  return out;
}

export function deleteSelection(ed: Editor): void {
  if (ed.interior && ed.selectedInteriorProp) {
    const b = clone(ed.find('buildings', ed.interior) as BuildingDef);
    b.props = b.props.filter((p) => p.id !== ed.selectedInteriorProp);
    const tx = ed.begin('Delete furniture');
    tx.set('buildings', lockEdited(b));
    ed.selectedInteriorProp = null;
    ed.commit(tx);
    return;
  }
  if (ed.selection.length === 0) return;
  const tx = ed.begin(ed.selection.length > 1 ? `Delete ${ed.selection.length} elements` : 'Delete');
  const spawnIdx = new Set<number>();
  for (const s of ed.selection) {
    if (s.coll === 'spawns') spawnIdx.add(Number(s.id));
    else tx.remove(s.coll, s.id);
  }
  if (spawnIdx.size > 0) tx.spawns(ed.map.spawns.filter((_, i) => !spawnIdx.has(i)));
  ed.selection = [];
  ed.commit(tx);
}

export function rotateSelection(ed: Editor, delta: number): void {
  if (ed.interior && ed.selectedInteriorProp) {
    const b = clone(ed.find('buildings', ed.interior) as BuildingDef);
    const p = b.props.find((pp) => pp.id === ed.selectedInteriorProp);
    if (!p) return;
    p.rot = Math.round((p.rot + delta) * 1000) / 1000;
    const tx = ed.begin('Rotate furniture');
    tx.set('buildings', lockEdited(b));
    ed.commit(tx);
    return;
  }
  const tx = ed.begin('Rotate');
  for (const s of ed.selection) {
    if (s.coll !== 'buildings' && s.coll !== 'props') continue;
    const el = clone(ed.find(s.coll, s.id) as BuildingDef | PropInstance);
    el.rot = Math.round(Math.atan2(Math.sin(el.rot + delta), Math.cos(el.rot + delta)) * 1000) / 1000;
    tx.set(s.coll, lockEdited(el));
  }
  ed.commit(tx);
}

export function toggleLock(ed: Editor, force?: boolean): void {
  const els = ed.selection
    .filter((s) => s.coll !== 'spawns')
    .map((s) => ({ coll: s.coll as Collection, el: ed.find(s.coll as Collection, s.id)! }));
  if (els.length === 0) return;
  const lock = force ?? !els.every((x) => x.el.locked);
  const tx = ed.begin(lock ? 'Lock' : 'Unlock');
  for (const { coll, el } of els) {
    const next = clone(el);
    if (lock) next.locked = true;
    else delete next.locked;
    tx.set(coll, next);
  }
  ed.commit(tx);
  ed.ui.toast(lock ? `Locked ${els.length} — regeneration will keep ${els.length === 1 ? 'it' : 'them'}.` : `Unlocked ${els.length}.`);
}

// =============================================================================================
// Terrain brush

class TerrainTool implements Tool {
  readonly id = 'terrain';
  readonly label = 'Terrain';
  readonly shortcut = 'KeyT';
  readonly hint = 'Paint ground materials · Shift+wheel brush size · Alt+click picks a material';
  material: TerrainMaterial = 'grass';
  radius = 3;
  lockPainted = true;
  private stroke: { before: Map<string, string | undefined>; last: { x: number; y: number } } | null = null;

  constructor(private readonly ed: Editor) {}

  pointerDown(p: Pointer, e: MouseEvent): void {
    if (e.altKey) {
      const m = this.ed.world.terrainAt(p.x, p.y);
      if (m >= 0) this.material = TERRAIN_MATERIALS[m];
      this.ed.ui.refreshToolPanel();
      return;
    }
    this.stroke = { before: new Map(), last: { x: p.x, y: p.y } };
    this.paint(p.x, p.y);
  }

  pointerMove(p: Pointer): void {
    if (!this.stroke) return;
    const { last } = this.stroke;
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    const steps = Math.max(1, Math.ceil(d / Math.max(0.5, this.radius / 2)));
    for (let i = 1; i <= steps; i++) this.paint(last.x + ((p.x - last.x) * i) / steps, last.y + ((p.y - last.y) * i) / steps);
    this.stroke.last = { x: p.x, y: p.y };
  }

  private paint(x: number, y: number): void {
    const ed = this.ed;
    const value = terrainIndex(this.material);
    const r = this.radius;
    let changed = false;
    for (let cy = Math.floor(y - r); cy <= Math.ceil(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.ceil(x + r); cx++) {
        if (cx < 0 || cy < 0 || cx >= ed.map.width || cy >= ed.map.height) continue;
        if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > r * r) continue;
        const key = chunkKey(Math.floor(cx / CHUNK_SIZE), Math.floor(cy / CHUNK_SIZE));
        const record = ed.world.chunks.get(key);
        if (!record) continue;
        const i = (cy - Math.floor(cy / CHUNK_SIZE) * CHUNK_SIZE) * CHUNK_SIZE + (cx - Math.floor(cx / CHUNK_SIZE) * CHUNK_SIZE);
        if (record.terrain[i] === value) continue;
        if (!this.stroke!.before.has(key)) this.stroke!.before.set(key, ed.map.terrain.chunks[key]);
        record.terrain[i] = value;
        changed = true;
      }
    }
    if (changed) ed.invalidateTerrain();
  }

  pointerUp(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.before.size === 0) return;
    const ed = this.ed;
    const tx = ed.begin(`Paint ${this.material.replace(/_/g, ' ')}`);
    for (const [key, before] of s.before) {
      const record = ed.world.chunks.get(key)!;
      const after = encodeTerrainChunk(record.terrain);
      tx.terrain(key, after, before);
      ed.map.terrain.chunks[key] = after;
    }
    if (this.lockPainted) {
      const locked = new Set(ed.map.terrainLocked ?? []);
      for (const key of s.before.keys()) locked.add(key);
      tx.terrainLocked([...locked]);
      ed.map.terrainLocked = [...locked];
    }
    ed.pushApplied(tx);
  }

  wheel(dir: number): boolean {
    this.radius = Math.max(0.5, Math.min(30, this.radius - dir * (this.radius < 4 ? 0.5 : 1)));
    this.ed.ui.refreshToolPanel();
    this.ed.redraw();
    return true;
  }

  drawOverlay(g: Graphics): void {
    const p = this.ed.pointer;
    g.circle(p.x, p.y, this.radius).stroke({ color: 0xffffff, width: this.ed.px(1.5), alpha: 0.8 });
  }

  panel(): HTMLElement {
    const swatches = h('div', { class: 'ed-swatches' });
    for (const m of TERRAIN_MATERIALS) {
      swatches.append(
        h(
          'button',
          {
            class: `ed-swatch${m === this.material ? ' active' : ''}`,
            title: m.replace(/_/g, ' '),
            on: {
              click: () => {
                this.material = m;
                this.ed.ui.refreshToolPanel();
              },
            },
          },
          m.replace(/_/g, ' '),
        ),
      );
    }
    return h(
      'div',
      null,
      swatches,
      numberField(
        'Brush radius (m)',
        () => this.radius,
        (v) => (this.radius = v),
        { min: 0.5, max: 30, step: 0.5 },
      ),
      checkField(
        'Lock painted chunks (regeneration keeps them)',
        () => this.lockPainted,
        (v) => (this.lockPainted = v),
      ),
      h('div', { class: 'fine' }, this.hint),
    );
  }
}

// =============================================================================================
// Biome brush

class BiomeTool implements Tool {
  readonly id = 'biome';
  readonly label = 'Biomes';
  readonly shortcut = 'KeyB';
  readonly hint = 'Paint biome regions (16 m cells). Generators use them to decide ground, streets, buildings and nature.';
  biome: Biome = 'suburb';
  radius = 2;
  private stroke: { before: string | undefined } | null = null;

  constructor(private readonly ed: Editor) {}

  activate(): void {
    this.ed.layers.biomes = true;
    this.ed.ui.refreshLayers();
  }

  pointerDown(p: Pointer, e: MouseEvent): void {
    if (e.altKey) {
      const { cols } = biomeGridSize(this.ed.map);
      this.biome = BIOMES[this.ed.biomeCells[Math.floor(p.y / BIOME_CELL) * cols + Math.floor(p.x / BIOME_CELL)]] ?? 'none';
      this.ed.ui.refreshToolPanel();
      return;
    }
    this.stroke = { before: this.ed.map.biomes?.data };
    this.paint(p.x, p.y);
  }

  pointerMove(p: Pointer): void {
    if (this.stroke) this.paint(p.x, p.y);
  }

  private paint(x: number, y: number): void {
    const ed = this.ed;
    const { cols, rows } = biomeGridSize(ed.map);
    const value = BIOMES.indexOf(this.biome);
    const cx = Math.floor(x / BIOME_CELL);
    const cy = Math.floor(y / BIOME_CELL);
    const r = this.radius - 1;
    let changed = false;
    for (let j = cy - r; j <= cy + r; j++) {
      for (let i = cx - r; i <= cx + r; i++) {
        if (i < 0 || j < 0 || i >= cols || j >= rows || (i - cx) ** 2 + (j - cy) ** 2 > r * r + r) continue;
        if (ed.biomeCells[j * cols + i] !== value) {
          ed.biomeCells[j * cols + i] = value;
          changed = true;
        }
      }
    }
    if (changed) ed.rebuildBiomeTexture();
  }

  pointerUp(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const ed = this.ed;
    const after = ed.encodeBiomeCells();
    if (after === s.before) return;
    const tx = ed.begin(`Paint ${BIOME_RULES[this.biome].label}`);
    tx.biomes(after, s.before);
    ed.map.biomes = { data: after };
    ed.pushApplied(tx);
  }

  wheel(dir: number): boolean {
    this.radius = Math.max(1, Math.min(12, this.radius - dir));
    this.ed.ui.refreshToolPanel();
    this.ed.redraw();
    return true;
  }

  drawOverlay(g: Graphics): void {
    const p = this.ed.pointer;
    const r = (this.radius - 0.5) * BIOME_CELL;
    const cx = (Math.floor(p.x / BIOME_CELL) + 0.5) * BIOME_CELL;
    const cy = (Math.floor(p.y / BIOME_CELL) + 0.5) * BIOME_CELL;
    g.circle(cx, cy, Math.max(BIOME_CELL / 2, r)).stroke({ color: 0xffffff, width: this.ed.px(1.5), alpha: 0.8 });
  }

  panel(): HTMLElement {
    const list = h('div', { class: 'ed-swatches' });
    for (const b of BIOMES) {
      const rules = BIOME_RULES[b];
      list.append(
        h(
          'button',
          {
            class: `ed-swatch${b === this.biome ? ' active' : ''}`,
            style: rules.color !== 'transparent' ? `border-left:6px solid ${rules.color}` : '',
            on: {
              click: () => {
                this.biome = b;
                this.ed.ui.refreshToolPanel();
              },
            },
          },
          rules.label,
        ),
      );
    }
    const r = BIOME_RULES[this.biome];
    return h(
      'div',
      null,
      list,
      numberField(
        'Brush radius (cells)',
        () => this.radius,
        (v) => (this.radius = v),
        { min: 1, max: 12 },
      ),
      h(
        'div',
        { class: 'fine' },
        this.biome === 'none'
          ? 'Erase biomes: generators leave unpainted areas alone.'
          : `${r.label}: trees every ${r.trees || '—'} m, ${r.block ? `streets every ${r.block} m` : 'no street grid'}, ~${r.zombiesPerHectare} zombies/ha.`,
      ),
      h('div', { class: 'fine' }, this.hint),
    );
  }
}

// =============================================================================================
// Roads and fences (polylines)

const ROAD_PRESETS: Record<RoadKind, { width: number; sidewalk: number; lanes: number; surface: RoadDef['surface']; markings: boolean }> = {
  highway: { width: 14, sidewalk: 0, lanes: 4, surface: 'asphalt', markings: true },
  main: { width: 9, sidewalk: 2.4, lanes: 2, surface: 'asphalt', markings: true },
  street: { width: 7, sidewalk: 1.8, lanes: 2, surface: 'asphalt', markings: false },
  country: { width: 7.5, sidewalk: 0, lanes: 2, surface: 'asphalt', markings: true },
  dirt: { width: 4, sidewalk: 0, lanes: 1, surface: 'dirt', markings: false },
  driveway: { width: 3.2, sidewalk: 0, lanes: 1, surface: 'concrete', markings: false },
};

abstract class PolylineTool implements Tool {
  abstract readonly id: ToolId;
  abstract readonly label: string;
  abstract readonly shortcut: string;
  abstract readonly hint: string;
  protected points: [number, number][] = [];

  constructor(protected readonly ed: Editor) {}

  protected abstract finish(points: [number, number][]): void;
  protected abstract previewWidth(): number;
  abstract panel(): HTMLElement;

  private point(p: Pointer, e: MouseEvent): [number, number] {
    let x = e.altKey ? p.x : snap(p.x);
    let y = e.altKey ? p.y : snap(p.y);
    // Shift: snap the new segment to 45° steps.
    const last = this.points[this.points.length - 1];
    if (last && e.shiftKey) {
      const a = Math.round(Math.atan2(y - last[1], x - last[0]) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(x - last[0], y - last[1]);
      x = last[0] + Math.cos(a) * d;
      y = last[1] + Math.sin(a) * d;
    }
    return [round2(x), round2(y)];
  }

  pointerDown(p: Pointer, e: MouseEvent): void {
    const pt = this.point(p, e);
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.4) return;
    this.points.push(pt);
    this.ed.redraw();
  }

  doubleClick(): void {
    this.complete();
  }

  secondary(): void {
    this.complete();
  }

  private complete(): void {
    if (this.points.length >= 2) this.finish(this.points);
    this.points = [];
    this.ed.redraw();
  }

  deactivate(): void {
    this.points = [];
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'Enter') {
      this.complete();
      return true;
    }
    if (e.code === 'Escape' && this.points.length > 0) {
      this.points = [];
      this.ed.redraw();
      return true;
    }
    if (e.code === 'Backspace' && this.points.length > 0) {
      this.points.pop();
      this.ed.redraw();
      return true;
    }
    return false;
  }

  drawOverlay(g: Graphics): void {
    const p = this.ed.pointer;
    const pts = [...this.points, [snap(p.x), snap(p.y)] as [number, number]];
    if (pts.length >= 2) {
      g.poly(pts.flat(), false).stroke({ color: 0x8ec06a, width: this.previewWidth(), alpha: 0.25 });
      g.poly(pts.flat(), false).stroke({ color: 0x8ec06a, width: this.ed.px(2) });
    }
    for (const [x, y] of this.points) g.circle(x, y, this.ed.px(5)).fill({ color: 0x8ec06a });
  }
}

class RoadTool extends PolylineTool {
  readonly id = 'road';
  readonly label = 'Roads';
  readonly shortcut = 'KeyO';
  readonly hint = 'Click to add points · double-click, right-click or Enter to finish · Backspace undoes a point · Shift snaps to 45°';
  kind: RoadKind = 'street';
  props = { ...ROAD_PRESETS.street };

  protected previewWidth(): number {
    return this.props.width + this.props.sidewalk * 2;
  }

  protected finish(points: [number, number][]): void {
    const road: RoadDef = { id: this.ed.newId('r_'), kind: this.kind, points: [...points], ...this.props, manual: true };
    const tx = this.ed.begin(`Draw ${this.kind} road`);
    tx.add('roads', road);
    this.ed.commit(tx);
    this.ed.select([{ coll: 'roads', id: road.id }]);
  }

  panel(): HTMLElement {
    return h(
      'div',
      null,
      selectField(
        'Kind',
        Object.keys(ROAD_PRESETS) as RoadKind[],
        () => this.kind,
        (v) => {
          this.kind = v;
          this.props = { ...ROAD_PRESETS[v] };
          this.ed.ui.refreshToolPanel();
        },
      ),
      numberField(
        'Width (m)',
        () => this.props.width,
        (v) => (this.props.width = v),
        { min: 1, max: 40, step: 0.5 },
      ),
      numberField(
        'Sidewalk (m)',
        () => this.props.sidewalk,
        (v) => (this.props.sidewalk = v),
        { min: 0, max: 6, step: 0.1 },
      ),
      numberField(
        'Lanes',
        () => this.props.lanes,
        (v) => (this.props.lanes = v),
        { min: 1, max: 6 },
      ),
      selectField(
        'Surface',
        ['asphalt', 'concrete', 'gravel', 'dirt'] as const,
        () => this.props.surface,
        (v) => (this.props.surface = v),
      ),
      checkField(
        'Lane markings',
        () => this.props.markings,
        (v) => (this.props.markings = v),
      ),
      h('div', { class: 'fine' }, this.hint),
    );
  }
}

class FenceTool extends PolylineTool {
  readonly id = 'fence';
  readonly label = 'Fences';
  readonly shortcut = 'KeyF';
  readonly hint = 'Click to add fence posts · double-click, right-click or Enter to finish';
  kind: FenceKind = 'wood';

  protected previewWidth(): number {
    return 0.2;
  }

  protected finish(points: [number, number][]): void {
    const fence: FenceDef = { id: this.ed.newId('f_'), kind: this.kind, points: [...points], manual: true };
    const tx = this.ed.begin('Draw fence');
    tx.add('fences', fence);
    this.ed.commit(tx);
  }

  panel(): HTMLElement {
    return h(
      'div',
      null,
      selectField(
        'Kind',
        ['wood', 'chainlink', 'picket'] as const,
        () => this.kind,
        (v) => (this.kind = v),
      ),
      h('div', { class: 'fine' }, this.hint),
    );
  }
}

// =============================================================================================
// Buildings

const BUILDING_KINDS = ['house', 'shed', 'cabin', 'grocery', 'gas_station', 'hardware', 'police'] as const;
type BuildingKind = (typeof BUILDING_KINDS)[number];

function buildingBuilder(kind: BuildingKind, id: string, seed: number): BuildingBuilder {
  const rng = new Rng(seed);
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

/** Paints concrete under a building's footprint in the affected terrain chunks. */
function paveUnder(ed: Editor, tx: ReturnType<Editor['begin']>, b: BuildingDef): void {
  const box = buildingBounds(b);
  const value = terrainIndex('concrete');
  const touched = new Map<string, Uint8Array>();
  for (let y = Math.floor(box.minY); y < Math.ceil(box.maxY); y++) {
    for (let x = Math.floor(box.minX); x < Math.ceil(box.maxX); x++) {
      if (x < 0 || y < 0 || x >= ed.map.width || y >= ed.map.height || !isInsideBuilding(b, x + 0.5, y + 0.5, 0.4)) continue;
      const key = chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
      let cells = touched.get(key);
      if (!cells) {
        const enc = ed.map.terrain.chunks[key];
        cells = enc ? decodeTerrainChunk(enc) : new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(ed.map.terrain.fill);
        touched.set(key, cells);
      }
      cells[(y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] = value;
    }
  }
  for (const [key, cells] of touched) tx.terrain(key, encodeTerrainChunk(cells));
}

class BuildingTool implements Tool {
  readonly id = 'building';
  readonly label = 'Buildings';
  readonly shortcut = 'KeyU';
  readonly hint = 'Click to place a generated building · R or Shift+wheel rotates · N rolls a new layout';
  kind: BuildingKind = 'house';
  seed = (Math.random() * 2 ** 31) >>> 0;
  rot = 0;
  pave = true;
  private preview: BuildingBuilder | null = null;

  constructor(private readonly ed: Editor) {}

  private builder(): BuildingBuilder {
    this.preview ??= buildingBuilder(this.kind, 'preview', this.seed);
    return this.preview;
  }

  private reroll(): void {
    this.seed = (Math.random() * 2 ** 31) >>> 0;
    this.preview = null;
    this.ed.redraw();
  }

  pointerDown(p: Pointer): void {
    const id = this.ed.newId('b_');
    const def = buildingBuilder(this.kind, id, this.seed).finish(snap(p.x), snap(p.y), this.rot);
    def.manual = true;
    const tx = this.ed.begin(`Place ${this.kind.replace('_', ' ')}`);
    tx.add('buildings', def);
    if (this.pave) paveUnder(this.ed, tx, def);
    this.ed.commit(tx);
    this.reroll();
  }

  wheel(dir: number): boolean {
    this.rot = Math.round((this.rot + (dir * Math.PI) / 2) * 1000) / 1000;
    this.ed.redraw();
    return true;
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'KeyR') return this.wheel(e.shiftKey ? -1 : 1);
    if (e.code === 'KeyN') {
      this.reroll();
      return true;
    }
    return false;
  }

  drawOverlay(g: Graphics): void {
    const b = this.builder();
    const p = this.ed.pointer;
    const def: BuildingDef = { ...b.def, x: snap(p.x), y: snap(p.y), rot: this.rot };
    const t = buildingTransform(def);
    const corners = [
      [0, 0],
      [def.w, 0],
      [def.w, def.h],
      [0, def.h],
    ].map(([x, y]) => localToWorld(t, x, y));
    g.poly(corners.flatMap((c) => [c.x, c.y]))
      .fill({ color: 0x8ec06a, alpha: 0.2 })
      .stroke({ color: 0x8ec06a, width: this.ed.px(2) });
    for (const r of def.rooms) {
      const rc = [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h],
        [r.x, r.y + r.h],
      ].map(([x, y]) => localToWorld(t, x, y));
      g.poly(rc.flatMap((c) => [c.x, c.y])).stroke({ color: 0x8ec06a, width: this.ed.px(1), alpha: 0.5 });
    }
    // Front (street side).
    const f0 = localToWorld(t, def.w / 2, def.h);
    const f1 = localToWorld(t, def.w / 2, def.h + 3);
    g.moveTo(f0.x, f0.y)
      .lineTo(f1.x, f1.y)
      .stroke({ color: 0xffe070, width: this.ed.px(2) });
  }

  panel(): HTMLElement {
    const b = this.builder();
    return h(
      'div',
      null,
      selectField(
        'Type',
        BUILDING_KINDS,
        () => this.kind,
        (v) => {
          this.kind = v;
          this.preview = null;
          this.ed.ui.refreshToolPanel();
        },
      ),
      h(
        'div',
        { class: 'fine' },
        `${b.w.toFixed(1)} × ${b.h.toFixed(1)} m, ${b.def.rooms.length} rooms, ${b.def.props.length} furnishings`,
      ),
      h(
        'div',
        { class: 'row' },
        button('New layout (N)', () => {
          this.reroll();
          this.ed.ui.refreshToolPanel();
        }),
      ),
      checkField(
        'Pave the footprint',
        () => this.pave,
        (v) => (this.pave = v),
      ),
      h('div', { class: 'fine' }, this.hint),
    );
  }
}

// =============================================================================================
// Props

class PropTool implements Tool {
  readonly id = 'prop';
  readonly label = 'Props';
  readonly shortcut = 'KeyP';
  readonly hint = 'Click to place · inside a building it becomes furniture · R or Shift+wheel rotates';
  type = 'tree_oak';
  rot = 0;
  randomRotation = false;
  private filter = '';

  constructor(private readonly ed: Editor) {}

  pointerDown(p: Pointer, e: MouseEvent): void {
    const ed = this.ed;
    const x = e.altKey ? round2(p.x) : snap(p.x, 0.1);
    const y = e.altKey ? round2(p.y) : snap(p.y, 0.1);
    const rot = this.randomRotation ? Math.round(Math.random() * 6283) / 1000 : this.rot;
    const building =
      (ed.interior ? (ed.find('buildings', ed.interior) as BuildingDef) : undefined) ??
      ed.map.buildings.find((b) => isInsideBuilding(b, x, y, -0.1));
    const tx = ed.begin(`Place ${this.type.replace(/_/g, ' ')}`);
    if (building && isInsideBuilding(building, x, y, -0.05)) {
      const b = clone(building);
      const l = worldToLocal(buildingTransform(b), x, y);
      b.props.push({
        id: `${b.id}.${ed.newId('p')}`,
        type: this.type,
        x: round2(l.x),
        y: round2(l.y),
        rot: Math.round((rot - b.rot) * 1000) / 1000,
      });
      tx.set('buildings', lockEdited(b));
    } else {
      tx.add('props', { id: ed.newId('p_'), type: this.type, x, y, rot, variant: Math.floor(Math.random() * 999), manual: true });
    }
    ed.commit(tx);
  }

  wheel(dir: number): boolean {
    this.rot = Math.round((this.rot + (dir * Math.PI) / 12) * 1000) / 1000;
    this.ed.redraw();
    return true;
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'KeyR') return this.wheel(e.shiftKey ? -1 : 1);
    return false;
  }

  drawOverlay(g: Graphics): void {
    const def = this.ed.content.findProp(this.type);
    const p = this.ed.pointer;
    const color = 0x8ec06a;
    if (!def || def.shape !== 'box') {
      g.circle(p.x, p.y, Math.max(def?.r ?? 0.4, this.ed.px(5))).stroke({ color, width: this.ed.px(2) });
      return;
    }
    const hw = (def.w ?? 1) / 2;
    const hh = (def.h ?? 1) / 2;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const pts = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].flatMap(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]);
    g.poly(pts)
      .fill({ color, alpha: 0.2 })
      .stroke({ color, width: this.ed.px(2) });
  }

  panel(): HTMLElement {
    const list = h('div', { class: 'ed-list' });
    const search = h('input', { type: 'search', placeholder: 'Find a prop…', value: this.filter, class: 'search' });
    const render = () => {
      clear(list);
      for (const def of this.ed.content.props) {
        if (this.filter && !`${def.id} ${def.name}`.toLowerCase().includes(this.filter)) continue;
        list.append(
          h(
            'button',
            {
              class: `ed-list-item${def.id === this.type ? ' active' : ''}`,
              on: {
                click: () => {
                  this.type = def.id;
                  render();
                  this.ed.redraw();
                },
              },
            },
            def.name,
            h(
              'span',
              { class: 'fine' },
              ` ${def.container ? '· storage' : ''}${def.movable ? ' · movable' : ''}${def.sleep ? ' · bed' : ''}`,
            ),
          ),
        );
      }
    };
    search.addEventListener('input', () => {
      this.filter = search.value.trim().toLowerCase();
      render();
    });
    render();
    return h(
      'div',
      null,
      search,
      list,
      checkField(
        'Random rotation',
        () => this.randomRotation,
        (v) => (this.randomRotation = v),
      ),
      h('div', { class: 'fine' }, this.hint),
    );
  }
}

// =============================================================================================
// Zones and spawns

const BIOME_ZONE: Record<Biome, ZoneKind> = {
  none: 'residential',
  city: 'downtown',
  suburb: 'residential',
  town: 'residential',
  forest: 'forest',
  plains: 'rural',
  farmland: 'rural',
  industrial: 'industrial',
  wilderness: 'forest',
};

class ZoneTool implements Tool {
  readonly id = 'zone';
  readonly label = 'Zones';
  readonly shortcut = 'KeyZ';
  readonly hint = 'Drag a rectangle to add a zombie zone; the biome under it suggests kind and population';
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private readonly ed: Editor) {}

  activate(): void {
    this.ed.layers.zones = true;
    this.ed.ui.refreshLayers();
  }

  pointerDown(p: Pointer): void {
    this.drag = { x0: snap(p.x, 1), y0: snap(p.y, 1), x1: snap(p.x, 1), y1: snap(p.y, 1) };
  }

  pointerMove(p: Pointer): void {
    if (!this.drag) return;
    this.drag.x1 = snap(p.x, 1);
    this.drag.y1 = snap(p.y, 1);
    this.ed.redraw();
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const r = normRect(d.x0, d.y0, d.x1, d.y1);
    if (r.w < 8 || r.h < 8) return;
    const ed = this.ed;
    const { cols } = biomeGridSize(ed.map);
    const biome =
      BIOMES[ed.biomeCells[Math.floor((r.y + r.h / 2) / BIOME_CELL) * cols + Math.floor((r.x + r.w / 2) / BIOME_CELL)]] ?? 'none';
    const zone: ZoneDef = {
      id: ed.newId('z_'),
      name: `${BIOME_RULES[biome].label === 'None' ? 'New' : BIOME_RULES[biome].label} zone`,
      kind: BIOME_ZONE[biome],
      rect: [r.x, r.y, r.w, r.h],
      zombies: Math.round(((r.w * r.h) / 10000) * (BIOME_RULES[biome].zombiesPerHectare || 2)),
      manual: true,
    };
    const tx = ed.begin('Add zone');
    tx.add('zones', zone);
    ed.commit(tx);
    ed.select([{ coll: 'zones', id: zone.id }]);
  }

  drawOverlay(g: Graphics): void {
    if (!this.drag) return;
    const r = normRect(this.drag.x0, this.drag.y0, this.drag.x1, this.drag.y1);
    g.rect(r.x, r.y, r.w, r.h)
      .fill({ color: 0xd07070, alpha: 0.12 })
      .stroke({ color: 0xd07070, width: this.ed.px(2) });
  }

  panel(): HTMLElement {
    return h('div', { class: 'fine' }, this.hint, h('br'), 'Select a zone with the select tool to rename it or change its population.');
  }
}

class SpawnTool implements Tool {
  readonly id = 'spawn';
  readonly label = 'Spawns';
  readonly shortcut = 'KeyN';
  readonly hint = 'Click to add a spawn point; click an existing one to remove it';

  constructor(private readonly ed: Editor) {}

  activate(): void {
    this.ed.layers.spawns = true;
    this.ed.ui.refreshLayers();
  }

  pointerDown(p: Pointer): void {
    const ed = this.ed;
    const i = ed.map.spawns.findIndex((s) => Math.hypot(s.x - p.x, s.y - p.y) < Math.max(1.5, ed.px(12)));
    const tx = ed.begin(i >= 0 ? 'Remove spawn' : 'Add spawn');
    if (i >= 0) tx.spawns(ed.map.spawns.filter((_, j) => j !== i));
    else tx.spawns([...ed.map.spawns, { x: round2(p.x), y: round2(p.y) }]);
    ed.commit(tx);
  }

  panel(): HTMLElement {
    return h('div', { class: 'fine' }, this.hint, h('br'), `${this.ed.map.spawns.length} spawn point(s). Players start at a random one.`);
  }
}

// =============================================================================================
// Area: generation, regeneration, locking and scattering (§44–47)

class AreaTool implements Tool {
  readonly id = 'area';
  readonly label = 'Generate';
  readonly shortcut = 'KeyX';
  readonly hint = 'Drag to select an area (or work on the whole map), then generate, regenerate, clear, scatter or lock';
  area: Rect | null = null;
  layers: LayerSelection = { terrain: true, roads: true, parcels: true, nature: true };
  seed = (Math.random() * 2 ** 31) >>> 0;
  block = 0;
  scatterTypes = new Set<string>(['tree_oak', 'tree_birch']);
  scatterSpacing = 6;
  scatterRotate = true;
  scatterTerrain = new Set<TerrainMaterial>();
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private readonly ed: Editor) {}

  private get target(): Rect {
    return this.area ?? { x: 0, y: 0, w: this.ed.map.width, h: this.ed.map.height };
  }

  pointerDown(p: Pointer): void {
    this.drag = { x0: snap(p.x, 1), y0: snap(p.y, 1), x1: snap(p.x, 1), y1: snap(p.y, 1) };
  }

  pointerMove(p: Pointer): void {
    if (!this.drag) return;
    this.drag.x1 = snap(p.x, 1);
    this.drag.y1 = snap(p.y, 1);
    this.ed.redraw();
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const r = normRect(d.x0, d.y0, d.x1, d.y1);
    this.area = r.w < 4 || r.h < 4 ? null : r;
    this.ed.ui.refreshToolPanel();
    this.ed.redraw();
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' && this.area) {
      this.area = null;
      this.ed.ui.refreshToolPanel();
      this.ed.redraw();
      return true;
    }
    return false;
  }

  drawOverlay(g: Graphics): void {
    const r = this.drag ? normRect(this.drag.x0, this.drag.y0, this.drag.x1, this.drag.y1) : this.area;
    if (!r) return;
    g.rect(r.x, r.y, r.w, r.h)
      .fill({ color: 0x70a0d8, alpha: 0.1 })
      .stroke({ color: 0x70a0d8, width: this.ed.px(2) });
  }

  /** Applies a generator result as one undoable step. */
  apply(label: string, edit: MapEdit): void {
    const ed = this.ed;
    const tx = ed.begin(label);
    for (const c of ELEMENT_COLLECTIONS) {
      tx.removeMany(c, edit.remove[c]);
      tx.addMany(c, edit.add[c] as Element[]);
    }
    for (const [key, enc] of Object.entries(edit.terrain)) tx.terrain(key, enc);
    const added = ELEMENT_COLLECTIONS.reduce((n, c) => n + edit.add[c].length, 0);
    const removed = ELEMENT_COLLECTIONS.reduce((n, c) => n + edit.remove[c].length, 0);
    if (tx.empty) {
      ed.ui.toast('Nothing changed. Paint biomes first — generators only work where a biome is set.', 'warn');
      return;
    }
    ed.select([]);
    ed.commit(tx);
    ed.ui.toast(`${label}: +${added} / −${removed} elements, ${Object.keys(edit.terrain).length} terrain chunks.`);
  }

  private run(label: string, replace: boolean): void {
    const started = performance.now();
    const edit = generateArea(this.ed.map, {
      seed: this.seed,
      area: this.target,
      layers: this.layers,
      replace,
      blockSize: this.block || undefined,
    });
    this.apply(`${label} (${Math.round(performance.now() - started)} ms)`, edit);
    this.seed = (Math.random() * 2 ** 31) >>> 0;
    this.ed.ui.refreshToolPanel();
  }

  private lockAll(lock: boolean): void {
    const ed = this.ed;
    const r = this.target;
    const tx = ed.begin(lock ? 'Lock area' : 'Unlock area');
    let n = 0;
    for (const c of ELEMENT_COLLECTIONS) {
      for (const el of ed.map[c] as Element[]) {
        const b = elementBox(c, el as never);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        if (cx < r.x || cy < r.y || cx > r.x + r.w || cy > r.y + r.h || !!el.locked === lock) continue;
        const next = clone(el);
        if (lock) next.locked = true;
        else delete next.locked;
        tx.set(c, next);
        n++;
      }
    }
    ed.commit(tx);
    ed.ui.toast(`${lock ? 'Locked' : 'Unlocked'} ${n} elements.`);
  }

  private lockTerrain(lock: boolean): void {
    const ed = this.ed;
    const r = this.target;
    const locked = new Set(ed.map.terrainLocked ?? []);
    for (let cy = Math.floor(r.y / CHUNK_SIZE); cy <= Math.floor((r.y + r.h - 0.01) / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(r.x / CHUNK_SIZE); cx <= Math.floor((r.x + r.w - 0.01) / CHUNK_SIZE); cx++) {
        if (lock) locked.add(chunkKey(cx, cy));
        else locked.delete(chunkKey(cx, cy));
      }
    }
    const tx = ed.begin(lock ? 'Lock terrain' : 'Unlock terrain');
    tx.terrainLocked([...locked]);
    ed.commit(tx);
    ed.layers.grid = true;
    ed.ui.refreshLayers();
  }

  panel(): HTMLElement {
    const r = this.target;
    const where = this.area
      ? `Area ${Math.round(r.w)} × ${Math.round(r.h)} m at ${Math.round(r.x)}, ${Math.round(r.y)}`
      : 'Whole map (drag to select an area)';
    const scatterList = h('div', { class: 'ed-list short' });
    for (const def of this.ed.content.props) {
      if (def.layer === 'tall' && def.container) continue;
      const input = h('input', { type: 'checkbox' });
      input.checked = this.scatterTypes.has(def.id);
      input.addEventListener('change', () => (input.checked ? this.scatterTypes.add(def.id) : this.scatterTypes.delete(def.id)));
      scatterList.append(h('label', { class: 'ed-check' }, input, def.name));
    }
    const terrainList = h('div', { class: 'ed-list short' });
    for (const m of TERRAIN_MATERIALS) {
      const input = h('input', { type: 'checkbox' });
      input.checked = this.scatterTerrain.has(m);
      input.addEventListener('change', () => (input.checked ? this.scatterTerrain.add(m) : this.scatterTerrain.delete(m)));
      terrainList.append(h('label', { class: 'ed-check' }, input, m.replace(/_/g, ' ')));
    }
    return h(
      'div',
      null,
      h('div', { class: 'ed-area-target' }, where),
      h('div', { class: 'section-title' }, h('span', null, 'Layers')),
      checkField(
        'Terrain (ground by biome)',
        () => this.layers.terrain,
        (v) => (this.layers.terrain = v),
      ),
      checkField(
        'Roads (street grid in urban biomes)',
        () => this.layers.roads,
        (v) => (this.layers.roads = v),
      ),
      checkField(
        'Parcels (buildings along roads)',
        () => this.layers.parcels,
        (v) => (this.layers.parcels = v),
      ),
      checkField(
        'Nature (trees, bushes, grass)',
        () => this.layers.nature,
        (v) => (this.layers.nature = v),
      ),
      numberField(
        'Seed',
        () => this.seed,
        (v) => (this.seed = Math.floor(v) >>> 0),
        { min: 0 },
      ),
      numberField(
        'Street spacing (m, 0 = biome)',
        () => this.block,
        (v) => (this.block = v),
        { min: 0, max: 400, step: 5 },
      ),
      h(
        'div',
        { class: 'ed-buttons' },
        button('Generate', () => this.run('Generate', false), 'btn small primary'),
        button('Regenerate unlocked', () => this.run('Regenerate unlocked', true), 'btn small'),
        button('Clear unlocked', () => this.apply('Clear', clearArea(this.ed.map, r, this.layers)), 'btn small danger'),
        button('Smooth terrain', () => this.apply('Smooth terrain', smoothTerrain(this.ed.map, r))),
      ),
      h(
        'div',
        { class: 'fine' },
        'Regenerate replaces generated content that is not locked, on painted biomes only. Anything you place or edit by hand is kept.',
      ),
      h('div', { class: 'section-title' }, h('span', null, 'Locking')),
      h(
        'div',
        { class: 'ed-buttons' },
        button('Lock everything here', () => this.lockAll(true)),
        button('Unlock everything here', () => this.lockAll(false)),
        button('Lock terrain', () => this.lockTerrain(true)),
        button('Unlock terrain', () => this.lockTerrain(false)),
      ),
      h('div', { class: 'section-title' }, h('span', null, 'Scatter props')),
      scatterList,
      numberField(
        'Spacing (m)',
        () => this.scatterSpacing,
        (v) => (this.scatterSpacing = v),
        { min: 0.5, max: 100, step: 0.5 },
      ),
      checkField(
        'Random rotation',
        () => this.scatterRotate,
        (v) => (this.scatterRotate = v),
      ),
      h('div', { class: 'fine' }, 'Only on (none checked = anywhere):'),
      terrainList,
      h(
        'div',
        { class: 'ed-buttons' },
        button('Scatter', () =>
          this.apply(
            'Scatter',
            scatterArea(this.ed.map, {
              seed: (Math.random() * 2 ** 31) >>> 0,
              area: r,
              types: [...this.scatterTypes],
              spacing: this.scatterSpacing,
              rotate: this.scatterRotate,
              terrain: [...this.scatterTerrain],
            }),
          ),
        ),
      ),
    );
  }
}

export function createTools(ed: Editor): Record<ToolId, Tool> {
  return {
    select: new SelectTool(ed),
    terrain: new TerrainTool(ed),
    biome: new BiomeTool(ed),
    road: new RoadTool(ed),
    fence: new FenceTool(ed),
    building: new BuildingTool(ed),
    prop: new PropTool(ed),
    zone: new ZoneTool(ed),
    spawn: new SpawnTool(ed),
    area: new AreaTool(ed),
  };
}

export { AreaTool };
