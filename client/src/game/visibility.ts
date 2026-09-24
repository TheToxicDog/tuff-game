// Line-of-sight polygon from the player's eyes. Walls, closed doors and tall furniture occlude;
// everything outside the polygon is dimmed and entities there are hidden, so the top-down view
// never reveals zombies the character could not actually see (design plan §85–86).

import { Block, ShapeKind, type Collider, type CollisionWorld } from '@tuff/shared';

const EPS = 0.00012;

export class VisibilityPolygon {
  /** Flat [x0, y0, x1, y1, ...] polygon in world space. */
  points: number[] = [];
  private lastX = NaN;
  private lastY = NaN;
  private dirty = true;
  private readonly colliders: Collider[] = [];
  private readonly angles: number[] = [];

  constructor(private readonly collision: CollisionWorld) {}

  invalidate(): void {
    this.dirty = true;
  }

  update(ox: number, oy: number, radius: number): boolean {
    if (!this.dirty && Math.abs(ox - this.lastX) < 0.02 && Math.abs(oy - this.lastY) < 0.02) return false;
    this.dirty = false;
    this.lastX = ox;
    this.lastY = oy;
    const cols = this.colliders;
    cols.length = 0;
    this.collision.queryRect(ox - radius, oy - radius, ox + radius, oy + radius, Block.Sight, cols);
    const angles = this.angles;
    angles.length = 0;
    const addCorner = (cx: number, cy: number) => {
      const dx = cx - ox;
      const dy = cy - oy;
      if (dx * dx + dy * dy > radius * radius * 1.2) return;
      const a = Math.atan2(dy, dx);
      angles.push(a - EPS, a, a + EPS);
    };
    for (const c of cols) {
      if (c.shape === ShapeKind.Box) {
        const ex = c.hx;
        const ey = c.hy;
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const lx = sx * ex;
          const ly = sy * ey;
          addCorner(c.x + lx * c.cos - ly * c.sin, c.y + lx * c.sin + ly * c.cos);
        }
      } else {
        const dx = c.x - ox;
        const dy = c.y - oy;
        const d = Math.hypot(dx, dy);
        if (d <= c.r) continue;
        const a = Math.atan2(dy, dx);
        const spread = Math.asin(Math.min(1, c.r / d));
        angles.push(a - spread - EPS, a - spread, a + spread, a + spread + EPS);
      }
    }
    const ring = 48;
    for (let i = 0; i < ring; i++) angles.push(-Math.PI + (i / ring) * Math.PI * 2);
    angles.sort((a, b) => a - b);
    const pts = this.points;
    pts.length = 0;
    let lastA = -Infinity;
    for (const a of angles) {
      if (a - lastA < 1e-5) continue;
      lastA = a;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const hit = this.collision.raycast(ox, oy, dx, dy, radius, Block.Sight);
      // Push slightly into walls so their faces are lit.
      const d = hit ? Math.min(radius, hit.distance + 0.12) : radius;
      pts.push(ox + dx * d, oy + dy * d);
    }
    return true;
  }
}
