// Day and night: a tint over the world that deepens after dusk, and warm glows around fires,
// furnaces and torches that stay bright in the dark.

import { Sprite, Texture } from 'pixi.js';
import type { ClientStruct } from '../game/world';
import { TS } from './draw';
import type { Renderer } from './renderer';

let glowTexture: Texture | null = null;

function glowTex(): Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 190, 110, 0.9)');
  g.addColorStop(0.4, 'rgba(255, 150, 70, 0.35)');
  g.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = Texture.from(c);
  return glowTexture;
}

/** Darkness (0–1) at a time of day in hours. */
export function darkness(hour: number): number {
  if (hour >= 7 && hour <= 19) return 0;
  if (hour > 19 && hour < 21.5) return (hour - 19) / 2.5;
  if (hour >= 4.5 && hour < 7) return 1 - (hour - 4.5) / 2.5;
  return 1;
}

export class Lighting {
  private readonly glows = new Map<number, Sprite>();
  private dark = 0;
  private time = 0;

  constructor(private readonly r: Renderer) {}

  structAdded(s: ClientStruct): void {
    const light = s.def.light;
    if (!light) return;
    const sp = new Sprite(glowTex());
    sp.anchor.set(0.5);
    sp.position.set((s.x + s.w / 2) * TS, (s.y + s.h / 2) * TS);
    sp.width = sp.height = light * TS * 1.6;
    if (s.def.electric) sp.tint = 0xe8f4ff;
    this.r.lights.addChild(sp);
    this.glows.set(s.id, sp);
    this.structChanged(s);
  }

  structChanged(s: ClientStruct): void {
    const sp = this.glows.get(s.id);
    if (!sp) return;
    // Torches always burn; stations only glow while working.
    const lit =
      s.type === 'torch' ||
      s.type === 'land_claim' ||
      s.type === 'lighthouse' ||
      s.type === 'clock_tower' ||
      !!s.st.on ||
      (s.type === 'campfire' && s.st.on !== false);
    sp.visible = lit;
  }

  structRemoved(s: ClientStruct): void {
    this.glows.get(s.id)?.destroy();
    this.glows.delete(s.id);
  }

  update(dt: number, hour: number): void {
    this.time += dt;
    this.dark = darkness(hour);
    const n = this.r.night;
    n.clear();
    if (this.dark > 0.001) n.rect(0, 0, this.r.width, this.r.height).fill({ color: 0x0b1030, alpha: this.dark * 0.62 });
    this.r.lights.alpha = 0.25 + this.dark * 0.75;
    let i = 0;
    for (const sp of this.glows.values()) sp.alpha = 0.88 + Math.sin(this.time * 7 + i++) * 0.12;
  }

  get level(): number {
    return this.dark;
  }
}
