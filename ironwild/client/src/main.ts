// Entry point: title screen → login → connect → game.

import './styles.css';
import { ClientGame } from './game/client-game';
import { currentAccount, forgetSession } from './net/api';
import { Connection } from './net/connection';
import { h } from './ui/dom';
import { showLogin, showMessage } from './ui/login';

const gameHost = document.getElementById('game')!;
const uiRoot = document.getElementById('ui')!;

async function boot(): Promise<void> {
  let session: Awaited<ReturnType<typeof currentAccount>> = null;
  try {
    session = await currentAccount();
  } catch {
    showMessage(uiRoot, 'Cannot reach the IRONWILD server. Is it running?', { label: 'Retry', run: () => location.reload() });
    return;
  }
  if (!session) session = await showLogin(uiRoot);
  const loading = h('div', { class: 'loading' }, 'Entering the valley…');
  uiRoot.append(loading);
  const conn = new Connection();
  let welcome;
  try {
    welcome = await conn.connect(session.token);
  } catch (err) {
    loading.remove();
    const message = (err as Error).message;
    if (message.includes('expired')) forgetSession();
    showMessage(uiRoot, message, { label: 'Try again', run: () => location.reload() });
    return;
  }
  const game = new ClientGame(conn, welcome, gameHost, uiRoot);
  await game.start();
  // Handy from the browser console (and for automated play-testing).
  (window as unknown as { ironwild: ClientGame }).ironwild = game;
  loading.remove();
}

void boot();
