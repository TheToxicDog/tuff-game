// The PixiJS application, the world layer stack and the camera. World-space content is split into
// per-chunk containers on each layer so whole chunks can be culled and dropped cheaply.

import { Application, Container, Graphics } from 'pixi.js';
import { CHUNK } from '@ironwild/shared';
import { TS } from './draw';

export const LAYERS = [
  'terrain',
  'decor',
  'floors',
  'ground',
  'belt',
  'nodes',
  'objects',
  'drops',
  'entities',
  'canopy',
  'effects',
] as const;
export type LayerName = (typeof LAYERS)[number];
/** Layers split into chunks. */
const CHUNKED: LayerName[] = ['decor', 'floors', 'ground', 'nodes', 'objects', 'canopy'];

export class Renderer {
  readonly app = new Application();
  /** Camera-transformed world below the night tint. */
  readonly world = new Container();
  /** Camera-transformed layer above the night tint: lights and the build overlay. */
  readonly top = new Container();
  readonly lights = new Container();
  readonly overlay = new Container();
  readonly night = new Graphics();
  readonly layers = {} as Record<LayerName, Container>;
  private readonly chunks = new Map<number, Partial<Record<LayerName, Container>>>();
  zoom = 0.9;
  targetZoom = 0.9;
  camX = 0;
  camY = 0;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      preference: 'webgl',
      resizeTo: window,
      background: 0x3f6f9e,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      powerPreference: 'high-performance',
    });
    host.append(this.app.canvas);
    for (const name of LAYERS) {
      const c = new Container();
      c.label = name;
      this.layers[name] = c;
      this.world.addChild(c);
    }
    // Parked carts and trucks (zIndex −1) stay under the people and animals around them.
    this.layers.entities.sortableChildren = true;
    this.app.stage.eventMode = 'none';
    this.lights.blendMode = 'add';
    this.top.addChild(this.lights, this.overlay);
    this.app.stage.addChild(this.world, this.night, this.top);
  }

  get width(): number {
    return this.app.screen.width;
  }

  get height(): number {
    return this.app.screen.height;
  }

  /** Container for one chunk on a chunked layer. */
  chunk(key: number, layer: LayerName): Container {
    let entry = this.chunks.get(key);
    if (!entry) this.chunks.set(key, (entry = {}));
    let c = entry[layer];
    if (!c) {
      c = new Container();
      c.label = `${layer}:${key}`;
      entry[layer] = c;
      this.layers[layer].addChild(c);
    }
    return c;
  }

  dropChunk(key: number): void {
    const entry = this.chunks.get(key);
    if (!entry) return;
    for (const c of Object.values(entry)) c?.destroy({ children: true });
    this.chunks.delete(key);
  }

  /** Scale in screen pixels per world pixel. */
  get scale(): number {
    return this.zoom;
  }

  applyCamera(x: number, y: number, dt: number): void {
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 12);
    this.camX = x;
    this.camY = y;
    const s = this.zoom;
    for (const c of [this.world, this.top]) {
      c.scale.set(s);
      c.position.set(Math.round(this.width / 2 - x * TS * s), Math.round(this.height / 2 - y * TS * s));
    }
    this.cull();
  }

  /** Visible area in tiles. */
  view(margin = 2): { x0: number; y0: number; x1: number; y1: number } {
    const halfW = this.width / 2 / (TS * this.zoom);
    const halfH = this.height / 2 / (TS * this.zoom);
    return {
      x0: this.camX - halfW - margin,
      y0: this.camY - halfH - margin,
      x1: this.camX + halfW + margin,
      y1: this.camY + halfH + margin,
    };
  }

  private cull(): void {
    const v = this.view(3);
    for (const [key, entry] of this.chunks) {
      const cx = (key % 1024) * CHUNK;
      const cy = Math.floor(key / 1024) * CHUNK;
      const visible = cx + CHUNK >= v.x0 && cx <= v.x1 && cy + CHUNK >= v.y0 && cy <= v.y1;
      for (const c of Object.values(entry)) if (c) c.visible = visible;
    }
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const s = TS * this.zoom;
    return { x: this.camX + (sx - this.width / 2) / s, y: this.camY + (sy - this.height / 2) / s };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const s = TS * this.zoom;
    return { x: (x - this.camX) * s + this.width / 2, y: (y - this.camY) * s + this.height / 2 };
  }

  isChunked(layer: LayerName): boolean {
    return CHUNKED.includes(layer);
  }
}
