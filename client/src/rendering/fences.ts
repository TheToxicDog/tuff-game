// Fences: wooden privacy fences, chain-link and picket fences drawn along their polylines.

import { Graphics, type Container } from 'pixi.js';
import type { FenceDef } from '@tuff/shared';

export class FenceRenderer {
  private readonly views = new Map<string, Graphics>();

  constructor(private readonly parent: Container) {}

  add(f: FenceDef): void {
    if (this.views.has(f.id) || f.points.length < 2) return;
    const g = new Graphics();
    const pts = f.points;
    const path = () => {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    };
    switch (f.kind) {
      case 'wood':
        path();
        g.stroke({ color: 0x000000, width: 0.26, alpha: 0.3, cap: 'square' });
        path();
        g.stroke({ color: 0x5e4630, width: 0.14, cap: 'square' });
        path();
        g.stroke({ color: 0x7a5c3e, width: 0.06, cap: 'square' });
        break;
      case 'picket':
        path();
        g.stroke({ color: 0xcfcabb, width: 0.05 });
        break;
      default:
        path();
        g.stroke({ color: 0x8a9094, width: 0.035, alpha: 0.8 });
    }
    // Posts every ~2.4 m.
    const postColor = f.kind === 'wood' ? 0x4a3624 : f.kind === 'picket' ? 0xe0dccf : 0x6a6e72;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const step = f.kind === 'picket' ? 0.25 : 2.4;
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        if (f.kind === 'picket') g.rect(px - 0.035, py - 0.035, 0.07, 0.07);
        else g.rect(px - 0.07, py - 0.07, 0.14, 0.14);
      }
    }
    g.fill(postColor);
    this.parent.addChild(g);
    this.views.set(f.id, g);
  }

  remove(id: string): void {
    this.views.get(id)?.destroy();
    this.views.delete(id);
  }
}
