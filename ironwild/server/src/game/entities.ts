// Non-player entities: creatures, dropped items, death bags, arrows and hand carts.

import type { CreatureDef, ItemStack, Slots } from '@ironwild/shared';

export type AiState = 'idle' | 'wander' | 'flee' | 'chase' | 'attack' | 'return';

export interface Creature {
  kind: 'creature';
  id: number;
  def: CreatureDef;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  hp: number;
  state: AiState;
  /** Player or creature being chased/fled from. */
  target: number;
  homeX: number;
  homeY: number;
  timer: number;
  /** Attack wind-up remaining (telegraphed). */
  windup: number;
  cooldown: number;
  wx: number;
  wy: number;
  /** Zone key the creature belongs to (spawner bookkeeping). */
  zone: string;
  /** Farm animals: owner account and product timer. */
  owner?: string | null;
  ownerName?: string;
  productIn?: number;
  hasProduct?: boolean;
  /** Seconds since hurt (for flee/aggro memory). */
  aggro: number;
  hurtT: number;
  /** Last damage source (for kill credit). */
  lastHitBy: number;
  /** Horse ridden by a player. */
  rider?: number;
}

export interface Drop {
  kind: 'drop';
  id: number;
  x: number;
  y: number;
  stack: ItemStack;
  expires: number;
}

export interface Bag {
  kind: 'bag';
  id: number;
  x: number;
  y: number;
  slots: Slots;
  owner: string | null;
  ownerName: string;
  expires: number;
}

export interface Arrow {
  kind: 'arrow';
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  damage: number;
  owner: number;
  life: number;
}

export interface Cart {
  kind: 'cart';
  id: number;
  x: number;
  y: number;
  angle: number;
  slots: Slots;
  owner: string | null;
  ownerName: string;
  puller: number;
}

export type Entity = Creature | Drop | Bag | Arrow | Cart;
