export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function rotateVec(x: number, y: number, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function normalize(x: number, y: number): Vec2 {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

export function fromAngle(angle: number, len = 1): Vec2 {
  return { x: Math.cos(angle) * len, y: Math.sin(angle) * len };
}

export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pointInPolygon(x: number, y: number, polygon: ArrayLike<number>): boolean {
  // Even-odd rule over a flat [x0, y0, x1, y1, ...] array.
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = polygon[i];
    const yi = polygon[i + 1];
    const xj = polygon[j];
    const yj = polygon[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
