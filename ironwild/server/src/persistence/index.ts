import { resolve } from 'node:path';
import { FileStorage } from './file-storage';
import { MemoryStorage } from './memory-storage';
import type { Storage } from './storage';

export * from './storage';
export { FileStorage, MemoryStorage };

/**
 * Chooses a backend from the environment:
 *   IRONWILD_STORAGE=memory   → in-memory (tests, throwaway servers)
 *   otherwise                 → JSON files in IRONWILD_SAVE_DIR (default ./.data/ironwild)
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.IRONWILD_STORAGE === 'memory') return new MemoryStorage();
  return new FileStorage(resolve(env.IRONWILD_SAVE_DIR ?? '.data/ironwild'));
}
