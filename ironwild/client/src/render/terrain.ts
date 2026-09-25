// Terrain: one texture for the whole island at 4 pixels per tile (linear filtering blends the
// regions softly), plus per-chunk decoration — grass tufts, flowers, pebbles, furrows, cobbles,
// ripples on the water.

import { Graphics, Sprite, Texture } from 'pixi.js';
import { CHUNK, TILES, Tile, fbm } from '@ironwild/shared';
import type { ClientWorld } from '../game/world';
import { TS, arcPath, mix, rand, shade } from './draw';
import type { Renderer } from './renderer';

const PX = 4;

export class TerrainRenderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: Texture;
  private readonly water = new Map<number, Graphics>();
  private time = 0;

  constructor(
    private readonly r: Renderer,
    private readonly world: ClientWorld,
  ) {}

  init(): void {
    const size = this.world.size * PX;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    const img = this.ctx.createImageData(size, size);
    for (let ty = 0; ty < this.world.size; ty++) for (let tx = 0; tx < this.world.size; tx++) this.paintTile(img.data, size, tx, ty);
    this.ctx.putImageData(img, 0, 0);
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'linear';
    const sprite = new Sprite(this.texture);
    sprite.scale.set(TS / PX);
    this.r.layers.terrain.addChild(sprite);
  }

  /** Base colour of a tile with gentle large-scale variation. */
  private tileColor(tx: number, ty: number): number {
    const t = this.world.tile(tx, ty);
    let c = TILES[t].color;
    if (t === Tile.Grass || t === Tile.Plains || t === Tile.Forest || t === Tile.Highland || t === Tile.Marsh) {
      const n = fbm(tx, ty, 77, 18, 2);
      c = shade(c, 0.9 + n * 0.2);
    }
    if (t === Tile.Water || t === Tile.DeepWater) {
      // Shallow edges are lighter.
      let shore = false;
      for (let oy = -1; oy <= 1 && !shore; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const n = this.world.tile(tx + ox, ty + oy);
          if (n !== Tile.Water && n !== Tile.DeepWater && n !== Tile.Bridge) shore = true;
        }
      if (shore) c = mix(c, 0x9ccbe8, 0.3);
    }
    if (t === Tile.Snow) c = shade(c, 0.95 + fbm(tx, ty, 81, 6, 2) * 0.08);
    return c;
  }

  private paintTile(data: Uint8ClampedArray, size: number, tx: number, ty: number): void {
    const base = this.tileColor(tx, ty);
    const t = this.world.tile(tx, ty);
    for (let py = 0; py < PX; py++) {
      for (let px = 0; px < PX; px++) {
        let c = base;
        const n = rand(tx * PX + px, ty * PX + py, 5);
        c = shade(c, 0.96 + n * 0.08);
        if (t === Tile.Farmland && py % 2 === 0) c = shade(c, 0.82);
        if (t === Tile.Bridge && px % 2 === 0) c = shade(c, 0.88);
        const i = ((ty * PX + py) * size + tx * PX + px) * 4;
        data[i] = (c >> 16) & 255;
        data[i + 1] = (c >> 8) & 255;
        data[i + 2] = c & 255;
        data[i + 3] = 255;
      }
    }
  }

  tilesChanged(changes: [number, number, number][]): void {
    const dirty = new Set<number>();
    for (const [x, y] of changes) {
      // Repaint the tile and its neighbours (shore shading depends on them).
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx < 0 || ty < 0 || tx >= this.world.size || ty >= this.world.size) continue;
          const img = this.ctx.createImageData(PX, PX);
          this.paintInto(img.data, tx, ty);
          this.ctx.putImageData(img, tx * PX, ty * PX);
        }
      }
      dirty.add(Math.floor(y / CHUNK) * 1024 + Math.floor(x / CHUNK));
    }
    for (const key of dirty) this.redrawDecor(key);
    this.texture.source.update();
  }

  private paintInto(data: Uint8ClampedArray, tx: number, ty: number): void {
    const base = this.tileColor(tx, ty);
    const t = this.world.tile(tx, ty);
    for (let py = 0; py < PX; py++) {
      for (let px = 0; px < PX; px++) {
        let c = shade(base, 0.96 + rand(tx * PX + px, ty * PX + py, 5) * 0.08);
        if (t === Tile.Farmland && py % 2 === 0) c = shade(c, 0.82);
        if (t === Tile.Bridge && px % 2 === 0) c = shade(c, 0.88);
        const i = (py * PX + px) * 4;
        data[i] = (c >> 16) & 255;
        data[i + 1] = (c >> 8) & 255;
        data[i + 2] = c & 255;
        data[i + 3] = 255;
      }
    }
  }

  // ——— Decoration ———

  chunkAdded(key: number): void {
    this.redrawDecor(key);
  }

  chunkRemoved(key: number): void {
    this.water.delete(key);
  }

  private redrawDecor(key: number): void {
    const layer = this.r.chunk(key, 'decor');
    layer.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();
    const waves = new Graphics();
    const cx0 = (key % 1024) * CHUNK;
    const cy0 = Math.floor(key / 1024) * CHUNK;
    const w = this.world;
    for (let ty = cy0; ty < cy0 + CHUNK; ty++) {
      for (let tx = cx0; tx < cx0 + CHUNK; tx++) {
        const t = w.tile(tx, ty);
        const r0 = rand(tx, ty, 11);
        const r1 = rand(tx, ty, 12);
        const r2 = rand(tx, ty, 13);
        const x = tx * TS;
        const y = ty * TS;
        const base = TILES[t].color;
        switch (t) {
          case Tile.Grass:
          case Tile.Plains:
          case Tile.Forest:
          case Tile.Highland: {
            if (r0 < 0.35) tuft(g, x + r1 * TS, y + r2 * TS, shade(base, t === Tile.Forest ? 0.72 : 0.8));
            if (t === Tile.Grass && r0 > 0.93)
              flower(g, x + r2 * TS, y + r1 * TS, [0xffffff, 0xf2d64a, 0xe07aa8, 0xa0c8f0][Math.floor(r1 * 4)]);
            if (t === Tile.Plains && r0 > 0.9) flower(g, x + r2 * TS, y + r1 * TS, 0xf2c53d);
            if (t === Tile.Highland && r0 > 0.8) pebble(g, x + r2 * TS, y + r1 * TS, 0x8e9084);
            if (t === Tile.Forest && r0 > 0.85)
              g.ellipse(x + r2 * TS, y + r1 * TS, 5, 3).fill({ color: [0xb07a3a, 0x9a6b3f, 0xc9973a][Math.floor(r1 * 3)], alpha: 0.7 });
            break;
          }
          case Tile.Mountain:
          case Tile.Snow:
            if (r0 < 0.3) pebble(g, x + r1 * TS, y + r2 * TS, t === Tile.Snow ? 0xd8dde2 : 0x7e7b74);
            if (t === Tile.Snow && r0 > 0.85) g.circle(x + r2 * TS, y + r1 * TS, 2).fill({ color: 0xffffff, alpha: 0.9 });
            break;
          case Tile.Cliff:
            g.poly([x + 8, y + TS - 6, x + TS * 0.4, y + 6 + r1 * 10, x + TS - 8, y + TS - 10], true).fill({
              color: shade(base, 0.8),
              alpha: 0.8,
            });
            break;
          case Tile.Sand:
          case Tile.Desert:
            if (r0 < 0.25)
              arcPath(g, x + r1 * TS, y + r2 * TS, 7, Math.PI * 1.1, Math.PI * 1.9).stroke({
                width: 2,
                color: shade(base, 0.85),
                alpha: 0.7,
              });
            break;
          case Tile.Marsh:
            if (r0 < 0.2) g.ellipse(x + r1 * TS, y + r2 * TS, 9, 5).fill({ color: 0x5b8a9a, alpha: 0.45 });
            else if (r0 < 0.45) tuft(g, x + r1 * TS, y + r2 * TS, 0x4f6f45);
            break;
          case Tile.Road:
            if (r0 < 0.3) pebble(g, x + r1 * TS, y + r2 * TS, shade(base, 0.8));
            break;
          case Tile.Farmland:
            for (let k = 0; k < 4; k++)
              g.moveTo(x + 4, y + 8 + k * 16)
                .lineTo(x + TS - 4, y + 8 + k * 16)
                .stroke({ width: 3, color: shade(base, 0.7), alpha: 0.8 });
            break;
          case Tile.Plaza:
            for (let k = 0; k < 4; k++) {
              const px = x + (k % 2) * 32 + 16 + (r0 - 0.5) * 6;
              const py = y + Math.floor(k / 2) * 32 + 16 + (r1 - 0.5) * 6;
              g.roundRect(px - 13, py - 13, 26, 26, 6).fill({ color: shade(base, 0.9 + rand(tx, ty, k) * 0.15) });
            }
            break;
          case Tile.Bridge: {
            const horizontal = TILES[w.tile(tx - 1, ty)].walk && !TILES[w.tile(tx, ty - 1)].walk;
            for (let k = 0; k < 4; k++) {
              if (horizontal) g.rect(x + k * 16 + 1, y, 13, TS).fill({ color: shade(0xa0784c, 0.9 + (k % 2) * 0.12) });
              else g.rect(x, y + k * 16 + 1, TS, 13).fill({ color: shade(0xa0784c, 0.9 + (k % 2) * 0.12) });
            }
            const water = (dx: number, dy: number) => {
              const n = w.tile(tx + dx, ty + dy);
              return n === Tile.Water || n === Tile.DeepWater;
            };
            if (water(0, -1)) g.rect(x, y, TS, 6).fill(0x6b4a2a);
            if (water(0, 1)) g.rect(x, y + TS - 6, TS, 6).fill(0x6b4a2a);
            if (water(-1, 0)) g.rect(x, y, 6, TS).fill(0x6b4a2a);
            if (water(1, 0)) g.rect(x + TS - 6, y, 6, TS).fill(0x6b4a2a);
            break;
          }
          case Tile.Water:
          case Tile.DeepWater:
            if (r0 < 0.2)
              arcPath(waves, x + r1 * TS, y + r2 * TS, 10, Math.PI * 1.15, Math.PI * 1.85).stroke({
                width: 3,
                color: 0xffffff,
                alpha: 0.35,
              });
            break;
        }
      }
    }
    layer.addChild(g, waves);
    this.water.set(key, waves);
  }

  animate(dt: number): void {
    this.time += dt;
    let i = 0;
    for (const w of this.water.values()) {
      w.alpha = 0.55 + 0.45 * Math.sin(this.time * 1.6 + i++);
      w.y = Math.sin(this.time * 0.8) * 3;
    }
  }

  minimapCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}

function tuft(g: Graphics, x: number, y: number, color: number): void {
  g.moveTo(x - 5, y + 4)
    .lineTo(x - 7, y - 5)
    .moveTo(x, y + 4)
    .lineTo(x, y - 8)
    .moveTo(x + 5, y + 4)
    .lineTo(x + 7, y - 5)
    .stroke({ width: 2.5, color, alpha: 0.85, cap: 'round' });
}

function flower(g: Graphics, x: number, y: number, color: number): void {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.circle(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 2.6).fill(color);
  }
  g.circle(x, y, 2).fill(0xf2c53d);
}

function pebble(g: Graphics, x: number, y: number, color: number): void {
  g.ellipse(x, y, 5, 3.5)
    .fill(color)
    .stroke({ width: 1.5, color: shade(color, 0.7) });
}
