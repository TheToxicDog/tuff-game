// The authoritative game: owns the world, the players and every system, runs the 20 Hz tick
// loop, routes client messages and saves the world.

import {
  DEFAULT_DAY_SECONDS,
  ENTITY_VIEW,
  PROFESSION_BY_ID,
  PROTOCOL_VERSION,
  TICK_DT,
  TICK_RATE,
  encodeTiles,
  type ClientMessage,
  type GameEvent,
  type ServerMessage,
  type WelcomeMessage,
} from '@ironwild/shared';
import type { AccountRecord, CharacterData, Storage, WorldSave } from '../persistence/storage';
import { Ambitions } from './ambitions';
import { BuildSystem } from './building';
import { CombatSystem } from './combat';
import { Commands } from './commands';
import { CompanySystem } from './companies';
import { CraftingSystem } from './crafting';
import { CreatureSystem } from './creatures';
import { Economy } from './economy';
import type { Entity } from './entities';
import { Factory } from './factory';
import { Farming } from './farming';
import { Fishing } from './fishing';
import { PowerSystem } from './electric';
import { FluidSystem } from './fluids';
import { newCharacter, Player } from './player';
import { PlayerSystem } from './players';
import { Progression } from './progression';
import { TownProjects } from './projects';
import { RailSystem } from './rails';
import { RaidSystem } from './raids';
import { Replication } from './replication';
import { GuardSystem } from './guards';
import { QuestSystem } from './quests';
import type { ClientSession } from './session';
import { World, type ResourceNode, type Structure } from './world';

export interface GameConfig {
  name: string;
  motd: string;
  pvp: boolean;
  maxPlayers: number;
  daySeconds: number;
  seed: number;
  autosaveSeconds: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  name: 'IRONWILD',
  motd: 'Everything can become a business.',
  pvp: false,
  maxPlayers: 30,
  daySeconds: DEFAULT_DAY_SECONDS,
  seed: 20260925,
  autosaveSeconds: 60,
};

interface PendingEvent {
  ev: GameEvent;
  x: number;
  y: number;
  r: number;
  /** Only to this player. */
  only?: number;
  /** Everyone except this player (they predicted it). */
  except?: number;
}

export class Game {
  readonly config: GameConfig;
  readonly world: World;
  readonly players = new Map<number, Player>();
  readonly byAccount = new Map<string, Player>();
  readonly sessions = new Set<ClientSession>();
  readonly entities = new Map<number, Entity>();
  readonly admins: Set<string>;
  tick = 0;
  /** Game minutes since the world began (day 1 starts at 06:00). */
  minutes = 6 * 60;
  nextEntityId = 1;
  nextStructId = 1;
  nextItemId = 1;
  events: PendingEvent[] = [];
  authenticate: (token: string) => Promise<AccountRecord | null> = async () => null;
  log: (msg: string) => void = (msg) => console.log(`[ironwild] ${msg}`);

  readonly playerSystem: PlayerSystem;
  readonly combat: CombatSystem;
  readonly creatures: CreatureSystem;
  readonly crafting: CraftingSystem;
  readonly building: BuildSystem;
  readonly factory: Factory;
  readonly economy: Economy;
  readonly progression: Progression;
  readonly replication: Replication;
  readonly farming: Farming;
  readonly fishing: Fishing;
  readonly fluids: FluidSystem;
  readonly power: PowerSystem;
  readonly raids: RaidSystem;
  readonly guards: GuardSystem;
  readonly quests: QuestSystem;
  readonly rails: RailSystem;
  readonly projects: TownProjects;
  readonly ambitions: Ambitions;
  readonly companies: CompanySystem;
  readonly commands: Commands;

  private timer: NodeJS.Timeout | null = null;
  private saving = false;
  private lastSave = Date.now();
  private stepStart = 0;
  /** Recent tick durations for /healthz. */
  tickMs = 0;

  constructor(
    readonly storage: Storage,
    config: Partial<GameConfig> = {},
    admins: string[] = [],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.admins = new Set(admins.map((a) => a.toLowerCase()));
    this.world = new World(this.config.seed);
    this.playerSystem = new PlayerSystem(this);
    this.combat = new CombatSystem(this);
    this.creatures = new CreatureSystem(this);
    this.crafting = new CraftingSystem(this);
    this.building = new BuildSystem(this);
    this.factory = new Factory(this);
    this.economy = new Economy(this);
    this.progression = new Progression(this);
    this.replication = new Replication(this);
    this.farming = new Farming(this);
    this.fishing = new Fishing(this);
    this.fluids = new FluidSystem(this);
    this.power = new PowerSystem(this);
    this.raids = new RaidSystem(this);
    this.guards = new GuardSystem(this);
    this.quests = new QuestSystem(this);
    this.rails = new RailSystem(this);
    this.projects = new TownProjects(this);
    this.ambitions = new Ambitions(this);
    this.companies = new CompanySystem(this);
    this.commands = new Commands(this);
  }

  // ——— Lifecycle ———

  async init(): Promise<void> {
    const save = await this.storage.loadWorld();
    if (save && save.seed === this.config.seed) this.load(save);
    else if (save) this.log(`saved world has seed ${save.seed}, config wants ${this.config.seed}: starting fresh`);
    this.economy.init();
    this.creatures.init();
    this.raids.init();
    this.guards.init();
    this.quests.init();
    this.factory.rebuildAll();
  }

  start(): void {
    let next = performance.now();
    const loop = () => {
      const now = performance.now();
      // Catch up at most a few ticks after a stall.
      let steps = 0;
      while (now >= next && steps < 4) {
        this.step();
        next += 1000 / TICK_RATE;
        steps++;
      }
      if (now - next > 1000) next = now;
      this.timer = setTimeout(loop, Math.max(0, next - performance.now()));
    };
    this.timer = setTimeout(loop, 0);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const s of this.sessions) s.close('Server shutting down.', 1001);
    await this.save();
  }

  get dayLength(): number {
    return this.config.daySeconds;
  }

  /** Current hour of day (0–24). */
  get hour(): number {
    return (this.minutes / 60) % 24;
  }

  get day(): number {
    return Math.floor(this.minutes / 1440) + 1;
  }

  get night(): boolean {
    const h = this.hour;
    return h < 5.5 || h >= 20.5;
  }

  /** Converts real seconds to game minutes. */
  gameMinutes(seconds: number): number {
    return (seconds * 1440) / this.config.daySeconds;
  }

  summary(): { players: number; day: number; time: string; tickMs: number; structures: number; entities: number } {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.minutes % 60) / 10) * 10;
    return {
      players: this.players.size,
      day: this.day,
      time: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
      tickMs: Math.round(this.tickMs * 100) / 100,
      structures: this.world.structures.size,
      entities: this.entities.size,
    };
  }

  // ——— Tick ———

  step(): void {
    this.stepStart = performance.now();
    this.tick++;
    const dt = TICK_DT;
    const prevDay = this.day;
    this.minutes += this.gameMinutes(dt);
    this.playerSystem.step(dt);
    this.combat.step(dt);
    this.creatures.step(dt);
    this.factory.step(dt);
    this.fluids.step(dt);
    this.power.step();
    this.rails.step(dt);
    this.farming.step(dt);
    this.fishing.step();
    this.raids.step(dt);
    if (this.tick % TICK_RATE === 0) {
      this.economy.stepSecond();
      this.regrowNodes();
      this.progression.stepSecond();
      this.ambitions.stepSecond();
      this.guards.stepSecond();
      this.quests.stepSecond();
      this.combat.expireEntities();
    }
    if (this.day !== prevDay) this.economy.newDay();
    this.replication.step();
    this.events.length = 0;
    if (Date.now() - this.lastSave > this.config.autosaveSeconds * 1000) void this.save();
    this.tickMs = this.tickMs * 0.95 + (performance.now() - this.stepStart) * 0.05;
  }

  private regrowNodes(): void {
    const now = Date.now();
    for (const chunk of this.world.nodesByChunk.values()) {
      for (const n of chunk) {
        if (n.regrowAt === 0 || n.gone || n.regrowAt > now) continue;
        // Don't regrow on top of someone.
        let blocked = false;
        for (const p of this.players.values()) if (Math.hypot(p.x - n.x, p.y - n.y) < n.def.radius + 0.6) blocked = true;
        if (blocked) {
          n.regrowAt = now + 5000;
          continue;
        }
        n.regrowAt = 0;
        n.amount = n.def.amount;
        this.nodeChanged(n);
      }
    }
  }

  // ——— Sessions ———

  attachSession(session: ClientSession): void {
    this.sessions.add(session);
  }

  async hello(session: ClientSession, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (msg.protocol !== PROTOCOL_VERSION) {
      session.close('Your game client is out of date. Refresh the page.', 4002);
      return;
    }
    const account = await this.authenticate(msg.token);
    if (!account) {
      session.close('Your session has expired. Please log in again.', 4001);
      return;
    }
    if (session.closed) return;
    if (this.admins.has(account.username.toLowerCase())) account.isAdmin = true;
    const existing = this.byAccount.get(account.id);
    if (existing) {
      // Newest login wins.
      existing.session.close('You logged in somewhere else.', 4003);
      this.disconnect(existing.session);
    }
    if (this.players.size >= this.config.maxPlayers) {
      session.close('The server is full.', 4004);
      return;
    }
    let data: CharacterData | null = await this.storage.loadCharacter(account.id);
    if (session.closed) return;
    const spawn = this.world.gen.spawn;
    if (!data) data = newCharacter(account.displayName, spawn.x + Math.random() * 4 - 2, spawn.y + Math.random() * 2 - 1);
    session.account = account;
    const player = new Player(this.nextEntityId++, session, account, data);
    session.player = player;
    this.players.set(player.id, player);
    this.byAccount.set(account.id, player);
    this.companies.attach(player);
    this.ambitions.joined(player);
    const welcome: WelcomeMessage = {
      t: 'welcome',
      you: { id: player.id, name: player.name, accountId: account.id, isAdmin: account.isAdmin },
      server: { name: this.config.name, motd: this.config.motd, pvp: this.config.pvp, daySeconds: this.config.daySeconds },
      world: {
        seed: this.config.seed,
        size: this.world.size,
        tiles: encodeTiles(this.world.tiles),
        regions: encodeTiles(this.world.regions),
        houses: this.world.gen.houses,
        settlements: this.world.settlements.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.radius >= 15 ? ('town' as const) : ('village' as const),
          x: s.x,
          y: s.y,
          radius: s.radius,
          npcs: s.npcs.map((n) => ({
            id: n.id,
            name: n.name,
            profession: n.profession,
            title: PROFESSION_BY_ID.get(n.profession)?.title ?? n.profession,
            x: n.x,
            y: n.y,
            angle: n.angle,
            ...(n.unlock !== undefined ? { unlock: n.unlock } : {}),
          })),
        })),
        landmarks: this.world.gen.landmarks,
      },
      tick: this.tick,
      time: this.minutes,
    };
    session.send(welcome);
    session.send({ t: 'kin', s: [], nets: this.factory.netSummaries(), of: [] });
    this.fluids.broadcast(true, session);
    this.power.broadcast(true, session);
    this.ambitions.sendMonuments(player);
    this.playerSystem.joined(player);
    this.broadcastChat('', `${player.name} arrived in the valley.`, 'system');
    this.log(`${account.username} joined (${this.players.size} online)`);
  }

  disconnect(session: ClientSession): void {
    this.sessions.delete(session);
    const player = session.player;
    if (!player || this.players.get(player.id) !== player) return;
    this.playerSystem.left(player);
    this.ambitions.left(player);
    this.players.delete(player.id);
    if (this.byAccount.get(player.accountId) === player) this.byAccount.delete(player.accountId);
    void this.storage
      .saveCharacters([{ accountId: player.accountId, data: player.save() }])
      .catch((err) => this.log(`save failed: ${err}`));
    this.broadcastChat('', `${player.name} left.`, 'system');
  }

  handleMessage(session: ClientSession, msg: ClientMessage): void {
    const p = session.player;
    if (!p) return;
    switch (msg.t) {
      case 'ping':
        session.send({ t: 'pong', id: msg.id });
        return;
      case 'in':
        this.playerSystem.receiveInputs(p, msg.i);
        return;
      case 'chat':
        this.commands.chat(p, msg.text);
        return;
      case 'respawn':
        this.playerSystem.respawn(p);
        return;
    }
    if (p.dead) return;
    switch (msg.t) {
      case 'slot':
        this.playerSystem.selectSlot(p, msg.slot);
        break;
      case 'move':
        this.playerSystem.moveItems(p, msg.from, msg.to, msg.n);
        break;
      case 'quick':
        this.playerSystem.quickMove(p, msg.from);
        break;
      case 'drop':
        this.playerSystem.dropItem(p, msg.slot, msg.n);
        break;
      case 'pickup':
        this.playerSystem.pickup(p);
        break;
      case 'dismount':
        this.playerSystem.dismount(p);
        break;
      case 'use':
        this.playerSystem.useItem(p, msg.slot, msg.x, msg.y);
        break;
      case 'craft':
        this.crafting.craft(p, msg.recipe, msg.n);
        break;
      case 'smith':
        this.crafting.smith(p, msg.recipe, msg.hits);
        break;
      case 'place':
        this.building.place(p, msg.item, msg.x, msg.y, msg.rot);
        break;
      case 'rotate':
        this.building.rotate(p, msg.id);
        break;
      case 'interact':
        this.playerSystem.interact(p, msg.kind, msg.id, msg.op);
        break;
      case 'close':
        this.playerSystem.closeUi(p);
        break;
      case 'trade':
        this.economy.trade(p, msg.npc, msg.op, msg.item, msg.n, msg.q);
        break;
      case 'machine':
        this.factory.configure(p, msg);
        break;
      case 'crank':
        this.factory.crank(p, msg.id, msg.on);
        break;
      case 'research':
        this.progression.research(p, msg.node);
        break;
      case 'contract':
        this.economy.contract(p, msg.op, msg.id);
        break;
      case 'project':
        if (typeof msg.npc === 'string' && typeof msg.item === 'string') this.projects.deliver(p, msg.npc, msg.item);
        break;
      case 'claim':
        this.building.claimMember(p, msg.id, msg.op, msg.name, msg.role);
        break;
      case 'quest':
        if (typeof msg.id === 'string' && (msg.op === 'accept' || msg.op === 'deliver' || msg.op === 'abandon'))
          this.quests.handle(p, msg.op, msg.id);
        break;
      case 'guard':
        if (typeof msg.id !== 'number') break;
        if (msg.op === 'hire' && typeof msg.days === 'number') this.guards.hire(p, msg.id, msg.days);
        else if (msg.op === 'dismiss') this.guards.release(p, msg.id);
        break;
      case 'shop':
        if (msg.op === 'price') this.economy.shopPrice(p, msg.id, msg.item, msg.q, msg.price);
        else this.economy.shopBuy(p, msg.id, msg.item, msg.q, msg.n);
        break;
      case 'order':
        this.economy.order(p, msg);
        break;
      case 'company':
        this.companies.handle(p, msg);
        break;
      case 'markets':
        this.economy.sendMarkets(p);
        break;
      case 'stats':
        session.send({ t: 'stats', ...this.factory.stats(p) });
        break;
      case 'standings': {
        const info = this.ambitions.standings(p);
        if (info) session.send({ t: 'standings', ...info });
        break;
      }
    }
  }

  // ——— Helpers used by systems ———

  send(p: Player, msg: ServerMessage): void {
    p.session.send(msg);
  }

  notice(p: Player, text: string, kind: 'info' | 'good' | 'bad' | 'money' = 'info'): void {
    p.session.send({ t: 'notice', text, kind });
  }

  broadcastChat(from: string, text: string, kind?: 'system' | 'admin' | 'company'): void {
    const json = JSON.stringify({ t: 'chat', from, text, kind });
    for (const p of this.players.values()) p.session.sendRaw(json);
  }

  emit(ev: GameEvent, x: number, y: number, opts: { r?: number; only?: number; except?: number } = {}): void {
    this.events.push({ ev, x, y, r: opts.r ?? ENTITY_VIEW, only: opts.only, except: opts.except });
  }

  newEntityId(): number {
    return this.nextEntityId++;
  }

  addEntity(e: Entity): void {
    this.entities.set(e.id, e);
  }

  removeEntity(id: number): void {
    this.entities.delete(id);
  }

  nodeChanged(n: ResourceNode): void {
    this.replication.nodeChanged(n);
  }

  structAdded(s: Structure): void {
    this.replication.structAdded(s);
  }

  structRemoved(s: Structure): void {
    this.replication.structRemoved(s);
  }

  structVisual(s: Structure): void {
    this.replication.structVisual(s);
  }

  playerByName(name: string): Player | undefined {
    const lower = name.toLowerCase();
    for (const p of this.players.values()) if (p.name.toLowerCase() === lower || p.account.username.toLowerCase() === lower) return p;
    return undefined;
  }

  // ——— Persistence ———

  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.lastSave = Date.now();
    try {
      const chars = [...this.players.values()].map((p) => ({ accountId: p.accountId, data: p.save() }));
      await this.storage.saveCharacters(chars);
      await this.storage.saveWorld(this.serialize());
    } catch (err) {
      this.log(`save failed: ${err}`);
    } finally {
      this.saving = false;
    }
  }

  serialize(): WorldSave {
    this.fluids.spread();
    const nodes: [number, number, number][] = [];
    for (const n of this.world.nodes.values()) {
      if (n.gone) nodes.push([n.id, -1, 0]);
      else if (n.amount !== n.def.amount || n.regrowAt) nodes.push([n.id, n.amount, n.regrowAt]);
    }
    const tiles: [number, number, number][] = [];
    for (const [i, t] of this.world.tileChanges) tiles.push([i % this.world.size, Math.floor(i / this.world.size), t]);
    return {
      version: 1,
      seed: this.config.seed,
      tick: this.tick,
      minutes: this.minutes,
      nextStructId: this.nextStructId,
      nextItemId: this.nextItemId,
      nodes,
      tiles,
      structures: [...this.world.structures.values()].map((s) => this.factory.saveStructure(s)),
      ...this.economy.save(),
      entities: [...this.creatures.save(), ...this.combat.save()],
      companies: this.companies.save(),
      projects: this.projects.save(),
      ambitions: this.ambitions.save(),
      quests: this.quests.save(),
    };
  }

  private load(save: WorldSave): void {
    this.tick = save.tick;
    this.minutes = save.minutes;
    this.nextStructId = save.nextStructId;
    this.nextItemId = save.nextItemId;
    for (const [id, amount, regrowAt] of save.nodes) {
      const n = this.world.nodes.get(id);
      if (!n) continue;
      if (amount < 0) n.gone = true;
      else {
        n.amount = amount;
        n.regrowAt = regrowAt;
      }
    }
    for (const [x, y, t] of save.tiles) this.world.setTile(x, y, t);
    for (const s of save.structures) this.factory.loadStructure(s);
    this.projects.load(save.projects);
    this.economy.load(save);
    this.creatures.load(save.entities);
    this.combat.load(save.entities);
    this.companies.load(save.companies ?? []);
    this.ambitions.load(save.ambitions);
    this.quests.load(save.quests);
    this.log(`loaded world: day ${this.day}, ${save.structures.length} structures`);
  }
}
