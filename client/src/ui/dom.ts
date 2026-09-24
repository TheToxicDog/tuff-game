// Tiny DOM helper. UI is plain DOM over the canvas: accessible, easy to style, and it will adapt
// to touch layouts later without a framework.

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  style?: string;
  title?: string;
  id?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  tabIndex?: number;
  role?: string;
  ariaLabel?: string;
  disabled?: boolean;
  autocomplete?: string;
  maxLength?: number;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
  data?: Record<string, string>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.style) el.setAttribute('style', props.style);
    if (props.title) el.title = props.title;
    if (props.id) el.id = props.id;
    if (props.role) el.setAttribute('role', props.role);
    if (props.ariaLabel) el.setAttribute('aria-label', props.ariaLabel);
    if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
    if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
    if (el instanceof HTMLInputElement) {
      if (props.type) el.type = props.type;
      if (props.value !== undefined) el.value = props.value;
      if (props.placeholder) el.placeholder = props.placeholder;
      if (props.autocomplete) el.autocomplete = props.autocomplete as AutoFill;
      if (props.maxLength) el.maxLength = props.maxLength;
    }
    if (el instanceof HTMLButtonElement) {
      el.type = (props.type as 'button' | 'submit') ?? 'button';
      if (props.disabled) el.disabled = true;
    }
    if (props.on) {
      for (const [event, handler] of Object.entries(props.on)) el.addEventListener(event, handler as EventListener);
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: HTMLElement, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
