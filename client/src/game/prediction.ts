// Local player prediction and server reconciliation.
//
// Inputs are simulated immediately with the shared `stepPlayer` so movement and shooting feel
// instant. Every snapshot carries the server's authoritative state after the last input it
// processed; we rewind to it, replay the inputs it has not seen yet, and smooth away any
// difference visually instead of snapping.

import {
  copyPlayerSimState,
  PlayerAction,
  reserveAmmo,
  stepPlayer,
  weaponProfile,
  ZOMBIE_RADIUS,
  type CollisionWorld,
  type ContentRegistry,
  type MoveParams,
  type PlayerInput,
  type PlayerInventory,
  type PlayerSimState,
  type PlayerStepEnv,
  type PlayerStepHooks,
} from '@tuff/shared';

export interface PredictionContext {
  collision: CollisionWorld;
  content: ContentRegistry;
  entityId: number;
  inventory(): PlayerInventory | null;
  move(): MoveParams;
  /** Latest known positions of zombies near a point (for body blocking). */
  zombiesNear(x: number, y: number, radius: number): { x: number; y: number }[];
}

const MAX_HISTORY = 240;

export class Prediction {
  readonly state: PlayerSimState;
  readonly prev: PlayerSimState;
  private history: PlayerInput[] = [];
  private heldUid = 0;
  /** Visual offset that absorbs corrections; decays to zero. */
  errorX = 0;
  errorY = 0;
  corrections = 0;
  hooks: PlayerStepHooks = {};

  constructor(
    initial: PlayerSimState,
    private readonly ctx: PredictionContext,
  ) {
    this.state = { ...initial };
    this.prev = { ...initial };
    this.heldUid = ctx.inventory()?.slots[initial.slot]?.uid ?? 0;
  }

  private env(hooks: PlayerStepHooks | undefined): PlayerStepEnv {
    const ctx = this.ctx;
    const inv = ctx.inventory();
    const move = ctx.move();
    return {
      dt: 1 / 60,
      collision: ctx.collision,
      entityId: ctx.entityId,
      weaponForSlot: (slot) => weaponProfile(ctx.content.findItem(inv?.slots[slot]?.id ?? '')),
      magAmmoForSlot: (slot) => inv?.slots[slot]?.ammo ?? 0,
      reserveAmmo: (caliber) => (inv ? reserveAmmo(ctx.content, inv, caliber) : 0),
      speedFactor: move.speedFactor,
      sprintAllowed: move.sprintAllowed,
      staminaRegen: move.staminaRegen,
      maxStamina: move.maxStamina,
      aimSway: move.aimSway,
      blockDynamic: (x, y, r) => {
        for (const z of ctx.zombiesNear(x, y, 1.2)) {
          const dx = x - z.x;
          const dy = y - z.y;
          const min = r + ZOMBIE_RADIUS;
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            x = z.x + (dx / d) * min;
            y = z.y + (dy / d) * min;
          }
        }
        return { x, y };
      },
      hooks,
    };
  }

  /** Mirrors the server: if the item in hand changed through the inventory, re-equip it. */
  private syncHeld(env: PlayerStepEnv): void {
    const uid = this.ctx.inventory()?.slots[this.state.slot]?.uid ?? 0;
    if (uid === this.heldUid) return;
    this.heldUid = uid;
    const profile = env.weaponForSlot(this.state.slot);
    this.state.equipTimer = profile.equipTime;
    this.state.magAmmo = profile.firearm ? env.magAmmoForSlot(this.state.slot) : 0;
    this.state.action = PlayerAction.None;
    this.state.actionTimer = 0;
  }

  step(input: PlayerInput): void {
    copyPlayerSimState(this.state, this.prev);
    const env = this.env({
      ...this.hooks,
      equip: (s, slot) => {
        this.heldUid = this.ctx.inventory()?.slots[slot]?.uid ?? 0;
        this.hooks.equip?.(s, slot);
      },
    });
    this.syncHeld(env);
    stepPlayer(this.state, input, env);
    this.history.push(input);
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  reconcile(server: PlayerSimState, ackSeq: number): void {
    while (this.history.length > 0 && this.history[0].seq <= ackSeq) this.history.shift();
    const beforeX = this.state.x;
    const beforeY = this.state.y;
    copyPlayerSimState(server, this.state);
    // Replays run without hooks: their effects were already shown when first predicted.
    const env = this.env({
      equip: (_s, slot) => {
        this.heldUid = this.ctx.inventory()?.slots[slot]?.uid ?? 0;
      },
    });
    for (const input of this.history) {
      this.syncHeld(env);
      stepPlayer(this.state, input, env);
    }
    const dx = this.state.x - beforeX;
    const dy = this.state.y - beforeY;
    if (Math.abs(dx) + Math.abs(dy) > 1e-4) {
      this.corrections++;
      if (Math.hypot(dx, dy) > 4) {
        // Teleport-sized correction (respawn, desync): snap.
        this.errorX = 0;
        this.errorY = 0;
        copyPlayerSimState(this.state, this.prev);
      } else {
        this.prev.x += dx;
        this.prev.y += dy;
        this.errorX -= dx;
        this.errorY -= dy;
      }
    }
  }

  /** Render position: interpolated between fixed steps, plus the decaying correction offset. */
  renderPosition(alpha: number): { x: number; y: number } {
    return {
      x: this.prev.x + (this.state.x - this.prev.x) * alpha + this.errorX,
      y: this.prev.y + (this.state.y - this.prev.y) * alpha + this.errorY,
    };
  }

  decay(dt: number): void {
    const k = Math.exp(-dt * 14);
    this.errorX *= k;
    this.errorY *= k;
    if (Math.abs(this.errorX) < 1e-4) this.errorX = 0;
    if (Math.abs(this.errorY) < 1e-4) this.errorY = 0;
  }

  get pending(): number {
    return this.history.length;
  }
}
