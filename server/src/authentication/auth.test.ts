import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../persistence/memory-storage';
import { AuthError, AuthService } from './auth-service';
import { hashPassword, verifyPassword } from './passwords';
import { RateLimiter } from './rate-limit';

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong password', a)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });
});

describe('AuthService', () => {
  it('registers, logs in and authenticates sessions', async () => {
    const storage = new MemoryStorage();
    const auth = new AuthService(storage);
    const reg = await auth.register('Survivor_1', 'hunter2hunter2', '1.1.1.1');
    expect(reg.account.username).toBe('Survivor_1');
    expect((await auth.authenticate(reg.token))?.id).toBe(reg.account.id);

    const login = await auth.login('survivor_1', 'hunter2hunter2', '1.1.1.1');
    expect(login.account.id).toBe(reg.account.id);
    expect(login.token).not.toBe(reg.token);

    await auth.logout(reg.token);
    expect(await auth.authenticate(reg.token)).toBeNull();
    expect((await auth.authenticate(login.token))?.id).toBe(reg.account.id);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    const auth = new AuthService(new MemoryStorage());
    await auth.register('Alice', 'password123', '1.1.1.1');
    await expect(auth.register('alice', 'password456', '2.2.2.2')).rejects.toMatchObject({ code: 'username_taken' });
  });

  it('validates usernames and passwords', async () => {
    const auth = new AuthService(new MemoryStorage());
    await expect(auth.register('a', 'password123', 'x')).rejects.toBeInstanceOf(AuthError);
    await expect(auth.register('valid_name', 'short', 'x')).rejects.toMatchObject({ code: 'invalid_password' });
    await expect(auth.register('bad name!', 'password123', 'x')).rejects.toMatchObject({ code: 'invalid_username' });
  });

  it('does not reveal whether a username exists', async () => {
    const auth = new AuthService(new MemoryStorage());
    await auth.register('bob_the_builder', 'password123', '1.1.1.1');
    const wrongPass = await auth.login('bob_the_builder', 'nope-nope-nope', '1.1.1.2').catch((e) => e);
    const noUser = await auth.login('nobody_here', 'nope-nope-nope', '1.1.1.3').catch((e) => e);
    expect(wrongPass.code).toBe('bad_credentials');
    expect(noUser.code).toBe('bad_credentials');
    expect(wrongPass.message).toBe(noUser.message);
  });

  it('ignores malformed tokens', async () => {
    const auth = new AuthService(new MemoryStorage());
    expect(await auth.authenticate(undefined)).toBeNull();
    expect(await auth.authenticate('short')).toBeNull();
    expect(await auth.authenticate('x'.repeat(43))).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('limits attempts within a window', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1000, () => now);
    expect([limiter.take('k'), limiter.take('k'), limiter.take('k'), limiter.take('k')]).toEqual([true, true, true, false]);
    now = 1000;
    expect(limiter.take('k')).toBe(true);
  });
});
