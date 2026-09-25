// In-memory storage: the basis of the file backend and used by tests.

import {
  DuplicateUsernameError,
  type AccountRecord,
  type CharacterData,
  type SessionRecord,
  type Storage,
  type WorldSave,
} from './storage';

export type Section = 'accounts' | 'sessions' | 'characters' | 'world';

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryStorage implements Storage {
  readonly kind: 'memory' | 'file' = 'memory';
  protected accounts = new Map<string, AccountRecord>();
  protected sessions = new Map<string, SessionRecord>();
  protected characters = new Map<string, CharacterData>();
  protected world: WorldSave | null = null;

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  /** Called after mutations; the file backend persists here. */
  protected async changed(_section: Section): Promise<void> {}

  async createAccount(account: AccountRecord): Promise<void> {
    const lower = account.username.toLowerCase();
    for (const a of this.accounts.values()) if (a.username.toLowerCase() === lower) throw new DuplicateUsernameError(account.username);
    this.accounts.set(account.id, clone(account));
    await this.changed('accounts');
  }

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const lower = username.toLowerCase();
    for (const a of this.accounts.values()) if (a.username.toLowerCase() === lower) return clone(a);
    return null;
  }

  async getAccount(id: string): Promise<AccountRecord | null> {
    const a = this.accounts.get(id);
    return a ? clone(a) : null;
  }

  async touchLogin(id: string, time: number): Promise<void> {
    const a = this.accounts.get(id);
    if (a) {
      a.lastLoginAt = time;
      await this.changed('accounts');
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, clone(session));
    await this.changed('sessions');
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const s = this.sessions.get(tokenHash);
    return s ? clone(s) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    if (this.sessions.delete(tokenHash)) await this.changed('sessions');
  }

  async deleteExpiredSessions(now: number): Promise<number> {
    let n = 0;
    for (const [k, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(k);
        n++;
      }
    }
    if (n > 0) await this.changed('sessions');
    return n;
  }

  async loadCharacter(accountId: string): Promise<CharacterData | null> {
    const c = this.characters.get(accountId);
    return c ? clone(c) : null;
  }

  async saveCharacters(characters: { accountId: string; data: CharacterData }[]): Promise<void> {
    if (characters.length === 0) return;
    for (const c of characters) this.characters.set(c.accountId, clone(c.data));
    await this.changed('characters');
  }

  async loadWorld(): Promise<WorldSave | null> {
    return this.world ? clone(this.world) : null;
  }

  async saveWorld(world: WorldSave): Promise<void> {
    this.world = clone(world);
    await this.changed('world');
  }
}
