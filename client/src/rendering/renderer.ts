// The PixiJS application and render layer stack (design plan §79). World layers are drawn in
// meters inside one camera-transformed container; the light map and the crosshair are drawn in
// screen space on top.

import { Application, Container, Graphics } from 'pixi.js';
import type { Camera } from '../camera/camera';
import { Lighting } from './lighting';

export interface WorldLayers {
  terrain: Container;
  roads: Container;
  ground: Container;
  floors: Container;
  decals: Container;
  low: Container;
  items: Container;
  corpses: Container;
  entities: Container;
  walls: Container;
  tall: Container;
  effects: Container;
  canopy: Container;
  roofs: Container;
  top: Container;
}

const LAYER_ORDER: (keyof WorldLayers)[] = [
  'terrain',
  'roads',
  'ground',
  'floors',
  'decals',
  'low',
  'items',
  'corpses',
  'entities',
  'walls',
  'tall',
  'effects',
  'canopy',
  'roofs',
  'top',
];

export class GameRenderer {
  readonly app = new Application();
  readonly world = new Container();
  readonly layers = {} as WorldLayers;
  readonly overlay = new Container();
  readonly crosshair = new Graphics();
  lighting!: Lighting;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      preference: 'webgl',
      resizeTo: window,
      background: 0x0b0c0b,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      powerPreference: 'high-performance',
    });
    host.append(this.app.canvas);
    for (const name of LAYER_ORDER) {
      const c = new Container();
      c.label = name;
      this.layers[name] = c;
      this.world.addChild(c);
    }
    // Interactive pixels are handled by our own input layer, not Pixi's event system.
    this.app.stage.eventMode = 'none';
    this.world.eventMode = 'none';
    this.lighting = new Lighting(this.app.renderer);
    this.overlay.addChild(this.crosshair);
    this.app.stage.addChild(this.world, this.lighting.sprite, this.overlay);
  }

  get width(): number {
    return this.app.screen.width;
  }

  get height(): number {
    return this.app.screen.height;
  }

  applyCamera(camera: Camera): void {
    const s = camera.scale;
    this.world.scale.set(s);
    this.world.position.set(this.width / 2 - camera.viewX() * s, this.height / 2 - camera.viewY() * s);
    this.lighting.resize(this.width, this.height);
  }

  /** Crosshair whose gap shows the current weapon spread at the aim distance. */
  drawCrosshair(x: number, y: number, gapPx: number, mode: 'gun' | 'melee' | 'hidden', color = 0xe8e4d6): void {
    const g = this.crosshair;
    g.clear();
    if (mode === 'hidden') return;
    if (mode === 'melee') {
      g.circle(x, y, 5).stroke({ color: 0x000000, width: 3, alpha: 0.6 });
      g.circle(x, y, 5).stroke({ color, width: 1.5, alpha: 0.9 });
      g.circle(x, y, 1.2).fill({ color, alpha: 0.9 });
      return;
    }
    const gap = Math.max(4, Math.min(120, gapPx));
    const len = 7;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      g.moveTo(x + dx * gap, y + dy * gap).lineTo(x + dx * (gap + len), y + dy * (gap + len));
    }
    g.stroke({ color: 0x000000, width: 4, alpha: 0.55 });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      g.moveTo(x + dx * gap, y + dy * gap).lineTo(x + dx * (gap + len), y + dy * (gap + len));
    }
    g.stroke({ color, width: 1.8, alpha: 0.95 });
    g.circle(x, y, 1.3).fill({ color, alpha: 0.9 });
  }
}
