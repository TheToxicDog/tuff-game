// World-space overlay drawn above the night tint: the building grid and ghost, hover outlines,
// land-claim areas and the members of a power network.

import { Container, Graphics } from 'pixi.js';
import type { ClientStruct, ClientWorld } from '../game/world';
import { TS } from './draw';
import type { Renderer } from './renderer';

export class Overlay {
  readonly g = new Graphics();
  readonly ghostLayer = new Container();
  private ghost: Container | null = null;
  private ghostKey = '';

  constructor(
    private readonly r: Renderer,
    private readonly world: ClientWorld,
  ) {
    r.overlay.addChild(this.g, this.ghostLayer);
  }

  clear(): void {
    this.g.clear();
  }

  grid(cx: number, cy: number, radius = 9): void {
    const g = this.g;
    const x0 = Math.floor(cx - radius);
    const y0 = Math.floor(cy - radius);
    for (let i = 0; i <= radius * 2; i++) {
      const x = x0 + i;
      const y = y0 + i;
      g.moveTo(x * TS, y0 * TS).lineTo(x * TS, (y0 + radius * 2) * TS);
      g.moveTo(x0 * TS, y * TS).lineTo((x0 + radius * 2) * TS, y * TS);
    }
    g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.13 });
  }

  setGhost(key: string, make: (() => Container) | null, x: number, y: number, w: number, h: number, valid: boolean): void {
    if (key !== this.ghostKey) {
      this.ghost?.destroy({ children: true });
      this.ghost = make ? make() : null;
      if (this.ghost) this.ghostLayer.addChild(this.ghost);
      this.ghostKey = key;
    }
    if (!this.ghost) return;
    this.ghost.position.set(x * TS, y * TS);
    this.ghost.alpha = 0.62;
    this.ghost.tint = valid ? 0xffffff : 0xff7060;
    this.g.rect(x * TS, y * TS, w * TS, h * TS).stroke({ width: 3, color: valid ? 0x8fd45a : 0xe8645a, alpha: 0.9 });
  }

  hideGhost(): void {
    if (this.ghost) {
      this.ghost.destroy({ children: true });
      this.ghost = null;
      this.ghostKey = '';
    }
  }

  outlineStruct(s: ClientStruct, color = 0xffffff, alpha = 0.8): void {
    this.g.roundRect(s.x * TS - 2, s.y * TS - 2, s.w * TS + 4, s.h * TS + 4, 8).stroke({ width: 3, color, alpha });
  }

  outlineCircle(x: number, y: number, r: number, color = 0xffffff): void {
    this.g.circle(x * TS, y * TS, r * TS).stroke({ width: 3, color, alpha: 0.75 });
  }

  claimArea(x: number, y: number, radius: number, mine: boolean): void {
    this.g
      .rect((x - radius) * TS, (y - radius) * TS, (radius * 2 + 1) * TS, (radius * 2 + 1) * TS)
      .fill({ color: mine ? 0x8fd45a : 0xf2c53d, alpha: 0.06 })
      .stroke({ width: 3, color: mine ? 0x8fd45a : 0xf2c53d, alpha: 0.6 });
  }

  /** Outlines every block in a power network. */
  network(net: number, stalled: boolean): void {
    const color = stalled ? 0xe8645a : 0xf2c53d;
    for (const s of this.world.structs.values()) if (s.net === net) this.outlineStruct(s, color, 0.55);
  }
}
