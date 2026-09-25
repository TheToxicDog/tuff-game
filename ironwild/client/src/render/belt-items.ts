// Individual items riding conveyors (§23). Each item's motion arrives as keyframes (position,
// speed, server tick); the item is drawn at the interpolated render tick, so it glides smoothly
// between keyframes and around corners.

import { Sprite } from 'pixi.js';
import { TICK_RATE, beltPosition, type BeltKeyframe } from '@ironwild/shared';
import type { ClientWorld } from '../game/world';
import { TS } from './draw';
import type { Renderer } from './renderer';
import { itemTexture } from './structures';

const SIZE = TS * 0.42;

export class BeltItems {
  private readonly sprites = new Map<number, Sprite>();
  private readonly pos = { x: 0, y: 0 };

  constructor(
    private readonly r: Renderer,
    private readonly world: ClientWorld,
  ) {}

  update(renderTick: number): void {
    for (const [id, it] of this.world.belt) {
      // Drop removed items once their removal is in the past.
      if (it.removedAt !== undefined && it.removedAt <= renderTick) {
        this.world.belt.delete(id);
        this.sprites.get(id)?.destroy();
        this.sprites.delete(id);
        continue;
      }
      let base: BeltKeyframe | null = null;
      let next: BeltKeyframe | null = null;
      for (let i = 0; i < it.frames.length; i++) {
        const f = it.frames[i];
        if (f.rm) continue;
        if (f.k <= renderTick) base = f;
        else {
          next = f;
          break;
        }
      }
      let sprite = this.sprites.get(id);
      if (!base) {
        if (sprite) sprite.visible = false;
        continue;
      }
      if (!sprite) {
        sprite = new Sprite(itemTexture(it.item));
        sprite.anchor.set(0.5);
        sprite.width = sprite.height = SIZE;
        this.r.layers.belt.addChild(sprite);
        this.sprites.set(id, sprite);
      }
      sprite.visible = true;
      let p = (base.p ?? 0) / 1000 + (((base.v ?? 0) / 100) * (renderTick - base.k)) / TICK_RATE;
      if (next && next.x === base.x && next.y === base.y && next.p !== undefined) p = Math.min(p, next.p / 1000);
      p = Math.max(0, Math.min(1, p));
      beltPosition(base.x ?? 0, base.y ?? 0, base.e ?? 2, base.o ?? 0, p, this.pos);
      sprite.position.set(this.pos.x * TS, this.pos.y * TS);
    }
    // Sprites whose items vanished (chunk unloaded).
    for (const [id, sp] of this.sprites) {
      if (!this.world.belt.has(id)) {
        sp.destroy();
        this.sprites.delete(id);
      }
    }
  }
}
