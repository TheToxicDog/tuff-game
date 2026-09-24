// The context action menu (design plan §5.4–5.5): tapping Interact does the obvious thing,
// holding it lists everything you can do with what you are looking at — open, lock, barricade,
// sleep, cook, pick up, dismantle. Options are picked with the mouse or the number keys.

import { clear, h } from './dom';

export interface MenuAction {
  label: string;
  /** Short explanation or the missing requirement. */
  detail?: string;
  disabled?: boolean;
  run: () => void;
}

export class ActionMenu {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private actions: MenuAction[] = [];
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.title = h('div', { class: 'action-menu-title' });
    this.list = h('div', { class: 'action-menu-list' });
    this.root = h('div', { class: 'action-menu panel hidden', role: 'menu' }, this.title, this.list);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.root);
  }

  open(title: string, actions: MenuAction[], x: number, y: number): void {
    this.actions = actions;
    this.title.textContent = title;
    clear(this.list);
    actions.forEach((a, i) => {
      const button = h(
        'button',
        {
          class: `action-menu-item${a.disabled ? ' disabled' : ''}`,
          role: 'menuitem',
          on: { click: () => this.pick(i) },
        },
        h('kbd', null, String(i + 1)),
        h('span', { class: 'label' }, a.label),
        a.detail ? h('span', { class: 'detail' }, a.detail) : null,
      );
      this.list.append(button);
    });
    this.isOpen = true;
    this.root.classList.remove('hidden');
    // Keep the menu on screen, next to the target.
    const rect = this.root.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - 12, Math.max(12, x + 18));
    const top = Math.min(window.innerHeight - rect.height - 12, Math.max(12, y - rect.height / 2));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }

  /** Picks option `index` (0-based). Returns true if the menu handled it. */
  pick(index: number): boolean {
    const a = this.actions[index];
    if (!a || a.disabled) return false;
    this.close();
    a.run();
    return true;
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.actions = [];
    this.onClose();
  }
}
