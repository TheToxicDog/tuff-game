// JSON-file storage: everything lives in one directory (default ./.data/ironwild). Writes are
// atomic (temp file + rename).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStorage, type Section } from './memory-storage';
import type { WorldSave } from './storage';

export class FileStorage extends MemoryStorage {
  override readonly kind = 'file' as const;

  constructor(private readonly dir: string) {
    super();
  }

  override async init(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    this.accounts = new Map(Object.entries(this.read('accounts') ?? {}));
    this.sessions = new Map(Object.entries(this.read('sessions') ?? {}));
    this.characters = new Map(Object.entries(this.read('characters') ?? {}));
    this.world = (this.read('world') as WorldSave | undefined) ?? null;
  }

  private file(section: Section): string {
    return join(this.dir, `${section}.json`);
  }

  private read(section: Section): Record<string, never> | undefined {
    const path = this.file(section);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, never>;
  }

  protected override async changed(section: Section): Promise<void> {
    let data: unknown;
    if (section === 'accounts') data = Object.fromEntries(this.accounts);
    else if (section === 'sessions') data = Object.fromEntries(this.sessions);
    else if (section === 'characters') data = Object.fromEntries(this.characters);
    else data = this.world;
    const path = this.file(section);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
  }
}
