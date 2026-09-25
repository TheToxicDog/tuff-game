// Power lines: every pair of poles within reach is strung with a sagging cable, and each electric
// device gets a short lead to the pole it draws from — the grid is something you can see.

import { Graphics } from 'pixi.js';
import { DEVICE_RANGE, POLE_RANGE } from '@ironwild/shared';
import type { ClientStruct, ClientWorld } from '../game/world';
import { TS } from './draw';
import type { Renderer } from './renderer';

export class WireRenderer {
  private readonly g = new Graphics();
  private dirty = true;

  constructor(
    r: Renderer,
    private readonly world: ClientWorld,
  ) {
    r.layers.canopy.addChild(this.g);
  }

  /** Call when an electric structure appears or goes. */
  changed(s: ClientStruct): void {
    if (s.def.electric) this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.g;
    g.clear();
    const poles: ClientStruct[] = [];
    const devices: ClientStruct[] = [];
    for (const s of this.world.structs.values()) {
      if (s.def.electric?.role === 'pole') poles.push(s);
      else if (s.def.electric) devices.push(s);
    }
    const cable = (x0: number, y0: number, x1: number, y1: number, width: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2 + len * 0.08;
      g.moveTo(x0, y0)
        .quadraticCurveTo(mx, my, x1, y1)
        .stroke({ width: width + 2, color: 0x1a1612, alpha: 0.35 });
      g.moveTo(x0, y0).quadraticCurveTo(mx, my, x1, y1).stroke({ width, color: 0x2a241c });
    };
    const top = (p: ClientStruct) => ({ x: (p.x + 0.5) * TS, y: (p.y + 0.5) * TS - 22 });
    for (let i = 0; i < poles.length; i++) {
      for (let j = i + 1; j < poles.length; j++) {
        const a = poles[i];
        const b = poles[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) > POLE_RANGE) continue;
        const ta = top(a);
        const tb = top(b);
        // Two conductors, one either side of the crossarm.
        const ang = Math.atan2(tb.y - ta.y, tb.x - ta.x) + Math.PI / 2;
        for (const off of [-9, 9])
          cable(ta.x + Math.cos(ang) * off, ta.y + Math.sin(ang) * off, tb.x + Math.cos(ang) * off, tb.y + Math.sin(ang) * off, 2);
      }
    }
    for (const d of devices) {
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      let best: ClientStruct | null = null;
      let bestD = DEVICE_RANGE;
      for (const p of poles) {
        const dist = Math.hypot(p.x + 0.5 - cx, p.y + 0.5 - cy);
        if (dist <= bestD) {
          bestD = dist;
          best = p;
        }
      }
      if (!best) continue;
      const t = top(best);
      cable(t.x, t.y, cx * TS, cy * TS - 6, 1.5);
    }
  }
}
