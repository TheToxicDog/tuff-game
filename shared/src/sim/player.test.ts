import { describe, expect, it } from 'vitest';
import { UNARMED, weaponProfile, type WeaponProfile } from '../content/registry';
import type { ItemDef } from '../content/types';
import { quantizeInput } from '../network/protocol';
import { BLOCK_ALL, CollisionWorld, ShapeKind } from '../world/collision';
import {
  Buttons,
  MOVEMENT,
  NO_SLOT,
  PlayerAction,
  createPlayerSimState,
  shotAngles,
  stepPlayer,
  type PlayerInput,
  type PlayerStepEnv,
} from './player';

const PISTOL: ItemDef = {
  id: 'pistol',
  name: 'Pistol',
  category: 'weapon',
  weight: 1,
  volume: 1,
  stackSize: 1,
  firearm: {
    caliber: '9mm',
    damage: 30,
    rpm: 300,
    magazine: 15,
    reloadTime: 1.5,
    hipSpread: 5,
    aimSpread: 1,
    aimTime: 0.4,
    recoil: 0.3,
    recoilRecovery: 1.5,
    range: 40,
    penetration: 1,
    noise: 80,
    knockback: 1,
  },
};

function env(collision: CollisionWorld, weapon: WeaponProfile = UNARMED, reserve = { n: 0 }): PlayerStepEnv {
  return {
    dt: 1 / 60,
    collision,
    entityId: 7,
    weaponForSlot: (slot) => (slot === 0 ? weapon : UNARMED),
    magAmmoForSlot: () => 5,
    reserveAmmo: () => reserve.n,
    speedFactor: 1,
    sprintAllowed: true,
    staminaRegen: 1,
    maxStamina: 1,
    aimSway: 0,
    hooks: {
      reloaded: (_s, _w, rounds) => {
        reserve.n -= rounds;
      },
    },
  };
}

function input(seq: number, partial: Partial<PlayerInput> = {}): PlayerInput {
  return quantizeInput({ seq, moveX: 0, moveY: 0, aim: 0, buttons: 0, slot: NO_SLOT, viewTick: 0, ...partial });
}

describe('stepPlayer', () => {
  it('accelerates to jog speed and to sprint speed', () => {
    const s = createPlayerSimState(0, 0);
    const e = env(new CollisionWorld());
    for (let i = 0; i < 60; i++) stepPlayer(s, input(i, { moveX: 1 }), e);
    expect(s.vx).toBeCloseTo(MOVEMENT.jog, 1);
    for (let i = 60; i < 120; i++) stepPlayer(s, input(i, { moveX: 1, buttons: Buttons.Sprint }), e);
    expect(s.vx).toBeCloseTo(MOVEMENT.sprint, 1);
    expect(s.stamina).toBeLessThan(1);
  });

  it('is deterministic for identical input streams', () => {
    const collision = new CollisionWorld();
    collision.add({ shape: ShapeKind.Box, x: 3, y: 0, hx: 0.1, hy: 3, flags: BLOCK_ALL, material: 'brick' });
    const a = createPlayerSimState(0, 0);
    const b = createPlayerSimState(0, 0);
    const inputs = Array.from({ length: 240 }, (_, i) =>
      input(i, { moveX: Math.sin(i / 20), moveY: Math.cos(i / 31), aim: i / 50, buttons: i % 90 < 30 ? Buttons.Sprint : 0 }),
    );
    for (const inp of inputs) stepPlayer(a, inp, env(collision));
    for (const inp of inputs) stepPlayer(b, inp, env(collision));
    expect(a).toEqual(b);
  });

  it('slides along walls instead of passing through them', () => {
    const collision = new CollisionWorld();
    collision.add({ shape: ShapeKind.Box, x: 2, y: 0, hx: 0.1, hy: 10, flags: BLOCK_ALL, material: 'brick' });
    const s = createPlayerSimState(0, 0);
    const e = env(collision);
    for (let i = 0; i < 180; i++) stepPlayer(s, input(i, { moveX: 1, moveY: 0.3 }), e);
    expect(s.x).toBeLessThan(2 - 0.1);
    expect(s.y).toBeGreaterThan(1);
  });

  it('fires semi-automatic weapons once per trigger press and reloads from reserve', () => {
    const pistol = weaponProfile(PISTOL);
    const reserve = { n: 20 };
    const e = env(new CollisionWorld(), pistol, reserve);
    let shots = 0;
    e.hooks!.fire = () => shots++;
    const s = createPlayerSimState(0, 0);
    let seq = 0;
    // Select slot 0 and wait out the equip time.
    for (let i = 0; i < 40; i++) stepPlayer(s, input(seq++, { slot: 0 }), e);
    expect(s.magAmmo).toBe(5);
    // Holding the trigger fires once.
    for (let i = 0; i < 30; i++) stepPlayer(s, input(seq++, { slot: 0, buttons: Buttons.Attack }), e);
    expect(shots).toBe(1);
    // Tapping fires again once the cooldown has passed.
    for (let n = 0; n < 4; n++) {
      stepPlayer(s, input(seq++, { slot: 0 }), e);
      for (let i = 0; i < 15; i++) stepPlayer(s, input(seq++, { slot: 0, buttons: Buttons.Attack }), e);
    }
    expect(shots).toBe(5);
    expect(s.magAmmo).toBe(0);
    // Reload.
    stepPlayer(s, input(seq++, { slot: 0 }), e);
    stepPlayer(s, input(seq++, { slot: 0, buttons: Buttons.Reload }), e);
    expect(s.action).toBe(PlayerAction.Reload);
    for (let i = 0; i < 100; i++) stepPlayer(s, input(seq++, { slot: 0 }), e);
    expect(s.magAmmo).toBe(15);
    expect(reserve.n).toBe(5);
  });

  it('shot spread is deterministic per entity and sequence', () => {
    const a = shotAngles(3, 100, 1, 0.1, 8);
    const b = shotAngles(3, 100, 1, 0.1, 8);
    const c = shotAngles(3, 101, 1, 0.1, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const angle of a) expect(Math.abs(angle - 1)).toBeLessThanOrEqual(0.1);
  });

  it('shoving costs stamina and has a cooldown', () => {
    const e = env(new CollisionWorld());
    let shoves = 0;
    e.hooks!.shove = () => shoves++;
    const s = createPlayerSimState(0, 0);
    let seq = 0;
    for (let n = 0; n < 3; n++) {
      stepPlayer(s, input(seq++, { buttons: Buttons.Shove }), e);
      stepPlayer(s, input(seq++), e);
    }
    for (let i = 0; i < 10; i++) stepPlayer(s, input(seq++), e);
    expect(shoves).toBe(1);
    expect(s.stamina).toBeLessThan(1);
  });
});
