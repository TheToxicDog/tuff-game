// What UI screens can see and do. The ClientGame implements this; screens never touch the
// network or the renderer directly.

import type {
  ClientMessage,
  ContainerView,
  ContentRegistry,
  InvLocation,
  ItemStack,
  PlayerInventory,
  StationKind,
  StatusView,
  WorldItemView,
} from '@tuff/shared';
import type { SoundId } from '../audio/synth';

export interface NearbyTarget {
  /** Container id, `e:<entity>` for corpses, or `floor`. */
  id: string;
  name: string;
}

export interface GameContext {
  readonly content: ContentRegistry;
  send(msg: ClientMessage): void;
  readonly inventory: PlayerInventory;
  readonly status: StatusView | null;
  /** The external container currently open on the server (world container or corpse). */
  readonly container: ContainerView | null;
  readonly floor: WorldItemView[];
  /** Selected quick slot, or NO_SLOT for empty hands. */
  readonly selectedSlot: number;
  selectSlot(slot: number): void;
  /** Rounds in the held firearm (predicted). */
  readonly magAmmo: number;
  /** Containers and corpses within reach, nearest first. */
  nearbyTargets(): NearbyTarget[];
  ui(sound: SoundId): void;
  /** Moves a stack where it most sensibly goes in the player's inventory. */
  take(stack: ItemStack, from: InvLocation): void;
  /** Crafting stations within reach (stoves, lit fires, workbenches). */
  stationsNearby(): Set<StationKind>;
  /** True while a timed action (search, cooking, building…) is running. */
  readonly busy: boolean;
}
