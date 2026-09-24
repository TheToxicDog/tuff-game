// Full-screen overlays: the escape menu (settings, controls), the death screen and the map.

import type { CharacterStats } from '@tuff/shared';
import { BUTTON_ACTIONS, type ButtonAction } from '../input/actions';
import { DEFAULT_BINDINGS, describeBinding } from '../input/bindings';
import { h, clear } from './dom';
import type { MapMarker, MapView } from './map-view';

const ACTION_LABELS: Partial<Record<ButtonAction, string>> = {
  attack: 'Attack / fire',
  aim: 'Precision aim',
  sprint: 'Sprint',
  crouch: 'Crouch (toggle)',
  shove: 'Shove',
  reload: 'Reload',
  interact: 'Interact (hold on a door to lock)',
  inventory: 'Inventory',
  flashlight: 'Flashlight',
  useItem: 'Use held item',
  map: 'Map',
  health: 'Health',
  menu: 'Menu / close',
  chat: 'Chat',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
};

export interface Settings {
  volume: number;
  ambience: number;
  showNames: boolean;
}

const SETTINGS_KEY = 'tuff.settings';

export function loadSettings(): Settings {
  const defaults: Settings = { volume: 0.8, ambience: 0.5, showNames: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Use defaults.
  }
  return defaults;
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Not persisted.
  }
}

export class EscapeMenu {
  readonly root: HTMLElement;
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    handlers: { onChange: (s: Settings) => void; onLogout: () => void; onClose: () => void; onHelp: () => void; serverName: string },
  ) {
    const slider = (label: string, key: 'volume' | 'ambience') => {
      const value = h('span', { class: 'muted' }, `${Math.round(settings[key] * 100)}`);
      const input = h('input', { type: 'range', ariaLabel: label });
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(settings[key] * 100));
      input.addEventListener('input', () => {
        settings[key] = Number(input.value) / 100;
        value.textContent = input.value;
        saveSettings(settings);
        handlers.onChange(settings);
      });
      return h('label', { class: 'slider-row' }, h('span', null, label), input, value);
    };
    const names = h('input', { type: 'checkbox' });
    names.checked = settings.showNames;
    names.addEventListener('change', () => {
      settings.showNames = names.checked;
      saveSettings(settings);
      handlers.onChange(settings);
    });
    const table = h('table', { class: 'controls-table' });
    const rows: [string, string][] = [['Move', 'W A S D']];
    for (const action of BUTTON_ACTIONS) {
      const label = ACTION_LABELS[action];
      if (label) rows.push([label, describeBinding(DEFAULT_BINDINGS[action])]);
    }
    rows.push(['Quick slots', '1 – 5'], ['Zoom', 'Mouse wheel']);
    for (const [a, b] of rows) table.append(h('tr', null, h('td', null, a), h('td', null, b)));
    const card = h(
      'div',
      { class: 'panel menu-card', role: 'dialog', ariaLabel: 'Menu' },
      h(
        'div',
        { class: 'row spread', style: 'margin-bottom:12px' },
        h('span', { class: 'panel-title' }, 'Paused — the world is not'),
        h('span', { class: 'fine' }, handlers.serverName),
      ),
      h('div', { class: 'stack' }, h('button', { class: 'btn primary', on: { click: () => this.close() } }, 'Resume')),
      h('div', { class: 'section-title' }, h('span', null, 'Audio')),
      slider('Master volume', 'volume'),
      slider('Ambience', 'ambience'),
      h('div', { class: 'section-title' }, h('span', null, 'Display')),
      h('label', { class: 'row', style: 'font-size:13px' }, names, 'Show player names'),
      h(
        'div',
        { class: 'section-title' },
        h('span', null, 'Controls'),
        h('button', { class: 'link', on: { click: () => handlers.onHelp() } }, 'Show hint'),
      ),
      table,
      h(
        'div',
        { class: 'row spread' },
        h('span', { class: 'fine' }, 'Your character stays in the world while you are away from the keyboard.'),
        h('button', { class: 'btn danger small', on: { click: () => handlers.onLogout() } }, 'Log out'),
      ),
    );
    this.root = h('div', { class: 'screen overlay hidden' }, card);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.onClose = handlers.onClose;
    parent.append(this.root);
  }

  private onClose: () => void;

  open(): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose();
  }
}

export function formatSurvival(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}, ${hours} h`;
  if (hours > 0) return `${hours} h ${Math.floor(minutes % 60)} min`;
  return `${Math.floor(minutes)} min`;
}

export class DeathScreen {
  readonly root: HTMLElement;
  private readonly cause: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly button: HTMLButtonElement;
  private timer = 0;

  constructor(
    parent: HTMLElement,
    private readonly onRespawn: () => void,
  ) {
    this.cause = h('div', { class: 'cause' });
    this.stats = h('div', { class: 'stats' });
    this.button = h('button', { class: 'btn primary', on: { click: () => this.onRespawn() } }, 'Respawn');
    this.root = h(
      'div',
      { class: 'screen overlay hidden', role: 'dialog', ariaLabel: 'You died' },
      h(
        'div',
        { class: 'death' },
        h('h1', null, 'YOU DIED'),
        this.cause,
        this.stats,
        this.button,
        h(
          'p',
          { class: 'fine', style: 'margin-top:18px' },
          'Your belongings stay on your body. A new survivor starts weakened for a while.',
        ),
      ),
    );
    parent.append(this.root);
  }

  show(cause: string, stats: CharacterStats, respawnIn: number): void {
    this.cause.textContent = cause;
    clear(this.stats);
    this.stats.append(
      h('div', null, h('b', null, formatSurvival(stats.timeAliveMinutes)), 'survived'),
      h('div', null, h('b', null, String(stats.kills)), stats.kills === 1 ? 'zombie killed' : 'zombies killed'),
      h('div', null, h('b', null, String(stats.deaths)), stats.deaths === 1 ? 'death' : 'deaths'),
    );
    this.root.classList.remove('hidden');
    let left = Math.ceil(respawnIn);
    const tick = () => {
      this.button.disabled = left > 0;
      this.button.textContent = left > 0 ? `Respawn (${left})` : 'Respawn';
      left--;
      if (left >= -1) this.timer = window.setTimeout(tick, 1000);
    };
    window.clearTimeout(this.timer);
    tick();
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

export class MapScreen {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.canvas = h('canvas');
    this.root = h(
      'div',
      { class: 'modal-backdrop hidden' },
      h(
        'div',
        { class: 'panel map-screen', role: 'dialog', ariaLabel: 'Map' },
        h(
          'div',
          { class: 'row spread', style: 'margin-bottom:8px' },
          h('span', { class: 'panel-title' }, 'Map'),
          h('button', { class: 'btn small', on: { click: () => this.close() } }, 'Close'),
        ),
        this.canvas,
        h(
          'div',
          { class: 'map-legend' },
          h('span', null, h('span', { class: 'dot', style: 'background:#e8e4d0' }), 'You'),
          h('span', null, h('span', { class: 'dot', style: 'background:#8ec06a' }), 'Survivors'),
          h('span', null, 'Unexplored areas stay dark until you visit them.'),
        ),
      ),
    );
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.append(this.root);
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  draw(map: MapView, markers: MapMarker[]): void {
    if (!this.isOpen) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(200, Math.round(rect.width * dpr));
    if (this.canvas.width !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const ctx = this.canvas.getContext('2d')!;
    const scale = size / Math.max(map.info.width, map.info.height);
    map.draw(ctx, map.info.width / 2, map.info.height / 2, scale, markers, true);
  }
}
