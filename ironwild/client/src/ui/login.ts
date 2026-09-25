// Title screen: log in or create an account.

import { login, register, serverStatus, type Account } from '../net/api';
import { h } from './dom';

export function showLogin(root: HTMLElement): Promise<{ token: string; account: Account }> {
  return new Promise((resolve) => {
    const user = h('input', { placeholder: 'Username', autocomplete: 'username', maxlength: '20' });
    const pass = h('input', { placeholder: 'Password (8+ characters)', type: 'password', autocomplete: 'current-password' });
    const error = h('div', { class: 'error' });
    const status = h('div', { class: 'status-line' }, 'Connecting…');
    const submit = async (mode: 'login' | 'register') => {
      error.textContent = '';
      try {
        const r = mode === 'login' ? await login(user.value.trim(), pass.value) : await register(user.value.trim(), pass.value);
        screen.remove();
        resolve(r);
      } catch (err) {
        error.textContent = (err as Error).message;
      }
    };
    const form = h(
      'form',
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          void submit('login');
        },
      },
      user,
      pass,
      error,
      h('button', { class: 'gold', type: 'submit' }, 'Play'),
      h('button', { type: 'button', onclick: () => void submit('register') }, 'Create account'),
    );
    const screen = h(
      'div',
      { class: 'login-screen' },
      h(
        'div',
        { class: 'panel login-card' },
        h('div', { class: 'logo' }, 'IRON', h('span', null, 'WILD')),
        h('div', { class: 'tagline' }, 'Chop. Mine. Trade. Build machines. Everything can become a business.'),
        form,
        status,
      ),
    );
    root.append(screen);
    user.focus();
    void serverStatus().then((s) => {
      status.textContent = s
        ? `${s.name} · ${s.players}/${s.maxPlayers} online · day ${s.day} ${s.time}${s.pvp ? ' · PvP' : ''}`
        : 'Server unreachable.';
    });
  });
}

export function showMessage(root: HTMLElement, text: string, action?: { label: string; run: () => void }): void {
  const el = h(
    'div',
    { class: 'login-screen' },
    h(
      'div',
      { class: 'panel login-card' },
      h('div', { class: 'logo', style: 'font-size:36px' }, 'IRON', h('span', null, 'WILD')),
      h('p', null, text),
      action ? h('button', { class: 'gold', onclick: () => (el.remove(), action.run()) }, action.label) : null,
    ),
  );
  root.append(el);
}

export function showDeath(root: HTMLElement, by: string, crests: number, items: number, respawn: () => void): HTMLElement {
  const el = h(
    'div',
    { class: 'death' },
    h(
      'div',
      { class: 'panel card' },
      h('h1', null, 'You died'),
      h('p', null, `Killed by ${by}.`),
      h(
        'p',
        { class: 'muted' },
        crests > 0 || items > 0
          ? `You lost ₡${crests} and dropped ${items} items in a bag where you fell. Your tools are safe.`
          : 'Your tools are safe.',
      ),
      h('button', { class: 'gold', onclick: () => respawn() }, 'Wake up'),
    ),
  );
  root.append(el);
  return el;
}
