// Abstract input actions (design plan §4). Game code only ever reads these — never raw keys or
// mouse buttons — so a touch or gamepad source can later feed the exact same actions (§5, §90
// Phase 12) without touching gameplay code.

export const BUTTON_ACTIONS = [
  'attack',
  'aim',
  'sprint',
  'crouch',
  'shove',
  'reload',
  'interact',
  'inventory',
  'flashlight',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
  'useItem',
  'map',
  'build',
  'crafting',
  'health',
  'menu',
  'chat',
  'zoomIn',
  'zoomOut',
] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

/** A source of input (keyboard + mouse today; touch and gamepad later). */
export interface InputSource {
  /** Called once per frame to write into the shared action state. */
  poll(state: ActionState): void;
  dispose(): void;
}

export class ActionState {
  /** Movement vector, length ≤ 1. */
  moveX = 0;
  moveY = 0;
  /** Aim point in screen pixels (pointer position). */
  aimScreenX = 0;
  aimScreenY = 0;
  /** True when the aim came from a pointer this frame (vs. a stick). */
  hasPointer = false;
  /** Mouse wheel / pinch zoom accumulated this frame. */
  zoom = 0;
  private readonly held = new Set<ButtonAction>();
  private readonly pressedEdges = new Set<ButtonAction>();
  private readonly releasedEdges = new Set<ButtonAction>();
  /** Presses not yet consumed by a fixed simulation step (so quick taps are never lost). */
  private readonly stepLatch = new Set<ButtonAction>();

  setHeld(action: ButtonAction, down: boolean): void {
    if (down && !this.held.has(action)) {
      this.held.add(action);
      this.pressedEdges.add(action);
      this.stepLatch.add(action);
    } else if (!down && this.held.has(action)) {
      this.held.delete(action);
      this.releasedEdges.add(action);
    }
  }

  isHeld(action: ButtonAction): boolean {
    return this.held.has(action);
  }

  /** Pressed since the last frame. */
  pressed(action: ButtonAction): boolean {
    return this.pressedEdges.has(action);
  }

  released(action: ButtonAction): boolean {
    return this.releasedEdges.has(action);
  }

  /** Held now, or tapped since the last simulation step. Clears the tap latch. */
  heldForStep(action: ButtonAction): boolean {
    const latched = this.stepLatch.has(action);
    this.stepLatch.delete(action);
    return this.held.has(action) || latched;
  }

  /** Forget everything (window blur, opening a menu). */
  releaseAll(): void {
    for (const a of [...this.held]) this.setHeld(a, false);
    this.stepLatch.clear();
    this.moveX = 0;
    this.moveY = 0;
  }

  endFrame(): void {
    this.pressedEdges.clear();
    this.releasedEdges.clear();
    this.zoom = 0;
  }
}
