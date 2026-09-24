// Accounts and sessions (design plan §73): username + password + persistent account id.
// Characters and owned structures reference the account id, never the username.

import { randomUUID } from 'node:crypto';
import { DuplicateUsernameError, type AccountRecord, type Storage } from '../persistence/storage';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './passwords';
import { RateLimiter } from './rate-limit';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

export class AuthError extends Error {
  constructor(
    readonly code: 'invalid_username' | 'invalid_password' | 'username_taken' | 'bad_credentials' | 'rate_limited' | 'invalid_session',
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface AuthResult {
  token: string;
  account: PublicAccount;
}

export interface PublicAccount {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export function publicAccount(a: AccountRecord): PublicAccount {
  return { id: a.id, username: a.username, displayName: a.displayName, isAdmin: a.isAdmin };
}

// A precomputed hash so failed lookups take as long as real password checks.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export class AuthService {
  private readonly ipLimiter: RateLimiter;
  private readonly userLimiter: RateLimiter;
  private readonly registerLimiter: RateLimiter;

  /** `rateLimit: false` is for load tests against an in-process server only. */
  constructor(
    private readonly storage: Storage,
    private readonly adminUsernames: Set<string> = new Set(),
    options: { rateLimit?: boolean } = {},
  ) {
    const on = options.rateLimit !== false;
    this.ipLimiter = new RateLimiter(on ? 20 : Infinity, 60_000);
    this.userLimiter = new RateLimiter(on ? 8 : Infinity, 5 * 60_000);
    this.registerLimiter = new RateLimiter(on ? 5 : Infinity, 60 * 60_000);
  }

  validateUsername(username: unknown): string {
    if (typeof username !== 'string' || !USERNAME.test(username)) {
      throw new AuthError('invalid_username', 'Usernames are 3–20 letters, numbers, underscores or dashes.');
    }
    return username;
  }

  validatePassword(password: unknown): string {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new AuthError('invalid_password', 'Passwords must be 8–128 characters.');
    }
    return password;
  }

  async register(usernameRaw: unknown, passwordRaw: unknown, ip: string): Promise<AuthResult> {
    if (!this.ipLimiter.take(ip) || !this.registerLimiter.take(ip)) {
      throw new AuthError('rate_limited', 'Too many attempts. Try again later.', 429);
    }
    const username = this.validateUsername(usernameRaw);
    const password = this.validatePassword(passwordRaw);
    const now = Date.now();
    const account: AccountRecord = {
      id: randomUUID(),
      username,
      displayName: username,
      passwordHash: await hashPassword(password),
      createdAt: now,
      lastLoginAt: now,
      isAdmin: this.adminUsernames.has(username.toLowerCase()),
    };
    try {
      await this.storage.createAccount(account);
    } catch (err) {
      if (err instanceof DuplicateUsernameError) throw new AuthError('username_taken', 'That username is already taken.', 409);
      throw err;
    }
    return { token: await this.startSession(account.id), account: publicAccount(account) };
  }

  async login(usernameRaw: unknown, passwordRaw: unknown, ip: string): Promise<AuthResult> {
    if (!this.ipLimiter.take(ip)) throw new AuthError('rate_limited', 'Too many attempts. Try again later.', 429);
    if (typeof usernameRaw !== 'string' || typeof passwordRaw !== 'string') {
      throw new AuthError('bad_credentials', 'Wrong username or password.', 401);
    }
    const key = usernameRaw.toLowerCase();
    if (!this.userLimiter.take(key)) throw new AuthError('rate_limited', 'Too many attempts for this account. Wait a few minutes.', 429);
    const account = await this.storage.findAccountByUsername(usernameRaw);
    const ok = await verifyPassword(passwordRaw, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !ok) throw new AuthError('bad_credentials', 'Wrong username or password.', 401);
    this.userLimiter.reset(key);
    await this.storage.touchLogin(account.id, Date.now());
    return { token: await this.startSession(account.id), account: publicAccount(account) };
  }

  private async startSession(accountId: string): Promise<string> {
    const { token, hash } = newSessionToken();
    const now = Date.now();
    await this.storage.createSession({ tokenHash: hash, accountId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return token;
  }

  /** Resolves a session token to its account, or null if invalid or expired. */
  async authenticate(token: unknown): Promise<AccountRecord | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const session = await this.storage.getSession(hashToken(token));
    if (!session || session.expiresAt <= Date.now()) return null;
    const account = await this.storage.getAccount(session.accountId);
    // Admin rights follow the server's current admin list.
    if (account && this.adminUsernames.has(account.username.toLowerCase())) account.isAdmin = true;
    return account;
  }

  async logout(token: unknown): Promise<void> {
    if (typeof token === 'string') await this.storage.deleteSession(hashToken(token));
  }
}
