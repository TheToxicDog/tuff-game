// Wire protocol.
//
// Low-frequency, structured messages (login, chunks, inventory, chat) travel as JSON text frames.
// High-frequency state (inputs, snapshots) travels as compact binary frames. WebSockets are
// reliable and ordered, so snapshots are deltas against what the server last sent each client.

import type { ContentBundle, ServerConfig } from '../content/types';
import type { InvLocation, ItemStack, PlayerInventory } from '../items/inventory';
import type { BodyPart, NeedsState, Wound } from '../sim/body';
import type { PlayerInput, PlayerSimState } from '../sim/player';
import type { ObjectState } from '../world/compile';
import type { BuildingDef, FenceDef, PropInstance, RoadDef, SpawnPoint, ZoneDef } from '../world/map';
import { BinaryReader, BinaryWriter } from './binary';

// ---------------------------------------------------------------------------------------------
// Entities

export const EntityKind = {
  Player: 1,
  Zombie: 2,
  Corpse: 3,
  Item: 4,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export const PlayerFlags = {
  Moving: 1 << 0,
  Sprinting: 1 << 1,
  Crouching: 1 << 2,
  Aiming: 1 << 3,
  Reloading: 1 << 4,
  Melee: 1 << 5,
  Shove: 1 << 6,
  Flashlight: 1 << 7,
  Injured: 1 << 8,
  Busy: 1 << 9,
} as const;

export const ZombieAnim = {
  Idle: 0,
  Walk: 1,
  Chase: 2,
  Attack: 3,
  Stagger: 4,
  Down: 5,
  Rise: 6,
  Bang: 7,
} as const;

export const CorpseFlags = {
  Player: 1,
  Looted: 2,
} as const;

/** Replicated entity state. Spawn messages carry every field; updates carry changed fields. */
export interface NetEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;
  anim: number;
  flags: number;
  /** Item index + 1 (held item for players, item for ground items), 0 for none. */
  item: number;
  /** Health fraction 0..1. */
  health: number;
  /** Spawn-only: appearance seed. */
  look: number;
  /** Spawn-only: zombie archetype index or ground item quantity. */
  extra: number;
  /** Spawn-only: player / corpse name. */
  name: string;
}

export const DeltaBits = {
  Position: 1,
  Angle: 2,
  Anim: 4,
  Flags: 8,
  Item: 16,
  Health: 32,
} as const;

// ---------------------------------------------------------------------------------------------
// Transient events

export const NetEventType = {
  Shot: 1,
  Melee: 2,
  Hit: 3,
  Sound: 4,
} as const;

export const IMPACT_MATERIALS = [
  'brick',
  'concrete',
  'wood',
  'drywall',
  'metal',
  'glass',
  'foliage',
  'fabric',
  'plastic',
  'stone',
] as const;

/** Impact byte for shot pellets: 0 = nothing hit, 1 = flesh, 2+ = IMPACT_MATERIALS index. */
export const IMPACT_NONE = 0;
export const IMPACT_FLESH = 1;

export interface ShotPellet {
  angle: number;
  distance: number;
  impact: number;
}

export interface ShotEvent {
  type: typeof NetEventType.Shot;
  shooter: number;
  item: number;
  x: number;
  y: number;
  pellets: ShotPellet[];
}

export interface MeleeEvent {
  type: typeof NetEventType.Melee;
  attacker: number;
  /** Item index + 1; 0 = fists; SHOVE_ITEM = shove. */
  item: number;
  angle: number;
  hits: number;
}

export const SHOVE_ITEM = 0xffff;

export const HitKind = {
  Bullet: 0,
  Blunt: 1,
  Sharp: 2,
  Shove: 3,
  Bite: 4,
  Scratch: 5,
} as const;

export const HitFlags = {
  Kill: 1,
  Headshot: 2,
  Knockdown: 4,
} as const;

export interface HitEvent {
  type: typeof NetEventType.Hit;
  target: number;
  x: number;
  y: number;
  /** Direction the hit travelled. */
  dir: number;
  kind: number;
  flags: number;
  /** Entity that caused the hit (attacker or zombie). */
  source: number;
}

export const SOUNDS = [
  'door_open',
  'door_close',
  'door_bang',
  'door_break',
  'door_locked',
  'window_break',
  'zombie_groan',
  'zombie_alert',
  'zombie_attack',
  'zombie_death',
  'body_fall',
  'footstep',
  'search',
  'eat',
  'drink',
  'bandage',
  'pickup',
  'player_hurt',
  'player_death',
  'glass_step',
] as const;
export type SoundName = (typeof SOUNDS)[number];

export interface SoundEvent {
  type: typeof NetEventType.Sound;
  sound: number;
  x: number;
  y: number;
  volume: number;
  /** Entity the sound belongs to (0 for none), so the client can skip its own predicted sounds. */
  source: number;
}

export type NetEvent = ShotEvent | MeleeEvent | HitEvent | SoundEvent;

// ---------------------------------------------------------------------------------------------
// Binary messages

export const ClientBinary = {
  Input: 1,
} as const;

export const ServerBinary = {
  Snapshot: 1,
} as const;

/** Applies wire quantisation so the client predicts with exactly the values the server sees. */
export function quantizeInput(input: PlayerInput): PlayerInput {
  const w = new BinaryWriter(16);
  writeInput(w, input);
  return readInput(new BinaryReader(w.finish()));
}

function writeInput(w: BinaryWriter, input: PlayerInput): void {
  w.u32(input.seq);
  w.i8(Math.round(Math.max(-1, Math.min(1, input.moveX)) * 127));
  w.i8(Math.round(Math.max(-1, Math.min(1, input.moveY)) * 127));
  w.angle16(input.aim);
  w.u8(input.buttons);
  w.u8(input.slot);
  const tick = Math.max(0, input.viewTick);
  const whole = Math.floor(tick);
  w.u32(whole);
  w.u8(Math.min(255, Math.floor((tick - whole) * 256)));
}

function readInput(r: BinaryReader): PlayerInput {
  const seq = r.u32();
  const moveX = r.i8() / 127;
  const moveY = r.i8() / 127;
  const aim = r.angle16();
  const buttons = r.u8();
  const slot = r.u8();
  const whole = r.u32();
  const frac = r.u8() / 256;
  return { seq, moveX, moveY, aim, buttons, slot, viewTick: whole + frac };
}

export function encodeInputs(inputs: readonly PlayerInput[]): Uint8Array {
  const w = new BinaryWriter(16 + inputs.length * 16);
  w.u8(ClientBinary.Input);
  w.u8(inputs.length);
  for (const input of inputs) writeInput(w, input);
  return w.finish();
}

export function decodeInputs(r: BinaryReader): PlayerInput[] {
  const count = r.u8();
  const inputs: PlayerInput[] = [];
  for (let i = 0; i < count; i++) inputs.push(readInput(r));
  return inputs;
}

export interface Snapshot {
  tick: number;
  worldMinutes: number;
  ackSeq: number;
  self: PlayerSimState | null;
  events: NetEvent[];
  spawns: NetEntity[];
  updates: (Partial<NetEntity> & { id: number; bits: number })[];
  despawns: number[];
}

export function writeSelfState(w: BinaryWriter, s: PlayerSimState | null): void {
  if (!s) {
    w.u8(0);
    return;
  }
  w.u8(1);
  w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy);
  w.u16(Math.round(Math.max(0, Math.min(1, s.stamina)) * 65535));
  w.u8((s.exhausted ? 1 : 0) | (s.crouching ? 2 : 0) | (s.sprinting ? 4 : 0));
  w.u16(Math.round(Math.max(0, Math.min(1, s.aimProgress)) * 65535));
  w.f32(s.bloom);
  w.u8(s.slot);
  w.f32(s.equipTimer).f32(s.cooldown).f32(s.shoveCooldown);
  w.u8(s.action);
  w.f32(s.actionTimer);
  w.u16(s.magAmmo);
  w.u8(s.prevButtons);
  w.f32(s.stride);
  w.angle16(s.aim);
}

export function readSelfState(r: BinaryReader): PlayerSimState | null {
  if (r.u8() === 0) return null;
  const x = r.f32();
  const y = r.f32();
  const vx = r.f32();
  const vy = r.f32();
  const stamina = r.u16() / 65535;
  const bits = r.u8();
  const aimProgress = r.u16() / 65535;
  const bloom = r.f32();
  const slot = r.u8();
  const equipTimer = r.f32();
  const cooldown = r.f32();
  const shoveCooldown = r.f32();
  const action = r.u8() as PlayerSimState['action'];
  const actionTimer = r.f32();
  const magAmmo = r.u16();
  const prevButtons = r.u8();
  const stride = r.f32();
  const aim = r.angle16();
  return {
    x,
    y,
    vx,
    vy,
    aim,
    stamina,
    exhausted: (bits & 1) !== 0,
    crouching: (bits & 2) !== 0,
    sprinting: (bits & 4) !== 0,
    aimProgress,
    bloom,
    slot,
    equipTimer,
    cooldown,
    shoveCooldown,
    action,
    actionTimer,
    magAmmo,
    prevButtons,
    stride,
  };
}

export function writeEvent(w: BinaryWriter, e: NetEvent): void {
  w.u8(e.type);
  switch (e.type) {
    case NetEventType.Shot:
      w.varuint(e.shooter).u16(e.item).f32(e.x).f32(e.y).u8(e.pellets.length);
      for (const p of e.pellets) {
        w.angle16(p.angle);
        w.u16(Math.min(65535, Math.round(p.distance * 100)));
        w.u8(p.impact);
      }
      break;
    case NetEventType.Melee:
      w.varuint(e.attacker).u16(e.item).angle16(e.angle).u8(e.hits);
      break;
    case NetEventType.Hit:
      w.varuint(e.target).f32(e.x).f32(e.y).angle16(e.dir).u8(e.kind).u8(e.flags).varuint(e.source);
      break;
    case NetEventType.Sound:
      w.u8(e.sound).f32(e.x).f32(e.y).unit8(e.volume).varuint(e.source);
      break;
  }
}

export function readEvent(r: BinaryReader): NetEvent {
  const type = r.u8();
  switch (type) {
    case NetEventType.Shot: {
      const shooter = r.varuint();
      const item = r.u16();
      const x = r.f32();
      const y = r.f32();
      const n = r.u8();
      const pellets: ShotPellet[] = [];
      for (let i = 0; i < n; i++) pellets.push({ angle: r.angle16(), distance: r.u16() / 100, impact: r.u8() });
      return { type, shooter, item, x, y, pellets };
    }
    case NetEventType.Melee:
      return { type, attacker: r.varuint(), item: r.u16(), angle: r.angle16(), hits: r.u8() };
    case NetEventType.Hit:
      return { type, target: r.varuint(), x: r.f32(), y: r.f32(), dir: r.angle16(), kind: r.u8(), flags: r.u8(), source: r.varuint() };
    case NetEventType.Sound:
      return { type, sound: r.u8(), x: r.f32(), y: r.f32(), volume: r.unit8(), source: r.varuint() };
    default:
      throw new Error(`Unknown event type ${type}`);
  }
}

export function writeSpawn(w: BinaryWriter, e: NetEntity): void {
  w.varuint(e.id).u8(e.kind).f32(e.x).f32(e.y).angle16(e.angle).u8(e.anim).u16(e.flags).u16(e.item);
  w.unit8(e.health).u32(e.look).u16(e.extra).string(e.name);
}

export function readSpawn(r: BinaryReader): NetEntity {
  return {
    id: r.varuint(),
    kind: r.u8() as EntityKind,
    x: r.f32(),
    y: r.f32(),
    angle: r.angle16(),
    anim: r.u8(),
    flags: r.u16(),
    item: r.u16(),
    health: r.unit8(),
    look: r.u32(),
    extra: r.u16(),
    name: r.string(64),
  };
}

/** Writes the fields of `e` selected by `bits`. */
export function writeUpdate(w: BinaryWriter, id: number, bits: number, e: NetEntity): void {
  w.varuint(id).u8(bits);
  if (bits & DeltaBits.Position) w.f32(e.x).f32(e.y);
  if (bits & DeltaBits.Angle) w.angle16(e.angle);
  if (bits & DeltaBits.Anim) w.u8(e.anim);
  if (bits & DeltaBits.Flags) w.u16(e.flags);
  if (bits & DeltaBits.Item) w.u16(e.item);
  if (bits & DeltaBits.Health) w.unit8(e.health);
}

export function readUpdate(r: BinaryReader): Partial<NetEntity> & { id: number; bits: number } {
  const id = r.varuint();
  const bits = r.u8();
  const u: Partial<NetEntity> & { id: number; bits: number } = { id, bits };
  if (bits & DeltaBits.Position) {
    u.x = r.f32();
    u.y = r.f32();
  }
  if (bits & DeltaBits.Angle) u.angle = r.angle16();
  if (bits & DeltaBits.Anim) u.anim = r.u8();
  if (bits & DeltaBits.Flags) u.flags = r.u16();
  if (bits & DeltaBits.Item) u.item = r.u16();
  if (bits & DeltaBits.Health) u.health = r.unit8();
  return u;
}

export function decodeSnapshot(r: BinaryReader): Snapshot {
  const tick = r.u32();
  const worldMinutes = r.f64();
  const ackSeq = r.u32();
  const self = readSelfState(r);
  const events: NetEvent[] = [];
  for (let i = r.varuint(); i > 0; i--) events.push(readEvent(r));
  const spawns: NetEntity[] = [];
  for (let i = r.varuint(); i > 0; i--) spawns.push(readSpawn(r));
  const updates: Snapshot['updates'] = [];
  for (let i = r.varuint(); i > 0; i--) updates.push(readUpdate(r));
  const despawns: number[] = [];
  for (let i = r.varuint(); i > 0; i--) despawns.push(r.varuint());
  return { tick, worldMinutes, ackSeq, self, events, spawns, updates, despawns };
}

// ---------------------------------------------------------------------------------------------
// JSON messages

export interface ChunkPayload {
  cx: number;
  cy: number;
  /** Run-length encoded terrain materials (see map.ts). */
  terrain: string;
  roads: RoadDef[];
  buildings: BuildingDef[];
  props: PropInstance[];
  fences: FenceDef[];
  /** Non-default states of world objects in this chunk. */
  objects: Record<string, ObjectState>;
}

export interface MapInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  spawns: SpawnPoint[];
  zones: ZoneDef[];
}

/** Coarse whole-map data for the map screen and minimap. */
export interface MapOverview {
  roads: { points: [number, number][]; width: number; kind: string }[];
  buildings: { id: string; type: string; name?: string; poly: number[] }[];
  /** Explored cells bitset (base64), OVERVIEW_CELL meters per cell. */
  explored: string;
}

export const OVERVIEW_CELL = 16;

export type PublicServerConfig = Pick<ServerConfig, 'name' | 'motd' | 'pvp' | 'maxPlayers' | 'realSecondsPerDay'>;

/** Movement parameters the client needs to predict exactly what the server simulates. */
export interface MoveParams {
  speedFactor: number;
  sprintAllowed: boolean;
  staminaRegen: number;
  maxStamina: number;
  aimSway: number;
}

export interface StatusView {
  health: number;
  wounds: Wound[];
  pain: number;
  bleeding: number;
  needs: NeedsState;
  painkillers: boolean;
  antibiotics: boolean;
  weakness: boolean;
  flashlight: boolean;
  flashlightCharge: number;
  hasFlashlight: boolean;
  /** Total carried weight in kg. */
  carried: number;
  move: MoveParams;
}

export interface ContainerView {
  id: string;
  name: string;
  volume: number;
  items: ItemStack[];
}

export interface WorldItemView {
  entity: number;
  stack: ItemStack;
}

export interface PlayerListEntry {
  id: number;
  name: string;
}

export interface CharacterStats {
  kills: number;
  timeAliveMinutes: number;
  deaths: number;
}

export type ServerMessage =
  | {
      t: 'welcome';
      entityId: number;
      accountId: string;
      name: string;
      config: PublicServerConfig;
      content: ContentBundle;
      map: MapInfo;
      tick: number;
      tickRate: number;
      worldMinutes: number;
    }
  | { t: 'chunk'; chunk: ChunkPayload }
  | { t: 'unchunk'; keys: string[] }
  | { t: 'overview'; overview: MapOverview }
  | { t: 'explored'; cells: number[] }
  | { t: 'objects'; states: Record<string, ObjectState> }
  | { t: 'inventory'; inventory: PlayerInventory }
  | { t: 'status'; status: StatusView }
  | { t: 'container'; container: ContainerView | null }
  | { t: 'floor'; items: WorldItemView[] }
  | { t: 'progress'; label: string; duration: number }
  | { t: 'progressEnd' }
  | { t: 'chat'; from: string; text: string; system?: boolean }
  | { t: 'notice'; text: string; level: 'info' | 'good' | 'warn' }
  | { t: 'players'; players: PlayerListEntry[] }
  | { t: 'died'; cause: string; stats: CharacterStats; respawnIn: number }
  | { t: 'spawned'; entityId: number }
  | { t: 'pong'; id: number; tick: number }
  | { t: 'error'; code: string; message: string };

export type ClientMessage =
  | { t: 'hello'; token: string; protocol: number }
  | { t: 'ping'; id: number }
  | { t: 'chat'; text: string }
  | { t: 'interact'; target: string; action?: 'toggle' | 'lock' }
  | { t: 'open'; target: string }
  | { t: 'close' }
  | { t: 'move'; uid: number; from: InvLocation; to: InvLocation; qty?: number }
  | { t: 'use'; uid: number; part?: BodyPart; woundId?: number }
  | { t: 'drop'; uid: number; qty?: number }
  | { t: 'takeAll'; container: string }
  | { t: 'unload'; uid: number }
  | { t: 'flashlight' }
  | { t: 'respawn' }
  | { t: 'cancel' };

export const MAX_CHAT_LENGTH = 200;
