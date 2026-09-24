// Zombie pathfinding: A* on a 0.5 m navigation grid built lazily per chunk from static colliders.
// Doors, windows and player-built structures are "portal" cells: passable at a cost, so zombies
// path to them and bang on them when they are closed (or barricaded, or walled up) instead of
// clawing at solid walls. Barricades and sturdier structures cost more, so zombies prefer the
// weakest way in.

import { Block, CHUNK_SIZE, chunkKey, type Collider } from '@tuff/shared';
import type { WorldState } from './world-state';

export const NAV_CELL = 0.5;
const CELLS = CHUNK_SIZE / NAV_CELL;
const FREE = 0;
const BLOCKED = 1;
const PORTAL = 2;

interface NavChunk {
  cells: Uint8Array;
  /** Portal cell index → owning object id. */
  portals: Map<number, string>;
}

class MinHeap {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.nodes.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.nodes.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export class Navigation {
  private readonly chunks = new Map<string, NavChunk>();
  private readonly gridW: number;
  private readonly gridH: number;
  searches = 0;

  constructor(private readonly world: WorldState) {
    this.gridW = Math.ceil(world.map.width / NAV_CELL);
    this.gridH = Math.ceil(world.map.height / NAV_CELL);
  }

  private chunk(cx: number, cy: number): NavChunk {
    const key = chunkKey(cx, cy);
    let c = this.chunks.get(key);
    if (c) return c;
    c = this.build(cx, cy);
    this.chunks.set(key, c);
    return c;
  }

  private build(cx: number, cy: number): NavChunk {
    const cells = new Uint8Array(CELLS * CELLS);
    const portals = new Map<number, string>();
    const collision = this.world.compiled.collision;
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    const colliders: Collider[] = collision.queryRect(x0 - 1, y0 - 1, x0 + CHUNK_SIZE + 1, y0 + CHUNK_SIZE + 1, Block.Zombie, [], true);
    const probe = new CollisionProbe();
    // Rasterise each collider over the cells its bounds touch. Door and window colliders change
    // state at runtime, so they become portals regardless of their current state; portals win over
    // walls so doorways stay open in the grid.
    const ordered = [...colliders].sort((a, b) => Number(this.isPortal(a)) - Number(this.isPortal(b)));
    for (const c of ordered) {
      const portal = this.isPortal(c);
      const pad = portal ? 0.3 : 0.22;
      const i0 = Math.max(0, Math.floor((c.minX - pad - x0) / NAV_CELL));
      const i1 = Math.min(CELLS - 1, Math.floor((c.maxX + pad - x0) / NAV_CELL));
      const j0 = Math.max(0, Math.floor((c.minY - pad - y0) / NAV_CELL));
      const j1 = Math.min(CELLS - 1, Math.floor((c.maxY + pad - y0) / NAV_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + 0.5) * NAV_CELL;
          const y = y0 + (j + 0.5) * NAV_CELL;
          if (!probe.overlaps(x, y, pad, c)) continue;
          const idx = j * CELLS + i;
          if (portal) {
            cells[idx] = PORTAL;
            portals.set(idx, c.objectId!);
          } else if (cells[idx] !== PORTAL) {
            cells[idx] = BLOCKED;
          }
        }
      }
    }
    // The map edge is impassable.
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        const x = x0 + (i + 0.5) * NAV_CELL;
        const y = y0 + (j + 0.5) * NAV_CELL;
        if (x < 1 || y < 1 || x > this.world.map.width - 1 || y > this.world.map.height - 1) cells[j * CELLS + i] = BLOCKED;
      }
    }
    return { cells, portals };
  }

  private isPortal(c: Collider): boolean {
    const id = c.objectId;
    if (!id) return false;
    const compiled = this.world.compiled;
    return compiled.doors.has(id) || compiled.windows.has(id) || compiled.structures.has(id);
  }

  /** Forgets the grid around an area whose static geometry changed (structures, moved furniture). */
  invalidate(minX: number, minY: number, maxX: number, maxY: number): void {
    const x0 = Math.floor((minX - 1) / CHUNK_SIZE);
    const x1 = Math.floor((maxX + 1) / CHUNK_SIZE);
    const y0 = Math.floor((minY - 1) / CHUNK_SIZE);
    const y1 = Math.floor((maxY + 1) / CHUNK_SIZE);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.chunks.delete(chunkKey(cx, cy));
  }

  /** 0 free, 1 blocked, 2 portal (with its object id). */
  cellAt(gx: number, gy: number): { kind: number; portal?: string } {
    if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return { kind: BLOCKED };
    const cx = Math.floor(gx / CELLS);
    const cy = Math.floor(gy / CELLS);
    const c = this.chunk(cx, cy);
    const idx = (gy - cy * CELLS) * CELLS + (gx - cx * CELLS);
    const kind = c.cells[idx];
    return kind === PORTAL ? { kind, portal: c.portals.get(idx) } : { kind };
  }

  /** Extra cost of passing through a portal right now, or Infinity if impassable. */
  private portalCost(objectId: string | undefined): number {
    if (!objectId) return 0;
    const compiled = this.world.compiled;
    const s = compiled.effectiveState(objectId);
    const struct = compiled.structures.get(objectId);
    if (struct) return 30 + s.hp / 8;
    const boards = s.boards * 14;
    if (compiled.doors.has(objectId)) return boards + ((s.open || s.broken) && !boards ? 0 : 10);
    return boards + (s.broken ? 2 : 22);
  }

  walkable(x: number, y: number): boolean {
    const cell = this.cellAt(Math.floor(x / NAV_CELL), Math.floor(y / NAV_CELL));
    return cell.kind !== BLOCKED;
  }

  /**
   * Finds a path from (sx, sy) to (tx, ty). Returns a flat [x0, y0, x1, y1, ...] list of waypoints
   * (excluding the start), or null if nothing was found within the node budget.
   */
  findPath(sx: number, sy: number, tx: number, ty: number, budget = 3500): number[] | null {
    this.searches++;
    const sgx = Math.floor(sx / NAV_CELL);
    const sgy = Math.floor(sy / NAV_CELL);
    let tgx = Math.floor(tx / NAV_CELL);
    let tgy = Math.floor(ty / NAV_CELL);
    // If the goal cell is blocked (e.g. a player hugging a wall), use a nearby free cell.
    if (this.cellAt(tgx, tgy).kind === BLOCKED) {
      let found = false;
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (this.cellAt(tgx + dx, tgy + dy).kind !== BLOCKED) {
              tgx += dx;
              tgy += dy;
              found = true;
            }
          }
        }
      }
      if (!found) return null;
    }
    const W = this.gridW;
    const start = sgy * W + sgx;
    const goal = tgy * W + tgx;
    if (start === goal) return [tx, ty];
    const g = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const closed = new Set<number>();
    const open = new MinHeap();
    const h = (gx: number, gy: number) => {
      const dx = Math.abs(gx - tgx);
      const dy = Math.abs(gy - tgy);
      return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * 1.05;
    };
    open.push(start, h(sgx, sgy));
    let expanded = 0;
    let best = start;
    let bestH = h(sgx, sgy);
    while (open.size > 0) {
      const node = open.pop();
      if (closed.has(node)) continue;
      closed.add(node);
      if (node === goal) {
        best = node;
        break;
      }
      if (++expanded > budget) break;
      const nx = node % W;
      const ny = (node - nx) / W;
      const hn = h(nx, ny);
      if (hn < bestH) {
        bestH = hn;
        best = node;
      }
      const gNode = g.get(node)!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const mx = nx + dx;
          const my = ny + dy;
          const cell = this.cellAt(mx, my);
          if (cell.kind === BLOCKED) continue;
          // No corner cutting past blocked cells.
          if (dx !== 0 && dy !== 0 && (this.cellAt(nx + dx, ny).kind === BLOCKED || this.cellAt(nx, ny + dy).kind === BLOCKED)) continue;
          const extra = cell.kind === PORTAL ? this.portalCost(cell.portal) : 0;
          if (!Number.isFinite(extra)) continue;
          const next = my * W + mx;
          if (closed.has(next)) continue;
          const cost = gNode + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) + extra;
          if (cost < (g.get(next) ?? Infinity)) {
            g.set(next, cost);
            parent.set(next, node);
            open.push(next, cost + h(mx, my));
          }
        }
      }
    }
    if (best === start) return null;
    const cells: number[] = [];
    for (let n = best; n !== start; n = parent.get(n)!) cells.push(n);
    cells.reverse();
    return this.smooth(sx, sy, cells, best === goal ? { x: tx, y: ty } : null);
  }

  /** String-pulls a grid path into a few waypoints. */
  private smooth(sx: number, sy: number, cells: number[], exactGoal: { x: number; y: number } | null): number[] {
    const W = this.gridW;
    const pts = cells.map((n) => {
      const gx = n % W;
      return { x: (gx + 0.5) * NAV_CELL, y: ((n - gx) / W + 0.5) * NAV_CELL, portal: this.cellAt(gx, (n - gx) / W).kind === PORTAL };
    });
    if (exactGoal) pts[pts.length - 1] = { ...exactGoal, portal: false };
    const out: number[] = [];
    let ax = sx;
    let ay = sy;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(ax, ay, pts[j].x, pts[j].y)) j--;
      // Keep portals as explicit waypoints so zombies line up with doorways.
      const portalIdx = pts.slice(i, j + 1).findIndex((p) => p.portal);
      if (portalIdx > 0) j = i + portalIdx;
      out.push(pts[j].x, pts[j].y);
      ax = pts[j].x;
      ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  private clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / (NAV_CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const cell = this.cellAt(Math.floor((ax + (bx - ax) * t) / NAV_CELL), Math.floor((ay + (by - ay) * t) / NAV_CELL));
      if (cell.kind !== FREE) return false;
    }
    return true;
  }
}

/** Minimal circle-vs-collider overlap test without allocating penetration results. */
class CollisionProbe {
  overlaps(x: number, y: number, r: number, c: Collider): boolean {
    if (c.shape === 0) {
      const dx = x - c.x;
      const dy = y - c.y;
      const rr = r + c.r;
      return dx * dx + dy * dy < rr * rr;
    }
    const dx = x - c.x;
    const dy = y - c.y;
    const lx = dx * c.cos + dy * c.sin;
    const ly = -dx * c.sin + dy * c.cos;
    const qx = Math.max(-c.hx, Math.min(c.hx, lx));
    const qy = Math.max(-c.hy, Math.min(c.hy, ly));
    const ex = lx - qx;
    const ey = ly - qy;
    return ex * ex + ey * ey < r * r;
  }
}
