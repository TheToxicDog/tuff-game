// Lighting and line-of-sight darkness (design plan §53, §85–86).
//
// Each frame a low-resolution light map is rendered: everything starts at the "unseen" level,
// the player's visibility polygon is filled with the ambient light of the time of day, and light
// sources (flashlights, lanterns, muzzle flashes) are added on top. The light map is then
// multiplied over the world. At night, unlit visible areas are nearly black, so flashlights matter.

import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { ambientLight, clamp } from '@tuff/shared';
import type { Camera } from '../camera/camera';
import type { TransientLight } from './effects';
import { coneTexture, radialTexture } from './textures';

const LIGHT_SCALE = 0.5;

export interface LightSource {
  kind: 'cone' | 'radial';
  x: number;
  y: number;
  angle: number;
  range: number;
  cone: number;
  intensity: number;
  /** Clip to the local player's line of sight (only valid for the local player's own light). */
  occluded: boolean;
}

function rgb(r: number, g: number, b: number): number {
  const c = (v: number) => Math.round(clamp(v, 0, 1) * 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export class Lighting {
  readonly sprite: Sprite;
  private rt: RenderTexture;
  private readonly scene = new Container();
  private readonly vis = new Graphics();
  private readonly visMask = new Graphics();
  private readonly occludedLights = new Container();
  private readonly freeLights = new Container();
  private readonly pool: Sprite[] = [];
  private used = 0;
  /** Overall brightness of the visible area (for HUD / gameplay hints). */
  ambientLevel = 1;

  constructor(private readonly renderer: Renderer) {
    this.rt = RenderTexture.create({ width: 16, height: 16, resolution: 1 });
    this.sprite = new Sprite(this.rt);
    this.sprite.blendMode = 'multiply';
    this.occludedLights.mask = this.visMask;
    this.scene.addChild(this.vis, this.visMask, this.occludedLights, this.freeLights);
  }

  resize(w: number, h: number): void {
    const lw = Math.max(16, Math.ceil(w * LIGHT_SCALE));
    const lh = Math.max(16, Math.ceil(h * LIGHT_SCALE));
    if (this.rt.width !== lw || this.rt.height !== lh) {
      this.rt.resize(lw, lh);
    }
    this.sprite.width = w;
    this.sprite.height = h;
  }

  private light(parent: Container, src: LightSource | TransientLight, isCone: boolean): void {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite();
      s.blendMode = 'add';
      this.pool.push(s);
    }
    this.used++;
    if (isCone) {
      const l = src as LightSource;
      s.texture = coneTexture(Math.round(l.cone));
      s.anchor.set(0, 0.5);
      s.width = l.range;
      s.height = l.range;
      s.rotation = l.angle;
      s.alpha = l.intensity;
      s.tint = 0xffffff;
    } else {
      const radius = 'radius' in src ? src.radius : (src as LightSource).range;
      s.texture = radialTexture('light', 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 256, 1.1);
      s.anchor.set(0.5);
      s.width = s.height = radius * 2;
      s.rotation = 0;
      const t = src as TransientLight;
      s.alpha = 'life' in src ? src.intensity * (t.life / t.max) : (src as LightSource).intensity;
      s.tint = 'color' in src ? t.color : 0xfff0d8;
    }
    s.position.set(src.x, src.y);
    parent.addChild(s);
  }

  /**
   * @param lit extra polygons lit by ambient light regardless of line of sight (roofs seen from
   * above: a roof is opaque, so lighting it reveals nothing underneath).
   */
  render(
    camera: Camera,
    visibility: number[],
    hour: number,
    lights: LightSource[],
    transient: TransientLight[],
    indoors: boolean,
    lit: number[][] = [],
  ): void {
    const amb = ambientLight(hour);
    // Interiors are darker than outdoors by day.
    const indoorFactor = indoors ? 0.72 : 1;
    const seenR = Math.max(0.05, amb.r * indoorFactor);
    const seenG = Math.max(0.055, amb.g * indoorFactor);
    const seenB = Math.max(0.07, amb.b * indoorFactor);
    this.ambientLevel = amb.level * indoorFactor;
    // Areas out of sight are remembered but dim.
    const unseen = 0.3 * amb.level + 0.035;

    this.vis.clear();
    this.visMask.clear();
    for (const poly of lit) this.vis.poly(poly).fill(rgb(amb.r * 0.92, amb.g * 0.92, amb.b * 0.92));
    if (visibility.length >= 6) {
      this.vis.poly(visibility).fill(rgb(seenR, seenG, seenB));
      this.visMask.poly(visibility).fill(0xffffff);
    }
    this.used = 0;
    this.occludedLights.removeChildren();
    this.freeLights.removeChildren();
    for (const l of lights) this.light(l.occluded ? this.occludedLights : this.freeLights, l, l.kind === 'cone');
    for (const t of transient) this.light(this.occludedLights, t, false);

    const scale = camera.scale * LIGHT_SCALE;
    this.scene.scale.set(scale);
    this.scene.position.set(this.rt.width / 2 - camera.viewX() * scale, this.rt.height / 2 - camera.viewY() * scale);
    this.renderer.render({
      container: this.scene,
      target: this.rt,
      clear: true,
      clearColor: [unseen * 0.85, unseen * 0.9, unseen * 1.05, 1],
    });
  }
}
