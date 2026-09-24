// The authoritative game server (design plan §70–76): owns the ECS world and every system, runs
// the 20 Hz tick, manages client sessions, replicates state with per-client interest management
// and chunk streaming, and persists the world as deltas.

import {
  BinaryWriter,
  Block,
  BOARD_HP,
  bleedRate,
  buildingPolygon,
  CHUNK_SIZE,
  CHUNK_STREAM_RADIUS,
  chunkKey,
  chunkOf,
  createBody,
  createNeeds,
  createPlayerSimState,
  CorpseFlags,
  DeltaBits,
  emptyInventory,
  ENTITY_INTEREST_RADIUS,
  EntityKind,
  hashString,
  INTERACT_RANGE,
  isInsideBuilding,
  MAP_RELOAD_CODE,
  MAX_CHAT_LENGTH,
  NetEventType,
  NO_SLOT,
  OVERVIEW_CELL,
  PLAYER_RADIUS,
  PlayerAction,
  PlayerFlags,
  PROTOCOL_VERSION,
  Rng,
  SERVER_TICK_RATE,
  ServerBinary,
  SOUNDS,
  SpatialHash,
  storageId,
  World,
  WORLD_ACTIONS,
  WorldClock,
  writeEvent,
  writeSelfState,
  writeSpawn,
  writeUpdate,
  ZOMBIE_RADIUS,
  type ContentRegistry,
  type InvLocation,
  type ItemStack,
  type MapData,
  type MapOverview,
  type NetEntity,
  type NetEvent,
  type PlayerInput,
  type ServerConfig,
  type ServerMessage,
  type SoundName,
  type WorldAction,
} from '@tuff/shared';
import type { LoadedContent } from '../content/loader';
import {
  type AccountRecord,
  type CharacterData,
  type DormantZombie,
  type PersistentEntity,
  type Storage,
  type WorldMeta,
  changeCount,
} from '../persistence/storage';
import { BuildingSystem } from './building';
import { Combat } from './combat';
import { Body, Corpse, GroundItem, Player, Replicated, Transform, Zombie, type PlayerComp, type TimedAction } from './components';
import { InventoryService, isBodyPart } from './inventory';
import { LagHistory } from './lag-history';
import { LootGenerator, newUid } from './loot';
import { Navigation } from './navigation';
import { NoiseSystem } from './noise';
import { PlayerSystem } from './players';
import type { ClientSession } from './session';
import { Spawner } from './spawner';
import { SurvivalSystem } from './survival';
import { WorldState } from './world-state';
import { zombieAnim, ZombieSystem } from './zombies';

export interface GameOptions {
  autosaveSeconds?: number;
  log?: (message: string) => void;
}

interface QueuedEvent {
  event: NetEvent;
  x: number;
  y: number;
  radius: number;
}

const PLAYER_CORPSE_MINUTES = 7 * 24 * 60;
const GROUND_ITEM_MINUTES = 3 * 24 * 60;
const MAX_ZOMBIE_CORPSES = 250;

export class Game {
  readonly ecs = new World();
  readonly spatial = new SpatialHash(8);
  readonly world: WorldState;
  readonly nav: Navigation;
  readonly lag = new LagHistory();
  readonly noise: NoiseSystem;
  readonly combat: Combat;
  readonly zombies: ZombieSystem;
  readonly players: PlayerSystem;
  readonly spawner: Spawner;
  readonly survival: SurvivalSystem;
  readonly building: BuildingSystem;
  readonly inventory: InventoryService;
  readonly loot: LootGenerator;
  readonly content: ContentRegistry;
  readonly config: ServerConfig;
  readonly rng = new Rng((Date.now() ^ 0x5eed) >>> 0);
  readonly clock: WorldClock;
  readonly tickSeconds = 1 / SERVER_TICK_RATE;
  readonly sessions = new Set<ClientSession>();
  tick = 0;
  private events: QueuedEvent[] = [];
  private readonly writer = new BinaryWriter(64 * 1024);
  private meta: WorldMeta;
  private loopTimer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;
  private autosaveTimer = 0;
  private saving: Promise<void> | null = null;
  private expiryTimer = 0;
  private overview: Omit<MapOverview, 'explored'>;
  private readonly log: (message: string) => void;
  private readonly autosaveSeconds: number;
  /** Rolling tick timing statistics for monitoring. */
  readonly stats = { tickMs: 0, maxTickMs: 0, bytesOut: 0 };

  constructor(
    private readonly loaded: LoadedContent,
    readonly map: MapData,
    private readonly storage: Storage,
    options: GameOptions = {},
  ) {
    this.content = loaded.registry;
    this.config = loaded.config;
    this.log = options.log ?? ((m) => console.log(`[game] ${m}`));
    this.autosaveSeconds = options.autosaveSeconds ?? 30;
    this.world = new WorldState(map, this.content);
    this.nav = new Navigation(this.world);
    this.noise = new NoiseSystem(this);
    this.combat = new Combat(this);
    this.zombies = new ZombieSystem(this);
    this.players = new PlayerSystem(this);
    this.spawner = new Spawner(this);
    this.survival = new SurvivalSystem(this);
    this.building = new BuildingSystem(this);
    this.inventory = new InventoryService(this);
    this.loot = new LootGenerator(this.content, loaded.lootTables, this.config, map.seed);
    this.meta = { version: 1, mapId: map.id, seed: map.seed, minutes: this.config.startHour * 60, createdAt: Date.now(), populated: false };
    this.clock = new WorldClock(this.meta.minutes, this.config.realSecondsPerDay);
    this.overview = {
      roads: map.roads.filter((r) => r.kind !== 'driveway').map((r) => ({ points: r.points, width: r.width, kind: r.kind })),
      buildings: map.buildings.map((b) => ({
        id: b.id,
        type: b.type,
        name: b.name,
        poly: buildingPolygon(b).map((v) => Math.round(v * 10) / 10),
      })),
    };
    this.ecs.onDestroy((e) => this.spatial.delete(e));
  }

  get minutes(): number {
    return this.clock.totalMinutes;
  }

  get hour(): number {
    return (this.clock.totalMinutes / 60) % 24;
  }

  // =============================================================================================
  // Lifecycle

  async init(): Promise<void> {
    const snapshot = await this.storage.loadWorld();
    if (snapshot.meta && snapshot.meta.mapId === this.map.id) {
      this.meta = snapshot.meta;
      this.clock.totalMinutes = snapshot.meta.minutes;
      this.world.load(snapshot);
      for (const [owner, record] of snapshot.trust) this.building.trust.set(owner, record);
      this.spawner.load(snapshot.chunks, snapshot.zones);
      for (const ent of snapshot.entities.values()) this.restoreEntity(ent);
    } else if (snapshot.meta) {
      this.log(`Saved world belongs to map "${snapshot.meta.mapId}", starting a fresh world for "${this.map.id}".`);
    }
    if (!this.meta.populated) {
      const n = this.spawner.populate(new Rng(this.map.seed ^ 0x2b2b));
      this.meta.populated = true;
      this.log(`Distributed ${n} zombies across ${this.map.zones.length} zones.`);
    } else {
      // Zones added since the world was first populated (a republished map) get their zombies now.
      const n = this.spawner.populate(new Rng(this.map.seed ^ 0x2b2b ^ this.map.zones.length), true);
      if (n > 0) this.log(`Distributed ${n} zombies across new zones.`);
    }
    this.world.changes.meta = { ...this.meta };
    await this.save();
  }

  start(): void {
    if (this.loopTimer) return;
    this.nextTickAt = performance.now();
    const loop = () => {
      const now = performance.now();
      let ticks = 0;
      while (now >= this.nextTickAt && ticks < 5) {
        const started = performance.now();
        try {
          this.step();
        } catch (err) {
          console.error('[game] tick failed', err);
        }
        const ms = performance.now() - started;
        this.stats.tickMs = this.stats.tickMs * 0.95 + ms * 0.05;
        this.stats.maxTickMs = Math.max(this.stats.maxTickMs * 0.999, ms);
        this.nextTickAt += this.tickSeconds * 1000;
        ticks++;
      }
      if (now - this.nextTickAt > 1000) this.nextTickAt = now;
      this.loopTimer = setTimeout(loop, Math.max(0, this.nextTickAt - performance.now()));
    };
    this.loopTimer = setTimeout(loop, 0);
  }

  async stop(reason = 'Server is shutting down.', code = 1001): Promise<void> {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    for (const s of [...this.sessions]) {
      if (code === MAP_RELOAD_CODE) s.send({ t: 'mapReload', reason });
      s.close(reason, code);
    }
    this.spawner.sleepAll();
    await this.save();
  }

  // =============================================================================================
  // Sessions

  attachSession(session: ClientSession): void {
    this.sessions.add(session);
  }

  async hello(session: ClientSession, msg: { t: string; token?: unknown; protocol?: unknown }): Promise<void> {
    if (msg.protocol !== PROTOCOL_VERSION) {
      session.close('Your game client is out of date. Refresh the page.');
      return;
    }
    const account = this.authenticate ? await this.authenticate(msg.token) : null;
    if (!account) {
      session.send({ t: 'error', code: 'auth', message: 'Your session has expired. Please log in again.' });
      session.close('Not logged in.', 4001);
      return;
    }
    if (session.closed) return;
    // One connection per account: the newest login wins.
    for (const other of this.sessions) {
      if (other !== session && other.account?.id === account.id) other.close('Logged in from another window.');
    }
    const online = [...this.sessions].filter((s) => s.account && s !== session).length;
    if (online >= this.config.maxPlayers) {
      session.close(`The server is full (${this.config.maxPlayers} players).`);
      return;
    }
    session.account = account;
    this.sessions.add(session);
    let data = await this.storage.loadCharacter(account.id);
    if (session.closed) return;
    if (!data || !data.alive) data = this.newCharacter(account.displayName, data);
    const e = this.spawnPlayer(session, data);
    const welcome: ServerMessage = {
      t: 'welcome',
      entityId: e,
      accountId: account.id,
      name: account.displayName,
      config: {
        name: this.config.name,
        motd: this.config.motd,
        pvp: this.config.pvp,
        maxPlayers: this.config.maxPlayers,
        realSecondsPerDay: this.config.realSecondsPerDay,
      },
      content: this.loaded.bundle,
      map: {
        id: this.map.id,
        name: this.map.name,
        width: this.map.width,
        height: this.map.height,
        spawns: this.map.spawns,
        zones: this.map.zones,
      },
      tick: this.tick,
      tickRate: SERVER_TICK_RATE,
      worldMinutes: this.minutes,
    };
    session.send(welcome);
    const p = this.ecs.get(e, Player)!;
    session.send({ t: 'overview', overview: { ...this.overview, explored: Buffer.from(p.explored).toString('base64') } });
    session.send({ t: 'inventory', inventory: p.inventory });
    p.inventoryDirty = false;
    this.broadcastPlayers();
    this.broadcast({ t: 'chat', from: '', text: `${account.displayName} joined.`, system: true }, session);
    session.send({ t: 'chat', from: '', text: this.config.motd, system: true });
    this.log(`${account.displayName} connected (${this.sessions.size} online)`);
  }

  /** Set by the server bootstrap: resolves session tokens to accounts. */
  authenticate: ((token: unknown) => Promise<AccountRecord | null>) | null = null;

  disconnect(session: ClientSession): void {
    if (!this.sessions.delete(session)) return;
    if (session.account) {
      const name = session.account.displayName;
      if (session.entity) {
        const p = this.ecs.get(session.entity, Player);
        const t = this.ecs.get(session.entity, Transform);
        if (p && t) {
          const data = this.characterData(p, t.x, t.y);
          void this.storage
            .saveCharacters([{ accountId: p.accountId, data }])
            .catch((err) => console.error('[game] save on disconnect failed', err));
        }
        this.despawnEntity(session.entity);
        session.entity = 0;
      } else if (session.deadCharacter) {
        void this.storage.saveCharacters([{ accountId: session.account.id, data: session.deadCharacter }]).catch(() => undefined);
      }
      this.broadcastPlayers();
      this.broadcast({ t: 'chat', from: '', text: `${name} left.`, system: true });
      this.log(`${name} disconnected (${this.sessions.size} online)`);
    }
  }

  private newCharacter(name: string, previous: CharacterData | null): CharacterData {
    const spawn = this.rng.pick(this.map.spawns);
    const cols = Math.ceil(this.map.width / OVERVIEW_CELL);
    const rows = Math.ceil(this.map.height / OVERVIEW_CELL);
    return {
      version: 1,
      name,
      alive: true,
      x: spawn.x + this.rng.range(-2, 2),
      y: spawn.y + this.rng.range(-2, 2),
      angle: this.rng.range(-Math.PI, Math.PI),
      stamina: 1,
      slot: NO_SLOT,
      body: createBody(),
      needs: createNeeds(),
      inventory: emptyInventory(),
      stats: { kills: previous?.stats.kills ?? 0, deaths: previous?.stats.deaths ?? 0, lifeMinutes: 0 },
      weaknessUntil: previous ? this.minutes + this.config.death.weaknessMinutes : 0,
      flashlight: false,
      // Map knowledge survives death.
      explored: previous?.explored ?? Buffer.alloc(Math.ceil((cols * rows) / 8)).toString('base64'),
    };
  }

  private spawnPlayer(session: ClientSession, data: CharacterData): number {
    const e = this.ecs.create();
    const cols = Math.ceil(this.map.width / OVERVIEW_CELL);
    const rows = Math.ceil(this.map.height / OVERVIEW_CELL);
    const explored = new Uint8Array(Math.ceil((cols * rows) / 8));
    if (data.explored) explored.set(Buffer.from(data.explored, 'base64').subarray(0, explored.length));
    // Never spawn inside geometry (e.g. if the map changed since the last save).
    let { x, y } = data;
    if (!this.world.isWalkable(x, y, PLAYER_RADIUS)) {
      const s = this.rng.pick(this.map.spawns);
      x = s.x;
      y = s.y;
    }
    const sim = createPlayerSimState(x, y);
    sim.aim = data.angle;
    sim.stamina = data.stamina;
    sim.slot = data.slot;
    sim.magAmmo = data.inventory.slots[data.slot]?.ammo ?? 0;
    const p: PlayerComp = {
      accountId: session.account!.id,
      name: data.name,
      link: session,
      sim,
      inputs: [],
      inputBudget: 0,
      lastSeq: 0,
      viewTick: this.tick,
      inventory: data.inventory,
      body: data.body,
      needs: data.needs,
      flashlight: data.flashlight,
      stats: data.stats,
      weaknessUntil: data.weaknessUntil,
      action: null,
      openContainer: null,
      heldUid: data.inventory.slots[data.slot]?.uid ?? 0,
      explored,
      exploredDirty: [],
      inventoryDirty: true,
      statusDirty: true,
      statusKey: '',
      refreshTimer: 0,
      move: { speedFactor: 1, sprintAllowed: true, staminaRegen: 1, maxStamina: 1, aimSway: 0 },
      sleep: null,
    };
    p.move = this.players.moveParams(p);
    this.ecs.add(e, Transform, { x, y, angle: data.angle });
    this.ecs.add(e, Body, { radius: PLAYER_RADIUS });
    this.ecs.add(e, Replicated, { kind: EntityKind.Player, look: hashString(p.accountId), name: data.name, extra: 0 });
    this.ecs.add(e, Player, p);
    this.spatial.set(e, x, y);
    session.entity = e;
    session.deadCharacter = null;
    session.viewX = x;
    session.viewY = y;
    const isNew =
      data.inventory.pockets.length === 0 && data.inventory.slots.every((s) => !s) && !data.inventory.back && data.stats.lifeMinutes === 0;
    if (isNew) this.inventory.giveStartingItems(e, p);
    return e;
  }

  characterData(p: PlayerComp, x: number, y: number): CharacterData {
    const held = p.inventory.slots[p.sim.slot];
    if (held && this.content.findItem(held.id)?.firearm) held.ammo = p.sim.magAmmo;
    return {
      version: 1,
      name: p.name,
      alive: p.body.health > 0,
      x,
      y,
      angle: p.sim.aim,
      stamina: p.sim.stamina,
      slot: p.sim.slot,
      body: p.body,
      needs: p.needs,
      inventory: p.inventory,
      stats: p.stats,
      weaknessUntil: p.weaknessUntil,
      flashlight: p.flashlight,
      explored: Buffer.from(p.explored).toString('base64'),
    };
  }

  receiveInputs(session: ClientSession, inputs: PlayerInput[]): void {
    const p = this.ecs.get(session.entity, Player);
    if (!p) return;
    for (const input of inputs) {
      // Ignore stale or duplicated inputs; sequence numbers only increase.
      if (input.seq <= p.lastSeq || (p.inputs.length > 0 && input.seq <= p.inputs[p.inputs.length - 1].seq)) continue;
      if (!Number.isFinite(input.moveX) || !Number.isFinite(input.aim)) continue;
      p.inputs.push(input);
    }
  }

  handleMessage(session: ClientSession, msg: { t: string; [key: string]: unknown }): void {
    const e = session.entity;
    const p = e ? this.ecs.get(e, Player) : undefined;
    switch (msg.t) {
      case 'ping':
        session.send({ t: 'pong', id: Number(msg.id) || 0, tick: this.tick });
        return;
      case 'chat':
        this.chat(session, msg.text);
        return;
      case 'respawn':
        this.respawn(session);
        return;
    }
    if (!p) return;
    let error: string | null = null;
    if (p.sleep && msg.t !== 'wake' && msg.t !== 'close' && msg.t !== 'cancel') {
      this.notify(p, 'You are asleep. Press E to wake up.', 'info');
      return;
    }
    switch (msg.t) {
      case 'wake':
        this.survival.wake(p, 'You get up.', 'info');
        break;
      case 'sleep':
        error = this.survival.sleep(e, p, typeof msg.target === 'string' ? msg.target : undefined);
        break;
      case 'craft':
        error = this.survival.beginCraft(e, p, String(msg.recipe ?? ''));
        break;
      case 'build':
        error = this.building.beginBuild(e, p, msg as never);
        break;
      case 'act': {
        const action = msg.action as WorldAction;
        if (!WORLD_ACTIONS.includes(action)) return;
        error = this.building.beginAction(e, p, action, String(msg.target ?? ''));
        break;
      }
      case 'interact':
        error = this.interact(e, p, String(msg.target ?? ''), msg.action === 'lock' ? 'lock' : 'toggle');
        break;
      case 'open':
        error = this.open(e, p, String(msg.target ?? ''));
        break;
      case 'close':
        p.openContainer = null;
        if (p.action?.kind === 'search') this.cancelAction(p);
        break;
      case 'move': {
        const from = parseLoc(msg.from);
        const to = parseLoc(msg.to);
        if (!from || !to || typeof msg.uid !== 'number') return;
        error = this.inventory.move(e, p, msg.uid, from, to, typeof msg.qty === 'number' ? msg.qty : undefined);
        if (from.kind === 'floor' || to.kind === 'floor') this.sendFloor(e, p);
        break;
      }
      case 'drop':
        if (typeof msg.uid !== 'number') return;
        {
          const found = this.findLoc(p, msg.uid);
          if (found)
            error = this.inventory.move(e, p, msg.uid, found, { kind: 'floor' }, typeof msg.qty === 'number' ? msg.qty : undefined);
          if (p.openContainer === 'floor') this.sendFloor(e, p);
        }
        break;
      case 'use':
        if (typeof msg.uid !== 'number') return;
        if (p.action) {
          error = 'You are busy.';
          break;
        }
        error = this.inventory.beginUse(e, p, msg.uid, typeof msg.woundId === 'number' ? msg.woundId : undefined);
        break;
      case 'takeAll':
        error = this.inventory.takeAll(e, p, String(msg.container ?? ''));
        if (msg.container === 'floor') this.sendFloor(e, p);
        break;
      case 'unload':
        if (typeof msg.uid === 'number') error = this.inventory.unload(p, msg.uid);
        break;
      case 'flashlight': {
        const light = this.inventory.lightItem(p.inventory);
        if (!light) error = 'You have no light.';
        else if ((light.charge ?? 1) <= 0) error = 'The batteries are dead.';
        else {
          p.flashlight = !p.flashlight;
          p.refreshTimer = 0;
        }
        break;
      }
      case 'cancel':
        if (p.action) this.cancelAction(p);
        break;
      default:
        return;
    }
    if (error) this.notify(p, error, 'warn');
    this.flushInventory(p);
  }

  private findLoc(p: PlayerComp, uid: number): InvLocation | null {
    const inv = p.inventory;
    const slot = inv.slots.findIndex((s) => s?.uid === uid);
    if (slot >= 0) return { kind: 'slot', index: slot };
    if (inv.pockets.some((s) => s.uid === uid)) return { kind: 'pockets' };
    if (inv.back?.uid === uid) return { kind: 'back' };
    if (inv.back?.contents?.some((s) => s.uid === uid)) return { kind: 'backpack' };
    return null;
  }

  private chat(session: ClientSession, raw: unknown): void {
    if (!session.account || typeof raw !== 'string') return;
    // Strip control characters; the client renders chat as plain text.
    const text = raw
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    if (text === '/who' || text === '/players') {
      const names = [...this.sessions].filter((s) => s.account).map((s) => s.account!.displayName);
      session.send({ t: 'chat', from: '', text: `Online (${names.length}): ${names.join(', ')}`, system: true });
      return;
    }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    if (text.startsWith('/') && (cmd === 'trust' || cmd === 'untrust' || cmd === 'trusted')) {
      const reply = this.building.trustCommand({ id: session.account.id, name: session.account.displayName }, cmd, args);
      session.send({ t: 'chat', from: '', text: reply, system: true });
      return;
    }
    if (text.startsWith('/')) {
      const reply = session.account.isAdmin ? this.adminCommand(session, text) : 'Unknown command. Try /who or /trust <name>.';
      session.send({ t: 'chat', from: '', text: reply, system: true });
      return;
    }
    this.broadcast({ t: 'chat', from: session.account.displayName, text });
  }

  /** Admin tools for testing and running a server (design plan §92: admin tools). */
  private adminCommand(session: ClientSession, text: string): string {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const e = session.entity;
    const p = e ? this.ecs.get(e, Player) : undefined;
    const t = e ? this.ecs.get(e, Transform) : undefined;
    const num = (i: number, fallback: number) => (Number.isFinite(Number(args[i])) && args[i] !== undefined ? Number(args[i]) : fallback);
    switch (cmd) {
      case 'help':
        return 'Admin: /tp x y · /time hour · /give item [qty] · /heal · /zombies n · /clear [radius] · /save · /kit build|cook — everyone: /who · /trust name · /untrust name · /trusted';
      case 'tp': {
        if (!p || !t) return 'You are not in the world.';
        const x = Math.max(1, Math.min(this.map.width - 1, num(0, t.x)));
        const y = Math.max(1, Math.min(this.map.height - 1, num(1, t.y)));
        p.sim.x = t.x = x;
        p.sim.y = t.y = y;
        this.spatial.set(e, x, y);
        session.viewX = x;
        session.viewY = y;
        return `Teleported to ${x.toFixed(0)}, ${y.toFixed(0)}.`;
      }
      case 'time': {
        const hour = Math.max(0, Math.min(23.99, num(0, 12)));
        const day = Math.floor(this.clock.totalMinutes / 1440);
        this.clock.totalMinutes = day * 1440 + hour * 60 + (hour * 60 < this.clock.totalMinutes % 1440 ? 1440 : 0);
        return `Time set to ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}.`;
      }
      case 'give': {
        if (!p || !t) return 'You are not in the world.';
        const def = this.content.findItem(args[0] ?? '');
        if (!def) return `Unknown item "${args[0] ?? ''}".`;
        const qty = Math.max(1, Math.min(def.stackSize, Math.floor(num(1, 1))));
        const stack: ItemStack = { uid: newUid(), id: def.id, qty };
        if (def.firearm) stack.ammo = def.firearm.magazine;
        if (def.uses) stack.uses = def.uses;
        if (def.light) stack.charge = 1;
        if (def.durability) stack.cond = 1;
        if (!this.inventory.autoPlace(p, stack)) this.spawnGroundItem(t.x, t.y, stack);
        this.flushInventory(p);
        return `Gave ${qty} × ${def.name}.`;
      }
      case 'heal':
        if (!p) return 'You are not in the world.';
        p.body = createBody();
        p.needs = createNeeds();
        p.weaknessUntil = 0;
        p.statusDirty = true;
        p.refreshTimer = 0;
        return 'Healed.';
      case 'zombies': {
        if (!t) return 'You are not in the world.';
        const n = Math.max(1, Math.min(40, Math.floor(num(0, 5))));
        const zone =
          this.map.zones.find(
            (z) => t.x >= z.rect[0] && t.y >= z.rect[1] && t.x <= z.rect[0] + z.rect[2] && t.y <= z.rect[1] + z.rect[3],
          ) ?? this.map.zones[0];
        let spawned = 0;
        for (let i = 0; i < n * 6 && spawned < n; i++) {
          const a = this.rng.range(-Math.PI, Math.PI);
          const d = this.rng.range(8, 16);
          const x = t.x + Math.cos(a) * d;
          const y = t.y + Math.sin(a) * d;
          if (this.world.compiled.collision.overlapsCircle(x, y, 0.4, Block.Zombie)) continue;
          const arch = this.content.zombies[Math.floor(this.rng.next() * this.content.zombies.length)];
          this.spawnZombie({ x, y, arch: arch.id, look: this.rng.nextU32(), zone: zone?.id ?? '', hp: 1 });
          spawned++;
        }
        return `Spawned ${spawned} zombies.`;
      }
      case 'clear': {
        if (!t) return 'You are not in the world.';
        const radius = Math.max(1, Math.min(120, num(0, 40)));
        let removed = 0;
        for (const z of this.ecs.query(Zombie, Transform)) {
          const zt = this.ecs.get(z, Transform)!;
          if (Math.hypot(zt.x - t.x, zt.y - t.y) > radius) continue;
          this.despawnEntity(z);
          removed++;
        }
        return `Removed ${removed} zombies.`;
      }
      case 'save':
        void this.save();
        return 'Saving the world.';
      case 'kit': {
        if (!p || !t) return 'You are not in the world.';
        const kits: Record<string, [string, number][]> = {
          build: [
            ['hammer', 1],
            ['saw', 1],
            ['plank', 10],
            ['nails', 100],
            ['lighter', 1],
            ['tool_bag', 1],
          ],
          cook: [
            ['cooking_pot', 1],
            ['frying_pan', 1],
            ['can_opener', 1],
            ['water_bottle', 4],
            ['potato', 4],
            ['raw_steak', 2],
            ['dry_pasta', 1],
            ['ground_coffee', 1],
          ],
        };
        const kit = kits[args[0] ?? ''];
        if (!kit) return 'Usage: /kit build|cook';
        this.inventory.giveItems(
          e,
          p,
          kit.map(([item, qty]) => ({ item, qty })),
        );
        this.flushInventory(p);
        return `Gave the ${args[0]} kit.`;
      }
      default:
        return `Unknown command /${cmd}. Try /help.`;
    }
  }

  private respawn(session: ClientSession): void {
    if (!session.account || session.entity) return;
    if (Date.now() < session.respawnAt) return;
    const data = this.newCharacter(session.account.displayName, session.deadCharacter);
    const e = this.spawnPlayer(session, data);
    session.known.clear();
    session.send({ t: 'spawned', entityId: e });
    const p = this.ecs.get(e, Player)!;
    this.flushInventory(p);
    this.broadcastPlayers();
  }

  // =============================================================================================
  // Interaction

  private interact(e: number, p: PlayerComp, target: string, action: 'toggle' | 'lock'): string | null {
    const t = this.ecs.get(e, Transform)!;
    if (target.startsWith('e:')) {
      const id = Number(target.slice(2));
      const item = this.ecs.get(id, GroundItem);
      const it = this.ecs.get(id, Transform);
      if (item && it) {
        if (Math.hypot(it.x - t.x, it.y - t.y) > INTERACT_RANGE + 0.5) return 'Too far away.';
        if (!this.inventory.autoPlace(p, item.stack)) return 'You have no room for that.';
        this.removeGroundItem(id);
        this.soundAt('pickup', t.x, t.y, 0.4, e);
        if (p.openContainer === 'floor') this.sendFloor(e, p);
        return null;
      }
      if (this.ecs.has(id, Corpse)) return this.open(e, p, target);
      return null;
    }
    const door = this.world.compiled.doors.get(target);
    if (door) {
      if (Math.hypot(door.x - t.x, door.y - t.y) > INTERACT_RANGE + door.w / 2) return 'Too far away.';
      const s = this.world.compiled.effectiveState(target);
      if (s.boards > 0) return 'It is barricaded.';
      if (s.broken) return 'The door is broken.';
      // Player-built doors lock with a key: their owner and trusted survivors, from either side.
      const owner = door.structureId ? this.world.structures.get(door.structureId)?.owner : null;
      const keyholder = !!owner && this.building.canManage(p.accountId, owner, this.isAdmin(p));
      if (action === 'lock') {
        if (s.open) return 'Close the door first.';
        if (owner) {
          if (!keyholder) return 'You do not have the key.';
          this.world.setObjectState(target, { locked: !s.locked });
          this.broadcastObject(target);
          this.soundAt('door_locked', door.x, door.y, 0.5, e);
          this.notify(p, s.locked ? 'Unlocked.' : 'Locked.', 'info');
          return null;
        }
        const building = this.world.map.buildings.find((b) => b.id === door.buildingId);
        const inside = building ? isInsideBuilding(building, t.x, t.y, -0.2) : false;
        if (!inside) return s.locked ? 'It is locked from the inside.' : 'You can only lock doors from the inside.';
        this.world.setObjectState(target, { locked: !s.locked });
        this.broadcastObject(target);
        this.soundAt('door_locked', door.x, door.y, 0.5, e);
        this.notify(p, s.locked ? 'Unlocked.' : 'Locked.', 'info');
        return null;
      }
      if (!s.open && s.locked) {
        const building = this.world.map.buildings.find((b) => b.id === door.buildingId);
        const inside = owner ? keyholder : building ? isInsideBuilding(building, t.x, t.y, -0.2) : false;
        if (!inside || door.doorKind === 'cell') {
          this.soundAt('door_locked', door.x, door.y, 0.6, e);
          return 'It is locked.';
        }
        // Unlock from the inside and open in one go.
        this.world.setObjectState(target, { locked: false });
      }
      if (s.open && this.doorwayBlocked(door.x, door.y, door.w)) return 'Something is in the way.';
      this.world.setObjectState(target, { open: !s.open });
      this.broadcastObject(target);
      this.soundAt(s.open ? 'door_close' : 'door_open', door.x, door.y, 0.7, e);
      this.noise.emit(door.x, door.y, s.open ? 5 : 7, e);
      return null;
    }
    const win = this.world.compiled.windows.get(target);
    if (win) {
      if (Math.hypot(win.x - t.x, win.y - t.y) > INTERACT_RANGE + win.w / 2) return 'Too far away.';
      const ws = this.world.compiled.effectiveState(target);
      if (ws.boards > 0) return 'It is boarded up.';
      if (ws.broken) return 'It is already broken — you can climb through.';
      this.damageObject(target, 999, e, 'window_break');
      return null;
    }
    if (this.world.compiled.containers.has(target)) return this.open(e, p, target);
    return null;
  }

  isAdmin(p: PlayerComp): boolean {
    return !!(p.link as Partial<ClientSession> | null)?.account?.isAdmin;
  }

  doorwayBlocked(x: number, y: number, w: number): boolean {
    for (const id of this.spatial.query(x, y, w)) {
      const t = this.ecs.get(id, Transform);
      const b = this.ecs.get(id, Body);
      if (t && b && Math.hypot(t.x - x, t.y - y) < w / 2 + b.radius) return true;
    }
    return false;
  }

  private open(e: number, p: PlayerComp, target: string): string | null {
    if (target === 'floor') {
      p.openContainer = 'floor';
      this.sendFloor(e, p);
      return null;
    }
    if (!this.inventory.inRangeOf(e, target)) return 'Too far away.';
    if (target.startsWith('e:')) {
      p.openContainer = target;
      p.link?.send({ t: 'container', container: this.inventory.containerView(target) });
      return null;
    }
    const container = this.world.compiled.containers.get(target);
    if (!container) return null;
    if (container.owner && this.world.compiled.effectiveState(target).locked) {
      if (!this.building.canManage(p.accountId, container.owner, this.isAdmin(p))) return 'It is locked.';
    }
    if (p.action) this.cancelAction(p);
    // The first search is slow (rummaging); reopening something already searched is quick.
    const searched = this.world.compiled.effectiveState(target).searched;
    const duration = searched ? Math.min(0.6, container.searchTime * 0.3) : container.searchTime;
    this.startAction(e, p, { kind: 'search', label: `${searched ? 'Opening' : 'Searching'} ${container.name}`, duration, target });
    this.soundAt('search', container.x, container.y, 0.35, e);
    this.noise.emit(container.x, container.y, 2, e);
    return null;
  }

  private openContainerNow(e: number, p: PlayerComp, id: string): void {
    if (!this.inventory.inRangeOf(e, id)) return;
    if (!this.world.containers.has(id)) {
      this.world.setContainer(id, { items: this.loot.generateContainer(this.world, id) });
    }
    if (!this.world.compiled.effectiveState(id).searched) {
      this.world.setObjectState(id, { searched: true });
      this.broadcastObject(id);
    }
    p.openContainer = id;
    p.link?.send({ t: 'container', container: this.inventory.containerView(id) });
  }

  startAction(e: number, p: PlayerComp, a: Omit<TimedAction, 'elapsed' | 'startX' | 'startY'>): void {
    p.action = { ...a, elapsed: 0, startX: p.sim.x, startY: p.sim.y };
    p.link?.send({ t: 'progress', label: a.label, duration: a.duration });
    if (a.kind === 'consume' && a.uid !== undefined) {
      const def = this.content.findItem(this.findStackId(p, a.uid) ?? '');
      if (def?.category === 'drink') this.sound('drink', e, 0.5);
      else if (def?.category === 'food') this.sound('eat', e, 0.5);
    }
  }

  private findStackId(p: PlayerComp, uid: number): string | null {
    const inv = p.inventory;
    for (const s of inv.slots) if (s?.uid === uid) return s.id;
    for (const s of inv.pockets) if (s.uid === uid) return s.id;
    for (const s of inv.back?.contents ?? []) if (s.uid === uid) return s.id;
    return null;
  }

  cancelAction(p: PlayerComp): void {
    p.action = null;
    p.link?.send({ t: 'progressEnd' });
  }

  completeAction(e: number, p: PlayerComp): void {
    const a = p.action;
    p.action = null;
    p.link?.send({ t: 'progressEnd' });
    if (!a) return;
    if (a.kind === 'search') this.openContainerNow(e, p, a.target);
    else if (a.kind === 'consume' && a.uid !== undefined) {
      const message = this.inventory.finishUse(e, p, a.uid, a.woundId);
      if (message) this.notify(p, message, 'info');
    } else if (a.kind === 'craft' && a.recipe) {
      const message = this.survival.finishCraft(e, p, a.recipe);
      if (message) this.notify(p, message, message.startsWith('You make') ? 'good' : 'warn');
    } else if (a.kind === 'build' && a.build) {
      const error = this.building.finishBuild(e, p, a.build);
      if (error) this.notify(p, error, 'warn');
    } else if (a.kind === 'work' && a.work) {
      const message = this.building.finish(e, p, a.work, a.target);
      if (message) this.notify(p, message, 'info');
    }
    this.flushInventory(p);
  }

  // =============================================================================================
  // World effects used by systems

  event(event: NetEvent, x: number, y: number, radius: number): void {
    this.events.push({ event, x, y, radius });
  }

  soundAt(name: SoundName, x: number, y: number, volume: number, source = 0): void {
    this.event({ type: NetEventType.Sound, sound: SOUNDS.indexOf(name), x, y, volume, source }, x, y, 18 + 50 * volume);
  }

  sound(name: SoundName, entity: number, volume: number): void {
    const t = this.ecs.get(entity, Transform);
    if (t) this.soundAt(name, t.x, t.y, volume, entity);
  }

  notify(p: PlayerComp, text: string, level: 'info' | 'good' | 'warn'): void {
    p.link?.send({ t: 'notice', text, level });
  }

  broadcast(message: ServerMessage, except?: ClientSession): void {
    const json = JSON.stringify(message);
    for (const s of this.sessions) if (s !== except && s.account) s.sendRaw(json);
  }

  private broadcastPlayers(): void {
    const players = [...this.sessions].filter((s) => s.account).map((s) => ({ id: s.entity, name: s.account!.displayName }));
    this.broadcast({ t: 'players', players });
  }

  broadcastObject(id: string): void {
    const chunks = this.world.chunksOfObject(id);
    const json = JSON.stringify({ t: 'objects', states: { [id]: this.world.compiled.stateOf(id) } });
    for (const s of this.sessions) {
      if (chunks.some((k) => s.loadedChunks.has(k))) s.sendRaw(json);
    }
  }

  /** Damages a door, window (barricade planks first) or structure; returns true when it broke. */
  damageObject(id: string, amount: number, source: number, sound: SoundName): boolean {
    const obj = this.world.compiled.object(id);
    if (!obj) return false;
    if (obj.kind === 'structure') return this.building.damageStructure(id, amount, source);
    if (obj.kind !== 'door' && obj.kind !== 'window') return false;
    const s = this.world.compiled.effectiveState(id);
    if (s.boards > 0) {
      // Planks take the beating first; each one gives way in turn.
      const boardHp = s.boardHp - Math.min(amount, BOARD_HP * 0.8);
      const boards = Math.max(0, Math.ceil(boardHp / BOARD_HP - 1e-6));
      this.world.setObjectState(id, { boards, boardHp: Math.max(0, boardHp) });
      if (boards < s.boards) {
        this.soundAt('board_break', obj.x, obj.y, 1, source);
        this.noise.emit(obj.x, obj.y, 24, source);
        this.broadcastObject(id);
      } else {
        this.soundAt('door_bang', obj.x, obj.y, 0.9, source);
        this.noise.emit(obj.x, obj.y, 18, source);
      }
      return false;
    }
    if (s.broken || (obj.kind === 'door' && s.open)) return false;
    const hp = s.hp - amount;
    if (hp <= 0) {
      this.world.setObjectState(id, { broken: true, hp: 0 });
      this.soundAt(obj.kind === 'door' ? 'door_break' : 'window_break', obj.x, obj.y, 1, source);
      this.noise.emit(obj.x, obj.y, obj.kind === 'door' ? 30 : 25, source);
      this.broadcastObject(id);
      return true;
    }
    this.world.setObjectState(id, { hp });
    this.soundAt(sound, obj.x, obj.y, 0.9, source);
    this.noise.emit(obj.x, obj.y, 18, source);
    return false;
  }

  spawnZombie(rec: DormantZombie): number {
    const arch = this.content.zombies.find((a) => a.id === rec.arch) ?? this.content.zombies[0];
    const rng = new Rng(rec.look);
    const maxHp = rng.range(arch.health[0], arch.health[1]);
    const e = this.ecs.create();
    this.ecs.add(e, Transform, { x: rec.x, y: rec.y, angle: rng.range(-Math.PI, Math.PI) });
    this.ecs.add(e, Body, { radius: ZOMBIE_RADIUS });
    this.ecs.add(e, Replicated, { kind: EntityKind.Zombie, look: rec.look, name: '', extra: this.content.zombies.indexOf(arch) });
    this.ecs.add(e, Zombie, {
      arch,
      archIndex: this.content.zombies.indexOf(arch),
      look: rec.look,
      zone: rec.zone,
      hp: maxHp * rec.hp,
      maxHp,
      walkSpeed: rng.range(arch.walkSpeed[0], arch.walkSpeed[1]),
      chaseSpeed: rng.range(arch.chaseSpeed[0], arch.chaseSpeed[1]),
      damageScale: rng.range(arch.attackDamage[0], arch.attackDamage[1]),
      state: 'idle',
      stateTimer: rng.range(1, 8),
      target: 0,
      goalX: rec.x,
      goalY: rec.y,
      interest: 0,
      awareness: 0,
      awarenessTarget: 0,
      lostTimer: 0,
      path: null,
      pathIndex: 0,
      repathTimer: 0,
      pathPending: false,
      perceptionTimer: rng.range(0, 0.4),
      attackCooldown: 0,
      groanTimer: rng.range(2, 12),
      stuckTimer: 0,
      progressX: rec.x,
      progressY: rec.y,
      bangTarget: null,
      vx: 0,
      vy: 0,
      knockX: 0,
      knockY: 0,
      idleOutside: 0,
    });
    this.spatial.set(e, rec.x, rec.y);
    return e;
  }

  killZombie(id: number, killer: number, dir: number): void {
    const z = this.ecs.get(id, Zombie);
    const t = this.ecs.get(id, Transform);
    if (!z || !t) return;
    this.spawner.onZombieKilled(z.zone);
    const killerPlayer = this.ecs.get(killer, Player);
    if (killerPlayer) killerPlayer.stats.kills++;
    this.soundAt('zombie_death', t.x, t.y, 0.8, id);
    const items = this.loot.zombiePockets(this.rng);
    this.spawnCorpse(t.x, t.y, dir, z.look, '', false, items, this.config.zombies.corpseLifetimeMinutes);
    this.despawnEntity(id);
    // Keep corpse counts bounded.
    const corpses = this.ecs.query(Corpse).filter((c) => !this.ecs.get(c, Corpse)!.player);
    if (corpses.length > MAX_ZOMBIE_CORPSES) this.removeCorpse(corpses[0]);
  }

  killPlayer(e: number, cause: string): void {
    const p = this.ecs.get(e, Player);
    const t = this.ecs.get(e, Transform);
    if (!p || !t) return;
    const session = p.link as ClientSession | null;
    const items = this.config.death.dropInventory ? this.inventory.strip(p) : [];
    this.spawnCorpse(t.x, t.y, p.sim.aim, hashString(p.accountId), p.name, true, items, PLAYER_CORPSE_MINUTES);
    p.stats.deaths++;
    this.soundAt('player_death', t.x, t.y, 1, e);
    this.noise.emit(t.x, t.y, 12, e);
    const data = this.characterData(p, t.x, t.y);
    data.alive = false;
    const stats = { kills: p.stats.kills, deaths: p.stats.deaths, timeAliveMinutes: Math.round(p.stats.lifeMinutes) };
    this.despawnEntity(e);
    if (session) {
      session.entity = 0;
      session.deadCharacter = data;
      session.respawnAt = Date.now() + this.config.death.respawnDelaySeconds * 1000;
      session.viewX = t.x;
      session.viewY = t.y;
      session.send({ t: 'died', cause, stats, respawnIn: this.config.death.respawnDelaySeconds });
      void this.storage
        .saveCharacters([{ accountId: p.accountId, data }])
        .catch((err) => console.error('[game] save on death failed', err));
    }
    this.broadcast({ t: 'chat', from: '', text: `${p.name} died. (${cause})`, system: true });
    this.broadcastPlayers();
  }

  private spawnCorpse(
    x: number,
    y: number,
    angle: number,
    look: number,
    name: string,
    player: boolean,
    items: ItemStack[],
    lifetime: number,
  ): number {
    const e = this.ecs.create();
    const id = `c${newUid()}`;
    this.ecs.add(e, Transform, { x, y, angle });
    this.ecs.add(e, Replicated, { kind: EntityKind.Corpse, look, name, extra: 0 });
    this.ecs.add(e, Corpse, { id, items, player, name, expiresAt: this.minutes + lifetime });
    this.spatial.set(e, x, y);
    if (player || items.length > 0) this.persistCorpse(e);
    return e;
  }

  persistCorpse(e: number): void {
    const c = this.ecs.get(e, Corpse);
    const t = this.ecs.get(e, Transform);
    const r = this.ecs.get(e, Replicated);
    if (!c || !t || !r) return;
    this.world.changes.entities.set(c.id, {
      kind: 'corpse',
      id: c.id,
      x: t.x,
      y: t.y,
      angle: t.angle,
      look: r.look,
      name: c.name,
      player: c.player,
      items: c.items,
      expiresAt: c.expiresAt,
    });
  }

  private removeCorpse(e: number): void {
    const c = this.ecs.get(e, Corpse);
    if (c) this.world.changes.entities.set(c.id, null);
    this.despawnEntity(e);
  }

  spawnGroundItem(x: number, y: number, stack: ItemStack): number {
    const e = this.ecs.create();
    const id = `i${newUid()}`;
    this.ecs.add(e, Transform, { x, y, angle: this.rng.range(-Math.PI, Math.PI) });
    this.ecs.add(e, Replicated, { kind: EntityKind.Item, look: 0, name: '', extra: stack.qty });
    this.ecs.add(e, GroundItem, { id, stack, expiresAt: this.minutes + GROUND_ITEM_MINUTES });
    this.spatial.set(e, x, y);
    this.persistGroundItem(e);
    return e;
  }

  persistGroundItem(e: number): void {
    const g = this.ecs.get(e, GroundItem);
    const t = this.ecs.get(e, Transform);
    if (!g || !t) return;
    const r = this.ecs.get(e, Replicated);
    if (r) r.extra = g.stack.qty;
    this.world.changes.entities.set(g.id, { kind: 'item', id: g.id, x: t.x, y: t.y, stack: g.stack, expiresAt: g.expiresAt });
  }

  removeGroundItem(e: number): void {
    const g = this.ecs.get(e, GroundItem);
    if (g) this.world.changes.entities.set(g.id, null);
    this.despawnEntity(e);
  }

  private restoreEntity(ent: PersistentEntity): void {
    const e = this.ecs.create();
    this.ecs.add(e, Transform, { x: ent.x, y: ent.y, angle: ent.kind === 'corpse' ? ent.angle : 0 });
    if (ent.kind === 'corpse') {
      this.ecs.add(e, Replicated, { kind: EntityKind.Corpse, look: ent.look, name: ent.name, extra: 0 });
      this.ecs.add(e, Corpse, { id: ent.id, items: ent.items, player: ent.player, name: ent.name, expiresAt: ent.expiresAt });
    } else {
      this.ecs.add(e, Replicated, { kind: EntityKind.Item, look: 0, name: '', extra: ent.stack.qty });
      this.ecs.add(e, GroundItem, { id: ent.id, stack: ent.stack, expiresAt: ent.expiresAt });
    }
    this.spatial.set(e, ent.x, ent.y);
  }

  despawnEntity(e: number): void {
    this.ecs.destroy(e);
  }

  pushContainer(id: string): void {
    for (const e of this.ecs.query(Player)) {
      const p = this.ecs.get(e, Player)!;
      if (p.openContainer === id) p.link?.send({ t: 'container', container: this.inventory.containerView(id) });
    }
  }

  private sendFloor(e: number, p: PlayerComp): void {
    p.link?.send({ t: 'floor', items: this.inventory.floorView(e) });
  }

  private flushInventory(p: PlayerComp): void {
    if (!p.inventoryDirty) return;
    p.inventoryDirty = false;
    p.link?.send({ t: 'inventory', inventory: p.inventory });
    p.refreshTimer = 0;
  }

  // =============================================================================================
  // Tick

  step(): void {
    this.tick++;
    const dt = this.tickSeconds;
    const online = [...this.sessions].some((s) => s.account);
    // An empty server does not simulate at all: no hunger, no zombie movement, no time.
    if (online) {
      // With every survivor asleep, the night passes quickly (design plan §51–52).
      const speed = this.survival.everyoneAsleep() ? this.survival.fastForward : 1;
      const dtMinutes = dt * speed * this.clock.gameMinutesPerSecond;
      this.clock.advance(dt * speed);
      for (const e of this.ecs.query(Player)) {
        const p = this.ecs.get(e, Player)!;
        p.stats.lifeMinutes += dtMinutes;
      }
      this.players.update(dt, dtMinutes);
      this.survival.update(dt);
      this.zombies.update(dt);
      this.noise.process();
      this.spawner.update(dt);
      this.expire(dt);
      this.recordHistory();
    }
    for (const session of this.sessions) {
      if (!session.account) continue;
      this.streamChunks(session);
      this.replicate(session);
      const p = session.entity ? this.ecs.get(session.entity, Player) : undefined;
      if (p) {
        this.flushInventory(p);
        if (p.openContainer && p.openContainer !== 'floor' && !this.inventory.inRangeOf(session.entity, p.openContainer)) {
          p.openContainer = null;
          session.send({ t: 'container', container: null });
        }
      }
    }
    this.events = [];
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= this.autosaveSeconds) {
      this.autosaveTimer = 0;
      void this.save();
    }
  }

  private expire(dt: number): void {
    this.expiryTimer -= dt;
    if (this.expiryTimer > 0) return;
    this.expiryTimer = 5;
    for (const e of this.ecs.query(Corpse)) {
      if (this.ecs.get(e, Corpse)!.expiresAt < this.minutes) this.removeCorpse(e);
    }
    for (const e of this.ecs.query(GroundItem)) {
      if (this.ecs.get(e, GroundItem)!.expiresAt < this.minutes) this.removeGroundItem(e);
    }
  }

  private recordHistory(): void {
    const positions = new Map<number, [number, number]>();
    for (const e of this.ecs.query(Body, Transform)) {
      const t = this.ecs.get(e, Transform)!;
      positions.set(e, [t.x, t.y]);
    }
    this.lag.record(this.tick, positions);
  }

  // =============================================================================================
  // Replication

  private netEntity(e: number): NetEntity | null {
    const r = this.ecs.get(e, Replicated);
    const t = this.ecs.get(e, Transform);
    if (!r || !t) return null;
    const base: NetEntity = {
      id: e,
      kind: r.kind,
      x: t.x,
      y: t.y,
      angle: t.angle,
      anim: 0,
      flags: 0,
      item: 0,
      health: 1,
      look: r.look,
      extra: r.extra,
      name: r.name,
    };
    switch (r.kind) {
      case EntityKind.Player: {
        const p = this.ecs.get(e, Player)!;
        const s = p.sim;
        let flags = 0;
        if (Math.hypot(s.vx, s.vy) > 0.25) flags |= PlayerFlags.Moving;
        if (s.sprinting) flags |= PlayerFlags.Sprinting;
        if (s.crouching) flags |= PlayerFlags.Crouching;
        if (s.aimProgress > 0.2) flags |= PlayerFlags.Aiming;
        if (s.action === PlayerAction.Reload) flags |= PlayerFlags.Reloading;
        if (s.action === PlayerAction.Melee) flags |= PlayerFlags.Melee;
        if (s.action === PlayerAction.Shove) flags |= PlayerFlags.Shove;
        if (p.flashlight) flags |= PlayerFlags.Flashlight;
        if (p.body.health < 50 || bleedRate(p.body) > 0.05) flags |= PlayerFlags.Injured;
        if (p.action) flags |= PlayerFlags.Busy;
        if (p.sleep) flags |= PlayerFlags.Sleeping;
        const held = p.inventory.slots[s.slot];
        base.anim = s.action;
        base.flags = flags;
        base.item = held ? this.content.itemIndex(held.id) + 1 : 0;
        base.health = p.body.health / 100;
        return base;
      }
      case EntityKind.Zombie: {
        const z = this.ecs.get(e, Zombie)!;
        base.anim = zombieAnim(z);
        base.health = Math.max(0, z.hp / z.maxHp);
        return base;
      }
      case EntityKind.Corpse: {
        const c = this.ecs.get(e, Corpse)!;
        base.flags = (c.player ? CorpseFlags.Player : 0) | (c.items.length === 0 ? CorpseFlags.Looted : 0);
        base.health = 0;
        return base;
      }
      case EntityKind.Item: {
        const g = this.ecs.get(e, GroundItem)!;
        base.item = this.content.itemIndex(g.stack.id) + 1;
        base.extra = g.stack.qty;
        return base;
      }
    }
    return base;
  }

  private replicate(session: ClientSession): void {
    const p = session.entity ? this.ecs.get(session.entity, Player) : undefined;
    const t = session.entity ? this.ecs.get(session.entity, Transform) : undefined;
    if (t) {
      session.viewX = t.x;
      session.viewY = t.y;
    }
    // Skip a snapshot for clients whose socket is badly backed up; deltas stay correct because
    // the known-state cache only advances when something is actually sent.
    if (session.backlog > 512 * 1024) return;
    const vx = session.viewX;
    const vy = session.viewY;
    const r2 = ENTITY_INTEREST_RADIUS * ENTITY_INTEREST_RADIUS;
    const spawns: NetEntity[] = [];
    const updates: { id: number; bits: number; e: NetEntity }[] = [];
    const seen = new Set<number>();
    for (const id of this.spatial.query(vx, vy, ENTITY_INTEREST_RADIUS)) {
      const et = this.ecs.get(id, Transform);
      if (!et) continue;
      const dx = et.x - vx;
      const dy = et.y - vy;
      if (dx * dx + dy * dy > r2) continue;
      const net = this.netEntity(id);
      if (!net) continue;
      seen.add(id);
      const prev = session.known.get(id);
      if (!prev) {
        spawns.push(net);
        session.known.set(id, net);
        continue;
      }
      let bits = 0;
      if (Math.abs(prev.x - net.x) > 0.004 || Math.abs(prev.y - net.y) > 0.004) bits |= DeltaBits.Position;
      if (Math.abs(prev.angle - net.angle) > 0.004) bits |= DeltaBits.Angle;
      if (prev.anim !== net.anim) bits |= DeltaBits.Anim;
      if (prev.flags !== net.flags) bits |= DeltaBits.Flags;
      if (prev.item !== net.item) bits |= DeltaBits.Item;
      if (Math.abs(prev.health - net.health) > 0.004) bits |= DeltaBits.Health;
      if (bits) {
        updates.push({ id, bits, e: net });
        session.known.set(id, net);
      }
    }
    const despawns: number[] = [];
    for (const id of session.known.keys()) {
      if (!seen.has(id)) despawns.push(id);
    }
    for (const id of despawns) session.known.delete(id);

    const w = this.writer.reset();
    w.u8(ServerBinary.Snapshot)
      .u32(this.tick)
      .f64(this.minutes)
      .u32(p?.lastSeq ?? 0);
    writeSelfState(w, p ? p.sim : null);
    const events = this.events.filter((ev) => {
      if (Math.hypot(ev.x - vx, ev.y - vy) > ev.radius) return false;
      // The shooter already predicted their own shot.
      if (ev.event.type === NetEventType.Shot && ev.event.shooter === session.entity) return false;
      return true;
    });
    w.varuint(events.length);
    for (const ev of events) writeEvent(w, ev.event);
    w.varuint(spawns.length);
    for (const s of spawns) writeSpawn(w, s);
    w.varuint(updates.length);
    for (const u of updates) writeUpdate(w, u.id, u.bits, u.e);
    w.varuint(despawns.length);
    for (const id of despawns) w.varuint(id);
    const bytes = w.finish();
    this.stats.bytesOut += bytes.length;
    session.sendBinary(bytes);
  }

  private streamChunks(session: ClientSession): void {
    const [pcx, pcy] = chunkOf(session.viewX, session.viewY);
    const wanted: [number, number, number][] = [];
    for (let dy = -CHUNK_STREAM_RADIUS; dy <= CHUNK_STREAM_RADIUS; dy++) {
      for (let dx = -CHUNK_STREAM_RADIUS; dx <= CHUNK_STREAM_RADIUS; dx++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        if (cx < 0 || cy < 0 || cx >= this.world.chunksX || cy >= this.world.chunksY) continue;
        if (!session.loadedChunks.has(chunkKey(cx, cy))) wanted.push([cx, cy, dx * dx + dy * dy]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of wanted.slice(0, 4)) {
      session.loadedChunks.add(chunkKey(cx, cy));
      session.send({ t: 'chunk', chunk: this.world.chunkPayload(cx, cy) });
    }
    // Let the client drop chunks that are well out of range.
    const drop: string[] = [];
    for (const key of session.loadedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cy - pcy)) > CHUNK_STREAM_RADIUS + 1) drop.push(key);
    }
    if (drop.length > 0) {
      for (const k of drop) session.loadedChunks.delete(k);
      session.send({ t: 'unchunk', keys: drop });
    }
  }

  // =============================================================================================
  // Persistence

  async save(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      try {
        const characters: { accountId: string; data: CharacterData }[] = [];
        for (const e of this.ecs.query(Player, Transform)) {
          const p = this.ecs.get(e, Player)!;
          const t = this.ecs.get(e, Transform)!;
          characters.push({ accountId: p.accountId, data: structuredClone(this.characterData(p, t.x, t.y)) });
        }
        this.meta.minutes = this.minutes;
        this.world.changes.meta = { ...this.meta };
        const changes = this.world.takeChanges();
        // Snapshot mutable payloads so later edits during the async write do not race.
        const frozen = structuredClone(changes);
        await this.storage.saveCharacters(characters);
        if (changeCount(frozen) > 0) await this.storage.saveWorld(frozen);
      } catch (err) {
        console.error('[game] save failed', err);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** Summary for the status endpoint and logs. */
  summary(): { players: number; zombies: number; dormant: number; activeChunks: number; tickMs: number; day: number; time: string } {
    const minutes = this.minutes;
    const day = Math.floor(minutes / 1440) + 1;
    const h = Math.floor((minutes % 1440) / 60);
    const m = Math.floor(minutes % 60);
    return {
      players: [...this.sessions].filter((s) => s.account).length,
      zombies: this.ecs.count(Zombie),
      dormant: this.spawner.dormantCount,
      activeChunks: this.spawner.activeChunkCount,
      tickMs: Math.round(this.stats.tickMs * 100) / 100,
      day,
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    };
  }
}

function parseLoc(v: unknown): InvLocation | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { kind?: unknown; index?: unknown; id?: unknown };
  switch (o.kind) {
    case 'pockets':
    case 'backpack':
    case 'back':
    case 'floor':
      return { kind: o.kind };
    case 'slot':
      return typeof o.index === 'number' && Number.isInteger(o.index) ? { kind: 'slot', index: o.index } : null;
    case 'container':
      return typeof o.id === 'string' && o.id.length < 64 ? { kind: 'container', id: o.id } : null;
    default:
      return null;
  }
}

export { CHUNK_SIZE, isBodyPart };
