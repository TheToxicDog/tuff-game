// The map editor's server API (design plan §38, §49): admin-only access, validation of uploaded
// maps, saving to data/maps and republishing a map into the running world.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEdit, BIOMES, biomeGridSize, encodeBiomes, generateArea, MAP_RELOAD_CODE, type MapData } from '@tuff/shared';
import { loadMap, startServer, type RunningServer } from './bootstrap';
import { loadContent } from './content/loader';
import { MemoryStorage } from './persistence/memory-storage';
import { Bot, sleep } from './testing/bot';

let server: RunningServer;
let base: string;
let dataDir: string;
let admin = '';
let player = '';

beforeAll(async () => {
  const content = loadContent();
  content.config.zombies.populationMultiplier = 0;
  // Save maps into a scratch directory, not the repository.
  dataDir = mkdtempSync(join(tmpdir(), 'tuff-editor-'));
  content.dataDir = dataDir;
  const map = structuredClone(loadMap(loadContent()));
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    storage: new MemoryStorage(),
    content,
    map,
    quiet: true,
    autosaveSeconds: 3600,
    adminUsernames: ['mapper'],
  });
  base = `http://127.0.0.1:${server.port}`;
  admin = await Bot.register(base, 'mapper');
  player = await Bot.register(base, 'visitor');
});

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function api(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

describe('editor api', () => {
  it('is only available to admins', async () => {
    expect((await api('GET', '/api/editor/maps', player)).status).toBe(403);
    expect((await api('GET', '/api/editor/maps', 'nope')).status).toBe(401);
    const maps = await api('GET', '/api/editor/maps', admin);
    expect(maps.status).toBe(200);
    expect(maps.data.liveMap).toBe('prototype');
  });

  it('serves content and the live map, and rejects invalid maps', async () => {
    const content = await api('GET', '/api/editor/content', admin);
    expect((content.data.content as { props: unknown[] }).props.length).toBeGreaterThan(50);
    const { data } = await api('GET', '/api/editor/map?id=prototype', admin);
    const map = data.map as MapData;
    expect(map.buildings.length).toBeGreaterThan(10);
    const broken = structuredClone(map);
    broken.props[0].type = 'no_such_prop';
    const res = await api('PUT', '/api/editor/map?id=prototype', admin, { map: broken });
    expect(res.status).toBe(422);
    expect(String(res.data.message)).toMatch(/unknown prop type/);
  });

  it('accepts content made by the area generators', async () => {
    const { data } = await api('GET', '/api/editor/map?id=prototype', admin);
    const map = data.map as MapData;
    // Paint the empty south-east as suburb and generate a neighbourhood there.
    const { cols, rows } = biomeGridSize(map);
    const cells = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) if (cx * 16 >= 448 && cy * 16 >= 432) cells[cy * cols + cx] = BIOMES.indexOf('suburb');
    map.biomes = encodeBiomes(cells);
    const area = { x: 448, y: 432, w: 192, h: 208 };
    const edit = generateArea(map, { seed: 42, area, layers: { terrain: true, roads: true, parcels: true, nature: true }, replace: true });
    expect(edit.add.buildings.length).toBeGreaterThan(0);
    applyEdit(map, edit);
    const res = await api('PUT', '/api/editor/map?id=generated-test', admin, { map: { ...map, id: 'generated-test' } });
    expect(res.data.message).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it('saves a map and republishes it into the running world', async () => {
    const { data } = await api('GET', '/api/editor/map?id=prototype', admin);
    const map = data.map as MapData;
    map.name = 'Pine Valley (edited)';
    map.props.push({ id: 'editor_test_rock', type: 'rock', x: 30, y: 320, rot: 0, manual: true });
    map.zones.push({ id: 'z_new', name: 'New zone', kind: 'forest', rect: [10, 600, 30, 30], zombies: 0, manual: true });
    expect((await api('PUT', '/api/editor/map?id=prototype', admin, { map })).status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dataDir, 'maps', 'prototype.json'), 'utf8')) as MapData;
    expect(saved.name).toBe('Pine Valley (edited)');

    const bot = await Bot.connect(base, 'visitor', player);
    let closeCode = 0;
    bot.ws.on('close', (code) => (closeCode = code));
    const before = server.game;
    expect((await api('POST', '/api/editor/publish?id=prototype', admin)).status).toBe(200);
    expect(server.game).not.toBe(before);
    expect(server.game.map.name).toBe('Pine Valley (edited)');
    expect(server.game.world.compiled.collision.overlapsCircle(30, 320, 0.2, 1)).toBe(true);
    for (let i = 0; i < 50 && closeCode === 0; i++) await sleep(20);
    expect(closeCode).toBe(MAP_RELOAD_CODE);
    expect(bot.messages.some((m) => m.t === 'mapReload')).toBe(true);
    // Players simply reconnect into the new world.
    const again = await Bot.connect(base, 'visitor', player);
    expect(again.entityId).toBeGreaterThan(0);
    again.close();
  });
});
