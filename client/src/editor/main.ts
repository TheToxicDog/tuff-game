// Editor entry point (/editor): admins only (design plan §38). Loads the content definitions and
// the live map from the server, then starts the editor on the game's renderer.

import { ContentRegistry } from '@tuff/shared';
import { currentAccount } from '../net/api';
import { GameRenderer } from '../rendering/renderer';
import { showLogin, showMessage } from '../ui/login';
import { EditorApi } from './api';
import { Editor } from './editor';

export async function startEditor(gameHost: HTMLElement, uiRoot: HTMLElement): Promise<void> {
  document.title = 'Tuff — Map Editor';
  let session = await currentAccount().catch(() => null);
  if (!session) session = await showLogin(uiRoot, 'Log in with an admin account to use the map editor.');
  if (!session.account.isAdmin) {
    showMessage(
      uiRoot,
      'Map editor',
      `The editor is for admins. Start the server with TUFF_ADMINS=${session.account.username} to give this account access.`,
      {
        label: 'Play instead',
        action: () => (location.href = '/'),
      },
    );
    return;
  }
  const loading = showMessage(uiRoot, 'Map editor', 'Loading content and map…');
  try {
    const api = new EditorApi(session.token);
    const { content, liveMap } = await api.content();
    const id = new URLSearchParams(location.search).get('map') ?? liveMap;
    const map = await api.load(id);
    const renderer = new GameRenderer();
    await renderer.init(gameHost);
    loading.remove();
    const editor = new Editor(renderer, uiRoot, api, new ContentRegistry(content), map);
    (window as unknown as { tuffEditor: unknown }).tuffEditor = editor;
  } catch (err) {
    loading.remove();
    showMessage(uiRoot, 'Map editor', (err as Error).message, { label: 'Retry', action: () => location.reload() });
  }
}
