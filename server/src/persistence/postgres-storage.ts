// PostgreSQL storage. Accounts, sessions and characters are rows; world deltas are keyed JSONB
// rows written in batches inside a transaction.

import pg from 'pg';
import type { ObjectState, StructureDef } from '@tuff/shared';
import {
  DuplicateUsernameError,
  type AccountRecord,
  type BuildingLootState,
  type CharacterData,
  type ContainerContents,
  type DormantZombie,
  type PersistentEntity,
  type SessionRecord,
  type Storage,
  type TrustRecord,
  type WorldChanges,
  type WorldMeta,
  type WorldSnapshot,
  type ZoneState,
} from './storage';

interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE accounts (
        id uuid PRIMARY KEY,
        username text NOT NULL,
        display_name text NOT NULL,
        password_hash text NOT NULL,
        created_at bigint NOT NULL,
        last_login_at bigint,
        is_admin boolean NOT NULL DEFAULT false
      );
      CREATE UNIQUE INDEX accounts_username_lower ON accounts (lower(username));
      CREATE TABLE sessions (
        token_hash text PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at bigint NOT NULL,
        expires_at bigint NOT NULL
      );
      CREATE INDEX sessions_account ON sessions (account_id);
      CREATE INDEX sessions_expires ON sessions (expires_at);
      CREATE TABLE characters (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE world_meta (id smallint PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_objects (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_containers (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_entities (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_chunks (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_zones (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_buildings (id text PRIMARY KEY, data jsonb NOT NULL);
    `,
  },
  {
    id: 2,
    name: 'player structures and trust',
    sql: `
      CREATE TABLE world_structures (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE world_trust (id text PRIMARY KEY, data jsonb NOT NULL);
    `,
  },
];

const WORLD_TABLES = {
  objects: 'world_objects',
  containers: 'world_containers',
  entities: 'world_entities',
  chunks: 'world_chunks',
  zones: 'world_zones',
  buildings: 'world_buildings',
  structures: 'world_structures',
  trust: 'world_trust',
} as const;

interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: string;
  last_login_at: string | null;
  is_admin: boolean;
}

function toAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
    isAdmin: row.is_admin,
  };
}

export class PostgresStorage implements Storage {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 8 });
    this.pool.on('error', (err) => console.error('[postgres] idle client error', err));
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(727274)');
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      const applied = new Set((await client.query<{ id: number }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
      for (const m of MIGRATIONS) {
        if (applied.has(m.id)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
          await client.query('COMMIT');
          console.log(`[postgres] applied migration ${m.id}: ${m.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createAccount(a: AccountRecord): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO accounts (id, username, display_name, password_hash, created_at, last_login_at, is_admin)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [a.id, a.username, a.displayName, a.passwordHash, a.createdAt, a.lastLoginAt, a.isAdmin],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new DuplicateUsernameError(a.username);
      throw err;
    }
  }

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const r = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE lower(username) = lower($1)', [username]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async getAccount(id: string): Promise<AccountRecord | null> {
    const r = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async touchLogin(id: string, time: number): Promise<void> {
    await this.pool.query('UPDATE accounts SET last_login_at = $2 WHERE id = $1', [id, time]);
  }

  async createSession(s: SessionRecord): Promise<void> {
    await this.pool.query('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      s.tokenHash,
      s.accountId,
      s.createdAt,
      s.expiresAt,
    ]);
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const r = await this.pool.query<{ token_hash: string; account_id: string; created_at: string; expires_at: string }>(
      'SELECT * FROM sessions WHERE token_hash = $1',
      [tokenHash],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { tokenHash: row.token_hash, accountId: row.account_id, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteExpiredSessions(now: number): Promise<number> {
    const r = await this.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
    return r.rowCount ?? 0;
  }

  async loadCharacter(accountId: string): Promise<CharacterData | null> {
    const r = await this.pool.query<{ data: CharacterData }>('SELECT data FROM characters WHERE account_id = $1', [accountId]);
    return r.rows[0]?.data ?? null;
  }

  async saveCharacters(characters: { accountId: string; data: CharacterData }[]): Promise<void> {
    if (characters.length === 0) return;
    await this.pool.query(
      `INSERT INTO characters (account_id, data, updated_at)
       SELECT * , now() FROM unnest($1::uuid[], $2::jsonb[])
       ON CONFLICT (account_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [characters.map((c) => c.accountId), characters.map((c) => JSON.stringify(c.data))],
    );
  }

  async loadWorld(): Promise<WorldSnapshot> {
    const load = async <T>(table: string): Promise<Map<string, T>> => {
      const r = await this.pool.query<{ id: string; data: T }>(`SELECT id, data FROM ${table}`);
      return new Map(r.rows.map((row) => [row.id, row.data]));
    };
    const meta = await this.pool.query<{ data: WorldMeta }>('SELECT data FROM world_meta WHERE id = 1');
    return {
      meta: meta.rows[0]?.data ?? null,
      objects: await load<ObjectState>(WORLD_TABLES.objects),
      containers: await load<ContainerContents>(WORLD_TABLES.containers),
      entities: await load<PersistentEntity>(WORLD_TABLES.entities),
      chunks: await load<DormantZombie[]>(WORLD_TABLES.chunks),
      zones: await load<ZoneState>(WORLD_TABLES.zones),
      buildings: await load<BuildingLootState>(WORLD_TABLES.buildings),
      structures: await load<StructureDef>(WORLD_TABLES.structures),
      trust: await load<TrustRecord>(WORLD_TABLES.trust),
    };
  }

  async saveWorld(changes: WorldChanges): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (changes.meta) {
        await client.query('INSERT INTO world_meta (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [
          JSON.stringify(changes.meta),
        ]);
      }
      for (const key of Object.keys(WORLD_TABLES) as (keyof typeof WORLD_TABLES)[]) {
        const table = WORLD_TABLES[key];
        const map = changes[key] as Map<string, unknown>;
        const upsertIds: string[] = [];
        const upsertData: string[] = [];
        const deleteIds: string[] = [];
        for (const [id, value] of map) {
          if (value === null) deleteIds.push(id);
          else {
            upsertIds.push(id);
            upsertData.push(JSON.stringify(value));
          }
        }
        if (upsertIds.length > 0) {
          await client.query(
            `INSERT INTO ${table} (id, data) SELECT * FROM unnest($1::text[], $2::jsonb[])
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
            [upsertIds, upsertData],
          );
        }
        if (deleteIds.length > 0) await client.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [deleteIds]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
