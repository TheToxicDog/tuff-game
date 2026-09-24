import { resolve } from 'node:path';
import { FileStorage } from './file-storage';
import { MemoryStorage } from './memory-storage';
import { PostgresStorage } from './postgres-storage';
import type { Storage } from './storage';

export * from './storage';
export { FileStorage, MemoryStorage, PostgresStorage };

/**
 * Chooses a backend from the environment:
 *   DATABASE_URL=postgres://...   → PostgreSQL (production)
 *   TUFF_STORAGE=memory           → in-memory (tests)
 *   otherwise                     → JSON files in TUFF_SAVE_DIR (default ./.data)
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.DATABASE_URL) return new PostgresStorage(env.DATABASE_URL);
  if (env.TUFF_STORAGE === 'memory') return new MemoryStorage();
  return new FileStorage(resolve(env.TUFF_SAVE_DIR ?? '.data'));
}
