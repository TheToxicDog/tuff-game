// Chat: a fading log in the corner and an input opened with Enter.

import { h } from './dom';

export class Chat {
  private readonly log = h('div', { class: 'log' });
  private readonly input = h('input', { maxlength: '240', placeholder: 'Say something… (/help for commands)', style: 'display:none' });
  readonly root = h('div', { class: 'chat' }, this.log, this.input);

  constructor(
    ui: HTMLElement,
    private readonly send: (text: string) => void,
  ) {
    ui.append(this.root);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.send(text);
        this.close();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.close();
        e.preventDefault();
      }
      e.stopPropagation();
    });
  }

  get typing(): boolean {
    return this.input.style.display !== 'none';
  }

  open(prefix = ''): void {
    this.input.style.display = 'block';
    this.input.value = prefix;
    this.input.focus();
    for (const l of this.log.children) (l as HTMLElement).style.opacity = '1';
  }

  close(): void {
    this.input.style.display = 'none';
    this.input.blur();
  }

  add(from: string, text: string, kind?: string): void {
    const line = h(
      'div',
      { class: `line ${kind ?? ''}` },
      from ? h('span', { class: 'from' }, `${from}: `) : null,
      h('span', { class: kind === 'system' ? 'system' : '' }, text),
    );
    this.log.append(line);
    while (this.log.children.length > 60) this.log.firstElementChild?.remove();
    setTimeout(() => {
      if (!this.typing) line.style.opacity = '0.25';
    }, 12000);
  }
}
