export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/**
 * Frame-rate independent exponential smoothing. `lambda` is the convergence rate per second:
 * after `1 / lambda` seconds roughly 63% of the remaining distance has been covered.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Wraps an angle into the range (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Shortest signed rotation that takes `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return lerpAngle(current, target, 1 - Math.exp(-lambda * dt));
}

/** Rotates `current` toward `target` by at most `maxDelta` radians. */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return wrapAngle(current + Math.sign(delta) * maxDelta);
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
