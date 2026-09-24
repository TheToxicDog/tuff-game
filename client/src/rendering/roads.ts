// Roads as crisp vector geometry on top of the terrain: sidewalks, asphalt, curbs and lane
// markings, built from the road splines in the map (design plan §39, Road Mode).

import { Container, FillPattern, Graphics, Matrix, type Texture } from 'pixi.js';
import { roadBounds, type RoadDef } from '@tuff/shared';

function offsetPolyline(points: [number, number][], offset: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let nx = 0;
    let ny = 0;
    let count = 0;
    if (i > 0) {
      const dx = x - prev[0];
      const dy = y - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      nx += -dy / len;
      ny += dx / len;
      count++;
    }
    if (i < points.length - 1) {
      const dx = next[0] - x;
      const dy = next[1] - y;
      const len = Math.hypot(dx, dy) || 1;
      nx += -dy / len;
      ny += dx / len;
      count++;
    }
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // Miter length correction, clamped for sharp corners.
    let scale = 1;
    if (count === 2) {
      const dx = x - prev[0];
      const dy = y - prev[1];
      const l = Math.hypot(dx, dy) || 1;
      const cos = (nx * -dy + ny * dx) / l;
      scale = 1 / Math.max(0.5, cos);
    }
    out.push([x + nx * offset * scale, y + ny * offset * scale]);
  }
  return out;
}

/** A strip polygon around a polyline, optionally extended past both ends. */
function strip(points: [number, number][], halfWidth: number, extend = 0): number[] {
  const pts = points.map((p) => [...p] as [number, number]);
  if (extend > 0 && pts.length >= 2) {
    const [ax, ay] = pts[0];
    const [bx, by] = pts[1];
    const l1 = Math.hypot(bx - ax, by - ay) || 1;
    pts[0] = [ax - ((bx - ax) / l1) * extend, ay - ((by - ay) / l1) * extend];
    const n = pts.length;
    const [cx, cy] = pts[n - 2];
    const [dx, dy] = pts[n - 1];
    const l2 = Math.hypot(dx - cx, dy - cy) || 1;
    pts[n - 1] = [dx + ((dx - cx) / l2) * extend, dy + ((dy - cy) / l2) * extend];
  }
  const left = offsetPolyline(pts, halfWidth);
  const right = offsetPolyline(pts, -halfWidth).reverse();
  return [...left, ...right].flat();
}

function pattern(texture: Texture, metersPerTile: number): FillPattern {
  const p = new FillPattern(texture, 'repeat');
  p.setTransform(new Matrix().scale(metersPerTile / texture.width, metersPerTile / texture.height));
  return p;
}

export class RoadRenderer {
  private readonly sidewalks = new Container();
  private readonly surfaces = new Container();
  private readonly markings = new Container();
  private readonly views = new Map<string, { graphics: Graphics[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } }>();
  private readonly asphalt: FillPattern;
  private readonly sidewalk: FillPattern;
  private readonly concrete: FillPattern;
  private readonly gravel: FillPattern;

  constructor(parent: Container, textures: { asphalt: Texture; sidewalk: Texture; concrete: Texture; gravel: Texture }) {
    parent.addChild(this.sidewalks, this.surfaces, this.markings);
    this.asphalt = pattern(textures.asphalt, 4);
    this.sidewalk = pattern(textures.sidewalk, 4);
    this.concrete = pattern(textures.concrete, 4);
    this.gravel = pattern(textures.gravel, 4);
  }

  add(road: RoadDef): void {
    if (this.views.has(road.id) || road.surface === 'dirt') return;
    const graphics: Graphics[] = [];
    const hw = road.width / 2;
    if (road.sidewalk > 0) {
      const g = new Graphics();
      g.poly(strip(road.points, hw + road.sidewalk, road.sidewalk)).fill(this.sidewalk);
      // Curb shadow line on the outer edge of the sidewalk.
      this.sidewalks.addChild(g);
      graphics.push(g);
    }
    const surface = new Graphics();
    const fill = road.surface === 'concrete' ? this.concrete : road.surface === 'gravel' ? this.gravel : this.asphalt;
    surface.poly(strip(road.points, hw, road.kind === 'driveway' ? 0 : 0.5)).fill(fill);
    if (road.kind === 'driveway') surface.poly(strip(road.points, hw)).stroke({ color: 0x2a2826, width: 0.05, alpha: 0.35 });
    this.surfaces.addChild(surface);
    graphics.push(surface);

    const marks = new Graphics();
    if (road.sidewalk > 0) {
      for (const side of [-1, 1]) {
        const edge = offsetPolyline(road.points, side * (hw + 0.06));
        marks.poly(edge.flat(), false).stroke({ color: 0x8a8880, width: 0.16, alpha: 0.9 });
        const inner = offsetPolyline(road.points, side * (hw - 0.02));
        marks.poly(inner.flat(), false).stroke({ color: 0x1a1a1a, width: 0.05, alpha: 0.5 });
      }
    }
    if (road.markings) {
      if (road.kind === 'main') {
        for (const off of [-0.12, 0.12])
          marks.poly(offsetPolyline(road.points, off).flat(), false).stroke({ color: 0xb89a3a, width: 0.1, alpha: 0.75 });
        for (const side of [-1, 1])
          marks.poly(offsetPolyline(road.points, side * (hw - 0.35)).flat(), false).stroke({ color: 0xc8c4b4, width: 0.12, alpha: 0.55 });
      } else {
        this.dashed(marks, road.points, 3, 3, 0xb89a3a, 0.11, 0.7);
      }
    }
    this.markings.addChild(marks);
    graphics.push(marks);
    const b = roadBounds(road);
    this.views.set(road.id, { graphics, bounds: b });
  }

  /** Crosswalk stripes across a road at a point. */
  crosswalk(x: number, y: number, angle: number, width: number): void {
    const g = new Graphics();
    const n = Math.floor(width / 0.6);
    for (let i = 0; i < n; i++) {
      const off = -width / 2 + 0.3 + i * 0.6;
      g.rect(-1.2, off - 0.18, 2.4, 0.36).fill({ color: 0xc8c4b4, alpha: 0.55 });
    }
    g.position.set(x, y);
    g.rotation = angle;
    this.markings.addChild(g);
  }

  private dashed(g: Graphics, points: [number, number][], dash: number, gap: number, color: number, width: number, alpha: number): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      for (let t = 0; t < len; t += dash + gap) {
        const e = Math.min(len, t + dash);
        g.moveTo(ax + ux * t, ay + uy * t).lineTo(ax + ux * e, ay + uy * e);
      }
    }
    g.stroke({ color, width, alpha });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    for (const g of v.graphics) g.destroy();
    this.views.delete(id);
  }

  cull(view: { minX: number; minY: number; maxX: number; maxY: number }): void {
    for (const v of this.views.values()) {
      const vis = v.bounds.maxX >= view.minX && v.bounds.minX <= view.maxX && v.bounds.maxY >= view.minY && v.bounds.minY <= view.maxY;
      for (const g of v.graphics) g.visible = vis;
    }
  }
}
