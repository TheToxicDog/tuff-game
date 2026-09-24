// Title screen with login and account creation (design plan §74).

import { ApiError, login, register, serverStatus, type Account } from '../net/api';
import { h, clear } from './dom';

export interface LoginResult {
  token: string;
  account: Account;
}

export function showLogin(parent: HTMLElement, message?: string): Promise<LoginResult> {
  return new Promise((resolve) => {
    let mode: 'login' | 'register' = 'login';
    const username = h('input', { type: 'text', autocomplete: 'username', maxLength: 20, placeholder: 'survivor_42' });
    const password = h('input', { type: 'password', autocomplete: 'current-password', maxLength: 128 });
    const confirm = h('input', { type: 'password', autocomplete: 'new-password', maxLength: 128 });
    const confirmField = h('label', { class: 'field hidden' }, h('span', null, 'Confirm password'), confirm);
    const error = h('div', { class: 'error-text', role: 'alert' }, message ?? '');
    const submit = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Enter the world');
    const switchText = h('span', { class: 'muted' });
    const switchLink = h('button', { class: 'link', type: 'button' });
    const serverLine = h('div', { class: 'server-line' }, h('span', null, 'Checking server…'));

    const setMode = (m: 'login' | 'register') => {
      mode = m;
      confirmField.classList.toggle('hidden', m === 'login');
      password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      submit.textContent = m === 'login' ? 'Enter the world' : 'Create survivor';
      switchText.textContent = m === 'login' ? 'New here? ' : 'Have an account? ';
      switchLink.textContent = m === 'login' ? 'Create an account' : 'Log in';
      error.textContent = '';
    };
    switchLink.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

    const form = h(
      'form',
      null,
      h('label', { class: 'field' }, h('span', null, 'Username'), username),
      h('label', { class: 'field' }, h('span', null, 'Password'), password),
      confirmField,
      error,
      submit,
      h('div', { style: 'margin-top:12px;font-size:13px' }, switchText, switchLink),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const u = username.value.trim();
      const p = password.value;
      if (!u || !p) {
        error.textContent = 'Enter a username and password.';
        return;
      }
      if (mode === 'register' && p !== confirm.value) {
        error.textContent = 'The passwords do not match.';
        return;
      }
      submit.disabled = true;
      try {
        const r = mode === 'login' ? await login(u, p) : await register(u, p);
        screen.remove();
        resolve(r);
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
      } finally {
        submit.disabled = false;
      }
    });

    const screen = h(
      'div',
      { class: 'screen' },
      h(
        'div',
        { class: 'title-card' },
        h('div', { class: 'logo' }, 'TUFF', h('span', null, '.')),
        h('div', { class: 'tagline' }, 'Scavenge · Survive · Die'),
        form,
        serverLine,
      ),
    );
    setMode('login');
    parent.append(screen);
    window.setTimeout(() => username.focus(), 50);

    void serverStatus().then((s) => {
      clear(serverLine);
      if (!s) {
        serverLine.append(h('span', null, h('span', { class: 'dot', style: 'background:var(--danger)' }), 'Server unreachable'));
        return;
      }
      serverLine.append(
        h('span', null, h('span', { class: 'dot' }), s.name),
        h('span', null, `${s.players}/${s.maxPlayers} online · Day ${s.day}, ${s.time}${s.pvp ? ' · PvP' : ''}`),
      );
    });
  });
}

/** A simple blocking message screen (connecting, disconnected). */
export function showMessage(parent: HTMLElement, title: string, text: string, button?: { label: string; action: () => void }): HTMLElement {
  const screen = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'title-card' },
      h('div', { class: 'logo', style: 'font-size:34px' }, title),
      h('p', { class: 'muted', style: 'line-height:1.6' }, text),
      button ? h('button', { class: 'btn primary', on: { click: button.action } }, button.label) : null,
    ),
  );
  parent.append(screen);
  return screen;
}
