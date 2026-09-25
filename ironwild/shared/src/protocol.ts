// Network messages. Everything is JSON over one WebSocket; positions in the per-tick snapshot
// are fixed-point integers (hundredths of a tile) to keep frames small.

import type { ItemStack, Slots } from './inventory';

// ——— Client → server ———

/** [sequence, flags, moveX, moveY, angle × 1000]. */
export type InputTuple = [number, number, number, number, number];

export type SectionName = 'inv' | 'store' | 'in' | 'fuel' | 'out';

export interface SlotRef {
  s: SectionName;
  i: number;
}

export type InteractKind = 'npc' | 'struct' | 'entity';

export type ClientMessage =
  | { t: 'hello'; token: string; protocol: number }
  | { t: 'ping'; id: number }
  | { t: 'in'; i: InputTuple[] }
  | { t: 'slot'; slot: number }
  | { t: 'move'; from: SlotRef; to: SlotRef; n?: number }
  | { t: 'quick'; from: SlotRef }
  | { t: 'drop'; slot: number; n?: number }
  | { t: 'pickup' }
  | { t: 'use'; slot: number; x?: number; y?: number }
  | { t: 'craft'; recipe: string; n: number }
  | { t: 'smith'; recipe: string; hits: number[] }
  | { t: 'place'; item: string; x: number; y: number; rot: number }
  | { t: 'rotate'; id: number }
  | { t: 'interact'; kind: InteractKind; id: string | number; op?: 'grab' }
  | { t: 'close' }
  | { t: 'trade'; npc: string; op: 'buy' | 'sell'; item: string; q?: number; n: number }
  | { t: 'machine'; id: number; op: 'mode'; mode: string }
  | { t: 'machine'; id: number; op: 'filter'; item: string | null }
  | { t: 'machine'; id: number; op: 'oc'; level: number }
  | { t: 'machine'; id: number; op: 'repair' }
  | { t: 'stats' }
  | { t: 'crank'; id: number; on: boolean }
  | { t: 'research'; node: string }
  | { t: 'contract'; op: 'accept' | 'deliver' | 'abandon'; id: string }
  | { t: 'chat'; text: string }
  | { t: 'claim'; id: number; op: 'add' | 'remove'; name: string; role?: ClaimRole }
  | { t: 'shop'; id: number; op: 'price'; item: string; q?: number; price: number | null }
  | { t: 'shop'; id: number; op: 'buy'; item: string; q?: number; n: number }
  | { t: 'order'; op: 'post'; item: string; n: number; price: number }
  | { t: 'order'; op: 'cancel' | 'collect'; id: string }
  | { t: 'order'; op: 'fill'; id: string; n: number }
  | { t: 'company'; op: 'create'; name: string }
  | { t: 'company'; op: 'invite' | 'kick' | 'promote' | 'demote'; name: string }
  | { t: 'company'; op: 'leave' | 'accept' | 'decline' | 'info' }
  | { t: 'company'; op: 'deposit' | 'withdraw'; amount: number }
  /** Hand a land claim you own, and everything of yours on it, to your company. */
  | { t: 'company'; op: 'transfer'; claim: number }
  | { t: 'markets' }
  | { t: 'respawn' };

export type ClaimRole = 'manager' | 'builder' | 'worker' | 'visitor';

// ——— Server → client ———

/** Own movement state for reconciliation. */
export interface MeState {
  /** Last processed input sequence. */
  q: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  st: number;
  sd: number;
  dt: number;
  dx: number;
  dy: number;
  dc: number;
  /** Movement speed multiplier (mount, cart, buffs). */
  sm: number;
  /** Stamina regeneration multiplier. */
  sr: number;
}

/** [id, x × 100, y × 100, angle × 100, health %, flags]. */
export type EntityTuple = [number, number, number, number, number, number];

export const EntityFlags = {
  Blocking: 1,
  Drawing: 2,
  Dodging: 4,
  Hurt: 8,
  Mounted: 16,
  Pulling: 32,
  Sleeping: 64,
  Charging: 128,
  /** Farm animal has eggs/wool/milk ready. */
  Product: 256,
  /** Hand crank being turned / creature winding up an attack. */
  Busy: 512,
} as const;

export type EntityKind = 'player' | 'creature' | 'drop' | 'bag' | 'arrow' | 'cart';

export interface EntitySpawn {
  id: number;
  k: EntityKind;
  /** Creature type, item id of a drop, etc. */
  type?: string;
  name?: string;
  /** Held item id. */
  held?: string;
  /** Hat / look index for players. */
  look?: number;
  /** Drop stack size. */
  n?: number;
  /** Owner (bags, carts). */
  owner?: string;
  x: number;
  y: number;
  a?: number;
  /** Company tag. */
  tag?: string;
}

/** [id, type, x × 100, y × 100, remaining 0–100 (0 = depleted)]. */
export type NodeTuple = [number, string, number, number, number];

export interface StructSpawn {
  id: number;
  type: string;
  x: number;
  y: number;
  r: number;
  owner?: string;
  st?: StructVisual;
  /** Rotation speeds (RPM per gear group) for kinetic blocks, tiles/s for conveyors. */
  k?: number[];
  /** Power network id. */
  n?: number;
}

/** Visual state that changes: running animations, doors, fill, filters, crops. */
export interface StructVisual {
  on?: boolean;
  open?: boolean;
  mode?: string;
  filter?: string;
  /** Output/fill hint (0–1). */
  fill?: number;
  /** Crop stage for farmland (0–4) and crop id. */
  crop?: string;
  stage?: number;
  /** Health in percent, when damaged. */
  hp?: number;
  /** Item shown on a machine (being processed). */
  item?: string;
  /** Player turning a crank. */
  crank?: boolean;
  /** Shop listing summary. */
  label?: string;
}

/** Belt item keyframe: position and speed of one item from a given server tick. */
export interface BeltKeyframe {
  /** Item id. */
  i: number;
  /** Item type (omitted for removals). */
  it?: string;
  x?: number;
  y?: number;
  /** Entry side and exit side. */
  e?: number;
  o?: number;
  /** Progress × 1000 and speed in tiles/second × 100. */
  p?: number;
  v?: number;
  k: number;
  /** Removed (entered a machine or picked up). */
  rm?: 1;
}

export interface NetSummary {
  id: number;
  rpm: number;
  cap: number;
  load: number;
  stalled: boolean;
  conflict: boolean;
}

export type GameEvent =
  | ['sw', number, number] // swing: entity, 1 = heavy
  | ['hit', number, number, string] // x×100, y×100, material
  | ['nd', number, number, number] // node wiggle: node id, dir x×100, dir y×100
  | ['pop', number, number, string, number] // floating text
  | ['dmg', number, number, number] // entity, amount, crit
  | ['sfx', string, number, number] // sound at x×100, y×100
  | ['atk', number] // creature attack wind-up
  | ['die', number] // entity died
  | ['shoot', number, number, number, number, number] // arrow from x,y to angle, entity
  | ['fish', number, number, number, number]; // fishing float: player, x×100, y×100, state (0 reeled in, 1 floating, 2 biting)

export interface Snapshot {
  t: 's';
  k: number;
  /** World time in game minutes. */
  tm: number;
  me?: MeState;
  /** Entities whose state changed since the last snapshot; the others stay where they were. */
  e: EntityTuple[];
  sp?: EntitySpawn[];
  d?: number[];
  ev?: GameEvent[];
}

export interface SettlementInfo {
  id: string;
  name: string;
  kind: 'town' | 'village';
  x: number;
  y: number;
  radius: number;
  npcs: NpcInfo[];
}

export interface NpcInfo {
  id: string;
  name: string;
  profession: string;
  title: string;
  x: number;
  y: number;
  angle: number;
  /** Prosperity the settlement needs before this trader opens a stall (§54). */
  unlock?: number;
}

export type CompanyRole = 'owner' | 'officer' | 'member';

/** Company overview (§46). */
export interface CompanyInfo {
  id: string;
  name: string;
  treasury: number;
  you: CompanyRole;
  members: { name: string; role: CompanyRole; online: boolean }[];
  /** Structures the company owns: how many, their base value, and the most common kinds. */
  property: { count: number; value: number; kinds: [string, number][] };
  /** Money in and out over the last game day, by source. */
  income: [string, number][];
}

/** A settlement's growth and market news (§14, §54). */
export interface TownInfo {
  id: string;
  prosperity: number;
  /** The next stall to open, at what prosperity. */
  next?: { at: number; title: string };
  /** Market events in progress; `ends` in game minutes. */
  events?: { title: string; text: string; ends: number }[];
}

/** Factory overview (§59). */
export interface FactoryStats {
  machines: {
    type: string;
    count: number;
    /** Share of time working (0–1). */
    util: number;
    /** Items made per minute, by item. */
    perMin: [string, number][];
    /** Their base value per minute. */
    value: number;
    /** Machines by status right now. */
    issues: [string, number][];
  }[];
  networks: NetSummary[];
  valuePerMin: number;
  hints: string[];
}

export interface HouseInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  color: number;
}

export interface LandmarkInfo {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
}

export interface WelcomeMessage {
  t: 'welcome';
  you: { id: number; name: string; accountId: string; isAdmin: boolean };
  server: { name: string; motd: string; pvp: boolean; daySeconds: number };
  world: {
    seed: number;
    size: number;
    tiles: number[];
    /** Region per tile, run-length encoded like the tiles. */
    regions: number[];
    houses: HouseInfo[];
    settlements: SettlementInfo[];
    landmarks: LandmarkInfo[];
  };
  tick: number;
  time: number;
}

export interface PlayerStatus {
  hp: number;
  hunger: number;
  crests: number;
  kp: number;
  buffs: { id: string; left: number }[];
  /** Skill levels. */
  skills: Record<string, number>;
  /** Spawn bed set. */
  bed: boolean;
  company?: string;
}

export interface InventoryMessage {
  t: 'inv';
  slots: Slots;
  sel: number;
  cap: number;
}

export interface TradeListing {
  item: string;
  q?: number;
  /** Price per unit for the next unit. */
  price: number;
  stock: number;
  /** Stock relative to normal: < 0.7 scarce, > 1.4 saturated. */
  level: number;
}

export interface TradeUi {
  kind: 'trade';
  npc: string;
  name: string;
  title: string;
  settlement: string;
  line: string;
  sells: TradeListing[];
  /** Prices the NPC pays for items in your inventory. */
  buys: TradeListing[];
}

export interface ContainerUi {
  kind: 'container';
  id: number;
  title: string;
  store: Slots;
  /** Entity containers (bags, carts) use negative ids. */
  entity?: boolean;
}

export interface MachineUi {
  kind: 'machine';
  id: number;
  type: string;
  title: string;
  in: Slots;
  fuel?: Slots;
  out: Slots;
  progress: number;
  status: string;
  rpm: number;
  mode?: string;
  modes?: string[];
  filter?: string | null;
  fuelLeft?: number;
  net?: NetSummary;
  recipes: string[];
  /** Overclock level index into OVERCLOCK; condition 0–1 (1 = like new). */
  oc?: number;
  condition?: number;
  /** Items made in the last minute. */
  perMin?: number;
  /** Fluid machines: what they hold, and how much they move per second. */
  tanks?: { fluid: string; amount: number; capacity: number }[];
  rate?: { fluid: string; perSec: number };
}

/** A fluid network: [id, fluid ('' when empty), fill ‰ (0–1000), flow per second × 10]. */
export type FluidNetTuple = [number, string, number, number];

export interface StationUi {
  kind: 'station';
  id: number;
  station: string;
}

export interface ShopUi {
  kind: 'shop';
  id: number;
  owner: string;
  mine: boolean;
  title: string;
  store: Slots;
  prices: { item: string; q?: number; price: number }[];
}

export interface ClaimUi {
  kind: 'claim';
  id: number;
  owner: string;
  mine: boolean;
  members: { name: string; role: ClaimRole }[];
  radius: number;
  /** Set when you own the claim and are in a company: it can be handed over. */
  company?: string;
}

export interface ExchangeUi {
  kind: 'exchange';
  npc: string;
  orders: BuyOrderInfo[];
  /** Items waiting for you from filled orders. */
  pending: ItemStack[];
}

export interface BoardUi {
  kind: 'board';
  npc: string;
  settlement: string;
  contracts: ContractInfo[];
}

export type UiState = TradeUi | ContainerUi | MachineUi | StationUi | ShopUi | ClaimUi | ExchangeUi | BoardUi;

export interface BuyOrderInfo {
  id: string;
  owner: string;
  item: string;
  n: number;
  filled: number;
  price: number;
  mine: boolean;
}

export interface ContractInfo {
  id: string;
  settlement: string;
  issuer: string;
  item: string;
  n: number;
  delivered: number;
  pay: number;
  bonus: number;
  /** Game minute by which the bonus is earned / the contract expires. */
  bonusBy: number;
  deadline: number;
  taker?: string;
  mine: boolean;
}

export interface ResearchState {
  kp: number;
  unlocked: string[];
  blueprints: string[];
}

export interface TutorialState {
  step: number;
  title: string;
  text: string;
  progress?: string;
  done: boolean;
}

export type ServerMessage =
  | WelcomeMessage
  | Snapshot
  | { t: 'pong'; id: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'chunk'; cx: number; cy: number; n: NodeTuple[]; st: StructSpawn[] }
  | { t: 'unchunk'; cx: number; cy: number }
  | { t: 'node'; id: number; a: number }
  | { t: 'sa'; s: StructSpawn[] }
  | { t: 'sr'; ids: number[] }
  | { t: 'su'; s: { id: number; st: StructVisual }[] }
  | { t: 'kin'; s: [number, ...number[]][]; nets: NetSummary[]; of: [number, number][] }
  | { t: 'belt'; k: BeltKeyframe[] }
  | { t: 'tiles'; c: [number, number, number][] }
  | InventoryMessage
  | ({ t: 'status' } & PlayerStatus)
  | { t: 'ui'; ui: UiState }
  | { t: 'uiclose' }
  | { t: 'notice'; text: string; kind: 'info' | 'good' | 'bad' | 'money' }
  | { t: 'chat'; from: string; text: string; kind?: 'system' | 'admin' | 'company' }
  /** Your company (null when you have none), and a pending invitation. */
  | { t: 'company'; info: CompanyInfo | null; invite?: string }
  | ({ t: 'research' } & ResearchState)
  | ({ t: 'tutorial' } & TutorialState)
  | { t: 'contracts'; list: ContractInfo[] }
  | { t: 'dead'; by: string; crests: number; items: number }
  | { t: 'alive' }
  | { t: 'markets'; list: { settlement: string; items: [string, number, number][] }[] }
  | ({ t: 'stats' } & FactoryStats)
  | { t: 'towns'; list: TownInfo[] }
  /** Fluid networks; `of` maps pipes and tanks to networks and comes when the pipes change. */
  | { t: 'fluids'; nets: FluidNetTuple[]; of?: [number, number][] };
