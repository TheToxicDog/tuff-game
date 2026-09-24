// Per-tick player simulation: consumes queued inputs through the shared `stepPlayer` (the same
// code the client predicts with), wires its hooks to combat, noise and inventory, and advances
// timed actions, bleeding, needs, flashlights and exploration.

import {
  bleedRate,
  bodyModifiers,
  canSprintWithWeight,
  encumbranceSpeed,
  INPUT_RATE,
  INPUT_STEP_SECONDS,
  inventoryWeight,
  OVERVIEW_CELL,
  PLAYER_RADIUS,
  PlayerAction,
  reserveAmmo,
  stepPlayer,
  totalPain,
  updateBleeding,
  updateBodyGameTime,
  weaponProfile,
  ZOMBIE_RADIUS,
  type MoveParams,
  type PlayerStepEnv,
  type StatusView,
} from '@tuff/shared';
import { Player, Transform, Zombie, type PlayerComp } from './components';
import type { Game } from './game';

const MAX_INPUT_BACKLOG = 120;
const EXPLORE_RADIUS = 40;

export class PlayerSystem {
  private readonly nearby: number[] = [];

  constructor(private readonly game: Game) {}

  moveParams(p: PlayerComp): MoveParams {
    const game = this.game;
    const mods = bodyModifiers(p.body, p.needs, game.minutes);
    const weak = game.minutes < p.weaknessUntil;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      speedFactor: r(encumbranceSpeed(game.content, p.inventory) * mods.speed * (weak ? 0.92 : 1)),
      sprintAllowed: canSprintWithWeight(game.content, p.inventory) && mods.canSprint,
      staminaRegen: r(mods.staminaRegen * (weak ? 0.75 : 1)),
      maxStamina: weak ? 0.65 : 1,
      aimSway: r(mods.aimSway),
    };
  }

  private env(e: number, p: PlayerComp, move: MoveParams): PlayerStepEnv {
    const game = this.game;
    const content = game.content;
    return {
      dt: INPUT_STEP_SECONDS,
      collision: game.world.compiled.collision,
      entityId: e,
      weaponForSlot: (slot) => weaponProfile(content.findItem(p.inventory.slots[slot]?.id ?? '')),
      magAmmoForSlot: (slot) => p.inventory.slots[slot]?.ammo ?? 0,
      reserveAmmo: (caliber) => reserveAmmo(content, p.inventory, caliber),
      speedFactor: move.speedFactor,
      sprintAllowed: move.sprintAllowed,
      staminaRegen: move.staminaRegen,
      maxStamina: move.maxStamina,
      aimSway: move.aimSway,
      blockDynamic: (x, y, r) => this.blockByZombies(x, y, r),
      hooks: {
        fire: (s, weapon, angles, input) => game.combat.fire(e, p, s, weapon, angles, input),
        melee: (s, weapon, angle, input) => game.combat.melee(e, p, s, weapon, angle, input, false),
        shove: (s, angle, input) => game.combat.melee(e, p, s, weaponProfile(null), angle, input, true),
        reloaded: (s, weapon, rounds) => {
          if (weapon.firearm) game.inventory.consumeAmmo(p, weapon.firearm.caliber, rounds);
          const held = p.inventory.slots[s.slot];
          if (held) held.ammo = s.magAmmo;
        },
        footstep: (s, loudness) => game.noise.emit(s.x, s.y, loudness, e),
        equip: (s) => {
          p.heldUid = p.inventory.slots[s.slot]?.uid ?? 0;
        },
      },
    };
  }

  /** Players are blocked by zombies (which is what makes being surrounded deadly). */
  private blockByZombies(x: number, y: number, r: number): { x: number; y: number } {
    this.nearby.length = 0;
    this.game.spatial.query(x, y, 1.2, this.nearby);
    for (const id of this.nearby) {
      const z = this.game.ecs.get(id, Zombie);
      if (!z || z.state === 'down') continue;
      const t = this.game.ecs.get(id, Transform)!;
      const dx = x - t.x;
      const dy = y - t.y;
      const min = r + ZOMBIE_RADIUS;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = t.x + (dx / d) * min;
        y = t.y + (dy / d) * min;
      }
    }
    return { x, y };
  }

  update(dt: number, dtMinutes: number): void {
    const game = this.game;
    for (const e of game.ecs.query(Player, Transform)) {
      const p = game.ecs.get(e, Player)!;
      const t = game.ecs.get(e, Transform)!;
      if (p.body.health <= 0) continue;
      this.consumeInputs(e, p);
      t.x = p.sim.x;
      t.y = p.sim.y;
      t.angle = p.sim.aim;
      game.spatial.set(e, t.x, t.y);

      this.updateAction(e, p, dt);

      updateBleeding(p.body, dt);
      updateBodyGameTime(p.body, p.needs, dtMinutes, game.minutes, game.rng);
      this.updateFlashlight(p, dt);

      p.refreshTimer -= dt;
      if (p.refreshTimer <= 0) {
        p.refreshTimer = 0.5;
        p.move = this.moveParams(p);
        this.explore(p, t.x, t.y);
        const status = this.statusView(p);
        const key = JSON.stringify(status);
        if (key !== p.statusKey) {
          p.statusKey = key;
          p.link?.send({ t: 'status', status });
        }
      }
      if (p.body.health <= 0) {
        const bled = bleedRate(p.body) > 0.02;
        game.killPlayer(e, bled ? 'Bled out' : p.needs.thirst < 5 ? 'Died of dehydration' : p.needs.hunger < 5 ? 'Starved' : 'Succumbed to injuries');
      }
    }
  }

  private consumeInputs(e: number, p: PlayerComp): void {
    const game = this.game;
    // Inputs are simulated at the client's fixed rate; the budget stops a client from moving
    // faster than real time, and a slightly faster drain keeps latency from creeping up.
    p.inputBudget = Math.min(p.inputBudget + game.tickSeconds * INPUT_RATE * (p.inputs.length > 12 ? 1.1 : 1), 30);
    if (p.inputs.length > MAX_INPUT_BACKLOG) p.inputs.splice(0, p.inputs.length - MAX_INPUT_BACKLOG);
    if (p.inputs.length === 0) return;
    const env = this.env(e, p, p.move);
    while (p.inputs.length > 0 && p.inputBudget >= 1) {
      const input = p.inputs.shift()!;
      p.inputBudget -= 1;
      p.viewTick = input.viewTick;
      // The held item can change through the inventory (moved, dropped, broken): re-equip.
      const heldUid = p.inventory.slots[p.sim.slot]?.uid ?? 0;
      if (heldUid !== p.heldUid) {
        p.heldUid = heldUid;
        const profile = env.weaponForSlot(p.sim.slot);
        p.sim.equipTimer = profile.equipTime;
        p.sim.magAmmo = profile.firearm ? env.magAmmoForSlot(p.sim.slot) : 0;
        p.sim.action = PlayerAction.None;
        p.sim.actionTimer = 0;
      }
      stepPlayer(p.sim, input, env);
      p.lastSeq = input.seq;
      const held = p.inventory.slots[p.sim.slot];
      if (held && held.ammo !== undefined && held.ammo !== p.sim.magAmmo && game.content.findItem(held.id)?.firearm) {
        held.ammo = p.sim.magAmmo;
      }
    }
  }

  private updateAction(e: number, p: PlayerComp, dt: number): void {
    const a = p.action;
    if (!a) return;
    const moved = Math.hypot(p.sim.x - a.startX, p.sim.y - a.startY);
    if ((a.kind === 'search' && moved > 1.6) || p.sim.action === PlayerAction.Melee || p.sim.action === PlayerAction.Shove) {
      this.game.cancelAction(p);
      return;
    }
    a.elapsed += dt;
    if (a.elapsed >= a.duration) this.game.completeAction(e, p);
  }

  private updateFlashlight(p: PlayerComp, dt: number): void {
    if (!p.flashlight) return;
    const light = this.game.inventory.lightItem(p.inventory);
    const def = light ? this.game.content.findItem(light.id) : undefined;
    if (!light || !def?.light) {
      p.flashlight = false;
      return;
    }
    light.charge = Math.max(0, (light.charge ?? 1) - dt / def.light.battery);
    if (light.charge <= 0) {
      p.flashlight = false;
      this.game.notify(p, `Your ${def.name.toLowerCase()} flickers and dies.`, 'warn');
      p.inventoryDirty = true;
    }
  }

  private explore(p: PlayerComp, x: number, y: number): void {
    const map = this.game.world.map;
    const cols = Math.ceil(map.width / OVERVIEW_CELL);
    const rows = Math.ceil(map.height / OVERVIEW_CELL);
    const r = Math.ceil(EXPLORE_RADIUS / OVERVIEW_CELL);
    const cx = Math.floor(x / OVERVIEW_CELL);
    const cy = Math.floor(y / OVERVIEW_CELL);
    for (let j = cy - r; j <= cy + r; j++) {
      for (let i = cx - r; i <= cx + r; i++) {
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        const dx = (i + 0.5) * OVERVIEW_CELL - x;
        const dy = (j + 0.5) * OVERVIEW_CELL - y;
        if (dx * dx + dy * dy > EXPLORE_RADIUS * EXPLORE_RADIUS) continue;
        const idx = j * cols + i;
        const byte = idx >> 3;
        const bit = 1 << (idx & 7);
        if (byte >= p.explored.length || p.explored[byte] & bit) continue;
        p.explored[byte] |= bit;
        p.exploredDirty.push(idx);
      }
    }
    if (p.exploredDirty.length > 0) {
      p.link?.send({ t: 'explored', cells: p.exploredDirty });
      p.exploredDirty = [];
    }
  }

  statusView(p: PlayerComp): StatusView {
    const game = this.game;
    const light = game.inventory.lightItem(p.inventory);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      health: r1(p.body.health),
      wounds: p.body.wounds.map((w) => ({
        ...w,
        severity: Math.round(w.severity * 100) / 100,
        bleeding: Math.round(w.bleeding * 1000) / 1000,
        dirty: Math.round(w.dirty * 100) / 100,
        contamination: Math.round(w.contamination * 100) / 100,
        infection: Math.round(w.infection * 100) / 100,
        age: Math.round(w.age),
      })),
      pain: Math.round(totalPain(p.body, game.minutes)),
      bleeding: Math.round(bleedRate(p.body) * 1000) / 1000,
      needs: {
        hunger: Math.round(p.needs.hunger),
        thirst: Math.round(p.needs.thirst),
        energy: Math.round(p.needs.energy),
        stress: Math.round(p.needs.stress),
      },
      painkillers: game.minutes < p.body.painkillerUntil,
      antibiotics: game.minutes < p.body.antibioticsUntil,
      weakness: game.minutes < p.weaknessUntil,
      flashlight: p.flashlight,
      flashlightCharge: light ? Math.round((light.charge ?? 1) * 100) / 100 : 0,
      hasFlashlight: !!light,
      carried: r1(inventoryWeight(game.content, p.inventory)),
      move: p.move,
    };
  }
}

export { PLAYER_RADIUS };
