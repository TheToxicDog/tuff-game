// Storage abstraction. The generated world (terrain, node positions) is recreated from the seed on
// start; only accounts, characters and the world's changes are stored.

import type { ClaimRole, Slots } from '@ironwild/shared';

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

export interface CharacterData {
  version: 1;
  name: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  hunger: number;
  stamina: number;
  slots: Slots;
  sel: number;
  cap: number;
  crests: number;
  kp: number;
  unlocked: string[];
  blueprints: string[];
  discovered: string[];
  crafted: string[];
  soldAt: string[];
  /** Skill experience. */
  skills: Record<string, number>;
  bed: { id: number; x: number; y: number } | null;
  tutorial: number;
  buffs: { id: string; left: number }[];
  dead: boolean;
  look: number;
  stats: { earned: number; deaths: number; kills: number; seconds: number };
}

export interface StructureSave {
  id: number;
  type: string;
  x: number;
  y: number;
  rot: number;
  owner: string | null;
  ownerName: string;
  hp: number;
  data?: Record<string, unknown>;
}

export interface ContractSave {
  id: string;
  settlement: string;
  item: string;
  n: number;
  delivered: number;
  pay: number;
  bonus: number;
  bonusBy: number;
  deadline: number;
  taker: string | null;
  takerName: string | null;
}

export interface OrderSave {
  id: string;
  owner: string;
  ownerName: string;
  item: string;
  n: number;
  filled: number;
  price: number;
  /** Delivered items waiting for the owner. */
  waiting: number;
  created: number;
}

export interface EntitySave {
  kind: 'bag' | 'cart' | 'animal' | 'drop';
  x: number;
  y: number;
  owner?: string | null;
  ownerName?: string;
  type?: string;
  slots?: Slots;
  expires?: number;
  data?: Record<string, unknown>;
}

export interface CompanySave {
  id: string;
  name: string;
  owner: string;
  members: { id: string; name: string; role: 'owner' | 'officer' | 'member' }[];
  treasury: number;
  created: number;
}

export interface ClaimMemberSave {
  id: string;
  name: string;
  role: ClaimRole;
}

export interface WorldSave {
  version: 1;
  seed: number;
  tick: number;
  /** Game minutes since the world began. */
  minutes: number;
  nextStructId: number;
  nextItemId: number;
  nodes: [number, number, number][];
  tiles: [number, number, number][];
  structures: StructureSave[];
  markets: Record<string, Record<string, number>>;
  prosperity: Record<string, number>;
  contracts: ContractSave[];
  orders: OrderSave[];
  entities: EntitySave[];
  companies: CompanySave[];
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is taken`);
  }
}

export interface Storage {
  readonly kind: 'file' | 'memory';
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

  loadWorld(): Promise<WorldSave | null>;
  saveWorld(world: WorldSave): Promise<void>;
}
