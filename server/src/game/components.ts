// ECS components used by the server simulation (design plan §79).

import {
  defineComponent,
  type MoveParams,
  type BodyState,
  type EntityKind,
  type ItemStack,
  type NeedsState,
  type PlayerInput,
  type PlayerInventory,
  type PlayerSimState,
  type ZombieArchetypeDef,
} from '@tuff/shared';
import type { CharacterStatsRecord } from '../persistence/storage';

export interface Transform {
  x: number;
  y: number;
  angle: number;
}
export const Transform = defineComponent<Transform>('Transform');

/** Marks an entity as replicated to clients, with its spawn-time data. */
export interface Replicated {
  kind: EntityKind;
  look: number;
  name: string;
  /** Zombie archetype index or ground-item quantity. */
  extra: number;
}
export const Replicated = defineComponent<Replicated>('Replicated');

/** Circle used for entity-vs-entity collision and hit detection. */
export interface Body {
  radius: number;
}
export const Body = defineComponent<Body>('Body');

/** A multi-second, server-authoritative action such as searching, eating or bandaging. */
export interface TimedAction {
  kind: 'search' | 'consume' | 'pickup';
  label: string;
  duration: number;
  elapsed: number;
  startX: number;
  startY: number;
  /** Target container or item uid, depending on kind. */
  target: string;
  uid?: number;
  woundId?: number;
}

/** Interface the simulation uses to talk to a player's network connection. */
export interface PlayerLink {
  send(message: object): void;
  readonly connected: boolean;
}

export interface PlayerComp {
  accountId: string;
  name: string;
  link: PlayerLink | null;
  sim: PlayerSimState;
  inputs: PlayerInput[];
  inputBudget: number;
  lastSeq: number;
  /** Server tick the most recent input was viewing (for lag compensation). */
  viewTick: number;
  inventory: PlayerInventory;
  body: BodyState;
  needs: NeedsState;
  flashlight: boolean;
  stats: CharacterStatsRecord;
  weaknessUntil: number;
  action: TimedAction | null;
  /** Container the player has open: world container id, `e:<entity>` or `floor`. */
  openContainer: string | null;
  /** Uid of the item currently in hand; used to notice when the held item changes. */
  heldUid: number;
  explored: Uint8Array;
  exploredDirty: number[];
  inventoryDirty: boolean;
  statusDirty: boolean;
  statusKey: string;
  /** Real seconds until the next status/exploration refresh. */
  refreshTimer: number;
  /** Movement parameters derived from encumbrance, injuries and weakness (shared with the client). */
  move: MoveParams;
  /** Real seconds before this dead player may respawn. */
  respawnTimer: number;
}
export const Player = defineComponent<PlayerComp>('Player');

export type ZombieState = 'idle' | 'wander' | 'investigate' | 'chase' | 'attack' | 'stagger' | 'down' | 'rise' | 'bang';

export interface ZombieComp {
  arch: ZombieArchetypeDef;
  archIndex: number;
  look: number;
  zone: string;
  hp: number;
  maxHp: number;
  walkSpeed: number;
  chaseSpeed: number;
  damageScale: number;
  state: ZombieState;
  stateTimer: number;
  target: number;
  goalX: number;
  goalY: number;
  /** Strength of the stimulus currently being investigated; weaker noises are ignored. */
  interest: number;
  awareness: number;
  awarenessTarget: number;
  lostTimer: number;
  path: number[] | null;
  pathIndex: number;
  repathTimer: number;
  pathPending: boolean;
  perceptionTimer: number;
  attackCooldown: number;
  groanTimer: number;
  stuckTimer: number;
  progressX: number;
  progressY: number;
  bangTarget: string | null;
  vx: number;
  vy: number;
  knockX: number;
  knockY: number;
  /** Seconds this zombie has been outside any active chunk. */
  idleOutside: number;
}
export const Zombie = defineComponent<ZombieComp>('Zombie');

export interface CorpseComp {
  id: string;
  items: ItemStack[];
  player: boolean;
  name: string;
  expiresAt: number;
}
export const Corpse = defineComponent<CorpseComp>('Corpse');

export interface GroundItemComp {
  id: string;
  stack: ItemStack;
  expiresAt: number;
}
export const GroundItem = defineComponent<GroundItemComp>('GroundItem');
