// Static collision geometry: walls, doors, windows, furniture, trees, parked cars.
//
// Colliders are circles or oriented boxes stored in a sparse uniform grid. The same code runs on
// the server (authoritative movement, bullets, line of sight) and on the client (movement
// prediction, visibility), which is what keeps predicted movement in agreement with the server.

import { clamp } from '../math/scalar';

/** Bit flags describing what a collider blocks. */
export const Block = {
  /** Blocks player movement. */
  Player: 1,
  /** Blocks zombie movement. */
  Zombie: 2,
  /** Blocks line of sight. */
  Sight: 4,
  /** Stops bullets. */
  Bullet: 8,
} as const;

export const BLOCK_MOVEMENT = Block.Player | Block.Zombie;
export const BLOCK_ALL = Block.Player | Block.Zombie | Block.Sight | Block.Bullet;

/** Surface material, used for impact effects, sounds and penetration. */
export type Material =
  | 'brick'
  | 'concrete'
  | 'wood'
  | 'drywall'
  | 'metal'
  | 'glass'
  | 'foliage'
  | 'fabric'
  | 'plastic'
  | 'stone';

export const ShapeKind = {
  Circle: 0,
  Box: 1,
} as const;
export type ShapeKind = (typeof ShapeKind)[keyof typeof ShapeKind];

export interface ColliderInit {
  shape: ShapeKind;
  x: number;
  y: number;
  /** Circle radius. */
  r?: number;
  /** Box half extents. */
  hx?: number;
  hy?: number;
  /** Box rotation in radians. */
  angle?: number;
  flags: number;
  material: Material;
  /** World object this collider belongs to (door, window, container, prop), if any. */
  objectId?: string;
  enabled?: boolean;
}

export interface Collider {
  readonly id: number;
  shape: ShapeKind;
  x: number;
  y: number;
  r: number;
  hx: number;
  hy: number;
  angle: number;
  cos: number;
  sin: number;
  flags: number;
  material: Material;
  objectId: string | undefined;
  enabled: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Query de-duplication stamp. */
  stamp: number;
  /** Grid cells this collider is registered in. */
  cells: number[];
}

export interface RayHit {
  collider: Collider;
  distance: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface Penetration {
  nx: number;
  ny: number;
  depth: number;
}

const CELL_SIZE = 4;
const KEY_OFFSET = 32768;

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) + (cy + KEY_OFFSET) * 65536;
}

export class CollisionWorld {
  private readonly colliders: (Collider | undefined)[] = [];
  private readonly freeIds: number[] = [];
  private readonly grid = new Map<number, Collider[]>();
  private stampCounter = 1;

  get size(): number {
    return this.colliders.length - this.freeIds.length;
  }

  add(init: ColliderInit): Collider {
    const id = this.freeIds.pop() ?? this.colliders.length;
    const angle = init.angle ?? 0;
    const collider: Collider = {
      id,
      shape: init.shape,
      x: init.x,
      y: init.y,
      r: init.r ?? 0,
      hx: init.hx ?? 0,
      hy: init.hy ?? 0,
      angle,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      flags: init.flags,
      material: init.material,
      objectId: init.objectId,
      enabled: init.enabled ?? true,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      stamp: 0,
      cells: [],
    };
    this.computeBounds(collider);
    this.colliders[id] = collider;
    this.insertIntoGrid(collider);
    return collider;
  }

  get(id: number): Collider | undefined {
    return this.colliders[id];
  }

  remove(collider: Collider): void {
    if (this.colliders[collider.id] !== collider) return;
    this.removeFromGrid(collider);
    this.colliders[collider.id] = undefined;
    this.freeIds.push(collider.id);
  }

  /** Moves or reshapes a collider, keeping the grid up to date. */
  update(collider: Collider, changes: Partial<Pick<Collider, 'x' | 'y' | 'angle' | 'hx' | 'hy' | 'r'>>): void {
    this.removeFromGrid(collider);
    Object.assign(collider, changes);
    collider.cos = Math.cos(collider.angle);
    collider.sin = Math.sin(collider.angle);
    this.computeBounds(collider);
    this.insertIntoGrid(collider);
  }

  private computeBounds(c: Collider): void {
    if (c.shape === ShapeKind.Circle) {
      c.minX = c.x - c.r;
      c.maxX = c.x + c.r;
      c.minY = c.y - c.r;
      c.maxY = c.y + c.r;
    } else {
      const ex = Math.abs(c.cos) * c.hx + Math.abs(c.sin) * c.hy;
      const ey = Math.abs(c.sin) * c.hx + Math.abs(c.cos) * c.hy;
      c.minX = c.x - ex;
      c.maxX = c.x + ex;
      c.minY = c.y - ey;
      c.maxY = c.y + ey;
      c.r = Math.sqrt(c.hx * c.hx + c.hy * c.hy);
    }
  }

  private insertIntoGrid(c: Collider): void {
    const x0 = Math.floor(c.minX / CELL_SIZE);
    const x1 = Math.floor(c.maxX / CELL_SIZE);
    const y0 = Math.floor(c.minY / CELL_SIZE);
    const y1 = Math.floor(c.maxY / CELL_SIZE);
    c.cells = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cellKey(cx, cy);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(c);
        c.cells.push(key);
      }
    }
  }

  private removeFromGrid(c: Collider): void {
    for (const key of c.cells) {
      const list = this.grid.get(key);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) {
        list[i] = list[list.length - 1];
        list.pop();
      }
      if (list.length === 0) this.grid.delete(key);
    }
    c.cells = [];
  }

  /** Collects enabled colliders whose bounds overlap the rectangle and match `mask`. */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, mask: number, out: Collider[] = []): Collider[] {
    const stamp = this.stampCounter++;
    const x0 = Math.floor(minX / CELL_SIZE);
    const x1 = Math.floor(maxX / CELL_SIZE);
    const y0 = Math.floor(minY / CELL_SIZE);
    const y1 = Math.floor(maxY / CELL_SIZE);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(cellKey(cx, cy));
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (!c.enabled || (c.flags & mask) === 0) continue;
          if (c.maxX < minX || c.minX > maxX || c.maxY < minY || c.minY > maxY) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Pushes a circle out of every overlapping collider matching `mask`.
   * Returns the corrected position and the collider that pushed hardest (for "blocked by" logic).
   */
  resolveCircle(
    x: number,
    y: number,
    r: number,
    mask: number,
    iterations = 3,
  ): { x: number; y: number; blocker: Collider | null } {
    let blocker: Collider | null = null;
    let deepest = 0;
    const candidates: Collider[] = [];
    for (let iter = 0; iter < iterations; iter++) {
      candidates.length = 0;
      this.queryRect(x - r, y - r, x + r, y + r, mask, candidates);
      let moved = false;
      for (const c of candidates) {
        const p = penetrateCircle(x, y, r, c);
        if (!p) continue;
        x += p.nx * p.depth;
        y += p.ny * p.depth;
        moved = true;
        if (p.depth > deepest) {
          deepest = p.depth;
          blocker = c;
        }
      }
      if (!moved) break;
    }
    return { x, y, blocker };
  }

  /** True if a circle at (x, y) overlaps any collider matching `mask`. */
  overlapsCircle(x: number, y: number, r: number, mask: number): boolean {
    const candidates = this.queryRect(x - r, y - r, x + r, y + r, mask);
    for (const c of candidates) if (penetrateCircle(x, y, r, c)) return true;
    return false;
  }

  /**
   * Casts a ray from (ox, oy) along the unit direction (dx, dy). Returns the nearest hit within
   * `maxDistance` against colliders matching `mask`, skipping those rejected by `ignore`.
   */
  raycast(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    maxDistance: number,
    mask: number,
    ignore?: (c: Collider) => boolean,
  ): RayHit | null {
    let best: RayHit | null = null;
    this.traverse(ox, oy, dx, dy, maxDistance, (list, cellExit) => {
      for (const c of list) {
        if (!c.enabled || (c.flags & mask) === 0) continue;
        if (ignore && ignore(c)) continue;
        const hit = rayCollider(ox, oy, dx, dy, c);
        if (hit && hit.distance <= maxDistance && (!best || hit.distance < best.distance)) best = hit;
      }
      // Stop once the best hit lies inside the cells visited so far.
      return best !== null && best.distance <= cellExit;
    });
    return best;
  }

  /** All hits along a ray, nearest first (used by penetrating bullets). */
  raycastAll(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    maxDistance: number,
    mask: number,
  ): RayHit[] {
    const hits: RayHit[] = [];
    const seen = new Set<number>();
    this.traverse(ox, oy, dx, dy, maxDistance, (list) => {
      for (const c of list) {
        if (!c.enabled || (c.flags & mask) === 0 || seen.has(c.id)) continue;
        seen.add(c.id);
        const hit = rayCollider(ox, oy, dx, dy, c);
        if (hit && hit.distance <= maxDistance) hits.push(hit);
      }
      return false;
    });
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  /** True when nothing matching `mask` blocks the segment between the two points. */
  lineOfSight(ax: number, ay: number, bx: number, by: number, mask: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return true;
    return this.raycast(ax, ay, dx / len, dy / len, len, mask) === null;
  }

  /**
   * Amanatides & Woo grid traversal. Calls `visit` with the colliders of each cell the ray passes
   * through, in order, along with the ray distance at which it leaves that cell. `visit` returns
   * true to stop early.
   */
  private traverse(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    maxDistance: number,
    visit: (list: Collider[], cellExit: number) => boolean,
  ): void {
    let cx = Math.floor(ox / CELL_SIZE);
    let cy = Math.floor(oy / CELL_SIZE);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(CELL_SIZE / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(CELL_SIZE / dy) : Infinity;
    let tMaxX =
      stepX > 0
        ? ((cx + 1) * CELL_SIZE - ox) / dx
        : stepX < 0
          ? (cx * CELL_SIZE - ox) / dx
          : Infinity;
    let tMaxY =
      stepY > 0
        ? ((cy + 1) * CELL_SIZE - oy) / dy
        : stepY < 0
          ? (cy * CELL_SIZE - oy) / dy
          : Infinity;
    // Colliders span several cells; a hit may lie beyond the current cell, so candidate hits are
    // only accepted as final once the traversal has passed their distance.
    for (let guard = 0; guard < 4096; guard++) {
      const cellExit = Math.min(tMaxX, tMaxY);
      const list = this.grid.get(cellKey(cx, cy));
      if (list && visit(list, Math.min(cellExit, maxDistance))) return;
      if (cellExit > maxDistance) return;
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
    }
  }
}

/** Penetration of a circle into a collider, or null if they do not overlap. */
export function penetrateCircle(x: number, y: number, r: number, c: Collider): Penetration | null {
  if (c.shape === ShapeKind.Circle) {
    const dx = x - c.x;
    const dy = y - c.y;
    const rr = r + c.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-9) return { nx: 1, ny: 0, depth: rr };
    return { nx: dx / d, ny: dy / d, depth: rr - d };
  }
  const dx = x - c.x;
  const dy = y - c.y;
  // Rotate into the box's local frame.
  const lx = dx * c.cos + dy * c.sin;
  const ly = -dx * c.sin + dy * c.cos;
  if (Math.abs(lx) > c.hx + r || Math.abs(ly) > c.hy + r) return null;
  const qx = clamp(lx, -c.hx, c.hx);
  const qy = clamp(ly, -c.hy, c.hy);
  const ex = lx - qx;
  const ey = ly - qy;
  const d2 = ex * ex + ey * ey;
  let nlx: number;
  let nly: number;
  let depth: number;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    nlx = ex / d;
    nly = ey / d;
    depth = r - d;
  } else {
    // Centre is inside the box: leave along the axis of least penetration.
    const px = c.hx - Math.abs(lx);
    const py = c.hy - Math.abs(ly);
    if (px < py) {
      nlx = lx >= 0 ? 1 : -1;
      nly = 0;
      depth = px + r;
    } else {
      nlx = 0;
      nly = ly >= 0 ? 1 : -1;
      depth = py + r;
    }
  }
  return {
    nx: nlx * c.cos - nly * c.sin,
    ny: nlx * c.sin + nly * c.cos,
    depth,
  };
}

/** Ray against a single collider. Origins inside a collider do not count as a hit. */
export function rayCollider(ox: number, oy: number, dx: number, dy: number, c: Collider): RayHit | null {
  if (c.shape === ShapeKind.Circle) {
    const t = rayCircle(ox, oy, dx, dy, c.x, c.y, c.r);
    if (t === null) return null;
    const x = ox + dx * t;
    const y = oy + dy * t;
    return { collider: c, distance: t, x, y, nx: (x - c.x) / c.r, ny: (y - c.y) / c.r };
  }
  // Box: slab test in local space.
  const rx = ox - c.x;
  const ry = oy - c.y;
  const lox = rx * c.cos + ry * c.sin;
  const loy = -rx * c.sin + ry * c.cos;
  const ldx = dx * c.cos + dy * c.sin;
  const ldy = -dx * c.sin + dy * c.cos;
  let tMin = -Infinity;
  let tMax = Infinity;
  let normalAxis = 0;
  let normalSign = 0;
  if (Math.abs(ldx) < 1e-12) {
    if (lox < -c.hx || lox > c.hx) return null;
  } else {
    const inv = 1 / ldx;
    let t1 = (-c.hx - lox) * inv;
    let t2 = (c.hx - lox) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      normalAxis = 0;
      normalSign = sign;
    }
    tMax = Math.min(tMax, t2);
  }
  if (Math.abs(ldy) < 1e-12) {
    if (loy < -c.hy || loy > c.hy) return null;
  } else {
    const inv = 1 / ldy;
    let t1 = (-c.hy - loy) * inv;
    let t2 = (c.hy - loy) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      normalAxis = 1;
      normalSign = sign;
    }
    tMax = Math.min(tMax, t2);
  }
  if (tMax < tMin || tMax < 0 || tMin < 0) return null;
  const nlx = normalAxis === 0 ? normalSign : 0;
  const nly = normalAxis === 1 ? normalSign : 0;
  return {
    collider: c,
    distance: tMin,
    x: ox + dx * tMin,
    y: oy + dy * tMin,
    nx: nlx * c.cos - nly * c.sin,
    ny: nlx * c.sin + nly * c.cos,
  };
}

/** Distance along a unit ray to a circle, or null. Origins inside the circle return null. */
export function rayCircle(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c < 0) return null;
  if (b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
