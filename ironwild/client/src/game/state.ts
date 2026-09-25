// Client-side game state that the UI reads, and the interface UI modules use to act.

import type {
  ClientMessage,
  ContractInfo,
  PlayerStatus,
  ResearchState,
  Slots,
  TutorialState,
  UiState,
  WelcomeMessage,
} from '@ironwild/shared';
import type { Sfx } from '../audio/sfx';
import type { ClientWorld } from './world';

export interface MarketReport {
  settlement: string;
  items: [string, number, number][];
}

export class ClientState {
  slots: Slots = [];
  sel = 0;
  cap = 16;
  status: PlayerStatus = { hp: 100, hunger: 100, crests: 0, kp: 0, buffs: [], skills: {}, bed: false };
  research: ResearchState = { kp: 0, unlocked: [], blueprints: [] };
  tutorial: TutorialState | null = null;
  contracts: ContractInfo[] = [];
  ui: UiState | null = null;
  markets: MarketReport[] | null = null;
  minutes = 360;
  stamina = 100;
  dead: { by: string; crests: number; items: number } | null = null;
  playerX = 0;
  playerY = 0;

  constructor(readonly welcome: WelcomeMessage) {}

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s?.id === id) n += s.n;
    return n;
  }

  held(): string | undefined {
    return this.slots[this.sel]?.id;
  }
}

export interface UiContext {
  state: ClientState;
  world: ClientWorld;
  sfx: Sfx;
  send(msg: ClientMessage): void;
  /** Crafting stations within reach (workbench, anvil, cooking). */
  nearStations(): Set<string>;
  startPlacement(item: string): void;
  startSmith(recipe: string): void;
  toggle(window: string): void;
  refresh(window: string): void;
  close(window: string): void;
  isOpen(window: string): boolean;
  /** Minimap/map source canvas (terrain at 4 px per tile). */
  terrainCanvas(): HTMLCanvasElement;
  notice(text: string, kind?: 'info' | 'good' | 'bad' | 'money'): void;
}
