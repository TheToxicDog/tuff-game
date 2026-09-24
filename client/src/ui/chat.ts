// Text chat (design plan §73). Enter opens the input; lines fade out after a while unless the
// chat is open. Everything is rendered as text, never HTML.

import { MAX_CHAT_LENGTH } from '@tuff/shared';
import { h } from './dom';

const VISIBLE_MS = 12_000;
const MAX_LINES = 60;

export class Chat {
  readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly onSend: (text: string) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.log = h('div', { class: 'chat-log', role: 'log', ariaLabel: 'Chat' });
    this.input = h('input', {
      class: 'chat-input hidden',
      type: 'text',
      maxLength: MAX_CHAT_LENGTH,
      placeholder: 'Say something… (Enter to send, Esc to cancel)',
      autocomplete: 'off',
      on: {
        keydown: (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            const text = this.input.value.trim();
            this.input.value = '';
            if (text) this.onSend(text);
            this.close();
          } else if (e.key === 'Escape') {
            this.input.value = '';
            this.close();
          }
        },
        blur: () => {
          if (this.isOpen) this.close();
        },
      },
    });
    this.root = h('div', { class: 'chat' }, this.log, this.input);
    parent.append(this.root);
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.classList.remove('hidden');
    // Focus after the current key event so the opening key does not end up in the field.
    window.setTimeout(() => this.input.focus(), 0);
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.classList.add('hidden');
    this.input.blur();
    this.onToggle(false);
  }

  add(from: string, text: string, system = false): void {
    const line = h(
      'div',
      { class: `chat-line${system ? ' system' : ''}` },
      from && !system ? h('span', { class: 'from' }, from) : null,
      text,
    );
    this.log.append(line);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    window.setTimeout(() => {
      line.style.opacity = '0';
    }, VISIBLE_MS);
  }
}
