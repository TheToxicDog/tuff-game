// Client prediction must agree with the server: both run the shared stepPlayer on the same
// quantised inputs, so reconciling against an authoritative state that saw the same inputs
// produces no correction, and a real divergence is smoothed instead of snapped.

import { describe, expect, it } from 'vitest';
import {
  Block,
  Buttons,
  CollisionWorld,
  ContentRegistry,
  createPlayerSimState,
  emptyInventory,
  NO_SLOT,
  quantizeInput,
  reserveAmmo,
  ShapeKind,
  stepPlayer,
  weaponProfile,
  type ItemDef,
  type MoveParams,
  type PlayerInput,
  type PlayerInventory,
  type PlayerStepEnv,
} from '@tuff/shared';
import { Prediction } from './prediction';

const pistol: ItemDef = {
  id: 'pistol',
  name: 'Pistol',
  category: 'weapon',
  weight: 1,
  volume: 0.5,
  stackSize: 1,
  tags: ['handgun'],
  firearm: {
    caliber: '9mm',
    damage: 30,
    rpm: 400,
    magazine: 15,
    reloadTime: 1.6,
    hipSpread: 6,
    aimSpread: 1.5,
    aimTime: 0.4,
    recoil: 0.4,
    recoilRecovery: 2,
    range: 40,
    penetration: 1,
    noise: 55,
    knockback: 1,
  },
};
const ammo: ItemDef = { id: 'ammo', name: 'Rounds', category: 'ammo', weight: 0.01, volume: 0.01, stackSize: 60, ammo: { caliber: '9mm' } };
const content = new ContentRegistry({ hash: 'test', items: [pistol, ammo], zombies: [], props: [] });
const move: MoveParams = { speedFactor: 1, sprintAllowed: true, staminaRegen: 1, maxStamina: 1, aimSway: 0 };

function world(): CollisionWorld {
  const w = new CollisionWorld();
  // A wall to slide along and a pillar to bump into.
  w.add({ shape: ShapeKind.Box, x: 10, y: 3, hx: 6, hy: 0.1, angle: 0, flags: Block.Player | Block.Bullet, material: 'brick' });
  w.add({ shape: ShapeKind.Circle, x: 6, y: 0, r: 0.5, flags: Block.Player, material: 'wood' });
  return w;
}

function inventory(): PlayerInventory {
  const inv = emptyInventory();
  inv.slots[1] = { uid: 1, id: 'pistol', qty: 1, ammo: 15 };
  inv.pockets.push({ uid: 2, id: 'ammo', qty: 30 });
  return inv;
}

function inputs(count: number): PlayerInput[] {
  const out: PlayerInput[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / 60;
    out.push(
      quantizeInput({
        seq: i + 1,
        moveX: Math.cos(t * 1.3),
        moveY: Math.sin(t * 0.7) + 0.4,
        aim: t * 0.9,
        buttons: (i % 40 < 20 ? Buttons.Sprint : 0) | (i % 25 === 0 ? Buttons.Attack : 0) | (i > 200 && i < 260 ? Buttons.Aim : 0),
        slot: i < 30 ? NO_SLOT : 1,
        viewTick: i / 3,
      }),
    );
  }
  return out;
}

/** The server side: plain stepPlayer with its own copy of the world and inventory. */
function serverEnv(collision: CollisionWorld, inv: PlayerInventory): PlayerStepEnv {
  return {
    dt: 1 / 60,
    collision,
    entityId: 7,
    weaponForSlot: (slot) => weaponProfile(content.findItem(inv.slots[slot]?.id ?? '')),
    magAmmoForSlot: (slot) => inv.slots[slot]?.ammo ?? 0,
    reserveAmmo: (caliber) => reserveAmmo(content, inv, caliber),
    ...move,
  };
}

describe('client prediction', () => {
  it('matches the server exactly when both see the same inputs', () => {
    const list = inputs(360);
    const serverInv = inventory();
    const server = createPlayerSimState(2, 0);
    const env = serverEnv(world(), serverInv);
    const clientInv = inventory();
    const p = new Prediction(createPlayerSimState(2, 0), {
      collision: world(),
      content,
      entityId: 7,
      inventory: () => clientInv,
      move: () => move,
      zombiesNear: () => [],
    });
    let shots = 0;
    p.hooks = { fire: () => shots++ };
    for (let i = 0; i < list.length; i++) {
      p.step(list[i]);
      stepPlayer(server, list[i], env);
      // The server acknowledges with a lag of 6 inputs (100 ms).
      if (i % 3 === 0 && i >= 6) {
        // The authoritative state as of 6 inputs ago, replayed from the same start.
        const replay = createPlayerSimState(2, 0);
        const replayEnv = serverEnv(world(), inventory());
        for (let k = 0; k <= i - 6; k++) stepPlayer(replay, list[k], replayEnv);
        p.reconcile(replay, list[i - 6].seq);
      }
    }
    expect(shots).toBeGreaterThan(0);
    expect(p.corrections).toBe(0);
    expect(p.state.x).toBeCloseTo(server.x, 6);
    expect(p.state.y).toBeCloseTo(server.y, 6);
    expect(p.state.magAmmo).toBe(server.magAmmo);
    expect(p.state.stamina).toBeCloseTo(server.stamina, 6);
  });

  it('smooths real corrections instead of snapping', () => {
    const inv = inventory();
    const p = new Prediction(createPlayerSimState(0, 0), {
      collision: new CollisionWorld(),
      content,
      entityId: 1,
      inventory: () => inv,
      move: () => move,
      zombiesNear: () => [],
    });
    const list = inputs(30);
    for (const input of list) p.step(input);
    // The server says we were pushed 0.5 m sideways (e.g. by a zombie the client did not know about).
    const server = createPlayerSimState(0, 0.5);
    p.reconcile(server, 0);
    expect(p.corrections).toBe(1);
    const before = p.renderPosition(1);
    expect(Math.abs(p.errorY)).toBeGreaterThan(0.4);
    // Rendering starts where the player was drawn, then eases onto the corrected path.
    expect(Math.abs(before.y - (p.state.y - 0.5))).toBeLessThan(1e-9);
    for (let i = 0; i < 60; i++) p.decay(1 / 60);
    expect(Math.abs(p.errorY)).toBeLessThan(0.01);
  });
});
