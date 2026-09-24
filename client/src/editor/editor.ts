// The browser map editor (design plan §38–49). It renders the map being edited through the game's
// own world model and renderers — terrain shader, roads, buildings with interiors, props, fences —
// so what you see is exactly what players will see, and adds editing tools on top.

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  BIOME_CELL,
  BIOMES,
  biomeGridSize,
  buildingBounds,
  buildingPolygon,
  buildingTransform,
  CHUNK_SIZE,
  chunkKeysIn,
  decodeBiomes,
  distanceToPolyline,
  encodeBiomes,
  fenceIndexBounds,
  isInsideBuilding,
  localToWorld,
  MapChunkIndex,
  propIndexBounds,
  roadBounds,
  TERRAIN_MATERIALS,
  BIOME_RULES,
  type Bounds,
  type BuildingDef,
  type ContentRegistry,
  type FenceDef,
  type MapData,
  type PropInstance,
  type RoadDef,
  type ZoneDef,
} from '@tuff/shared';
import { Camera } from '../camera/camera';
import { ClientWorld } from '../game/world';
import { BuildingRenderer } from '../rendering/buildings';
import { FenceRenderer } from '../rendering/fences';
import { PropRenderer } from '../rendering/props';
import type { GameRenderer } from '../rendering/renderer';
import { RoadRenderer } from '../rendering/roads';
import { TerrainRenderer } from '../rendering/terrain';
import { materialTexture } from '../rendering/textures';
import type { EditorApi } from './api';
import { applyEntry, History, Transaction, type Collection, type Element, type ElementChange, type HistoryEntry } from './history';
import { createTools, type Tool, type ToolId } from './tools';
import { EditorUi } from './ui';

export type LayerId = 'terrain' | 'roads' | 'buildings' | 'roofs' | 'props' | 'fences' | 'zones' | 'spawns' | 'biomes' | 'locks' | 'grid';
export type EditableLayer = 'roads' | 'buildings' | 'props' | 'fences' | 'zones' | 'spawns';

export interface SelectionItem {
  coll: Collection | 'spawns';
  id: string;
}

/** A prop inside a building (interior editing). */
export interface InteriorProp {
  building: BuildingDef;
  prop: PropInstance;
}

const ZONE_COLORS: Record<string, number> = {
  residential: 0xd8b060,
  commercial: 0x70a0d8,
  forest: 0x60b060,
  rural: 0xb89060,
  industrial: 0x9090a0,
  downtown: 0xd07070,
};

export class Editor {
  map: MapData;
  readonly camera = new Camera();
  world!: ClientWorld;
  private index!: MapChunkIndex;
  private terrain!: TerrainRenderer;
  private roads!: RoadRenderer;
  private fences!: FenceRenderer;
  private buildings!: BuildingRenderer;
  private props!: PropRenderer;
  private readonly worldRoot = new Container();
  readonly history = new History();
  readonly tools: Record<ToolId, Tool>;
  tool: Tool;
  readonly ui: EditorUi;
  selection: SelectionItem[] = [];
  /** Building whose furniture is being edited (double-click a building). */
  interior: string | null = null;
  selectedInteriorProp: string | null = null;
  readonly layers: Record<LayerId, boolean> = {
    terrain: true,
    roads: true,
    buildings: true,
    roofs: false,
    props: true,
    fences: true,
    zones: true,
    spawns: true,
    biomes: false,
    locks: true,
    grid: false,
  };
  /** Layers that cannot be selected or edited. */
  readonly lockedLayers = new Set<EditableLayer>();
  biomeCells: Uint8Array;
  private biomeCanvas: HTMLCanvasElement;
  private biomeTexture: Texture;
  private readonly biomeSprite: Sprite;
  private readonly overlay = new Graphics();
  private readonly labels = new Container();
  private labelPool: Text[] = [];
  private overlayDirty = true;
  private lastCameraKey = '';
  readonly pointer = { sx: 0, sy: 0, x: 0, y: 0, inside: false };
  private panning: { sx: number; sy: number; x: number; y: number } | null = null;
  private readonly keys = new Set<string>();
  private lastFrame = performance.now();
  private statusTimer = 0;
  private readonly cleanup: (() => void)[] = [];
  private idCounter = 0;

  constructor(
    readonly renderer: GameRenderer,
    uiRoot: HTMLElement,
    readonly api: EditorApi,
    readonly content: ContentRegistry,
    map: MapData,
  ) {
    this.map = map;
    this.biomeCells = decodeBiomes(map);
    this.biomeCanvas = document.createElement('canvas');
    this.biomeTexture = Texture.from(this.biomeCanvas);
    this.biomeSprite = new Sprite(this.biomeTexture);
    this.biomeSprite.alpha = 0.38;
    renderer.lighting.sprite.visible = false;
    renderer.drawCrosshair(0, 0, 0, 'hidden');
    renderer.layers.top.addChild(this.biomeSprite, this.overlay, this.labels);
    this.camera.minZoom = 0.04;
    this.camera.maxZoom = 4;
    this.camera.zoom = this.camera.targetZoom = 0.35;
    this.tools = createTools(this);
    this.tool = this.tools.select;
    this.ui = new EditorUi(uiRoot, this);
    this.buildWorld();
    this.rebuildBiomeTexture();
    const s = map.spawns[0] ?? { x: map.width / 2, y: map.height / 2 };
    const params = new URLSearchParams(location.search);
    const px = Number(params.get('x'));
    const py = Number(params.get('y'));
    this.camera.snapTo(Number.isFinite(px) && px > 0 ? px : s.x, Number.isFinite(py) && py > 0 ? py : s.y);
    this.bindInput();
    renderer.app.ticker.add(this.frame);
    this.ui.refreshAll();
    window.addEventListener('beforeunload', this.guardUnload);
  }

  // =============================================================================================
  // World

  private buildWorld(): void {
    const layers = this.renderer.layers;
    for (const c of Object.values(layers)) c.removeChildren();
    layers.top.addChild(this.biomeSprite, this.overlay, this.labels);
    this.world = new ClientWorld(this.content, this.map.width, this.map.height);
    const windowChunks = Math.min(24, Math.max(7, Math.ceil(Math.max(this.map.width, this.map.height) / CHUNK_SIZE) + 2));
    this.terrain = new TerrainRenderer(layers.terrain, this.world, windowChunks);
    this.roads = new RoadRenderer(layers.roads, {
      asphalt: materialTexture('asphalt'),
      sidewalk: materialTexture('sidewalk'),
      concrete: materialTexture('concrete'),
      gravel: materialTexture('gravel'),
    });
    this.fences = new FenceRenderer(layers.low);
    this.buildings = new BuildingRenderer(
      { floors: layers.floors, low: layers.low, walls: layers.walls, tall: layers.tall, roofs: layers.roofs },
      this.content,
      this.world.compiled,
    );
    this.props = new PropRenderer({ ground: layers.ground, low: layers.low, tall: layers.tall, canopy: layers.canopy }, this.content);
    this.world.listen({
      elementAdded: (kind, def) => {
        if (kind === 'building') this.buildings.add(def as BuildingDef);
        else if (kind === 'prop') this.props.add(def as PropInstance);
        else if (kind === 'road') this.roads.add(def as RoadDef);
        else if (kind === 'fence') this.fences.add(def as FenceDef);
      },
      elementRemoved: (kind, id) => {
        if (kind === 'building') this.buildings.remove(id);
        else if (kind === 'prop') this.props.remove(id);
        else if (kind === 'road') this.roads.remove(id);
        else if (kind === 'fence') this.fences.remove(id);
      },
      terrainChanged: () => this.terrain.invalidate(),
      objectChanged: () => undefined,
    });
    this.index = new MapChunkIndex(this.map, this.content);
    for (let cy = 0; cy < this.index.chunksY; cy++)
      for (let cx = 0; cx < this.index.chunksX; cx++) this.world.addChunk(this.index.payload(cx, cy));
    const maxWindow = windowChunks * CHUNK_SIZE * 0.92;
    this.camera.minZoom = Math.max(0.03, Math.max(window.innerWidth, window.innerHeight) / (48 * maxWindow));
    this.overlayDirty = true;
  }

  /** Replaces the whole map (opening another map, templates, regenerating everything). */
  loadMap(map: MapData, keepHistory = false): void {
    this.map = map;
    this.biomeCells = decodeBiomes(map);
    this.selection = [];
    this.interior = null;
    this.selectedInteriorProp = null;
    if (!keepHistory) {
      (this as { history: History }).history = new History();
    }
    this.buildWorld();
    this.rebuildBiomeTexture();
    this.ui.refreshAll();
  }

  /** Re-streams the chunks touched by these bounds into the world. */
  refreshBounds(bounds: Bounds[], terrainKeys: string[] = []): void {
    const keys = new Set<string>(terrainKeys);
    for (const b of bounds) for (const k of chunkKeysIn(this.map, b)) keys.add(k);
    if (keys.size === 0) return;
    this.index = new MapChunkIndex(this.map, this.content);
    if (keys.size > this.index.chunksX * this.index.chunksY * 0.6) {
      for (const k of [...this.world.chunks.keys()]) this.world.removeChunk(k);
      for (let cy = 0; cy < this.index.chunksY; cy++)
        for (let cx = 0; cx < this.index.chunksX; cx++) this.world.addChunk(this.index.payload(cx, cy));
    } else {
      for (const k of keys) this.world.removeChunk(k);
      for (const k of keys) {
        const [cx, cy] = k.split(',').map(Number);
        this.world.addChunk(this.index.payload(cx, cy));
      }
    }
    this.overlayDirty = true;
  }

  boundsOf(coll: Collection, el: Element): Bounds | null {
    switch (coll) {
      case 'roads':
        return roadBounds(el as RoadDef);
      case 'buildings':
        return buildingBounds(el as BuildingDef);
      case 'props':
        return propIndexBounds(this.content, el as PropInstance);
      case 'fences':
        return fenceIndexBounds(el as FenceDef);
      default:
        return null;
    }
  }

  private refreshFromChanges(changes: ElementChange[], entry: HistoryEntry): void {
    const bounds: Bounds[] = [];
    for (const c of changes) {
      for (const el of [c.before, c.after]) {
        if (!el) continue;
        const b = this.boundsOf(c.coll, el);
        if (b) bounds.push(b);
      }
    }
    this.refreshBounds(
      bounds,
      entry.terrain.map((t) => t.key),
    );
    if (entry.biomes) {
      this.biomeCells = decodeBiomes(this.map);
      this.rebuildBiomeTexture();
    }
    this.pruneSelection();
    this.overlayDirty = true;
    this.ui.refreshAll();
  }

  // =============================================================================================
  // Editing

  begin(label: string): Transaction {
    return new Transaction(this.map, label);
  }

  /** Applies a transaction to the map, records it for undo and refreshes the view. */
  commit(tx: Transaction): void {
    if (tx.empty) return;
    const entry = tx.entry;
    applyEntry(this.map, entry, true);
    this.history.push(entry);
    this.refreshFromChanges(entry.elements, entry);
  }

  /** Records a change that has already been applied to the map (drags, brush strokes). */
  pushApplied(tx: Transaction, refresh = false): void {
    if (tx.empty) return;
    this.history.push(tx.entry);
    if (refresh) this.refreshFromChanges(tx.entry.elements, tx.entry);
    else this.ui.refreshAll();
  }

  undo(): void {
    const e = this.history.undo();
    if (!e) return;
    this.refreshFromChanges(applyEntry(this.map, e, false), e);
    this.ui.toast(`Undid: ${e.label}`);
  }

  redo(): void {
    const e = this.history.redo();
    if (!e) return;
    this.refreshFromChanges(applyEntry(this.map, e, true), e);
    this.ui.toast(`Redid: ${e.label}`);
  }

  newId(prefix: string): string {
    const taken = (id: string) =>
      this.map.roads.some((e) => e.id === id) ||
      this.map.buildings.some((e) => e.id === id) ||
      this.map.props.some((e) => e.id === id) ||
      this.map.fences.some((e) => e.id === id) ||
      this.map.zones.some((e) => e.id === id);
    for (;;) {
      const id = `${prefix}${Date.now().toString(36)}${(++this.idCounter).toString(36)}`;
      if (!taken(id)) return id;
    }
  }

  find(coll: Collection, id: string): Element | undefined {
    return (this.map[coll] as Element[]).find((e) => e.id === id);
  }

  /** Terrain cells in the loaded chunks were painted directly. */
  invalidateTerrain(): void {
    this.terrain.invalidate();
  }

  /** Marks the overlay for redrawing (selection, handles, previews). */
  redraw(): void {
    this.overlayDirty = true;
  }

  select(items: SelectionItem[]): void {
    this.selection = items;
    this.selectedInteriorProp = null;
    this.overlayDirty = true;
    this.ui.refreshInspector();
  }

  private pruneSelection(): void {
    this.selection = this.selection.filter((s) =>
      s.coll === 'spawns' ? Number(s.id) < this.map.spawns.length : !!this.find(s.coll, s.id),
    );
    if (this.interior && !this.find('buildings', this.interior)) this.interior = null;
  }

  selected<T extends Element>(coll: Collection): T[] {
    return this.selection
      .filter((s) => s.coll === coll)
      .map((s) => this.find(coll, s.id) as T)
      .filter(Boolean);
  }

  setTool(id: ToolId): void {
    if (this.tool.id === id) return;
    this.tool.deactivate?.();
    this.tool = this.tools[id];
    this.tool.activate?.();
    this.overlayDirty = true;
    this.ui.refreshTools();
  }

  enterInterior(building: string | null): void {
    this.interior = building;
    this.selectedInteriorProp = null;
    if (building) this.layers.roofs = false;
    this.overlayDirty = true;
    this.ui.refreshAll();
  }

  // =============================================================================================
  // Hit testing

  /** Topmost element under a world point, respecting layer visibility and layer locks. */
  hitTest(x: number, y: number): SelectionItem | null {
    const ok = (layer: EditableLayer, visible: LayerId) => this.layers[visible] && !this.lockedLayers.has(layer);
    const pick = 0.6 / Math.max(0.2, this.camera.zoom);
    if (ok('spawns', 'spawns')) {
      const i = this.map.spawns.findIndex((s) => Math.hypot(s.x - x, s.y - y) < Math.max(1.5, pick * 2));
      if (i >= 0) return { coll: 'spawns', id: String(i) };
    }
    if (ok('props', 'props')) {
      let best: PropInstance | null = null;
      let bestD = Infinity;
      for (const p of this.map.props) {
        if (Math.abs(p.x - x) > 6 || Math.abs(p.y - y) > 6) continue;
        const def = this.content.findProp(p.type);
        const r = Math.max(0.35, def?.shape === 'circle' ? (def.r ?? 0.3) : Math.max(p.w ?? def?.w ?? 1, p.h ?? def?.h ?? 1) / 2, pick);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= r && d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) return { coll: 'props', id: best.id };
    }
    if (ok('fences', 'fences')) {
      for (const f of this.map.fences) if (distanceToPolyline(x, y, f.points) < Math.max(0.6, pick)) return { coll: 'fences', id: f.id };
    }
    if (ok('buildings', 'buildings')) {
      for (const b of this.map.buildings) if (isInsideBuilding(b, x, y, 0.2)) return { coll: 'buildings', id: b.id };
    }
    if (ok('roads', 'roads')) {
      for (const r of this.map.roads)
        if (distanceToPolyline(x, y, r.points) < Math.max(r.width / 2 + r.sidewalk, pick)) return { coll: 'roads', id: r.id };
    }
    if (ok('zones', 'zones')) {
      // Smallest zone first so nested zones stay reachable.
      const zones = this.map.zones
        .filter((z) => x >= z.rect[0] && y >= z.rect[1] && x <= z.rect[0] + z.rect[2] && y <= z.rect[1] + z.rect[3])
        .sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3]);
      if (zones[0]) return { coll: 'zones', id: zones[0].id };
    }
    return null;
  }

  /** Furniture of the interior being edited under a world point. */
  hitInterior(x: number, y: number): InteriorProp | null {
    const b = this.interior ? (this.find('buildings', this.interior) as BuildingDef | undefined) : undefined;
    if (!b) return null;
    const t = buildingTransform(b);
    let best: InteriorProp | null = null;
    let bestD = Infinity;
    for (const p of b.props) {
      const w = localToWorld(t, p.x, p.y);
      const def = this.content.findProp(p.type);
      const r = Math.max(0.3, def?.shape === 'circle' ? (def.r ?? 0.3) : Math.max(p.w ?? def?.w ?? 1, p.h ?? def?.h ?? 1) / 2);
      const d = Math.hypot(w.x - x, w.y - y);
      if (d <= r && d < bestD) {
        bestD = d;
        best = { building: b, prop: p };
      }
    }
    return best;
  }

  // =============================================================================================
  // Biomes

  rebuildBiomeTexture(): void {
    const { cols, rows } = biomeGridSize(this.map);
    const c = this.biomeCanvas;
    if (c.width !== cols || c.height !== rows) {
      c.width = cols;
      c.height = rows;
    }
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const biome = BIOMES[this.biomeCells[i]] ?? 'none';
      const color = BIOME_RULES[biome].color;
      if (color === 'transparent') continue;
      const v = parseInt(color.slice(1), 16);
      img.data[i * 4] = (v >> 16) & 255;
      img.data[i * 4 + 1] = (v >> 8) & 255;
      img.data[i * 4 + 2] = v & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.biomeTexture.source.resize(cols, rows);
    this.biomeTexture.source.scaleMode = 'nearest';
    this.biomeTexture.source.update();
    this.biomeSprite.texture = this.biomeTexture;
    this.biomeSprite.width = cols * BIOME_CELL;
    this.biomeSprite.height = rows * BIOME_CELL;
  }

  encodeBiomeCells(): string {
    return encodeBiomes(this.biomeCells).data;
  }

  // =============================================================================================
  // Input

  private readonly guardUnload = (e: BeforeUnloadEvent) => {
    if (this.history.dirty > 0) e.preventDefault();
  };

  private bindInput(): void {
    const canvas = this.renderer.app.canvas;
    canvas.style.cursor = 'crosshair';
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mousedown', (e) => {
      this.updatePointer(e);
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.keys.has('Space'))) {
        this.panning = { sx: e.clientX, sy: e.clientY, x: this.camera.x, y: this.camera.y };
        e.preventDefault();
        return;
      }
      if (e.button === 0) this.tool.pointerDown?.(this.pointer, e);
      this.overlayDirty = true;
    });
    on(window, 'mousemove', (e) => {
      this.updatePointer(e);
      if (this.panning) {
        const s = this.camera.scale;
        this.camera.x = this.panning.x - (e.clientX - this.panning.sx) / s;
        this.camera.y = this.panning.y - (e.clientY - this.panning.sy) / s;
        return;
      }
      this.tool.pointerMove?.(this.pointer, e);
      this.overlayDirty = true;
    });
    on(window, 'mouseup', (e) => {
      this.updatePointer(e);
      if (this.panning && (e.button === 1 || e.button === 2 || e.button === 0)) {
        const moved = Math.hypot(e.clientX - this.panning.sx, e.clientY - this.panning.sy);
        this.panning = null;
        // A right click without dragging is a tool action (finish a road, delete a point).
        if (e.button === 2 && moved < 4) this.tool.secondary?.(this.pointer, e);
        return;
      }
      if (e.button === 0) this.tool.pointerUp?.(this.pointer, e);
      this.overlayDirty = true;
    });
    on(canvas, 'dblclick', (e) => {
      this.updatePointer(e);
      this.tool.doubleClick?.(this.pointer, e);
    });
    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        this.updatePointer(e);
        if (e.shiftKey && this.tool.wheel?.(Math.sign(e.deltaY))) return;
        const before = this.camera.screenToWorld(e.clientX, e.clientY);
        this.camera.addZoom(Math.sign(e.deltaY));
        this.camera.zoom = this.camera.targetZoom;
        const after = this.camera.screenToWorld(e.clientX, e.clientY);
        this.camera.x += before.x - after.x;
        this.camera.y += before.y - after.y;
      },
      { passive: false },
    );
    on(window, 'keydown', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (this.onKey(e)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }

  private updatePointer(e: MouseEvent): void {
    this.pointer.sx = e.clientX;
    this.pointer.sy = e.clientY;
    const w = this.camera.screenToWorld(e.clientX, e.clientY);
    this.pointer.x = w.x;
    this.pointer.y = w.y;
    this.pointer.inside = w.x >= 0 && w.y >= 0 && w.x <= this.map.width && w.y <= this.map.height;
  }

  private onKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (ctrl && e.code === 'KeyY') {
      this.redo();
      return true;
    }
    if (ctrl && e.code === 'KeyS') {
      void this.ui.save();
      return true;
    }
    if (ctrl) return false;
    if (this.tool.key?.(e)) return true;
    if (e.code === 'Escape') {
      if (this.interior) this.enterInterior(null);
      else this.select([]);
      return true;
    }
    for (const t of Object.values(this.tools)) {
      if (t.shortcut === e.code) {
        this.setTool(t.id);
        return true;
      }
    }
    return e.code.startsWith('Arrow') || e.code === 'Space' || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code);
  }

  // =============================================================================================
  // Frame

  private readonly frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const r = this.renderer;
    this.camera.resize(r.width, r.height);
    // Keyboard panning.
    const speed = (700 / this.camera.scale) * dt * (this.keys.has('ShiftLeft') ? 3 : 1);
    const ctrl = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('MetaLeft');
    if (!ctrl) {
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) this.camera.x -= speed;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) this.camera.x += speed;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) this.camera.y -= speed;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) this.camera.y += speed;
    }
    this.camera.x = Math.max(-50, Math.min(this.map.width + 50, this.camera.x));
    this.camera.y = Math.max(-50, Math.min(this.map.height + 50, this.camera.y));
    r.applyCamera(this.camera);
    const view = this.camera.bounds(10);
    this.terrain.update(this.camera.x, this.camera.y);
    this.roads.cull(view);
    this.buildings.update(dt, null, view);
    this.props.update(dt, -1e6, -1e6, view);
    const L = r.layers;
    L.terrain.visible = this.layers.terrain;
    L.roads.visible = this.layers.roads;
    for (const c of [L.floors, L.walls]) c.visible = this.layers.buildings;
    L.roofs.visible = this.layers.roofs && this.layers.buildings;
    L.ground.visible = this.layers.props;
    L.canopy.visible = this.layers.props;
    L.tall.visible = this.layers.props || this.layers.buildings;
    this.biomeSprite.visible = this.layers.biomes;
    const camKey = `${this.camera.x.toFixed(2)},${this.camera.y.toFixed(2)},${this.camera.zoom.toFixed(4)},${r.width},${r.height}`;
    if (this.overlayDirty || camKey !== this.lastCameraKey) {
      this.lastCameraKey = camKey;
      this.overlayDirty = false;
      this.drawOverlay(view);
    }
    this.statusTimer -= dt;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0.1;
      this.ui.refreshStatus();
    }
  };

  // =============================================================================================
  // Overlay

  /** Screen pixels → world meters at the current zoom. */
  px(pixels: number): number {
    return pixels / this.camera.scale;
  }

  private label(i: number, text: string, x: number, y: number, color = 0xffffff): void {
    let t = this.labelPool[i];
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } },
      });
      this.labelPool[i] = t;
      this.labels.addChild(t);
    }
    t.visible = true;
    t.text = text;
    t.style.fill = color;
    t.scale.set(1 / this.camera.scale);
    t.position.set(x, y);
  }

  private drawOverlay(view: Bounds): void {
    const g = this.overlay;
    g.clear();
    let labels = 0;
    const map = this.map;
    // Map border.
    g.rect(0, 0, map.width, map.height).stroke({ color: 0xe8d060, width: this.px(2), alpha: 0.8 });
    if (this.layers.grid) {
      for (let x = 0; x <= map.width; x += CHUNK_SIZE) g.moveTo(x, 0).lineTo(x, map.height);
      for (let y = 0; y <= map.height; y += CHUNK_SIZE) g.moveTo(0, y).lineTo(map.width, y);
      g.stroke({ color: 0xffffff, width: this.px(1), alpha: 0.18 });
      for (const key of map.terrainLocked ?? []) {
        const [cx, cy] = key.split(',').map(Number);
        g.rect(cx * CHUNK_SIZE + this.px(3), cy * CHUNK_SIZE + this.px(3), CHUNK_SIZE - this.px(6), CHUNK_SIZE - this.px(6)).stroke({
          color: 0xe8a040,
          width: this.px(1.5),
          alpha: 0.6,
        });
      }
    }
    if (this.layers.zones) {
      for (const z of map.zones) {
        const [x, y, w, h] = z.rect;
        if (x > view.maxX || y > view.maxY || x + w < view.minX || y + h < view.minY) continue;
        const color = ZONE_COLORS[z.kind] ?? 0xffffff;
        g.rect(x, y, w, h)
          .fill({ color, alpha: 0.06 })
          .stroke({ color, width: this.px(1.5), alpha: 0.7 });
        if (labels < 60)
          this.label(labels++, `${z.name} · ${z.kind} · ${z.zombies}🧟${z.locked ? ' 🔒' : ''}`, x + this.px(4), y + this.px(3), color);
      }
    }
    if (this.layers.spawns) {
      for (const s of map.spawns) {
        g.circle(s.x, s.y, this.px(7))
          .fill({ color: 0x60d0ff, alpha: 0.35 })
          .stroke({ color: 0x60d0ff, width: this.px(2) });
        g.moveTo(s.x - this.px(10), s.y)
          .lineTo(s.x + this.px(10), s.y)
          .moveTo(s.x, s.y - this.px(10))
          .lineTo(s.x, s.y + this.px(10));
        g.stroke({ color: 0x60d0ff, width: this.px(1.5) });
      }
    }
    if (this.layers.locks) {
      const lock = (x: number, y: number) => {
        const s = this.px(5);
        g.roundRect(x - s, y - s * 0.3, s * 2, s * 1.5, s * 0.3).fill({ color: 0xe8a040, alpha: 0.9 });
        g.moveTo(x - s * 0.65, y - s * 0.3)
          .arc(x, y - s * 0.3, s * 0.65, Math.PI, 0)
          .stroke({ color: 0xe8a040, width: this.px(1.5) });
      };
      const inView = (x: number, y: number) => x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
      for (const b of map.buildings) if (b.locked && inView(b.x, b.y)) lock(b.x, b.y);
      for (const r of map.roads) {
        if (!r.locked) continue;
        const [x, y] = r.points[Math.floor(r.points.length / 2)];
        if (inView(x, y)) lock(x, y);
      }
      if (this.camera.zoom > 0.25) for (const p of map.props) if (p.locked && inView(p.x, p.y)) lock(p.x, p.y);
      for (const f of map.fences) if (f.locked && inView(f.points[0][0], f.points[0][1])) lock(f.points[0][0], f.points[0][1]);
    }
    // Interior being edited.
    const interior = this.interior ? (this.find('buildings', this.interior) as BuildingDef | undefined) : undefined;
    if (interior) {
      g.poly(buildingPolygon(interior)).stroke({ color: 0x8ec06a, width: this.px(3), alpha: 0.9 });
      const t = buildingTransform(interior);
      for (const p of interior.props) {
        const w = localToWorld(t, p.x, p.y);
        const selected = p.id === this.selectedInteriorProp;
        g.circle(w.x, w.y, selected ? this.px(8) : this.px(3)).stroke({
          color: selected ? 0xffe070 : 0x8ec06a,
          width: this.px(selected ? 2 : 1),
          alpha: 0.8,
        });
      }
      if (labels < 60) this.label(labels++, `Interior: ${interior.name ?? interior.type} — Esc to leave`, interior.x, interior.y, 0x8ec06a);
    }
    // Selection.
    for (const s of this.selection) this.drawSelected(g, s);
    this.tool.drawOverlay?.(g);
    for (let i = labels; i < this.labelPool.length; i++) this.labelPool[i].visible = false;
  }

  private drawSelected(g: Graphics, s: SelectionItem): void {
    const color = 0xffe070;
    const w = this.px(2);
    if (s.coll === 'spawns') {
      const sp = this.map.spawns[Number(s.id)];
      if (sp) g.circle(sp.x, sp.y, this.px(12)).stroke({ color, width: w });
      return;
    }
    const el = this.find(s.coll, s.id);
    if (!el) return;
    switch (s.coll) {
      case 'buildings':
        g.poly(buildingPolygon(el as BuildingDef)).stroke({ color, width: w });
        break;
      case 'roads': {
        const r = el as RoadDef;
        g.poly(r.points.flat(), false).stroke({ color, width: Math.max(w, r.width + r.sidewalk * 2), alpha: 0.25 });
        g.poly(r.points.flat(), false).stroke({ color, width: w });
        if (this.selection.length === 1)
          for (const [x, y] of r.points) g.circle(x, y, this.px(6)).fill({ color: 0x1a1a1a }).stroke({ color, width: w });
        break;
      }
      case 'fences': {
        const f = el as FenceDef;
        g.poly(f.points.flat(), false).stroke({ color, width: this.px(4), alpha: 0.6 });
        if (this.selection.length === 1)
          for (const [x, y] of f.points) g.circle(x, y, this.px(6)).fill({ color: 0x1a1a1a }).stroke({ color, width: w });
        break;
      }
      case 'props': {
        const p = el as PropInstance;
        const def = this.content.findProp(p.type);
        if (def?.shape === 'box' || (p.w && p.h)) {
          const hw = (p.w ?? def?.w ?? 1) / 2;
          const hh = (p.h ?? def?.h ?? 1) / 2;
          const c = Math.cos(p.rot);
          const n = Math.sin(p.rot);
          const pts = [
            [-hw, -hh],
            [hw, -hh],
            [hw, hh],
            [-hw, hh],
          ].flatMap(([x, y]) => [p.x + x * c - y * n, p.y + x * n + y * c]);
          g.poly(pts).stroke({ color, width: w });
        } else g.circle(p.x, p.y, Math.max(this.px(8), def?.r ?? 0.5)).stroke({ color, width: w });
        break;
      }
      case 'zones': {
        const [x, y, zw, zh] = (el as ZoneDef).rect;
        g.rect(x, y, zw, zh).stroke({ color, width: this.px(3) });
        for (const [hx, hy] of [
          [x, y],
          [x + zw, y],
          [x + zw, y + zh],
          [x, y + zh],
        ])
          g.rect(hx - this.px(5), hy - this.px(5), this.px(10), this.px(10)).fill({ color });
        break;
      }
    }
  }

  // =============================================================================================
  // Status

  /** Terrain material and biome under the pointer. */
  describePointer(): string {
    const { x, y } = this.pointer;
    if (!this.pointer.inside) return 'outside the map';
    const m = this.world.terrainAt(x, y);
    const { cols } = biomeGridSize(this.map);
    const biome = BIOMES[this.biomeCells[Math.floor(y / BIOME_CELL) * cols + Math.floor(x / BIOME_CELL)] ?? 0];
    return `${x.toFixed(1)}, ${y.toFixed(1)} · chunk ${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)} · ${TERRAIN_MATERIALS[m] ?? '—'} · ${BIOME_RULES[biome].label}`;
  }

  destroy(): void {
    this.renderer.app.ticker.remove(this.frame);
    for (const c of this.cleanup) c();
    window.removeEventListener('beforeunload', this.guardUnload);
  }
}
