// Non-player entities: creatures, dropped items, death bags, arrows and hand carts.

import type { CreatureDef, ItemStack, Slots } from '@ironwild/shared';
import type { RailState } from './rails';
import type { RaiderState } from './raids';

export type AiState = 'idle' | 'wander' | 'flee' | 'chase' | 'attack' | 'return';

/** Getting around something in the way: how long it has been stuck, and a sidestep until a time (ms). */
export interface Detour {
  stuck: number;
  detourUntil: number;
  dx: number;
  dy: number;
}

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
  /** Bandits on a raid (§42). */
  raider?: RaiderState;
  /** A hired guard (§42), the guard house it keeps watch from, and how it gets around things. */
  guard?: { post: number; nav: Detour };
  /** A guard this creature is fighting back against. */
  foe?: number;
  /** Sent out by a town quest (§53): taken away again when the quest ends. */
  quest?: string;
  /** Next time a spike trap may hurt it. */
  trapAt?: number;
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
  /** Shooter's player id, or 0 for an arrow tower. */
  owner: number;
  life: number;
  /** Tower arrows fly over walls and only hit hostile creatures. */
  high?: boolean;
}

export interface Cart {
  kind: 'cart';
  /** Hand carts are pulled on foot, wagons behind a horse; minecarts run on rails; trucks are driven. */
  type: 'hand' | 'wagon' | 'minecart' | 'truck';
  id: number;
  x: number;
  y: number;
  angle: number;
  slots: Slots;
  owner: string | null;
  ownerName: string;
  puller: number;
  rail?: RailState;
  /** A truck's driver (player id), and the tiles its tank has left. */
  driver?: number;
  fuel?: number;
}

/** The item each kind of cart is made from (and returns to when picked up). */
export const CART_ITEM: Record<Cart['type'], string> = { hand: 'hand_cart', wagon: 'wagon', minecart: 'minecart', truck: 'motor_truck' };

export type Entity = Creature | Drop | Bag | Arrow | Cart;
