// JSON-file storage for local development: everything lives in a directory (default ./.data).
// Writes are atomic (temp file + rename) and coalesced per file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyMemoryState, MemoryStorage } from './memory-storage';

type Section = 'accounts' | 'sessions' | 'characters' | 'world';

function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(map);
}

function objectToMap<T>(obj: Record<string, T> | undefined): Map<string, T> {
  return new Map(Object.entries(obj ?? {}));
}

export class FileStorage extends MemoryStorage {
  override readonly kind = 'file' as const;

  constructor(private readonly dir: string) {
    super();
  }

  override async init(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const state = emptyMemoryState();
    const accounts = this.read<Record<string, never>>('accounts');
    const sessions = this.read<Record<string, never>>('sessions');
    const characters = this.read<Record<string, never>>('characters');
    const world = this.read<Record<string, Record<string, never>> & { meta?: never }>('world');
    state.accounts = objectToMap(accounts);
    state.sessions = objectToMap(sessions);
    state.characters = objectToMap(characters);
    if (world) {
      state.meta = world.meta ?? null;
      state.objects = objectToMap(world.objects);
      state.containers = objectToMap(world.containers);
      state.entities = objectToMap(world.entities);
      state.chunks = objectToMap(world.chunks);
      state.zones = objectToMap(world.zones);
      state.buildings = objectToMap(world.buildings);
    }
    this.state = state;
  }

  private file(section: Section): string {
    return join(this.dir, `${section}.json`);
  }

  private read<T>(section: Section): T | undefined {
    const path = this.file(section);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }

  protected override async changed(section: Section): Promise<void> {
    const s = this.state;
    let data: unknown;
    switch (section) {
      case 'accounts':
        data = mapToObject(s.accounts);
        break;
      case 'sessions':
        data = mapToObject(s.sessions);
        break;
      case 'characters':
        data = mapToObject(s.characters);
        break;
      case 'world':
        data = {
          meta: s.meta,
          objects: mapToObject(s.objects),
          containers: mapToObject(s.containers),
          entities: mapToObject(s.entities),
          chunks: mapToObject(s.chunks),
          zones: mapToObject(s.zones),
          buildings: mapToObject(s.buildings),
        };
        break;
    }
    const path = this.file(section);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
  }
}
