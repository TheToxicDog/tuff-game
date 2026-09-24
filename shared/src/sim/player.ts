// The player simulation step.
//
// This function is the single source of truth for how a player moves and uses weapons. The server
// runs it authoritatively for every input it receives; the client runs the exact same code to
// predict its own player immediately (no waiting for the server) and replays unacknowledged inputs
// after each snapshot. Anything random (weapon spread) is derived from a hash of the entity id and
// input sequence number so both sides agree.

import { SHOVE, type WeaponProfile } from '../content/registry';
import type { FirearmDef } from '../content/types';
import { PLAYER_RADIUS } from '../constants';
import { hash32, hashToUnit } from '../math/rng';
import { angleDelta, clamp, lerp } from '../math/scalar';
import { Block, type CollisionWorld } from '../world/collision';

export const Buttons = {
  Attack: 1,
  Aim: 2,
  Sprint: 4,
  Crouch: 8,
  Shove: 16,
  Reload: 32,
} as const;

/** Quick slot value meaning "nothing selected / empty hands". */
export const NO_SLOT = 255;

export interface PlayerInput {
  /** Monotonic sequence number, used for acknowledgement and deterministic spread. */
  seq: number;
  /** Movement direction; length ≤ 1. Quantised to 1/127 on the wire. */
  moveX: number;
  moveY: number;
  /** Aim angle in radians. */
  aim: number;
  buttons: number;
  /** Selected quick slot (0–4) or NO_SLOT. */
  slot: number;
  /** Server tick (fractional) the client was rendering, for lag compensation. */
  viewTick: number;
}

export const PlayerAction = {
  None: 0,
  Melee: 1,
  Shove: 2,
  Reload: 3,
} as const;
export type PlayerAction = (typeof PlayerAction)[keyof typeof PlayerAction];

export interface PlayerSimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  /** 0..1 */
  stamina: number;
  exhausted: boolean;
  crouching: boolean;
  sprinting: boolean;
  /** 0..1 — how settled precision aim is. */
  aimProgress: number;
  /** Accumulated recoil; spread is multiplied by (1 + bloom). */
  bloom: number;
  slot: number;
  equipTimer: number;
  /** Time until the equipped weapon can attack again. */
  cooldown: number;
  shoveCooldown: number;
  action: PlayerAction;
  actionTimer: number;
  /** Rounds in the equipped firearm's magazine. */
  magAmmo: number;
  prevButtons: number;
  /** Distance travelled since the last footstep. */
  stride: number;
}

export const MOVEMENT = {
  walk: 2.3,
  jog: 3.6,
  sprint: 5.5,
  crouch: 1.5,
  accel: 30,
  decel: 36,
  strafeFactor: 0.93,
  backpedalFactor: 0.8,
  sprintDrain: 0.1,
  regenIdle: 0.17,
  regenMoving: 0.09,
  exhaustedRecover: 0.35,
} as const;

export function createPlayerSimState(x: number, y: number): PlayerSimState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    aim: 0,
    stamina: 1,
    exhausted: false,
    crouching: false,
    sprinting: false,
    aimProgress: 0,
    bloom: 0,
    slot: NO_SLOT,
    equipTimer: 0,
    cooldown: 0,
    shoveCooldown: 0,
    action: PlayerAction.None,
    actionTimer: 0,
    magAmmo: 0,
    prevButtons: 0,
    stride: 0,
  };
}

export function copyPlayerSimState(from: PlayerSimState, to: PlayerSimState): void {
  Object.assign(to, from);
}

export interface PlayerStepHooks {
  fire?(state: PlayerSimState, weapon: WeaponProfile, angles: number[], input: PlayerInput): void;
  dryFire?(state: PlayerSimState, weapon: WeaponProfile): void;
  melee?(state: PlayerSimState, weapon: WeaponProfile, angle: number, input: PlayerInput): void;
  meleeStart?(state: PlayerSimState, weapon: WeaponProfile): void;
  shove?(state: PlayerSimState, angle: number, input: PlayerInput): void;
  reloadStart?(state: PlayerSimState, weapon: WeaponProfile): void;
  /** `rounds` rounds were moved from the reserve into the magazine. */
  reloaded?(state: PlayerSimState, weapon: WeaponProfile, rounds: number): void;
  footstep?(state: PlayerSimState, loudness: number): void;
  equip?(state: PlayerSimState, slot: number): void;
}

export interface PlayerStepEnv {
  dt: number;
  collision: CollisionWorld;
  /** Used to derive deterministic weapon spread. */
  entityId: number;
  weaponForSlot(slot: number): WeaponProfile;
  magAmmoForSlot(slot: number): number;
  reserveAmmo(caliber: string): number;
  /** Encumbrance, injuries and weakness combined (1 = unhindered). */
  speedFactor: number;
  sprintAllowed: boolean;
  /** Stamina regeneration multiplier. */
  staminaRegen: number;
  maxStamina: number;
  /** Additional spread in degrees (pain, exhaustion). */
  aimSway: number;
  /** Optional dynamic obstacle resolution (zombies). */
  blockDynamic?(x: number, y: number, r: number): { x: number; y: number };
  hooks?: PlayerStepHooks;
}

/** Current half-angle spread in radians for the given firearm. */
export function firearmSpread(state: PlayerSimState, firearm: FirearmDef, aimSway: number): number {
  const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
  const base = lerp(firearm.hipSpread, firearm.aimSpread, state.aimProgress);
  const movement = clamp(speed / MOVEMENT.jog, 0, 1.5) * firearm.hipSpread * 0.45 * (1 - 0.6 * state.aimProgress);
  let degrees = (base + movement + aimSway) * (1 + state.bloom);
  if (state.crouching) degrees *= 0.85;
  return (degrees * Math.PI) / 180;
}

/** Deterministic per-pellet spread offsets for a shot. */
export function shotAngles(entityId: number, seq: number, aim: number, spread: number, pellets: number): number[] {
  const angles: number[] = [];
  for (let p = 0; p < pellets; p++) {
    const a = hashToUnit(hash32(entityId, seq, p, 0x51));
    const b = hashToUnit(hash32(entityId, seq, p, 0xa7));
    // Triangular distribution: shots cluster toward the centre of the cone.
    angles.push(aim + (a + b - 1) * spread);
  }
  return angles;
}

/** Advances one player by one fixed input step. */
export function stepPlayer(s: PlayerSimState, input: PlayerInput, env: PlayerStepEnv): void {
  const dt = env.dt;
  const hooks = env.hooks;
  const held = input.buttons;
  const pressed = held & ~s.prevButtons;
  s.aim = input.aim;

  // --- Weapon switching -------------------------------------------------------------------
  if (input.slot !== s.slot) {
    s.slot = input.slot;
    const next = env.weaponForSlot(s.slot);
    s.equipTimer = next.equipTime;
    s.magAmmo = next.firearm ? env.magAmmoForSlot(s.slot) : 0;
    s.action = PlayerAction.None;
    s.actionTimer = 0;
    s.aimProgress = 0;
    s.bloom = 0;
    hooks?.equip?.(s, s.slot);
  }
  const weapon = env.weaponForSlot(s.slot);
  const firearm = weapon.firearm;

  s.equipTimer = Math.max(0, s.equipTimer - dt);
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.shoveCooldown = Math.max(0, s.shoveCooldown - dt);
  s.bloom = firearm ? Math.max(0, s.bloom - firearm.recoilRecovery * dt) : 0;

  const aimHeld = (held & Buttons.Aim) !== 0 && firearm !== null && s.action !== PlayerAction.Reload;
  if (aimHeld && firearm) s.aimProgress = Math.min(1, s.aimProgress + dt / firearm.aimTime);
  else s.aimProgress = Math.max(0, s.aimProgress - dt / 0.12);

  // --- Actions in progress ----------------------------------------------------------------
  if (s.action === PlayerAction.Melee) {
    s.actionTimer -= dt;
    if (s.actionTimer <= 0) {
      const melee = weapon.melee;
      s.action = PlayerAction.None;
      s.actionTimer = 0;
      if (melee) {
        s.cooldown = melee.recovery * (s.exhausted ? 1.35 : 1);
        hooks?.melee?.(s, weapon, s.aim, input);
      }
    }
  } else if (s.action === PlayerAction.Shove) {
    s.actionTimer -= dt;
    if (s.actionTimer <= 0) {
      s.action = PlayerAction.None;
      s.actionTimer = 0;
      s.shoveCooldown = SHOVE.recovery * (s.exhausted ? 1.4 : 1);
      s.cooldown = Math.max(s.cooldown, 0.18);
      hooks?.shove?.(s, s.aim, input);
    }
  } else if (s.action === PlayerAction.Reload) {
    if (!firearm) {
      s.action = PlayerAction.None;
    } else if (firearm.reloadPerRound && (pressed & Buttons.Attack) !== 0 && s.magAmmo > 0) {
      // Shell-by-shell reloads can be interrupted to fire.
      s.action = PlayerAction.None;
      s.actionTimer = 0;
    } else {
      s.actionTimer -= dt;
      if (s.actionTimer <= 0) {
        const reserve = env.reserveAmmo(firearm.caliber);
        const needed = firearm.magazine - s.magAmmo;
        const rounds = Math.max(0, Math.min(needed, reserve, firearm.reloadPerRound ? 1 : needed));
        if (rounds > 0) {
          s.magAmmo += rounds;
          hooks?.reloaded?.(s, weapon, rounds);
        }
        if (firearm.reloadPerRound && s.magAmmo < firearm.magazine && reserve - rounds > 0) {
          s.actionTimer += firearm.reloadTime;
        } else {
          s.action = PlayerAction.None;
          s.actionTimer = 0;
        }
      }
    }
  }

  // --- Starting new actions ---------------------------------------------------------------
  const canShove = s.action === PlayerAction.None || s.action === PlayerAction.Reload;
  if ((pressed & Buttons.Shove) !== 0 && canShove && s.shoveCooldown <= 0 && s.stamina > 0.02) {
    // Shoving is the emergency tool: it interrupts reloads and ignores equip time.
    s.action = PlayerAction.Shove;
    s.actionTimer = SHOVE.windup;
    s.stamina = Math.max(0, s.stamina - SHOVE.stamina);
  } else if (s.equipTimer <= 0 && s.action === PlayerAction.None) {
    if (firearm) {
      const reserve = env.reserveAmmo(firearm.caliber);
      const trigger = firearm.automatic ? (held & Buttons.Attack) !== 0 : (pressed & Buttons.Attack) !== 0;
      if ((pressed & Buttons.Reload) !== 0 && s.magAmmo < firearm.magazine && reserve > 0) {
        s.action = PlayerAction.Reload;
        s.actionTimer = firearm.reloadTime;
        hooks?.reloadStart?.(s, weapon);
      } else if (trigger && s.cooldown <= 0) {
        if (s.magAmmo > 0) {
          const spread = firearmSpread(s, firearm, env.aimSway);
          const angles = shotAngles(env.entityId, input.seq, s.aim, spread, firearm.pellets ?? 1);
          s.magAmmo -= 1;
          s.cooldown = 60 / firearm.rpm;
          s.bloom = Math.min(3, s.bloom + firearm.recoil);
          hooks?.fire?.(s, weapon, angles, input);
        } else if ((pressed & Buttons.Attack) !== 0) {
          s.cooldown = 0.25;
          hooks?.dryFire?.(s, weapon);
          if (reserve > 0) {
            s.action = PlayerAction.Reload;
            s.actionTimer = firearm.reloadTime;
            hooks?.reloadStart?.(s, weapon);
          }
        }
      }
    } else if (weapon.melee && (held & Buttons.Attack) !== 0 && s.cooldown <= 0 && s.stamina > 0.01) {
      s.action = PlayerAction.Melee;
      s.actionTimer = weapon.melee.windup * (s.exhausted ? 1.3 : 1);
      s.stamina = Math.max(0, s.stamina - weapon.melee.stamina);
      hooks?.meleeStart?.(s, weapon);
    }
  }

  // --- Movement ---------------------------------------------------------------------------
  let mx = input.moveX;
  let my = input.moveY;
  const mag = Math.sqrt(mx * mx + my * my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }
  const moving = mag > 0.05;
  s.crouching = (held & Buttons.Crouch) !== 0;
  s.sprinting =
    (held & Buttons.Sprint) !== 0 &&
    moving &&
    !s.crouching &&
    !aimHeld &&
    !s.exhausted &&
    env.sprintAllowed &&
    s.action !== PlayerAction.Reload;

  let speed = s.crouching ? MOVEMENT.crouch : aimHeld ? MOVEMENT.walk : s.sprinting ? MOVEMENT.sprint : MOVEMENT.jog;
  if (moving) {
    // Full speed moving toward the aim, slightly slower strafing, slower still backpedalling.
    const diff = Math.abs(angleDelta(Math.atan2(my, mx), s.aim));
    if (diff > Math.PI / 3) {
      const t = (diff - Math.PI / 3) / (Math.PI / 3);
      speed *= t <= 1 ? lerp(1, MOVEMENT.strafeFactor, t) : lerp(MOVEMENT.strafeFactor, MOVEMENT.backpedalFactor, Math.min(1, t - 1));
    }
  }
  if (s.action === PlayerAction.Melee || s.action === PlayerAction.Shove) speed *= 0.72;
  else if (s.action === PlayerAction.Reload) speed *= 0.85;
  speed *= env.speedFactor;

  const targetVx = mx * speed;
  const targetVy = my * speed;
  const dvx = targetVx - s.vx;
  const dvy = targetVy - s.vy;
  const dv = Math.sqrt(dvx * dvx + dvy * dvy);
  const speedingUp = targetVx * targetVx + targetVy * targetVy > s.vx * s.vx + s.vy * s.vy;
  const maxDv = (speedingUp ? MOVEMENT.accel : MOVEMENT.decel) * dt;
  if (dv <= maxDv) {
    s.vx = targetVx;
    s.vy = targetVy;
  } else {
    s.vx += (dvx / dv) * maxDv;
    s.vy += (dvy / dv) * maxDv;
  }

  const startX = s.x;
  const startY = s.y;
  let nx = s.x + s.vx * dt;
  let ny = s.y + s.vy * dt;
  const resolved = env.collision.resolveCircle(nx, ny, PLAYER_RADIUS, Block.Player);
  nx = resolved.x;
  ny = resolved.y;
  if (env.blockDynamic) {
    const d = env.blockDynamic(nx, ny, PLAYER_RADIUS);
    // Never let dynamic separation push the player into static geometry.
    const again = env.collision.resolveCircle(d.x, d.y, PLAYER_RADIUS, Block.Player);
    nx = again.x;
    ny = again.y;
  }
  // Remove the velocity component that drove into obstacles so we slide instead of sticking.
  const pushX = nx - (s.x + s.vx * dt);
  const pushY = ny - (s.y + s.vy * dt);
  const push = Math.sqrt(pushX * pushX + pushY * pushY);
  if (push > 1e-6) {
    const pnx = pushX / push;
    const pny = pushY / push;
    const into = s.vx * pnx + s.vy * pny;
    if (into < 0) {
      s.vx -= pnx * into;
      s.vy -= pny * into;
    }
  }
  s.x = nx;
  s.y = ny;

  // --- Stamina ----------------------------------------------------------------------------
  if (s.sprinting) {
    s.stamina -= MOVEMENT.sprintDrain * dt;
  } else if (s.action === PlayerAction.None) {
    s.stamina += (moving ? MOVEMENT.regenMoving : MOVEMENT.regenIdle) * env.staminaRegen * dt;
  }
  s.stamina = clamp(s.stamina, 0, env.maxStamina);
  if (s.stamina <= 0.001) s.exhausted = true;
  else if (s.exhausted && s.stamina >= Math.min(MOVEMENT.exhaustedRecover, env.maxStamina * 0.9)) s.exhausted = false;

  // --- Footsteps --------------------------------------------------------------------------
  const travelled = Math.sqrt((s.x - startX) ** 2 + (s.y - startY) ** 2);
  s.stride += travelled;
  const strideLength = s.sprinting ? 1.25 : s.crouching ? 0.6 : 0.85;
  if (s.stride >= strideLength) {
    s.stride = 0;
    const loudness = s.sprinting ? 9 : s.crouching ? 1.5 : aimHeld ? 3 : 4;
    hooks?.footstep?.(s, loudness);
  }

  s.prevButtons = held;
}
