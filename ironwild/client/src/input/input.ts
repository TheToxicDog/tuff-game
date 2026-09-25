// Keyboard and mouse state. Gameplay code reads held keys, one-shot presses and the mouse; UI
// focus (typing in chat or a form) suppresses game keys.

export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseLeft = false;
  mouseRight = false;
  leftPressed = false;
  rightPressed = false;
  wheel = 0;
  /** True while the pointer is over a UI element (clicks do not reach the game). */
  overUi = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.typing(e)) return;
      const k = key(e);
      if (!this.held.has(k)) this.pressed.add(k);
      this.held.add(k);
      if (['Tab', 'Space', 'F1', 'Backquote'].includes(k) || (e.ctrlKey && ['KeyS', 'KeyW', 'KeyD'].includes(k))) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(key(e));
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseLeft = this.mouseRight = false;
    });
    window.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.overUi = e.target !== target && !(e.target instanceof HTMLCanvasElement);
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.mouseLeft = true;
        this.leftPressed = true;
      }
      if (e.button === 2) {
        this.mouseRight = true;
        this.rightPressed = true;
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  down(code: string): boolean {
    return this.held.has(code);
  }

  /** True once per key press. */
  hit(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  /** Clears one-shot state at the end of a frame. */
  endFrame(): void {
    this.pressed.clear();
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
  }

  releaseAll(): void {
    this.held.clear();
    this.mouseLeft = this.mouseRight = false;
  }
}

function key(e: KeyboardEvent): string {
  return e.code || e.key;
}
