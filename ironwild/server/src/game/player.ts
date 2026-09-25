// A connected player's character: movement state, survival stats, inventory, money, knowledge.

import {
  DEFAULT_MODS,
  FIST,
  ITEM_BY_ID,
  MAX_HEALTH,
  MAX_HUNGER,
  emptySlots,
  makeStack,
  newMoveState,
  type InputTuple,
  type ItemDef,
  type MoveMods,
  type MoveState,
  type Slots,
  type ToolStats,
  type UiState,
} from '@ironwild/shared';
import type { AccountRecord, CharacterData } from '../persistence/storage';
import type { FishingLine } from './fishing';
import type { ClientSession } from './session';

export const START_CRESTS = 25;
export const START_SLOTS = 16;

export const SKILLS = ['mining', 'forestry', 'farming', 'smithing', 'engineering', 'trading', 'combat', 'fishing'] as const;
export type Skill = (typeof SKILLS)[number];

export function skillLevel(xp: number): number {
  return Math.min(20, Math.floor(Math.sqrt(xp / 12)));
}

export function newCharacter(name: string, x: number, y: number): CharacterData {
  const slots = emptySlots(START_SLOTS);
  slots[0] = makeStack('stone_axe', 1);
  slots[1] = makeStack('stone_pickaxe', 1);
  return {
    version: 1,
    name,
    x,
    y,
    angle: 0,
    hp: MAX_HEALTH,
    hunger: 80,
    stamina: 100,
    slots,
    sel: 0,
    cap: START_SLOTS,
    crests: START_CRESTS,
    kp: 0,
    unlocked: [],
    blueprints: [],
    discovered: [],
    crafted: [],
    soldAt: [],
    skills: {},
    bed: null,
    tutorial: 0,
    buffs: [],
    dead: false,
    look: Math.floor(Math.random() * 8),
    stats: { earned: 0, deaths: 0, kills: 0, seconds: 0 },
  };
}

export class Player {
  readonly kind = 'player' as const;
  name: string;
  move: MoveState;
  angle: number;
  hp: number;
  hunger: number;
  slots: Slots;
  sel: number;
  cap: number;
  crests: number;
  kp: number;
  unlocked: Set<string>;
  blueprints: Set<string>;
  discovered: Set<string>;
  crafted: Set<string>;
  soldAt: Set<string>;
  skills: Record<string, number>;
  bed: CharacterData['bed'];
  tutorial: number;
  buffs = new Map<string, number>();
  dead: boolean;
  look: number;
  stats: CharacterData['stats'];

  // ——— Runtime ———
  inputs: InputTuple[] = [];
  lastSeq = 0;
  /** Input steps the player may still simulate (refilled in real time). */
  inputBudget = 6;
  flags = 0;
  prevFlags = 0;
  swingCd = 0;
  /** Hits land a moment after the swing starts. */
  pendingHits: { at: number; heavy: boolean; tool: ToolStats; item: string | null }[] = [];
  chargeT = 0;
  drawT = 0;
  eatCd = 0;
  lastDamageAt = 0;
  lastHunger = 0;
  gatherAcc = new Map<string, number>();
  ui: UiState | null = null;
  uiTarget: { kind: 'npc' | 'struct' | 'entity'; id: string | number } | null = null;
  invDirty = true;
  statusDirty = true;
  researchDirty = true;
  tutorialDirty = true;
  mods: MoveMods = { ...DEFAULT_MODS };
  pulling = 0;
  mounted = 0;
  /** The truck being driven. */
  driving = 0;
  crankId = 0;
  hurtT = 0;
  /** Company id. */
  company: string | null = null;
  invite: string | null = null;
  lastChatAt = 0;
  fishing: FishingLine | null = null;

  constructor(
    readonly id: number,
    readonly session: ClientSession,
    readonly account: AccountRecord,
    data: CharacterData,
  ) {
    this.name = data.name;
    this.move = newMoveState(data.x, data.y);
    this.move.stamina = data.stamina;
    this.angle = data.angle;
    this.hp = data.hp;
    this.hunger = data.hunger;
    this.slots = data.slots.slice(0, data.cap);
    while (this.slots.length < data.cap) this.slots.push(null);
    this.sel = data.sel;
    this.cap = data.cap;
    this.crests = data.crests;
    this.kp = data.kp;
    this.unlocked = new Set(data.unlocked);
    this.blueprints = new Set(data.blueprints);
    this.discovered = new Set(data.discovered);
    this.crafted = new Set(data.crafted);
    this.soldAt = new Set(data.soldAt);
    this.skills = { ...data.skills };
    this.bed = data.bed;
    this.tutorial = data.tutorial;
    for (const b of data.buffs) this.buffs.set(b.id, b.left);
    this.dead = data.dead;
    this.look = data.look;
    this.stats = { ...data.stats };
  }

  get x(): number {
    return this.move.x;
  }

  get y(): number {
    return this.move.y;
  }

  get accountId(): string {
    return this.account.id;
  }

  heldItem(): ItemDef | null {
    const s = this.slots[this.sel];
    return s ? (ITEM_BY_ID.get(s.id) ?? null) : null;
  }

  tool(): ToolStats {
    return this.heldItem()?.tool ?? FIST;
  }

  skill(name: Skill): number {
    return skillLevel(this.skills[name] ?? 0);
  }

  addXp(name: Skill, xp: number): void {
    const before = this.skill(name);
    this.skills[name] = (this.skills[name] ?? 0) + xp;
    if (this.skill(name) > before) this.statusDirty = true;
  }

  save(): CharacterData {
    return {
      version: 1,
      name: this.name,
      x: this.move.x,
      y: this.move.y,
      angle: this.angle,
      hp: this.hp,
      hunger: this.hunger,
      stamina: this.move.stamina,
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      sel: this.sel,
      cap: this.cap,
      crests: this.crests,
      kp: this.kp,
      unlocked: [...this.unlocked],
      blueprints: [...this.blueprints],
      discovered: [...this.discovered],
      crafted: [...this.crafted],
      soldAt: [...this.soldAt],
      skills: { ...this.skills },
      bed: this.bed,
      tutorial: this.tutorial,
      buffs: [...this.buffs].map(([id, left]) => ({ id, left })),
      dead: this.dead,
      look: this.look,
      stats: { ...this.stats },
    };
  }

  healthPct(): number {
    return Math.round((this.hp / MAX_HEALTH) * 100);
  }

  clampStats(): void {
    this.hp = Math.max(0, Math.min(MAX_HEALTH, this.hp));
    this.hunger = Math.max(0, Math.min(MAX_HUNGER, this.hunger));
  }
}
