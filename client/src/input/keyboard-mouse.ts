// Desktop input source: keyboard + mouse → abstract actions.

import { ActionState, BUTTON_ACTIONS, type ButtonAction, type InputSource } from './actions';
import { DEFAULT_BINDINGS, MOVE_KEYS, type Bindings } from './bindings';

export class KeyboardMouseSource implements InputSource {
  private readonly down = new Set<string>();
  /** Codes pressed since the last poll, so taps shorter than a frame still register. */
  private readonly tapped = new Set<string>();
  private readonly codeToActions = new Map<string, ButtonAction[]>();
  private pointerX = window.innerWidth / 2;
  private pointerY = window.innerHeight / 2;
  private wheel = 0;
  private readonly cleanup: (() => void)[] = [];
  /** When false (typing in chat, menus open), gameplay keys are ignored. */
  enabled = true;
  /** Actions that still fire while disabled (closing menus, toggling inventory). */
  private readonly alwaysOn = new Set<ButtonAction>(['menu', 'inventory', 'map', 'health']);

  constructor(
    private readonly target: HTMLElement,
    bindings: Bindings = DEFAULT_BINDINGS,
  ) {
    for (const action of BUTTON_ACTIONS) {
      for (const code of bindings[action]) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(type, fn, opts);
      this.cleanup.push(() => window.removeEventListener(type, fn, opts));
    };
    on('keydown', (e) => {
      if (isTyping(e)) return;
      if (this.codeToActions.has(e.code) || isMoveKey(e.code)) {
        // Keep Tab, Space, arrows etc. from scrolling or moving focus.
        if (e.code !== 'F5' && e.code !== 'F11' && e.code !== 'F12') e.preventDefault();
      }
      this.down.add(e.code);
      this.tapped.add(e.code);
    });
    on('keyup', (e) => {
      this.down.delete(e.code);
    });
    on('blur', () => this.down.clear());
    const canvasTarget = this.target;
    const onMouseDown = (e: MouseEvent) => {
      this.down.add(`Mouse${e.button}`);
      this.tapped.add(`Mouse${e.button}`);
      if (e.button === 1) e.preventDefault();
    };
    canvasTarget.addEventListener('mousedown', onMouseDown);
    this.cleanup.push(() => canvasTarget.removeEventListener('mousedown', onMouseDown));
    on('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    on('mousemove', (e) => {
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
    });
    const onContext = (e: MouseEvent) => e.preventDefault();
    canvasTarget.addEventListener('contextmenu', onContext);
    this.cleanup.push(() => canvasTarget.removeEventListener('contextmenu', onContext));
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    };
    canvasTarget.addEventListener('wheel', onWheel, { passive: false });
    this.cleanup.push(() => canvasTarget.removeEventListener('wheel', onWheel));
  }

  poll(state: ActionState): void {
    for (const action of BUTTON_ACTIONS) {
      let held = false;
      if (this.enabled || this.alwaysOn.has(action)) {
        for (const [code, actions] of this.codeToActions) {
          if (actions.includes(action) && (this.down.has(code) || this.tapped.has(code))) {
            held = true;
            break;
          }
        }
      }
      state.setHeld(action, held);
    }
    let mx = 0;
    let my = 0;
    if (this.enabled) {
      if (MOVE_KEYS.left.some((k) => this.down.has(k))) mx -= 1;
      if (MOVE_KEYS.right.some((k) => this.down.has(k))) mx += 1;
      if (MOVE_KEYS.up.some((k) => this.down.has(k))) my -= 1;
      if (MOVE_KEYS.down.some((k) => this.down.has(k))) my += 1;
    }
    const len = Math.hypot(mx, my);
    state.moveX = len > 0 ? mx / len : 0;
    state.moveY = len > 0 ? my / len : 0;
    state.aimScreenX = this.pointerX;
    state.aimScreenY = this.pointerY;
    state.hasPointer = true;
    state.zoom += this.wheel;
    this.wheel = 0;
    this.tapped.clear();
  }

  /** Clears held keys (e.g. when a menu opens) so movement does not stick. */
  reset(): void {
    this.down.clear();
    this.tapped.clear();
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function isMoveKey(code: string): boolean {
  return Object.values(MOVE_KEYS).some((list) => list.includes(code));
}
