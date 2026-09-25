// HTTP auth API. The session token is kept in localStorage so returning players skip the login.

export interface Account {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export interface ServerStatus {
  name: string;
  motd: string;
  pvp: boolean;
  maxPlayers: number;
  players: number;
  day: number;
  time: string;
  online: string[];
}

const TOKEN_KEY = 'ironwild.session';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status);
  return data;
}

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the session just won't be remembered.
  }
}

export async function register(username: string, password: string): Promise<{ token: string; account: Account }> {
  const r = await request<{ token: string; account: Account }>('POST', '/api/register', { username, password });
  storeToken(r.token);
  return r;
}

export async function login(username: string, password: string): Promise<{ token: string; account: Account }> {
  const r = await request<{ token: string; account: Account }>('POST', '/api/login', { username, password });
  storeToken(r.token);
  return r;
}

export async function currentAccount(): Promise<{ token: string; account: Account } | null> {
  const token = storedToken();
  if (!token) return null;
  try {
    const r = await request<{ account: Account }>('GET', '/api/session', undefined, token);
    return { token, account: r.account };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) storeToken(null);
    if (err instanceof ApiError && err.status === 0) throw err;
    return null;
  }
}

export async function logout(): Promise<void> {
  const token = storedToken();
  storeToken(null);
  if (token) await request('POST', '/api/logout', undefined, token).catch(() => undefined);
}

export function forgetSession(): void {
  storeToken(null);
}

export async function serverStatus(): Promise<ServerStatus | null> {
  try {
    return await request<ServerStatus>('GET', '/api/status');
  } catch {
    return null;
  }
}
