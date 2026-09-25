// Window manager: panels open side by side in the middle of the screen (the inventory next to
// whatever you are using) and re-render when the state they show changes.

import { h } from './dom';
import { hideTooltip } from './slots';

export interface WindowDef {
  title: () => string | HTMLElement;
  render: (body: HTMLElement) => void;
  order?: number;
  width?: number;
  onClose?: () => void;
}

interface Open {
  def: WindowDef;
  el: HTMLDivElement;
  body: HTMLDivElement;
  header: HTMLElement;
}

export class Windows {
  readonly root = h('div', { class: 'windows' });
  private readonly open = new Map<string, Open>();

  constructor(ui: HTMLElement) {
    ui.append(this.root);
  }

  show(id: string, def: WindowDef): void {
    let w = this.open.get(id);
    if (!w) {
      const header = h('header');
      const body = h('div', { class: 'body' });
      const el = h('div', { class: 'panel window' }, header, body);
      el.style.order = String(def.order ?? 0);
      if (def.width) el.style.width = `${def.width}px`;
      this.root.append(el);
      w = { def, el, body, header };
      this.open.set(id, w);
    } else {
      w.def = def;
      if (def.width) w.el.style.width = `${def.width}px`;
      w.el.style.order = String(def.order ?? 0);
    }
    this.render(id);
  }

  render(id: string): void {
    const w = this.open.get(id);
    if (!w) return;
    const title = w.def.title();
    w.header.replaceChildren(
      typeof title === 'string' ? h('span', null, title) : title,
      h('button', { class: 'close', title: 'Close (Esc)', onclick: () => this.hide(id) }, '×'),
    );
    const scroll = w.body.scrollTop;
    w.body.replaceChildren();
    w.def.render(w.body);
    w.body.scrollTop = scroll;
  }

  hide(id: string): void {
    const w = this.open.get(id);
    if (!w) return;
    w.el.remove();
    this.open.delete(id);
    hideTooltip();
    w.def.onClose?.();
  }

  isOpen(id: string): boolean {
    return this.open.has(id);
  }

  refresh(...ids: string[]): void {
    for (const id of ids.length ? ids : [...this.open.keys()]) this.render(id);
  }

  anyOpen(): boolean {
    return this.open.size > 0;
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) this.hide(id);
  }

  ids(): string[] {
    return [...this.open.keys()];
  }
}
