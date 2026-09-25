// Fishing floats: a line from the rod tip to a red-and-white float that bobs on the water, rings
// spreading around it, and a sharp dip when a fish bites.

import { Container, Graphics } from 'pixi.js';
import { OUTLINE, TS } from './draw';
import type { Renderer } from './renderer';

interface Float {
  pid: number;
  x: number;
  y: number;
  state: number;
  since: number;
  g: Graphics;
}

export class FishingFloats {
  private readonly floats = new Map<number, Float>();
  private readonly layer: Container;

  constructor(
    r: Renderer,
    /** Rod tip of a player in world pixels, or null when they are not in view. */
    private readonly tip: (pid: number) => { x: number; y: number } | null,
  ) {
    this.layer = r.layers.effects;
  }

  /** State 0 reels the line in, 1 floats, 2 bites. */
  set(pid: number, x: number, y: number, state: number): void {
    let f = this.floats.get(pid);
    if (state === 0) {
      if (f) {
        f.g.destroy();
        this.floats.delete(pid);
      }
      return;
    }
    if (!f) {
      f = { pid, x, y, state, since: 0, g: new Graphics() };
      this.layer.addChild(f.g);
      this.floats.set(pid, f);
    }
    f.x = x;
    f.y = y;
    f.state = state;
    f.since = performance.now();
  }

  update(now: number): void {
    for (const f of this.floats.values()) {
      const tip = this.tip(f.pid);
      if (!tip) {
        this.set(f.pid, 0, 0, 0);
        continue;
      }
      const g = f.g;
      g.clear();
      const t = (now - f.since) / 1000;
      const biting = f.state === 2;
      const fx = f.x * TS;
      const fy = f.y * TS;
      for (let k = 0; k < 2; k++) {
        const ring = (t * (biting ? 2.4 : 0.7) + k * 0.5) % 1;
        g.ellipse(fx, fy + 2, 7 + ring * (biting ? 26 : 16), (7 + ring * (biting ? 26 : 16)) * 0.6).stroke({
          width: 2,
          color: 0xffffff,
          alpha: 0.55 * (1 - ring),
        });
      }
      const dip = biting ? 5 + Math.sin(t * 28) * 3 : Math.sin(t * 2.6) * 1.6;
      g.moveTo(tip.x, tip.y)
        .quadraticCurveTo((tip.x + fx) / 2, Math.max(tip.y, fy) + 18, fx, fy + dip - 6)
        .stroke({ width: 1.5, color: 0xf2f2f2, alpha: 0.85 });
      const r = biting ? 5 : 6;
      g.circle(fx, fy + dip, r)
        .fill(0xffffff)
        .stroke({ width: 2, color: OUTLINE });
      g.moveTo(fx - r, fy + dip)
        .arc(fx, fy + dip, r, Math.PI, Math.PI * 2)
        .closePath()
        .fill(0xe0403a);
      g.circle(fx, fy + dip, r).stroke({ width: 2, color: OUTLINE });
    }
  }
}
