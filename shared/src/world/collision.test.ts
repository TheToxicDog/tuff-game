import { describe, expect, it } from 'vitest';
import { Block, BLOCK_ALL, CollisionWorld, ShapeKind } from './collision';
import { splitWall } from './compile';
import { decodeTerrainChunk, encodeTerrainChunk } from './map';

function wallWorld(): CollisionWorld {
  const w = new CollisionWorld();
  // A vertical wall at x = 10 from y = 0 to y = 20, 0.2 m thick.
  w.add({ shape: ShapeKind.Box, x: 10, y: 10, hx: 0.1, hy: 10, flags: BLOCK_ALL, material: 'brick' });
  return w;
}

describe('CollisionWorld', () => {
  it('pushes circles out of boxes along the shortest axis', () => {
    const w = wallWorld();
    const r = w.resolveCircle(9.8, 5, 0.3, Block.Player);
    expect(r.x).toBeCloseTo(9.6, 5);
    expect(r.y).toBeCloseTo(5, 5);
    expect(r.blocker).not.toBeNull();
  });

  it('ignores colliders that do not match the mask or are disabled', () => {
    const w = new CollisionWorld();
    const glass = w.add({ shape: ShapeKind.Box, x: 0, y: 0, hx: 1, hy: 0.05, flags: Block.Player, material: 'glass' });
    expect(w.lineOfSight(0, -2, 0, 2, Block.Sight)).toBe(true);
    expect(w.overlapsCircle(0, 0.1, 0.2, Block.Player)).toBe(true);
    glass.enabled = false;
    expect(w.overlapsCircle(0, 0.1, 0.2, Block.Player)).toBe(false);
  });

  it('handles rotated boxes', () => {
    const w = new CollisionWorld();
    w.add({ shape: ShapeKind.Box, x: 0, y: 0, hx: 2, hy: 0.1, angle: Math.PI / 4, flags: BLOCK_ALL, material: 'wood' });
    // A point on the diagonal is inside; one off to the side is not.
    expect(w.overlapsCircle(1, 1, 0.05, Block.Player)).toBe(true);
    expect(w.overlapsCircle(1, -1, 0.05, Block.Player)).toBe(false);
    const hit = w.raycast(-3, 0, 1, 0, 10, Block.Bullet);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(-0.3);
    expect(hit!.x).toBeLessThan(0.1);
  });

  it('raycasts return the nearest hit across multiple cells', () => {
    const w = new CollisionWorld();
    w.add({ shape: ShapeKind.Box, x: 30, y: 0, hx: 0.1, hy: 5, flags: BLOCK_ALL, material: 'brick' });
    w.add({ shape: ShapeKind.Circle, x: 15, y: 0, r: 0.5, flags: BLOCK_ALL, material: 'wood' });
    const hit = w.raycast(0, 0, 1, 0, 100, Block.Bullet);
    expect(hit?.collider.material).toBe('wood');
    expect(hit?.distance).toBeCloseTo(14.5, 5);
    const all = w.raycastAll(0, 0, 1, 0, 100, Block.Bullet);
    expect(all.map((h) => h.collider.material)).toEqual(['wood', 'brick']);
    expect(w.raycast(0, 0, 1, 0, 10, Block.Bullet)).toBeNull();
  });

  it('handles long colliders spanning many cells without double counting', () => {
    const w = new CollisionWorld();
    w.add({ shape: ShapeKind.Box, x: 50, y: 50, hx: 40, hy: 0.1, flags: BLOCK_ALL, material: 'brick' });
    const hit = w.raycast(20, 40, 0, 1, 50, Block.Sight);
    expect(hit?.distance).toBeCloseTo(9.9, 5);
    expect(w.queryRect(0, 0, 100, 100, BLOCK_ALL)).toHaveLength(1);
  });

  it('can remove colliders', () => {
    const w = wallWorld();
    const c = w.queryRect(0, 0, 20, 20, BLOCK_ALL)[0];
    w.remove(c);
    expect(w.size).toBe(0);
    expect(w.lineOfSight(0, 5, 20, 5, Block.Sight)).toBe(true);
  });
});

describe('splitWall', () => {
  it('cuts openings out of a wall and closes the original corners', () => {
    const segments = splitWall(0, 0, 10, 0, 0.2, [{ x: 5, y: 0, w: 1, angle: 0 }]);
    expect(segments).toHaveLength(2);
    expect(segments[0].x1).toBeCloseTo(-0.1);
    expect(segments[0].x2).toBeCloseTo(4.5);
    expect(segments[1].x1).toBeCloseTo(5.5);
    expect(segments[1].x2).toBeCloseTo(10.1);
  });

  it('ignores openings on other walls', () => {
    const segments = splitWall(0, 0, 10, 0, 0.2, [
      { x: 5, y: 3, w: 1, angle: 0 },
      { x: 5, y: 0, w: 1, angle: Math.PI / 2 },
    ]);
    expect(segments).toHaveLength(1);
  });
});

describe('terrain encoding', () => {
  it('round-trips run-length encoded chunks', () => {
    const cells = new Uint8Array(64 * 64);
    for (let i = 0; i < cells.length; i++) cells[i] = i < 1000 ? 0 : i < 3000 ? (i % 7 === 0 ? 4 : 8) : 11;
    const decoded = decodeTerrainChunk(encodeTerrainChunk(cells));
    expect(Array.from(decoded)).toEqual(Array.from(cells));
  });
});
