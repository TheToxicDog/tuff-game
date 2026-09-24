import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createBody, createNeeds, emptyInventory } from '@tuff/shared';
import { FileStorage } from './file-storage';
import { MemoryStorage } from './memory-storage';
import { PostgresStorage } from './postgres-storage';
import { DuplicateUsernameError, emptyChanges, type CharacterData, type Storage } from './storage';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function character(name: string): CharacterData {
  return {
    version: 1,
    name,
    alive: true,
    x: 10,
    y: 20,
    angle: 0,
    stamina: 1,
    slot: 255,
    body: createBody(),
    needs: createNeeds(),
    inventory: emptyInventory(),
    stats: { kills: 3, deaths: 0, lifeMinutes: 100 },
    weaknessUntil: 0,
    flashlight: false,
    explored: '',
  };
}

async function freshPostgresDatabase(): Promise<string | null> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return null;
  const name = `tuff_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

const backends: [string, () => Promise<Storage | null>][] = [
  ['memory', async () => new MemoryStorage()],
  [
    'file',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tuff-storage-'));
      tempDirs.push(dir);
      return new FileStorage(dir);
    },
  ],
  [
    'postgres',
    async () => {
      const url = await freshPostgresDatabase();
      return url ? new PostgresStorage(url) : null;
    },
  ],
];

describe.each(backends)('%s storage', (name, make) => {
  it('stores accounts, sessions, characters and world deltas', async (ctx) => {
    const storage = await make();
    if (!storage) {
      ctx.skip();
      return;
    }
    await storage.init();
    try {
      const id = randomUUID();
      await storage.createAccount({ id, username: 'Rick', displayName: 'Rick', passwordHash: 'h', createdAt: 1, lastLoginAt: null, isAdmin: false });
      await expect(
        storage.createAccount({ id: randomUUID(), username: 'rick', displayName: 'rick', passwordHash: 'h', createdAt: 1, lastLoginAt: null, isAdmin: false }),
      ).rejects.toBeInstanceOf(DuplicateUsernameError);
      expect((await storage.findAccountByUsername('RICK'))?.id).toBe(id);
      await storage.touchLogin(id, 1234);
      expect((await storage.getAccount(id))?.lastLoginAt).toBe(1234);

      await storage.createSession({ tokenHash: 'abc', accountId: id, createdAt: 1, expiresAt: 100 });
      await storage.createSession({ tokenHash: 'def', accountId: id, createdAt: 1, expiresAt: Date.now() + 1e6 });
      expect((await storage.getSession('abc'))?.accountId).toBe(id);
      expect(await storage.deleteExpiredSessions(1000)).toBe(1);
      expect(await storage.getSession('abc')).toBeNull();
      await storage.deleteSession('def');
      expect(await storage.getSession('def')).toBeNull();

      expect(await storage.loadCharacter(id)).toBeNull();
      await storage.saveCharacters([{ accountId: id, data: character('Rick') }]);
      const loaded = await storage.loadCharacter(id);
      expect(loaded?.stats.kills).toBe(3);
      expect(loaded?.inventory.slots).toHaveLength(5);

      const changes = emptyChanges();
      changes.meta = { version: 1, mapId: 'prototype', seed: 1, minutes: 480, createdAt: 1, populated: true };
      changes.objects.set('b1.d1', { open: true });
      changes.objects.set('b1.d2', { broken: true });
      changes.containers.set('b1.p3', { items: [{ uid: 1, id: 'canned_beans', qty: 2 }] });
      changes.chunks.set('3,4', [{ x: 1, y: 2, arch: 'walker', look: 9, zone: 'z', hp: 1 }]);
      changes.zones.set('z', { population: 10, lastRespawn: 0 });
      changes.entities.set('corpse1', { kind: 'item', id: 'corpse1', x: 1, y: 1, stack: { uid: 2, id: 'apple', qty: 1 }, expiresAt: 99 });
      await storage.saveWorld(changes);

      const second = emptyChanges();
      second.objects.set('b1.d2', null);
      second.entities.set('corpse1', null);
      await storage.saveWorld(second);

      const world = await storage.loadWorld();
      expect(world.meta?.minutes).toBe(480);
      expect(world.objects.get('b1.d1')).toEqual({ open: true });
      expect(world.objects.has('b1.d2')).toBe(false);
      expect(world.containers.get('b1.p3')?.items[0].id).toBe('canned_beans');
      expect(world.chunks.get('3,4')?.[0].arch).toBe('walker');
      expect(world.zones.get('z')?.population).toBe(10);
      expect(world.entities.size).toBe(0);

      if (name === 'file') {
        // A second instance reading the same directory sees the persisted state.
        const reopened = new FileStorage((storage as unknown as { dir: string }).dir);
        await reopened.init();
        expect((await reopened.loadWorld()).objects.get('b1.d1')).toEqual({ open: true });
        expect((await reopened.findAccountByUsername('rick'))?.id).toBe(id);
      }
    } finally {
      await storage.close();
    }
  });
});

describe('body and needs defaults', () => {
  it('start healthy', () => {
    expect(createBody().health).toBe(100);
    expect(createNeeds().hunger).toBeGreaterThan(50);
  });
});
