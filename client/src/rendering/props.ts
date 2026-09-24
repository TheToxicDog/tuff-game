// Outdoor props (trees, cars, dumpsters, streetlights, decals), grouped into per-chunk containers
// on each render layer so whole chunks can be culled at once. Tree canopies render above
// characters and turn translucent when the player walks underneath.

import { Container, Graphics } from 'pixi.js';
import { CHUNK_SIZE, type ContentRegistry, type PropInstance } from '@tuff/shared';
import { hashId } from './buildings';
import { propContext } from './prop-styles';

export interface PropLayers {
  ground: Container;
  low: Container;
  tall: Container;
  canopy: Container;
}

interface ChunkGroup {
  cx: number;
  cy: number;
  containers: Partial<Record<keyof PropLayers, Container>>;
}

interface CanopyView {
  g: Graphics;
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

function hex(c: string | undefined): number {
  return parseInt((c ?? '#777777').replace('#', ''), 16);
}

export class PropRenderer {
  private readonly groups = new Map<string, ChunkGroup>();
  private readonly views = new Map<string, { graphics: Graphics[]; canopy?: CanopyView }>();
  private readonly canopies = new Set<CanopyView>();

  constructor(
    private readonly layers: PropLayers,
    private readonly content: ContentRegistry,
  ) {}

  private container(p: PropInstance, layer: keyof PropLayers): Container {
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cy = Math.floor(p.y / CHUNK_SIZE);
    const key = `${cx},${cy}`;
    let group = this.groups.get(key);
    if (!group) {
      group = { cx, cy, containers: {} };
      this.groups.set(key, group);
    }
    let c = group.containers[layer];
    if (!c) {
      c = new Container();
      group.containers[layer] = c;
      this.layers[layer].addChild(c);
    }
    return c;
  }

  add(p: PropInstance): void {
    if (this.views.has(p.id)) return;
    const def = this.content.findProp(p.type);
    if (!def) return;
    const variant = p.variant ?? hashId(p.id);
    const w = p.w ?? def.w ?? 1;
    const h = p.h ?? def.h ?? 1;
    const graphics: Graphics[] = [];
    let canopy: CanopyView | undefined;
    if (def.layer === 'canopy') {
      if (def.style.startsWith('tree')) {
        const trunk = new Graphics();
        trunk.circle(0.06, 0.08, (def.r ?? 0.3) + 0.05).fill({ color: 0x000000, alpha: 0.3 });
        trunk.circle(0, 0, def.r ?? 0.3).fill(0x4a3a2a);
        trunk.circle(-0.05, -0.05, (def.r ?? 0.3) * 0.6).fill(0x5a4632);
        trunk.position.set(p.x, p.y);
        this.container(p, 'low').addChild(trunk);
        graphics.push(trunk);
      }
      const g = new Graphics(propContext(def.style, w, h, def.r ?? 0.3, hex(def.color), variant));
      g.position.set(p.x, p.y);
      g.rotation = p.rot;
      this.container(p, 'canopy').addChild(g);
      graphics.push(g);
      canopy = { g, x: p.x, y: p.y, radius: def.style === 'canopy' ? Math.max(w, h) / 2 : 2.4, alpha: 1 };
      this.canopies.add(canopy);
    } else {
      const g = new Graphics(propContext(def.style, w, h, def.r ?? 0.3, hex(def.color), variant));
      g.position.set(p.x, p.y);
      g.rotation = p.rot;
      const layer = def.layer === 'ground' ? 'ground' : def.layer === 'tall' ? 'tall' : 'low';
      this.container(p, layer).addChild(g);
      graphics.push(g);
    }
    this.views.set(p.id, { graphics, canopy });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    for (const g of v.graphics) g.destroy();
    if (v.canopy) this.canopies.delete(v.canopy);
    this.views.delete(id);
  }

  update(dt: number, px: number, py: number, view: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const margin = 4;
    for (const group of this.groups.values()) {
      const x0 = group.cx * CHUNK_SIZE;
      const y0 = group.cy * CHUNK_SIZE;
      const vis =
        x0 + CHUNK_SIZE + margin >= view.minX &&
        x0 - margin <= view.maxX &&
        y0 + CHUNK_SIZE + margin >= view.minY &&
        y0 - margin <= view.maxY;
      for (const c of Object.values(group.containers)) c.visible = vis;
    }
    for (const c of this.canopies) {
      if (c.x < view.minX - 4 || c.x > view.maxX + 4 || c.y < view.minY - 4 || c.y > view.maxY + 4) continue;
      const under = Math.hypot(px - c.x, py - c.y) < c.radius;
      const target = under ? 0.28 : 1;
      c.alpha += (target - c.alpha) * Math.min(1, dt * 8);
      c.g.alpha = c.alpha;
    }
  }
}
