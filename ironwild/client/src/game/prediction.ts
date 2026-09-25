// Client-side prediction of the local player's movement. Inputs are applied immediately with the
// same shared stepMovement the server runs; when the server's state arrives, unacknowledged inputs
// are replayed on top of it and any difference is hidden with a decaying visual offset.

import {
  INPUT_DT,
  InputFlags,
  cloneMoveState,
  newMoveState,
  stepMovement,
  type CollisionWorld,
  type InputTuple,
  type MeState,
  type MoveMods,
  type MoveState,
} from '@ironwild/shared';

export class Prediction {
  state: MoveState;
  prev: MoveState;
  mods: MoveMods = { speed: 1, staminaRegen: 1 };
  private pending: InputTuple[] = [];
  smoothX = 0;
  smoothY = 0;
  corrections = 0;

  constructor(x: number, y: number) {
    this.state = newMoveState(x, y);
    this.prev = cloneMoveState(this.state);
  }

  apply(input: InputTuple, world: CollisionWorld): void {
    this.prev = cloneMoveState(this.state);
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    this.run(this.state, input, world);
  }

  private run(s: MoveState, input: InputTuple, world: CollisionWorld): void {
    const [, flags, mx, my] = input;
    stepMovement(
      s,
      {
        mx,
        my,
        sprint: (flags & InputFlags.Sprint) !== 0,
        dodge: (flags & InputFlags.Dodge) !== 0,
        slow: (flags & InputFlags.Slow) !== 0,
      },
      INPUT_DT,
      world,
      this.mods,
    );
  }

  reconcile(me: MeState, world: CollisionWorld): void {
    const beforeX = this.state.x;
    const beforeY = this.state.y;
    this.mods = { speed: me.sm, staminaRegen: me.sr };
    const s: MoveState = {
      x: me.x,
      y: me.y,
      vx: me.vx,
      vy: me.vy,
      stamina: me.st,
      staminaDelay: me.sd,
      dodgeT: me.dt,
      dodgeX: me.dx,
      dodgeY: me.dy,
      dodgeCd: me.dc,
    };
    this.pending = this.pending.filter((p) => p[0] > me.q);
    for (const input of this.pending) this.run(s, input, world);
    const ex = beforeX - s.x;
    const ey = beforeY - s.y;
    const err = Math.hypot(ex, ey);
    this.prev.x += s.x - beforeX;
    this.prev.y += s.y - beforeY;
    this.state = s;
    if (err > 3) {
      this.smoothX = this.smoothY = 0;
      this.prev = cloneMoveState(s);
    } else if (err > 0.001) {
      this.smoothX += ex;
      this.smoothY += ey;
      this.corrections++;
    }
  }

  /** Visual position between the last two steps, plus the correction offset. */
  renderPosition(alpha: number, dt: number): { x: number; y: number } {
    const k = Math.pow(0.5, dt / 0.06);
    this.smoothX *= k;
    this.smoothY *= k;
    return {
      x: this.prev.x + (this.state.x - this.prev.x) * alpha + this.smoothX,
      y: this.prev.y + (this.state.y - this.prev.y) * alpha + this.smoothY,
    };
  }

  teleport(x: number, y: number): void {
    this.state = newMoveState(x, y);
    this.prev = cloneMoveState(this.state);
    this.pending = [];
    this.smoothX = this.smoothY = 0;
  }
}
