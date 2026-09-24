// Storage abstraction. PostgreSQL is the production backend; a JSON-file backend exists so the
// game can be run locally with zero setup. Both implement exactly this interface.
//
// The base world (the map) is never stored here — only accounts, characters and the world's
// differences from the base map (design plan §50).

import type { BodyState, ItemStack, NeedsState, ObjectState, PlayerInventory, StructureDef } from '@tuff/shared';

export interface AccountRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number | null;
  isAdmin: boolean;
}

export interface SessionRecord {
  tokenHash: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
}

export interface CharacterStatsRecord {
  kills: number;
  deaths: number;
  /** Game minutes survived in the current life. */
  lifeMinutes: number;
}

export interface CharacterData {
  version: 1;
  name: string;
  alive: boolean;
  x: number;
  y: number;
  angle: number;
  stamina: number;
  slot: number;
  body: BodyState;
  needs: NeedsState;
  inventory: PlayerInventory;
  stats: CharacterStatsRecord;
  /** Game minute until which post-respawn weakness lasts. */
  weaknessUntil: number;
  flashlight: boolean;
  /** Explored overview cells (base64 bitset). */
  explored: string;
}

export interface WorldMeta {
  version: 1;
  mapId: string;
  seed: number;
  minutes: number;
  createdAt: number;
  /** Set once the initial zombie population has been distributed. */
  populated: boolean;
}

/** Zombies in inactive chunks are stored as records instead of simulated (design plan §75). */
export interface DormantZombie {
  x: number;
  y: number;
  arch: string;
  look: number;
  zone: string;
  /** Remaining health fraction. */
  hp: number;
}

export interface ZoneState {
  /** Living zombies that belong to this zone (active and dormant). */
  population: number;
  /** Game minute of the last respawn check. */
  lastRespawn: number;
}

export type PersistentEntity =
  | {
      kind: 'corpse';
      id: string;
      x: number;
      y: number;
      angle: number;
      look: number;
      name: string;
      player: boolean;
      items: ItemStack[];
      expiresAt: number;
    }
  | { kind: 'item'; id: string; x: number; y: number; stack: ItemStack; expiresAt: number };

/** A world container's generated contents. */
export interface ContainerContents {
  items: ItemStack[];
}

export interface WorldSnapshot {
  meta: WorldMeta | null;
  objects: Map<string, ObjectState>;
  containers: Map<string, ContainerContents>;
  entities: Map<string, PersistentEntity>;
  chunks: Map<string, DormantZombie[]>;
  zones: Map<string, ZoneState>;
  buildings: Map<string, BuildingLootState>;
  /** Player-built structures, keyed by id. */
  structures: Map<string, StructureDef>;
  /** Owner account id → account ids they trust with their structures and storage. */
  trust: Map<string, TrustRecord>;
}

export interface TrustRecord {
  /** Trusted account ids. */
  accounts: string[];
  /** Display names at the time they were trusted (for listing). */
  names: string[];
}

/** Building-level loot decisions (e.g. which drawer hides the house's handgun). */
export interface BuildingLootState {
  rolled: boolean;
  /** Container id → loot table ids added on top of the container's own table. */
  extra: Record<string, string[]>;
}

/** Incremental world changes; `null` deletes a record. */
export interface WorldChanges {
  meta?: WorldMeta;
  objects: Map<string, ObjectState | null>;
  containers: Map<string, ContainerContents | null>;
  entities: Map<string, PersistentEntity | null>;
  chunks: Map<string, DormantZombie[] | null>;
  zones: Map<string, ZoneState | null>;
  buildings: Map<string, BuildingLootState | null>;
  structures: Map<string, StructureDef | null>;
  trust: Map<string, TrustRecord | null>;
}

export function emptyChanges(): WorldChanges {
  return {
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

export function changeCount(c: WorldChanges): number {
  return (
    (c.meta ? 1 : 0) +
    c.objects.size +
    c.containers.size +
    c.entities.size +
    c.chunks.size +
    c.zones.size +
    c.buildings.size +
    c.structures.size +
    c.trust.size
  );
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is taken`);
  }
}

export interface Storage {
  readonly kind: 'postgres' | 'file' | 'memory';
  init(): Promise<void>;
  close(): Promise<void>;

  createAccount(account: AccountRecord): Promise<void>;
  findAccountByUsername(username: string): Promise<AccountRecord | null>;
  getAccount(id: string): Promise<AccountRecord | null>;
  touchLogin(id: string, time: number): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<number>;

  loadCharacter(accountId: string): Promise<CharacterData | null>;
  saveCharacters(characters: { accountId: string; data: CharacterData }[]): Promise<void>;

  loadWorld(): Promise<WorldSnapshot>;
  saveWorld(changes: WorldChanges): Promise<void>;
}
