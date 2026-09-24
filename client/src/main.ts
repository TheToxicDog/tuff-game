// Entry point: title screen → login → connect → game.

import './styles.css';
import { AudioEngine } from './audio/audio';
import { ClientGame } from './game/client-game';
import { currentAccount, forgetSession, logout } from './net/api';
import { Connection } from './net/connection';
import { GameRenderer } from './rendering/renderer';
import { showLogin, showMessage } from './ui/login';

const gameHost = document.getElementById('game')!;
const uiRoot = document.getElementById('ui')!;
const audio = new AudioEngine();

// Browsers only allow audio after a user gesture.
const unlockAudio = () => audio.start();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

function guardUnload(e: BeforeUnloadEvent): void {
  // Ctrl+W (crouch is also on Ctrl) should not silently close the game.
  e.preventDefault();
}

async function main(): Promise<void> {
  let session: { token: string } | null = null;
  try {
    session = await currentAccount();
  } catch {
    session = null;
  }
  if (!session) session = await showLogin(uiRoot);
  await enterGame(session.token);
}

async function enterGame(token: string): Promise<void> {
  const connecting = showMessage(uiRoot, 'TUFF', 'Connecting to the server…');
  const conn = new Connection();
  let welcome;
  try {
    welcome = await conn.connect(token);
  } catch (err) {
    connecting.remove();
    const reason = err instanceof Error ? err.message : 'Could not connect.';
    if (/log in|session|Not logged in/i.test(reason)) {
      forgetSession();
      const r = await showLogin(uiRoot, reason);
      return enterGame(r.token);
    }
    showMessage(uiRoot, 'Offline', reason, { label: 'Try again', action: () => location.reload() });
    return;
  }
  const renderer = new GameRenderer();
  await renderer.init(gameHost);
  connecting.remove();
  audio.start();
  window.addEventListener('beforeunload', guardUnload);
  const game = new ClientGame(conn, welcome, renderer, audio, uiRoot, {
    logout: () => {
      window.removeEventListener('beforeunload', guardUnload);
      game.destroy();
      void logout().finally(() => location.reload());
    },
    disconnected: (reason, code) => {
      window.removeEventListener('beforeunload', guardUnload);
      game.destroy();
      if (code === 4001) forgetSession();
      showMessage(uiRoot, 'Disconnected', reason, { label: 'Reconnect', action: () => location.reload() });
    },
  });
  // Expose for debugging and automated browser tests.
  (window as unknown as { tuff: unknown }).tuff = game;
}

void main();
