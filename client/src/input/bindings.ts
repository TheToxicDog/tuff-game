// Default desktop bindings from the design plan (§4). Keys use KeyboardEvent.code so layouts
// other than QWERTY keep physical positions; mouse buttons are "Mouse0/1/2".

import type { ButtonAction } from './actions';

export type Bindings = Record<ButtonAction, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  attack: ['Mouse0'],
  aim: ['Mouse2'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  // Ctrl is the plan's crouch key, but browsers reserve Ctrl+W (close tab) and the like, so C is
  // bound too and the game asks for confirmation before the tab closes.
  crouch: ['KeyC', 'ControlLeft'],
  shove: ['KeyQ', 'Space'],
  reload: ['KeyR'],
  interact: ['KeyE'],
  inventory: ['Tab', 'KeyI'],
  flashlight: ['KeyF'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  useItem: ['KeyG'],
  map: ['KeyM'],
  build: ['KeyB'],
  health: ['KeyH'],
  menu: ['Escape'],
  chat: ['Enter', 'KeyT'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
};

export const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

export function describeBinding(codes: string[]): string {
  return codes
    .map((c) =>
      c === 'Mouse0'
        ? 'Left Click'
        : c === 'Mouse2'
          ? 'Right Click'
          : c.startsWith('Key')
            ? c.slice(3)
            : c.startsWith('Digit')
              ? c.slice(5)
              : c.replace('Left', '').replace('Right', ''),
    )
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' / ');
}
