// Conveyor geometry (§23). An item on a conveyor tile travels from the edge it entered through
// to the edge the conveyor faces, along a straight line or a quarter circle around a corner.
// Progress runs 0 → 1 across the tile.

import { DX, DY, opposite } from '../constants';

/** Items on one conveyor tile are kept at least this far apart (4 per tile). */
export const BELT_SPACING = 0.25;
/** Tiles per second at 16 RPM. */
export const BELT_SPEED_AT_BASE = 1.6;
export const MAX_BELT_SPEED = 6;

export function beltSpeed(rpm: number): number {
  return Math.min(MAX_BELT_SPEED, (BELT_SPEED_AT_BASE * rpm) / 16);
}

/**
 * World position of an item on tile (tx, ty) that entered through side `entry` (the direction
 * from the tile centre to that edge) and leaves through side `exit`, at progress p.
 */
export function beltPosition(tx: number, ty: number, entry: number, exit: number, p: number, out: { x: number; y: number }): void {
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  const ex = cx + DX[entry] * 0.5;
  const ey = cy + DY[entry] * 0.5;
  const ox = cx + DX[exit] * 0.5;
  const oy = cy + DY[exit] * 0.5;
  if (entry === exit || entry === opposite(exit)) {
    out.x = ex + (ox - ex) * p;
    out.y = ey + (oy - ey) * p;
    return;
  }
  // Quarter circle around the corner shared by the two edges.
  const kx = cx + (DX[entry] + DX[exit]) * 0.5;
  const ky = cy + (DY[entry] + DY[exit]) * 0.5;
  const sx = ex - kx;
  const sy = ey - ky;
  const fx = ox - kx;
  const fy = oy - ky;
  const a = p * (Math.PI / 2);
  const c = Math.cos(a);
  const s = Math.sin(a);
  out.x = kx + sx * c + fx * s;
  out.y = ky + sy * c + fy * s;
}
