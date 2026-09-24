// The translucent preview of a structure in build mode: green where it can go, red where it
// cannot (blocked, too far, no materials).

import { Graphics, type Container } from 'pixi.js';
import type { StructureShape } from '@tuff/shared';

export class BuildGhost {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    this.g.visible = false;
    parent.addChild(this.g);
  }

  hide(): void {
    this.g.visible = false;
  }

  show(shape: StructureShape, x: number, y: number, rot: number, ok: boolean): void {
    const g = this.g;
    g.clear();
    g.visible = true;
    g.position.set(x, y);
    g.rotation = rot;
    const color = ok ? 0x8ec06a : 0xd0503a;
    if (shape.r > 0) {
      g.circle(0, 0, shape.r).fill({ color, alpha: 0.3 }).stroke({ color, width: 0.05, alpha: 0.9 });
    } else if (shape.opening > 0) {
      const side = (shape.w - shape.opening) / 2;
      for (const sign of [-1, 1]) {
        g.rect(sign * (shape.opening / 2 + side / 2) - side / 2, -shape.h / 2, side, shape.h).fill({ color, alpha: 0.35 });
      }
      g.rect(-shape.opening / 2, -0.04, shape.opening, 0.08).fill({ color, alpha: 0.2 });
      g.rect(-shape.w / 2, -shape.h / 2, shape.w, shape.h).stroke({ color, width: 0.04, alpha: 0.9 });
    } else {
      g.rect(-shape.w / 2, -shape.h / 2, shape.w, shape.h)
        .fill({ color, alpha: 0.3 })
        .stroke({ color, width: 0.04, alpha: 0.9 });
    }
    // Front marker so rotation is readable.
    g.moveTo(0, shape.h / 2)
      .lineTo(0, shape.h / 2 + 0.3)
      .stroke({ color, width: 0.05, alpha: 0.8 });
  }
}
