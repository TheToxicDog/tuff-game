// In-memory storage, the basis of the file backend and handy for tests.

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
import type { ObjectState, StructureDef } from '@tuff/shared';

export interface MemoryState {
  accounts: Map<string, AccountRecord>;
  sessions: Map<string, SessionRecord>;
  characters: Map<string, CharacterData>;
  meta: WorldMeta | null;
  objects: Map<string, ObjectState>;
  containers: Map<string, ContainerContents>;
  entities: Map<string, PersistentEntity>;
  chunks: Map<string, DormantZombie[]>;
  zones: Map<string, ZoneState>;
  buildings: Map<string, BuildingLootState>;
  structures: Map<string, StructureDef>;
  trust: Map<string, TrustRecord>;
}

export function emptyMemoryState(): MemoryState {
  return {
    accounts: new Map(),
    sessions: new Map(),
    characters: new Map(),
    meta: null,
    objects: new Map(),
    containers: new Map(),
    entities: new Map(),
    chunks: new Map(),
    zones: new Map(),
    buildings: new Map(),
    structures: new Map(),
    trust: new Map(),
  };
}

const clone = <T>(value: T): T => structuredClone(value);

function apply<T>(target: Map<string, T>, changes: Map<string, T | null>): void {
  for (const [key, value] of changes) {
    if (value === null) target.delete(key);
    else target.set(key, clone(value));
  }
}

export class MemoryStorage implements Storage {
  readonly kind: 'memory' | 'file' = 'memory';
  protected state: MemoryState = emptyMemoryState();

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  /** Called after mutations; the file backend persists here. */
  protected async changed(_what: 'accounts' | 'sessions' | 'characters' | 'world'): Promise<void> {}

  async createAccount(account: AccountRecord): Promise<void> {
    const lower = account.username.toLowerCase();
    for (const a of this.state.accounts.values()) {
      if (a.username.toLowerCase() === lower) throw new DuplicateUsernameError(account.username);
    }
    this.state.accounts.set(account.id, clone(account));
    await this.changed('accounts');
  }

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const lower = username.toLowerCase();
    for (const a of this.state.accounts.values()) if (a.username.toLowerCase() === lower) return clone(a);
    return null;
  }

  async getAccount(id: string): Promise<AccountRecord | null> {
    const a = this.state.accounts.get(id);
    return a ? clone(a) : null;
  }

  async touchLogin(id: string, time: number): Promise<void> {
    const a = this.state.accounts.get(id);
    if (a) {
      a.lastLoginAt = time;
      await this.changed('accounts');
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.state.sessions.set(session.tokenHash, clone(session));
    await this.changed('sessions');
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const s = this.state.sessions.get(tokenHash);
    return s ? clone(s) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    if (this.state.sessions.delete(tokenHash)) await this.changed('sessions');
  }

  async deleteExpiredSessions(now: number): Promise<number> {
    let n = 0;
    for (const [k, s] of this.state.sessions) {
      if (s.expiresAt <= now) {
        this.state.sessions.delete(k);
        n++;
      }
    }
    if (n > 0) await this.changed('sessions');
    return n;
  }

  async loadCharacter(accountId: string): Promise<CharacterData | null> {
    const c = this.state.characters.get(accountId);
    return c ? clone(c) : null;
  }

  async saveCharacters(characters: { accountId: string; data: CharacterData }[]): Promise<void> {
    for (const { accountId, data } of characters) this.state.characters.set(accountId, clone(data));
    if (characters.length > 0) await this.changed('characters');
  }

  async loadWorld(): Promise<WorldSnapshot> {
    const s = this.state;
    return clone({
      meta: s.meta,
      objects: s.objects,
      containers: s.containers,
      entities: s.entities,
      chunks: s.chunks,
      zones: s.zones,
      buildings: s.buildings,
      structures: s.structures,
      trust: s.trust,
    });
  }

  async saveWorld(changes: WorldChanges): Promise<void> {
    if (changes.meta) this.state.meta = clone(changes.meta);
    apply(this.state.objects, changes.objects);
    apply(this.state.containers, changes.containers);
    apply(this.state.entities, changes.entities);
    apply(this.state.chunks, changes.chunks);
    apply(this.state.zones, changes.zones);
    apply(this.state.buildings, changes.buildings);
    apply(this.state.structures, changes.structures);
    apply(this.state.trust, changes.trust);
    await this.changed('world');
  }
}
