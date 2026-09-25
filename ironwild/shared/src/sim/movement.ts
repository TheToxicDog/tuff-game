// Player movement, shared by the server (authoritative) and the client (prediction). Both sides
// run exactly this code on the same quantised inputs, so predictions rarely need correcting.
// It only uses arithmetic and Math.sqrt, which are bit-identical across JavaScript engines.

import { DODGE_COOLDOWN, DODGE_SPEED, DODGE_STAMINA, DODGE_TIME, MAX_STAMINA, PLAYER_RADIUS, SPRINT_MULT, WALK_SPEED } from '../constants';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface CollisionWorld {
  readonly size: number;
  /** Whether a tile blocks movement (terrain or a solid structure). */
  solidAt(tx: number, ty: number): boolean;
  /** Appends static circular obstacles near (x, y) within `range`. */
  circles(x: number, y: number, range: number, out: Circle[]): void;
  /** Terrain speed multiplier at a tile. */
  speedAt(tx: number, ty: number): number;
}

export interface MoveState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number;
  /** Seconds before stamina starts regenerating. */
  staminaDelay: number;
  /** Remaining dodge time and its direction. */
  dodgeT: number;
  dodgeX: number;
  dodgeY: number;
  dodgeCd: number;
}

export interface MoveInput {
  /** −1, 0 or 1 on each axis. */
  mx: number;
  my: number;
  sprint: boolean;
  dodge: boolean;
  /** Blocking or drawing a bow slows the player down. */
  slow: boolean;
}

export interface MoveMods {
  /** Multiplier from mounts, carts and buffs. */
  speed: number;
  /** Stamina regeneration multiplier. */
  staminaRegen: number;
}

export const DEFAULT_MODS: MoveMods = { speed: 1, staminaRegen: 1 };

export function newMoveState(x: number, y: number): MoveState {
  return { x, y, vx: 0, vy: 0, stamina: MAX_STAMINA, staminaDelay: 0, dodgeT: 0, dodgeX: 0, dodgeY: 0, dodgeCd: 0 };
}

export function cloneMoveState(s: MoveState): MoveState {
  return { ...s };
}

const SQRT1_2 = Math.sqrt(0.5);
const scratch: Circle[] = [];

export function stepMovement(s: MoveState, input: MoveInput, dt: number, world: CollisionWorld, mods: MoveMods = DEFAULT_MODS): void {
  const mx = input.mx > 0 ? 1 : input.mx < 0 ? -1 : 0;
  const my = input.my > 0 ? 1 : input.my < 0 ? -1 : 0;
  const diag = mx !== 0 && my !== 0;
  const dx = diag ? mx * SQRT1_2 : mx;
  const dy = diag ? my * SQRT1_2 : my;
  const moving = mx !== 0 || my !== 0;
  const tileSpeed = world.speedAt(Math.floor(s.x), Math.floor(s.y));

  if (s.dodgeCd > 0) s.dodgeCd = Math.max(0, s.dodgeCd - dt);
  if (input.dodge && moving && s.dodgeCd <= 0 && s.dodgeT <= 0 && s.stamina >= DODGE_STAMINA) {
    s.dodgeT = DODGE_TIME;
    s.dodgeCd = DODGE_COOLDOWN;
    s.dodgeX = dx;
    s.dodgeY = dy;
    s.stamina -= DODGE_STAMINA;
    s.staminaDelay = 1;
  }

  const sprinting = input.sprint && moving && !input.slow && s.stamina > 0 && s.dodgeT <= 0;
  let speed = WALK_SPEED * tileSpeed * mods.speed;
  if (sprinting) speed *= SPRINT_MULT;
  if (input.slow) speed *= 0.55;

  if (s.dodgeT > 0) {
    const dodgeSpeed = DODGE_SPEED * (tileSpeed < 0.8 ? 0.6 : 1);
    s.vx = s.dodgeX * dodgeSpeed;
    s.vy = s.dodgeY * dodgeSpeed;
    s.dodgeT = Math.max(0, s.dodgeT - dt);
  } else {
    const k = dt * 14 > 1 ? 1 : dt * 14;
    s.vx += (dx * speed - s.vx) * k;
    s.vy += (dy * speed - s.vy) * k;
    if (!moving && s.vx * s.vx + s.vy * s.vy < 0.0004) {
      s.vx = 0;
      s.vy = 0;
    }
  }

  if (sprinting) {
    s.stamina = Math.max(0, s.stamina - 14 * dt);
    s.staminaDelay = 0.8;
  } else if (s.staminaDelay > 0) {
    s.staminaDelay = Math.max(0, s.staminaDelay - dt);
  } else if (s.stamina < MAX_STAMINA) {
    s.stamina = Math.min(MAX_STAMINA, s.stamina + 18 * mods.staminaRegen * dt);
  }

  s.x += s.vx * dt;
  s.y += s.vy * dt;
  resolveCollisions(s, PLAYER_RADIUS, world);
}

/** Pushes a circle at (p.x, p.y) out of solid tiles and static circles. */
export function resolveCollisions(p: { x: number; y: number }, r: number, world: CollisionWorld): void {
  for (let iter = 0; iter < 2; iter++) {
    const tx0 = Math.floor(p.x - r);
    const tx1 = Math.floor(p.x + r);
    const ty0 = Math.floor(p.y - r);
    const ty1 = Math.floor(p.y + r);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!world.solidAt(tx, ty)) continue;
        const cx = p.x < tx ? tx : p.x > tx + 1 ? tx + 1 : p.x;
        const cy = p.y < ty ? ty : p.y > ty + 1 ? ty + 1 : p.y;
        const ddx = p.x - cx;
        const ddy = p.y - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = r - d;
          p.x += (ddx / d) * push;
          p.y += (ddy / d) * push;
        } else {
          // Centre inside the tile: leave through the nearest side.
          const left = p.x - tx;
          const right = tx + 1 - p.x;
          const top = p.y - ty;
          const bottom = ty + 1 - p.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) p.x = tx - r;
          else if (m === right) p.x = tx + 1 + r;
          else if (m === top) p.y = ty - r;
          else p.y = ty + 1 + r;
        }
      }
    }
    scratch.length = 0;
    world.circles(p.x, p.y, r + 1.6, scratch);
    if (scratch.length > 1) scratch.sort((a, b) => a.x - b.x || a.y - b.y);
    for (const c of scratch) {
      const ddx = p.x - c.x;
      const ddy = p.y - c.y;
      const min = r + c.r;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 >= min * min) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        p.x += (ddx / d) * (min - d);
        p.y += (ddy / d) * (min - d);
      } else {
        p.x += min;
      }
    }
  }
  const lo = r;
  const hi = world.size - r;
  if (p.x < lo) p.x = lo;
  if (p.y < lo) p.y = lo;
  if (p.x > hi) p.x = hi;
  if (p.y > hi) p.y = hi;
}

/** Encodes the move part of an input as bit flags for the network. */
export const InputFlags = {
  Sprint: 1,
  Primary: 2,
  Secondary: 4,
  Dodge: 8,
  Slow: 16,
} as const;
