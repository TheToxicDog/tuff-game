// The running game on the client: input → prediction → network, snapshots → interpolation →
// rendering, JSON messages → UI. Everything the player sees is driven from here.

import {
  angleDelta,
  Block,
  BUILD_ROTATION_STEP,
  buildingPolygon,
  Buttons,
  checkMaterials,
  ContentRegistry,
  countItems,
  CorpseFlags,
  EntityKind,
  emptyInventory,
  firearmSpread,
  FURNITURE_STRUCTURE,
  furnitureItemId,
  hasToolTag,
  HitFlags,
  HitKind,
  IMPACT_FLESH,
  IMPACT_MATERIALS,
  IMPACT_NONE,
  INPUT_STEP_SECONDS,
  INTERACT_RANGE,
  MAX_BOARDS,
  NetEventType,
  NO_SLOT,
  PlayerAction,
  placementProblem,
  PlayerFlags,
  preferredSlot,
  quantizeInput,
  rayCircle,
  SHOVE,
  SHOVE_ITEM,
  snapPlacement,
  SOUNDS,
  storageId,
  structureShape,
  usageOf,
  weaponProfile,
  ZombieAnim,
  ZOMBIE_RADIUS,
  type ContainerView,
  type InvLocation,
  type ItemStack,
  type MoveParams,
  type NetEvent,
  type PlayerInput,
  type PlayerInventory,
  type ServerMessage,
  type Snapshot,
  type StationKind,
  type StatusView,
  type WeaponProfile,
  type WorldAction,
  type WorldItemView,
} from '@tuff/shared';
import type { AudioEngine } from '../audio/audio';
import type { SoundId } from '../audio/synth';
import { Camera } from '../camera/camera';
import { ActionState } from '../input/actions';
import { KeyboardMouseSource } from '../input/keyboard-mouse';
import type { Connection, WelcomeMessage } from '../net/connection';
import { BuildGhost } from '../rendering/build-ghost';
import { BuildingRenderer } from '../rendering/buildings';
import { Effects } from '../rendering/effects';
import { EntityViews } from '../rendering/entity-views';
import { FenceRenderer } from '../rendering/fences';
import type { LightSource } from '../rendering/lighting';
import { PropRenderer } from '../rendering/props';
import type { GameRenderer } from '../rendering/renderer';
import { RoadRenderer } from '../rendering/roads';
import { StructureRenderer } from '../rendering/structures';
import { TerrainRenderer } from '../rendering/terrain';
import { materialTexture } from '../rendering/textures';
import { ActionMenu, type MenuAction } from '../ui/action-menu';
import { BuildPanel, type BuildChoice } from '../ui/build-panel';
import { Chat } from '../ui/chat';
import { CraftingScreen } from '../ui/crafting-screen';
import type { GameContext, NearbyTarget } from '../ui/context';
import { HealthScreen } from '../ui/health-screen';
import { Hud } from '../ui/hud';
import { InventoryScreen } from '../ui/inventory-screen';
import { MapView, type MapMarker } from '../ui/map-view';
import { DeathScreen, EscapeMenu, loadSettings, MapScreen, type Settings } from '../ui/screens';
import { ServerClock } from './clock';
import { EntityStore, type RemoteEntity } from './entities';
import { Prediction } from './prediction';
import { VisibilityPolygon } from './visibility';
import { ClientWorld } from './world';

const STEP = INPUT_STEP_SECONDS;
const MAX_STEPS_PER_FRAME = 8;
const VIEW_RADIUS = 46;
/** Holding Interact this long opens the action menu instead of doing the primary action. */
const MENU_HOLD_SECONDS = 0.35;
const CORPSE_RANGE = 2.2;
const ITEM_RANGE = 1.6;

const SHOT_SOUNDS: Record<string, SoundId> = {
  pistol: 'shot_pistol',
  revolver: 'shot_revolver',
  shotgun: 'shot_shotgun',
  rifle: 'shot_rifle',
  carbine: 'shot_carbine',
};

const NET_SOUNDS: Partial<Record<(typeof SOUNDS)[number], SoundId>> = {
  door_open: 'door_open',
  door_close: 'door_close',
  door_bang: 'door_bang',
  door_break: 'door_break',
  door_locked: 'door_locked',
  window_break: 'window_break',
  zombie_groan: 'zombie_groan',
  zombie_alert: 'zombie_alert',
  zombie_attack: 'zombie_attack',
  zombie_death: 'zombie_death',
  body_fall: 'body_fall',
  footstep: 'step_soft',
  search: 'search',
  eat: 'eat',
  drink: 'drink',
  bandage: 'bandage',
  pickup: 'pickup',
  player_hurt: 'player_hurt',
  player_death: 'player_death',
  glass_step: 'glass_step',
};

/** Audible range per sound, in meters. */
const SOUND_RANGE: Partial<Record<SoundId, number>> = {
  window_break: 70,
  door_break: 70,
  door_bang: 50,
  zombie_groan: 34,
  zombie_alert: 45,
  zombie_death: 30,
  player_death: 60,
  player_hurt: 35,
};

type Interaction =
  | {
      kind: 'door';
      id: string;
      x: number;
      y: number;
      open: boolean;
      locked: boolean;
      broken: boolean;
      boards: number;
      structureId: string | null;
    }
  | { kind: 'window'; id: string; x: number; y: number; broken: boolean; boards: number }
  | { kind: 'container'; id: string; x: number; y: number; name: string; searched: boolean }
  | { kind: 'corpse'; entity: number; x: number; y: number; name: string }
  | { kind: 'item'; entity: number; x: number; y: number; name: string }
  /** Beds, loose furniture, stations and player structures. */
  | { kind: 'thing'; id: string; x: number; y: number; name: string };

interface TargetActions {
  title: string;
  primary: MenuAction | null;
  actions: MenuAction[];
}

export interface GameCallbacks {
  logout(): void;
  disconnected(reason: string, code: number): void;
}

export class ClientGame implements GameContext {
  readonly content: ContentRegistry;
  readonly world: ClientWorld;
  readonly entities = new EntityStore();
  private readonly clock = new ServerClock();
  private readonly camera = new Camera();
  private readonly actions = new ActionState();
  private readonly keyboard: KeyboardMouseSource;
  private readonly terrain: TerrainRenderer;
  private readonly roads: RoadRenderer;
  private readonly fences: FenceRenderer;
  private readonly buildings: BuildingRenderer;
  private readonly props: PropRenderer;
  private readonly effects: Effects;
  private readonly views: EntityViews;
  private readonly visibility: VisibilityPolygon;
  private readonly hud: Hud;
  private readonly inventoryScreen: InventoryScreen;
  private readonly healthScreen: HealthScreen;
  private readonly chat: Chat;
  private readonly menu: EscapeMenu;
  private readonly death: DeathScreen;
  private readonly mapScreen: MapScreen;
  private readonly crafting: CraftingScreen;
  private readonly actionMenu: ActionMenu;
  private readonly buildPanel: BuildPanel;
  private readonly structures: StructureRenderer;
  private readonly ghost: BuildGhost;
  private readonly settings: Settings;
  private readonly accountId: string;
  private buildMode = false;
  private buildRot = 0;
  private buildChoice: BuildChoice | null = null;
  private menuOpened = false;
  private mapView: MapView | null = null;
  private readonly mapInfo: WelcomeMessage['map'];

  entityId: number;
  inventory: PlayerInventory = emptyInventory();
  status: StatusView | null = null;
  container: ContainerView | null = null;
  floor: WorldItemView[] = [];
  selectedSlot = NO_SLOT;
  private players: { id: number; name: string }[] = [];
  private prediction: Prediction | null = null;
  private seq = 0;
  private acc = 0;
  private outgoing: PlayerInput[] = [];
  private crouchOn = false;
  private worldMinutes: number;
  private alive = true;
  private interactHeld = -1;
  private lockSent = false;
  private target: Interaction | null = null;
  private lastFloorX = 0;
  private lastFloorY = 0;
  private craftTimer = 0;
  private floorTimer = 0;
  private mapTimer = 0;
  private stepSide = false;
  private insideId: string | null = null;
  private lastHealth = 100;
  private destroyed = false;
  private readonly tickerFn: () => void;
  private lastFrame = performance.now();
  private readonly defaultMove: MoveParams = { speedFactor: 1, sprintAllowed: true, staminaRegen: 1, maxStamina: 1, aimSway: 0 };

  constructor(
    private readonly conn: Connection,
    welcome: WelcomeMessage,
    private readonly renderer: GameRenderer,
    private readonly audio: AudioEngine,
    uiRoot: HTMLElement,
    private readonly callbacks: GameCallbacks,
  ) {
    this.content = new ContentRegistry(welcome.content);
    this.entityId = welcome.entityId;
    this.accountId = welcome.accountId;
    this.worldMinutes = welcome.worldMinutes;
    this.mapInfo = welcome.map;
    this.world = new ClientWorld(this.content, welcome.map.width, welcome.map.height);
    this.settings = loadSettings();
    audio.setVolume(this.settings.volume);
    audio.setAmbienceVolume(this.settings.ambience);

    const layers = renderer.layers;
    this.terrain = new TerrainRenderer(layers.terrain, this.world);
    this.roads = new RoadRenderer(layers.roads, {
      asphalt: materialTexture('asphalt'),
      sidewalk: materialTexture('sidewalk'),
      concrete: materialTexture('concrete'),
      gravel: materialTexture('gravel'),
    });
    this.fences = new FenceRenderer(layers.low);
    this.buildings = new BuildingRenderer(
      { floors: layers.floors, low: layers.low, walls: layers.walls, tall: layers.tall, roofs: layers.roofs },
      this.content,
      this.world.compiled,
    );
    this.props = new PropRenderer({ ground: layers.ground, low: layers.low, tall: layers.tall, canopy: layers.canopy }, this.content);
    this.structures = new StructureRenderer(
      { floors: layers.floors, low: layers.low, walls: layers.walls, tall: layers.tall },
      this.content,
      this.world.compiled,
    );
    this.ghost = new BuildGhost(layers.top);
    this.effects = new Effects(layers.decals, layers.effects, layers.top);
    this.views = new EntityViews(layers, this.content);
    this.views.selfId = this.entityId;
    this.views.showNames = this.settings.showNames;
    this.views.onStep = (x, y, zombie, running) => {
      const surface = this.surfaceSound(x, y);
      this.audio.play(surface, { x, y, volume: zombie ? 0.35 : running ? 0.5 : 0.3, range: zombie ? 16 : 22, rate: zombie ? 0.8 : 1 });
    };
    this.entities.listen(this.views);
    this.visibility = new VisibilityPolygon(this.world.compiled.collision);

    this.world.listen({
      elementAdded: (kind, def) => {
        if (kind === 'building') this.buildings.add(def as never);
        else if (kind === 'prop') {
          this.props.add(def as never);
          if (this.world.compiled.effectiveState((def as { id: string }).id).removed)
            this.props.setHidden((def as { id: string }).id, true);
        } else if (kind === 'road') this.roads.add(def as never);
        else if (kind === 'structure') this.structures.add(def as never);
        else this.fences.add(def as never);
        this.visibility.invalidate();
      },
      elementRemoved: (kind, id) => {
        if (kind === 'building') this.buildings.remove(id);
        else if (kind === 'prop') this.props.remove(id);
        else if (kind === 'road') this.roads.remove(id);
        else if (kind === 'structure') this.structures.remove(id);
        else this.fences.remove(id);
        this.visibility.invalidate();
      },
      terrainChanged: () => this.terrain.invalidate(),
      objectChanged: (id) => {
        this.buildings.objectChanged(id);
        this.structures.objectChanged(id);
        if (this.world.compiled.effectiveState(id).removed) this.props.setHidden(id, true);
        this.visibility.invalidate();
      },
    });

    // UI.
    this.hud = new Hud(uiRoot, this);
    this.chat = new Chat(
      uiRoot,
      (text) => this.send({ t: 'chat', text }),
      (open) => {
        this.keyboard.enabled = !open;
        if (open) this.actions.releaseAll();
      },
    );
    const refocus = () => this.actions.releaseAll();
    this.inventoryScreen = new InventoryScreen(uiRoot, this, refocus);
    this.healthScreen = new HealthScreen(uiRoot, this, refocus);
    this.mapScreen = new MapScreen(uiRoot, refocus);
    this.crafting = new CraftingScreen(uiRoot, this, refocus);
    this.actionMenu = new ActionMenu(uiRoot, refocus);
    this.buildPanel = new BuildPanel(uiRoot, this, (choice) => {
      this.buildChoice = choice;
    });
    this.death = new DeathScreen(uiRoot, () => this.send({ t: 'respawn' }));
    this.menu = new EscapeMenu(uiRoot, this.settings, {
      serverName: welcome.config.name,
      onChange: (s) => {
        this.audio.setVolume(s.volume);
        this.audio.setAmbienceVolume(s.ambience);
        this.views.showNames = s.showNames;
      },
      onLogout: () => this.callbacks.logout(),
      onClose: () => {
        this.keyboard.enabled = true;
        refocus();
      },
      onHelp: () => {
        this.menu.close();
        this.hud.showHint();
      },
    });

    this.keyboard = new KeyboardMouseSource(renderer.app.canvas);
    this.chat.add('', `Welcome to ${welcome.config.name}. ${welcome.map.name}.`, true);

    conn.attach({
      message: (m) => this.onMessage(m),
      snapshot: (s, at) => this.onSnapshot(s, at),
      closed: (reason, code) => {
        if (!this.destroyed) this.callbacks.disconnected(reason, code);
      },
    });

    this.tickerFn = () => this.frame();
    renderer.app.ticker.add(this.tickerFn);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('keydown', this.onKey);
  }

  private debugOn = false;
  private debugTimer = 0;
  private frameMs = 0;
  private lastBytes = 0;

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === 'F3') {
      e.preventDefault();
      this.debugOn = !this.debugOn;
      if (!this.debugOn) this.hud.setDebug(null);
    }
  };

  private updateDebug(dt: number, px: number, py: number): void {
    if (!this.debugOn) return;
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.5;
    const kbps = (this.conn.bytesIn - this.lastBytes) / 0.5 / 1024;
    this.lastBytes = this.conn.bytesIn;
    const fps = this.renderer.app.ticker.FPS;
    this.hud.setDebug(
      `${fps.toFixed(0)} fps · logic ${this.frameMs.toFixed(2)} ms · ping ${this.conn.rtt.toFixed(0)} ms · ${kbps.toFixed(1)} KB/s\n` +
        `entities ${this.entities.all.size} · chunks ${this.world.chunks.size} · corrections ${this.prediction?.corrections ?? 0} · pending ${this.prediction?.pending ?? 0} · ${px.toFixed(1)}, ${py.toFixed(1)}`,
    );
  }

  private readonly onBlur = () => {
    this.actions.releaseAll();
    this.keyboard.reset();
  };

  destroy(): void {
    this.destroyed = true;
    this.renderer.app.ticker.remove(this.tickerFn);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onKey);
    this.keyboard.dispose();
    this.conn.close();
  }

  // =============================================================================================
  // GameContext

  send(msg: Parameters<Connection['send']>[0]): void {
    this.conn.send(msg);
  }

  get magAmmo(): number {
    return this.prediction?.state.magAmmo ?? 0;
  }

  selectSlot(slot: number): void {
    if (slot === this.selectedSlot) return;
    this.selectedSlot = slot;
    this.hud.setInventory();
    this.inventoryScreen.render();
  }

  ui(sound: SoundId): void {
    this.audio.play(sound, { volume: 0.45, jitter: 0.02 });
  }

  private get position(): { x: number; y: number } {
    const s = this.prediction?.state;
    return s ? { x: s.x, y: s.y } : { x: this.camera.x, y: this.camera.y };
  }

  nearbyTargets(): NearbyTarget[] {
    const { x, y } = this.position;
    const out: (NearbyTarget & { d: number })[] = [];
    for (const c of this.world.compiled.containers.values()) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= INTERACT_RANGE + c.radius * 0.85) out.push({ id: c.id, name: c.name, d });
    }
    for (const e of this.entities.all.values()) {
      if (e.kind !== EntityKind.Corpse) continue;
      const d = Math.hypot(e.net.x - x, e.net.y - y);
      if (d <= CORPSE_RANGE) out.push({ id: `e:${e.id}`, name: corpseName(e), d });
    }
    return out.sort((a, b) => a.d - b.d).map(({ id, name }) => ({ id, name }));
  }

  get busy(): boolean {
    return this.hud.busy;
  }

  private get asleep(): boolean {
    return this.status?.sleeping !== null && this.status?.sleeping !== undefined && this.alive;
  }

  stationsNearby(): Set<StationKind> {
    const out = new Set<StationKind>();
    const { x, y } = this.position;
    const compiled = this.world.compiled;
    for (const st of compiled.stations.values()) {
      if (Math.abs(st.x - x) > 6 || Math.abs(st.y - y) > 6) continue;
      if (Math.hypot(st.x - x, st.y - y) > INTERACT_RANGE + st.radius) continue;
      if (st.fire && compiled.effectiveState(st.id).until <= this.worldMinutes) continue;
      out.add(st.kind);
    }
    return out;
  }

  take(stack: ItemStack, from: InvLocation): void {
    const def = this.content.findItem(stack.id);
    if (!def) return;
    const inv = this.inventory;
    let to: InvLocation = { kind: 'pockets' };
    const pref = preferredSlot(def);
    if (pref !== null && !inv.slots[pref] && !stack.contents?.length) to = { kind: 'slot', index: pref };
    else if (def.container && !inv.back) to = { kind: 'back' };
    else if (inv.back) {
      const bag = this.content.findItem(inv.back.id)?.container;
      const usage = usageOf(this.content, inv.back.contents ?? []);
      if (
        bag &&
        usage.volume + def.volume * stack.qty <= bag.volume + 1e-6 &&
        usage.weight + def.weight * stack.qty <= bag.maxWeight + 1e-6
      )
        to = { kind: 'backpack' };
    }
    this.send({ t: 'move', uid: stack.uid, from, to });
    this.ui('pickup');
  }

  // =============================================================================================
  // Network

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'chunk':
        this.world.addChunk(m.chunk);
        break;
      case 'structure':
        this.world.addStructure(m.structure);
        this.visibility.invalidate();
        break;
      case 'unstructure':
        this.world.removeStructure(m.id);
        this.visibility.invalidate();
        break;
      case 'mapReload':
        this.hud.notice(m.reason, 'warn');
        break;
      case 'unchunk':
        for (const k of m.keys) this.world.removeChunk(k);
        break;
      case 'overview':
        if (!this.mapView) this.mapView = new MapView(this.mapInfo, m.overview);
        break;
      case 'explored':
        this.mapView?.markExplored(m.cells);
        break;
      case 'objects':
        this.world.setObjectStates(m.states);
        break;
      case 'inventory':
        this.inventory = m.inventory;
        this.hud.setInventory();
        this.inventoryScreen.render();
        this.healthScreen.render();
        this.crafting.render();
        this.buildPanel.render();
        break;
      case 'status': {
        const prev = this.status;
        this.status = m.status;
        this.hud.setStatus(m.status);
        this.healthScreen.render();
        if (m.status.sleeping !== null) {
          this.actionMenu.close();
          this.exitBuildMode();
        }
        if (prev && m.status.health < prev.health - 0.5) this.hud.hurt(Math.min(0.4, (prev.health - m.status.health) / 30));
        this.lastHealth = m.status.health;
        break;
      }
      case 'container':
        this.container = m.container;
        if (m.container && !this.inventoryScreen.isOpen && this.alive) {
          this.closeScreens();
          this.inventoryScreen.open(m.container.id);
        } else {
          this.inventoryScreen.containerChanged();
        }
        break;
      case 'floor':
        this.floor = m.items;
        this.inventoryScreen.render();
        break;
      case 'progress':
        this.hud.startProgress(m.label, m.duration);
        break;
      case 'progressEnd':
        this.hud.endProgress();
        // A completed search is followed by the container; an interrupted one is not.
        window.setTimeout(() => this.inventoryScreen.searchEnded(), 400);
        break;
      case 'chat':
        this.chat.add(m.from, m.text, m.system);
        break;
      case 'notice':
        this.hud.notice(m.text, m.level);
        if (m.level === 'warn') this.ui('ui_error');
        break;
      case 'players':
        this.players = m.players;
        this.hud.setPlayers(m.players.map((p) => p.name));
        break;
      case 'died':
        this.alive = false;
        this.prediction = null;
        this.closeScreens();
        this.exitBuildMode();
        this.chat.close();
        this.hud.endProgress();
        this.hud.setPrompt(null);
        this.death.show(m.cause, m.stats, m.respawnIn);
        this.audio.play('player_death', { volume: 0.9 });
        break;
      case 'spawned':
        this.entityId = m.entityId;
        this.views.selfId = m.entityId;
        this.alive = true;
        this.prediction = null;
        this.selectedSlot = NO_SLOT;
        this.crouchOn = false;
        this.death.hide();
        this.hud.notice('You wake up somewhere new. You feel weak.', 'warn');
        break;
      case 'error':
        this.hud.notice(m.message, 'warn');
        break;
      default:
        break;
    }
  }

  private onSnapshot(snap: Snapshot, receivedAt: number): void {
    this.clock.onSnapshot(snap.tick, receivedAt);
    this.worldMinutes = snap.worldMinutes;
    this.entities.apply(snap);
    if (snap.self && this.alive) {
      if (!this.prediction) {
        this.prediction = new Prediction(snap.self, {
          collision: this.world.compiled.collision,
          content: this.content,
          entityId: this.entityId,
          inventory: () => this.inventory,
          move: () => this.status?.move ?? this.defaultMove,
          zombiesNear: (x, y, r) => this.zombiesNear(x, y, r),
        });
        this.prediction.hooks = this.predictionHooks();
        this.selectedSlot = snap.self.slot;
        this.crouchOn = snap.self.crouching;
        this.seq = Math.max(this.seq, snap.ackSeq);
        this.camera.snapTo(snap.self.x, snap.self.y);
        this.hud.setInventory();
      } else {
        this.prediction.reconcile(snap.self, snap.ackSeq);
      }
    }
    for (const ev of snap.events) this.onEvent(ev);
  }

  private zombiesNear(x: number, y: number, r: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const e of this.entities.all.values()) {
      if (e.kind !== EntityKind.Zombie || e.net.anim === ZombieAnim.Down) continue;
      if (Math.abs(e.net.x - x) > r || Math.abs(e.net.y - y) > r) continue;
      out.push({ x: e.net.x, y: e.net.y });
    }
    return out;
  }

  // =============================================================================================
  // Events and effects

  private onEvent(ev: NetEvent): void {
    switch (ev.type) {
      case NetEventType.Shot: {
        const def = this.content.itemAt(ev.item - 1);
        const first = ev.pellets[0]?.angle ?? 0;
        this.shotEffects(ev.x, ev.y, first, ev.pellets, def?.icon, def?.firearm?.pellets ? 1.3 : 1);
        this.views.character(ev.shooter)?.recoil();
        break;
      }
      case NetEventType.Melee: {
        if (ev.attacker === this.entityId) break;
        const e = this.entities.all.get(ev.attacker);
        const view = this.views.character(ev.attacker);
        if (ev.item === SHOVE_ITEM) {
          view?.shove();
          if (e) this.audio.play('shove', { x: e.x, y: e.y, volume: 0.6 });
        } else {
          view?.swing();
          if (e) {
            const def = ev.item ? this.content.itemAt(ev.item - 1) : undefined;
            const reach = def?.melee?.reach ?? 1.05;
            this.effects.swing(e.x, e.y, ev.angle, reach, def?.melee?.arc ?? 70, 1);
            this.audio.play('swing', { x: e.x, y: e.y, volume: 0.5 });
          }
        }
        break;
      }
      case NetEventType.Hit: {
        const flesh = ev.kind !== HitKind.Shove;
        if (flesh) this.effects.bloodSpray(ev.x, ev.y, ev.dir, ev.kind === HitKind.Bullet ? 1 : 0.8);
        this.views.character(ev.target)?.flash();
        const sound: SoundId = ev.kind === HitKind.Blunt || ev.kind === HitKind.Shove ? 'hit_blunt' : 'hit_flesh';
        this.audio.play(sound, { x: ev.x, y: ev.y, volume: ev.kind === HitKind.Bullet ? 0.5 : 0.8 });
        if (ev.flags & HitFlags.Kill) {
          this.effects.bloodPool(ev.x + Math.cos(ev.dir) * 0.3, ev.y + Math.sin(ev.dir) * 0.3, 1.2);
          this.audio.play('body_fall', { x: ev.x, y: ev.y, volume: 0.7 });
        }
        if (ev.flags & HitFlags.Headshot && ev.source === this.entityId) this.audio.play('hit_flesh', { volume: 0.25, rate: 1.4 });
        if (ev.target === this.entityId) {
          this.camera.addShake(ev.kind === HitKind.Bite ? 0.35 : 0.22);
          this.hud.hurt(ev.kind === HitKind.Bite ? 0.55 : 0.35);
          if (ev.kind === HitKind.Bite) this.hud.notice('You have been bitten!', 'warn');
        }
        break;
      }
      case NetEventType.Sound: {
        const name = SOUNDS[ev.sound];
        const id = name ? NET_SOUNDS[name] : undefined;
        if (!id) break;
        if (ev.source === this.entityId && (id === 'player_death' || id === 'step_soft')) break;
        this.audio.play(id, { x: ev.x, y: ev.y, volume: ev.volume, range: SOUND_RANGE[id] ?? 30 });
        break;
      }
    }
  }

  private shotEffects(
    x: number,
    y: number,
    angle: number,
    pellets: { angle: number; distance: number; impact: number }[],
    icon: string | undefined,
    scale: number,
  ): void {
    this.effects.muzzleFlash(x, y, angle, scale);
    for (const p of pellets) {
      const ex = x + Math.cos(p.angle) * p.distance;
      const ey = y + Math.sin(p.angle) * p.distance;
      this.effects.tracer(x, y, ex, ey);
      if (p.impact !== IMPACT_NONE && p.impact !== IMPACT_FLESH) this.effects.impact(ex, ey, p.angle, p.impact);
    }
    if (icon !== 'shotgun' && icon !== 'revolver') this.effects.casing(x - Math.cos(angle) * 0.3, y - Math.sin(angle) * 0.3, angle);
    this.audio.play(SHOT_SOUNDS[icon ?? ''] ?? 'shot_pistol', { x, y, volume: 1, range: 160, jitter: 0.04 });
  }

  private predictionHooks(): NonNullable<Prediction['hooks']> {
    return {
      fire: (s, weapon, angles) => {
        const firearm = weapon.firearm!;
        const def = weapon.itemId ? this.content.findItem(weapon.itemId) : undefined;
        const muzzle = 0.45;
        const ox = s.x + Math.cos(s.aim) * muzzle;
        const oy = s.y + Math.sin(s.aim) * muzzle;
        const pellets = angles.map((a) => this.traceShot(ox, oy, a, firearm.range));
        this.shotEffects(ox, oy, s.aim, pellets, def?.icon, firearm.pellets ? 1.3 : 1);
        this.camera.addKick(s.aim, firearm.kick ?? 0.12);
        this.camera.addShake(firearm.pellets ? 0.12 : 0.05);
        this.views.character(this.entityId)?.recoil();
      },
      dryFire: () => this.audio.play('dry_fire', { volume: 0.6 }),
      melee: (s, weapon, angle) => this.localSwing(s.x, s.y, angle, weapon, false),
      shove: (s, angle) => this.localSwing(s.x, s.y, angle, weaponProfile(null), true),
      reloadStart: () => this.audio.play('reload_start', { volume: 0.6 }),
      reloaded: (_s, weapon) => this.audio.play(weapon.firearm?.reloadPerRound ? 'shell_insert' : 'reload_end', { volume: 0.6 }),
      footstep: (s, loudness) => {
        this.stepSide = !this.stepSide;
        const surface = this.surfaceSound(s.x, s.y);
        this.audio.play(surface, { volume: Math.min(0.55, 0.12 + loudness * 0.02), rate: this.stepSide ? 1 : 0.94 });
      },
      equip: () => this.audio.play('equip', { volume: 0.4 }),
    };
  }

  private localSwing(x: number, y: number, angle: number, weapon: WeaponProfile, shove: boolean): void {
    const view = this.views.character(this.entityId);
    if (shove) {
      view?.shove();
      this.effects.swing(x, y, angle, SHOVE.reach, SHOVE.arc, 1);
      this.audio.play('shove', { volume: 0.55 });
    } else {
      view?.swing();
      this.effects.swing(x, y, angle, weapon.melee?.reach ?? 1, weapon.melee?.arc ?? 70, 1);
      this.audio.play('swing', { volume: 0.5 });
    }
  }

  /** Client-side trace for predicted tracers: stops at walls (not glass) or the first zombie. */
  private traceShot(ox: number, oy: number, angle: number, range: number): { angle: number; distance: number; impact: number } {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let distance = range;
    let impact = IMPACT_NONE;
    for (const hit of this.world.compiled.collision.raycastAll(ox, oy, dx, dy, range, Block.Bullet)) {
      const oid = hit.collider.objectId;
      if (oid && this.world.compiled.windows.has(oid)) continue;
      distance = hit.distance;
      impact = 2 + Math.max(0, IMPACT_MATERIALS.indexOf(hit.collider.material as (typeof IMPACT_MATERIALS)[number]));
      break;
    }
    for (const e of this.entities.all.values()) {
      if (e.kind !== EntityKind.Zombie) continue;
      const t = rayCircle(ox, oy, dx, dy, e.x, e.y, ZOMBIE_RADIUS);
      if (t !== null && t < distance) {
        distance = t;
        impact = IMPACT_FLESH;
      }
    }
    return { angle, distance, impact };
  }

  private surfaceSound(x: number, y: number): SoundId {
    const b = this.world.buildingAt(x, y);
    if (b) {
      const room = b.rooms[0];
      return room?.floor === 'wood' || room?.floor === 'darkwood' ? 'step_wood' : 'step_hard';
    }
    const m = this.world.terrainAt(x, y);
    // asphalt, asphalt_cracked, concrete, sidewalk, concrete_industrial, asphalt_parking.
    return m === 8 || m === 9 || m === 10 || m === 11 || m === 18 || m === 19 ? 'step_hard' : 'step_soft';
  }

  // =============================================================================================
  // Frame

  private closeScreens(): void {
    this.inventoryScreen.close();
    this.healthScreen.close();
    this.mapScreen.close();
    this.crafting.close();
    this.actionMenu.close();
  }

  private get modalOpen(): boolean {
    return (
      this.inventoryScreen.isOpen ||
      this.healthScreen.isOpen ||
      this.mapScreen.isOpen ||
      this.crafting.isOpen ||
      this.actionMenu.isOpen ||
      this.menu.isOpen ||
      this.death.visible
    );
  }

  private handleUiActions(): void {
    const a = this.actions;
    if (a.pressed('menu')) {
      if (this.actionMenu.isOpen) this.actionMenu.close();
      else if (this.inventoryScreen.isOpen || this.healthScreen.isOpen || this.mapScreen.isOpen || this.crafting.isOpen)
        this.closeScreens();
      else if (this.buildMode) this.exitBuildMode();
      else if (this.menu.isOpen) this.menu.close();
      else if (!this.death.visible) {
        this.menu.open();
        this.actions.releaseAll();
      }
      return;
    }
    if (a.pressed('chat') && !this.chat.isOpen && !this.menu.isOpen) {
      this.chat.open();
      return;
    }
    if (this.menu.isOpen || this.death.visible) return;
    if (this.actionMenu.isOpen) {
      for (let i = 0; i < 5; i++) if (a.pressed(`slot${i + 1}` as 'slot1')) this.actionMenu.pick(i);
      if (a.pressed('interact')) this.actionMenu.close();
      return;
    }
    if (a.pressed('inventory')) {
      const open = !this.inventoryScreen.isOpen;
      this.closeScreens();
      if (open) this.inventoryScreen.open();
      this.ui('ui_click');
    }
    if (a.pressed('health')) {
      const open = !this.healthScreen.isOpen;
      this.closeScreens();
      if (open) this.healthScreen.open();
      this.ui('ui_click');
    }
    if (a.pressed('map')) {
      const open = !this.mapScreen.isOpen;
      this.closeScreens();
      if (open) {
        this.mapScreen.open();
        this.mapTimer = 0;
      }
      this.ui('ui_click');
    }
    if (a.pressed('crafting')) {
      const open = !this.crafting.isOpen;
      this.closeScreens();
      if (open) this.crafting.open();
      this.ui('ui_click');
    }
    if (!this.alive) return;
    if (a.zoom !== 0) this.camera.addZoom(a.zoom);
    if (a.pressed('zoomIn')) this.camera.addZoom(-2);
    if (a.pressed('zoomOut')) this.camera.addZoom(2);
    if (this.asleep) {
      // Asleep: the only thing to do is wake up.
      if (a.pressed('interact') || a.pressed('shove')) this.send({ t: 'wake' });
      return;
    }
    if (a.pressed('build')) {
      if (this.buildMode) this.exitBuildMode();
      else this.enterBuildMode();
      this.ui('ui_click');
    }
    if (this.buildMode) {
      for (let i = 0; i < 5; i++) if (a.pressed(`slot${i + 1}` as 'slot1')) this.buildPanel.pick(i);
      if (a.pressed('reload')) this.buildRot += BUILD_ROTATION_STEP;
      if (a.pressed('aim')) this.exitBuildMode();
      else if (a.pressed('attack') && !this.modalOpen) this.placeStructure();
    } else {
      for (let i = 0; i < 5; i++) {
        if (a.pressed(`slot${i + 1}` as 'slot1')) this.selectSlot(this.selectedSlot === i ? NO_SLOT : i);
      }
      if (a.pressed('useItem')) {
        const held = this.selectedSlot !== NO_SLOT ? this.inventory.slots[this.selectedSlot] : null;
        if (held) this.send({ t: 'use', uid: held.uid });
      }
    }
    if (a.pressed('flashlight')) this.send({ t: 'flashlight' });
    if (a.pressed('crouch')) this.crouchOn = !this.crouchOn;
    this.handleInteract();
  }

  // =============================================================================================
  // Interaction: tap E for the obvious action, hold E for everything else (design plan §5.4)

  private handleInteract(): void {
    const a = this.actions;
    if (a.pressed('interact')) {
      this.interactHeld = 0;
      this.menuOpened = false;
      if (this.hud.busy) {
        this.send({ t: 'cancel' });
        this.interactHeld = -1;
      }
    }
    if (this.interactHeld >= 0 && a.isHeld('interact') && !this.menuOpened && this.interactHeld >= MENU_HOLD_SECONDS) {
      this.menuOpened = true;
      this.openActionMenu();
    }
    if (this.interactHeld >= 0 && a.released('interact')) {
      if (!this.menuOpened) {
        const t = this.target;
        const acts = this.actionsFor(t);
        if (acts.primary && !acts.primary.disabled) acts.primary.run();
        else if (t) this.openActionMenu();
      }
      this.interactHeld = -1;
    }
  }

  private openActionMenu(): void {
    const acts = this.actionsFor(this.target);
    const t = this.target;
    const p = t ? this.camera.worldToScreen(t.x, t.y) : { x: this.actions.aimScreenX, y: this.actions.aimScreenY };
    const list = acts.primary ? [acts.primary, ...acts.actions] : acts.actions;
    if (list.length === 0) return;
    this.actionMenu.open(acts.title, list, p.x, p.y);
    this.actions.releaseAll();
  }

  private act(action: WorldAction, target: string): void {
    this.send({ t: 'act', action, target });
  }

  private has(tag: string): boolean {
    return hasToolTag(this.content, this.inventory, tag);
  }

  private count(item: string): number {
    return countItems(this.inventory, (st) => st.id === item);
  }

  private barricadeActions(id: string, boards: number, canBoard: boolean): MenuAction[] {
    const out: MenuAction[] = [];
    if (canBoard && boards < MAX_BOARDS) {
      const ok = this.has('hammer') && this.count('plank') >= 1 && this.count('nails') >= 2;
      out.push({
        label: boards > 0 ? `Add a plank (${boards}/${MAX_BOARDS})` : 'Barricade',
        detail: ok ? 'Hammer · 1 plank · 2 nails' : 'Needs a hammer, 1 plank and 2 nails',
        disabled: !ok,
        run: () => this.act('barricade', id),
      });
    }
    if (boards > 0) {
      const ok = this.has('crowbar') || this.has('hammer');
      out.push({
        label: 'Pry off a plank',
        detail: ok ? 'Crowbar or hammer' : 'Needs a crowbar or a hammer',
        disabled: !ok,
        run: () => this.act('unbarricade', id),
      });
    }
    return out;
  }

  /** Actions for a player structure (or placed furniture) by structure id. */
  private structureActions(sid: string): MenuAction[] {
    const compiled = this.world.compiled;
    const s = compiled.structures.get(sid);
    if (!s) return [];
    const out: MenuAction[] = [];
    const mine = s.def.owner === this.accountId;
    const state = compiled.effectiveState(sid);
    const con = s.shape.construction;
    if (con?.kind === 'fire') {
      const lit = state.until > this.worldMinutes;
      const fuel = this.content.findItem(con.fuel ?? '');
      const hasFuel = this.count(con.fuel ?? '') > 0;
      const canLight = lit || this.has('fire');
      out.push({
        label: lit ? `Add a ${fuel?.name.toLowerCase() ?? 'log'}` : 'Light the fire',
        detail: !hasFuel
          ? `Needs a ${fuel?.name.toLowerCase() ?? 'fuel'}`
          : !canLight
            ? 'Needs a lighter or matches'
            : lit
              ? 'Burns longer'
              : undefined,
        disabled: !hasFuel || !canLight,
        run: () => this.act('refuel', sid),
      });
      if (lit) out.push({ label: 'Put out', run: () => this.act('extinguish', sid) });
    }
    if (s.def.type === FURNITURE_STRUCTURE) {
      out.push({
        label: 'Pick up',
        detail: mine ? 'Carry it in your hands' : `Placed by ${s.def.ownerName}`,
        run: () => this.act('pickup', sid),
      });
    } else {
      if (state.hp < s.maxHp) {
        const ok = this.has('hammer') && this.count('plank') >= 1 && this.count('nails') >= 2;
        out.push({
          label: 'Repair',
          detail: ok ? 'Hammer · 1 plank · 2 nails' : 'Needs a hammer, 1 plank and 2 nails',
          disabled: !ok,
          run: () => this.act('repair', sid),
        });
      }
      out.push({
        label: 'Dismantle',
        detail: mine ? 'Returns half the materials' : `Built by ${s.def.ownerName}`,
        disabled: !this.has('hammer'),
        run: () => this.act('dismantle', sid),
      });
    }
    return out;
  }

  /** Station, bed and furniture actions for an object id (base-map prop or structure). */
  private objectActions(id: string, sid: string | null): { primary: MenuAction | null; actions: MenuAction[] } {
    const compiled = this.world.compiled;
    const actions: MenuAction[] = [];
    let primary: MenuAction | null = null;
    const bed = compiled.beds.get(sid ?? id) ?? compiled.beds.get(id);
    if (bed) {
      const quality = bed.quality >= 0.9 ? 'best rest' : bed.quality >= 0.5 ? 'decent rest' : 'poor rest';
      const sleep = {
        label: `Sleep in the ${bed.name.toLowerCase()}`,
        detail: quality,
        run: () => this.send({ t: 'sleep', target: bed.id }),
      };
      actions.push(sleep);
      primary = sleep;
    }
    const station = compiled.stations.get(sid ?? id) ?? compiled.stations.get(id);
    if (station) {
      const lit = !station.fire || compiled.effectiveState(station.id).until > this.worldMinutes;
      const cook = station.kind === 'heat';
      const open: MenuAction = {
        label: cook ? 'Cook…' : 'Craft…',
        detail: lit ? (cook ? 'Heat source' : 'Workbench') : 'Light the fire first',
        disabled: !lit,
        run: () => {
          this.closeScreens();
          this.crafting.open(cook ? 'cooking' : 'carpentry');
        },
      };
      actions.push(open);
      if (lit) primary = open;
    }
    const movable = compiled.movables.get(id);
    if (movable && !compiled.effectiveState(id).removed) {
      const container = compiled.containers.has(id);
      const state = compiled.effectiveState(id);
      const blocked = container && !state.searched ? 'Search it first' : null;
      actions.push({
        label: `Pick up the ${movable.name.toLowerCase()}`,
        detail: blocked ?? `Heavy · ${this.content.findItem(furnitureItemId(movable.propType))?.weight ?? '?'} kg`,
        disabled: !!blocked,
        run: () => this.act('pickup', id),
      });
    }
    if (sid) actions.push(...this.structureActions(sid));
    return { primary, actions };
  }

  private actionsFor(t: Interaction | null): TargetActions {
    const compiled = this.world.compiled;
    if (!t) {
      return {
        title: 'You',
        primary: null,
        actions: [
          { label: 'Sleep here', detail: 'On the floor — poor rest', run: () => this.send({ t: 'sleep' }) },
          { label: 'Crafting & cooking…', detail: 'K', run: () => this.crafting.open() },
          { label: 'Build…', detail: 'B', run: () => this.enterBuildMode() },
        ],
      };
    }
    switch (t.kind) {
      case 'door': {
        const actions: MenuAction[] = [];
        let primary: MenuAction | null = null;
        if (t.boards === 0 && !t.broken) {
          primary = { label: t.open ? 'Close door' : 'Open door', run: () => this.send({ t: 'interact', target: t.id }) };
          if (!t.open) {
            actions.push({
              label: t.locked ? 'Unlock' : 'Lock',
              detail: t.structureId ? 'Your key' : 'From the inside',
              run: () => this.send({ t: 'interact', target: t.id, action: 'lock' }),
            });
          }
        }
        actions.push(...this.barricadeActions(t.id, t.boards, !t.open || t.broken));
        if (t.structureId) actions.push(...this.structureActions(t.structureId));
        return { title: t.broken ? 'Broken doorway' : 'Door', primary, actions };
      }
      case 'window': {
        const primary: MenuAction | null =
          !t.broken && t.boards === 0
            ? { label: 'Smash window', detail: 'Loud', run: () => this.send({ t: 'interact', target: t.id }) }
            : null;
        return { title: t.broken ? 'Broken window' : 'Window', primary, actions: this.barricadeActions(t.id, t.boards, true) };
      }
      case 'container': {
        const box = compiled.containers.get(t.id);
        const sid = box?.structureId ?? null;
        const primary: MenuAction = {
          label: `${t.searched ? 'Open' : 'Search'} ${t.name.toLowerCase()}`,
          run: () => {
            this.send({ t: 'open', target: t.id });
            this.inventoryScreen.expect(t.id);
          },
        };
        const extra = this.objectActions(t.id, sid);
        if (box?.owner) {
          const locked = compiled.effectiveState(t.id).locked;
          extra.actions.unshift({
            label: locked ? 'Unlock storage' : 'Lock storage',
            detail: box.owner === this.accountId ? 'Only you and survivors you /trust' : 'Owner or trusted only',
            run: () => this.act('lockStorage', t.id),
          });
        }
        return { title: t.name, primary, actions: extra.actions };
      }
      case 'corpse':
        return {
          title: t.name,
          primary: {
            label: `Search ${t.name.toLowerCase()}`,
            run: () => {
              this.send({ t: 'open', target: `e:${t.entity}` });
              this.inventoryScreen.expect(`e:${t.entity}`);
            },
          },
          actions: [],
        };
      case 'item':
        return {
          title: t.name,
          primary: { label: `Pick up ${t.name}`, run: () => this.send({ t: 'interact', target: `e:${t.entity}` }) },
          actions: [],
        };
      case 'thing': {
        const sid = compiled.structures.has(t.id) ? t.id : null;
        const acts = this.objectActions(t.id, sid);
        return { title: t.name, primary: acts.primary, actions: acts.actions.filter((x) => x !== acts.primary) };
      }
    }
  }

  /** Picks the interactable the player is most likely aiming at. */
  private findTarget(px: number, py: number, aim: number): Interaction | null {
    let best: Interaction | null = null;
    let bestScore = Infinity;
    const consider = (i: Interaction, reach: number, penalty = 0) => {
      const d = Math.hypot(i.x - px, i.y - py);
      if (d > reach) return;
      const ang = Math.abs(angleDelta(aim, Math.atan2(i.y - py, i.x - px)));
      const score = d + ang * 1.4 * Math.min(1, d) + penalty;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    };
    const compiled = this.world.compiled;
    const near = (x: number, y: number, r: number) => Math.abs(x - px) <= r && Math.abs(y - py) <= r;
    for (const d of compiled.doors.values()) {
      if (!near(d.x, d.y, 4)) continue;
      const s = compiled.effectiveState(d.id);
      if (s.broken && s.boards === 0 && !d.structureId) {
        // A broken doorway can still be boarded up, but should not steal focus.
        consider(
          { kind: 'door', id: d.id, x: d.x, y: d.y, open: s.open, locked: s.locked, broken: true, boards: 0, structureId: null },
          INTERACT_RANGE + d.w / 2,
          0.8,
        );
        continue;
      }
      consider(
        {
          kind: 'door',
          id: d.id,
          x: d.x,
          y: d.y,
          open: s.open,
          locked: s.locked,
          broken: s.broken,
          boards: s.boards,
          structureId: d.structureId,
        },
        INTERACT_RANGE + d.w / 2,
      );
    }
    for (const w of compiled.windows.values()) {
      if (!near(w.x, w.y, 4)) continue;
      const s = compiled.effectiveState(w.id);
      consider(
        { kind: 'window', id: w.id, x: w.x, y: w.y, broken: s.broken, boards: s.boards },
        INTERACT_RANGE * 0.8 + w.w / 2,
        s.broken && s.boards === 0 ? 0.8 : 0,
      );
    }
    for (const c of compiled.containers.values()) {
      if (!near(c.x, c.y, 5)) continue;
      consider(
        { kind: 'container', id: c.id, x: c.x, y: c.y, name: c.name, searched: compiled.effectiveState(c.id).searched },
        INTERACT_RANGE + c.radius * 0.85,
      );
    }
    for (const b of compiled.beds.values()) {
      if (!near(b.x, b.y, 5) || compiled.containers.has(b.id)) continue;
      consider({ kind: 'thing', id: b.id, x: b.x, y: b.y, name: b.name }, INTERACT_RANGE + b.radius * 0.85);
    }
    for (const m of compiled.movables.values()) {
      if (!near(m.x, m.y, 5) || compiled.containers.has(m.id) || compiled.beds.has(m.id)) continue;
      if (compiled.effectiveState(m.id).removed) continue;
      consider({ kind: 'thing', id: m.id, x: m.x, y: m.y, name: m.name }, INTERACT_RANGE + m.radius * 0.85, 0.4);
    }
    for (const st of compiled.structures.values()) {
      if (!near(st.x, st.y, 6) || st.shape.kind === 'door' || st.shape.kind === 'gate') continue;
      if (compiled.containers.has(storageId(st.id)) || compiled.beds.has(st.id)) continue;
      const floor = st.shape.kind === 'floor';
      consider({ kind: 'thing', id: st.id, x: st.x, y: st.y, name: st.shape.name }, INTERACT_RANGE + st.radius * 0.85, floor ? 1.6 : 0.3);
    }
    for (const e of this.entities.all.values()) {
      if (e.kind === EntityKind.Corpse)
        consider({ kind: 'corpse', entity: e.id, x: e.net.x, y: e.net.y, name: corpseName(e) }, CORPSE_RANGE);
      else if (e.kind === EntityKind.Item) {
        const def = this.content.itemAt(e.net.item - 1);
        const name = def ? `${def.name}${e.net.extra > 1 ? ` (×${e.net.extra})` : ''}` : 'item';
        // Items on the floor get a small bonus so they win over the cabinet next to them.
        const d = Math.hypot(e.net.x - px, e.net.y - py);
        if (d <= ITEM_RANGE) consider({ kind: 'item', entity: e.id, x: e.net.x, y: e.net.y, name }, ITEM_RANGE + 0.3);
      }
    }
    return best;
  }

  private updatePrompt(): void {
    if (this.buildMode) return;
    const t = this.target;
    if (this.asleep) {
      this.hud.setPrompt(null);
      return;
    }
    if (this.modalOpen || this.hud.busy) {
      this.hud.setPrompt(this.hud.busy && !this.modalOpen ? 'E' : null, 'Cancel');
      return;
    }
    if (!t) {
      this.hud.setPrompt(null);
      return;
    }
    const acts = this.actionsFor(t);
    const more = acts.actions.length > 0 ? 'Hold E for more' : '';
    if (acts.primary) this.hud.setPrompt('E', acts.primary.label, more);
    else this.hud.setPrompt('E', acts.title, 'Actions');
  }

  // =============================================================================================
  // Build mode (design plan §54–56)

  private enterBuildMode(): void {
    if (!this.alive || this.asleep) return;
    this.closeScreens();
    this.buildMode = true;
    this.buildPanel.open();
    this.hud.setBuildMode(true);
    this.selectSlot(NO_SLOT);
  }

  private exitBuildMode(): void {
    if (!this.buildMode) return;
    this.buildMode = false;
    this.buildPanel.close();
    this.buildChoice = null;
    this.ghost.hide();
    this.hud.setBuildMode(false);
    this.hud.setPrompt(null);
  }

  private floorAt(x: number, y: number): boolean {
    for (const st of this.world.compiled.structures.values()) {
      if (st.shape.kind !== 'floor' || Math.abs(st.x - x) > 2 || Math.abs(st.y - y) > 2) continue;
      const dx = x - st.x;
      const dy = y - st.y;
      const lx = dx * Math.cos(st.rot) + dy * Math.sin(st.rot);
      const ly = -dx * Math.sin(st.rot) + dy * Math.cos(st.rot);
      if (Math.abs(lx) < st.shape.w / 2 - 0.05 && Math.abs(ly) < st.shape.h / 2 - 0.05) return true;
    }
    return false;
  }

  /** The snapped placement under the cursor and why it cannot be built there (null if it can). */
  private buildPlacement(): { x: number; y: number; rot: number; problem: string | null } | null {
    const choice = this.buildChoice;
    const p = this.prediction?.state;
    if (!choice || !p) return null;
    const pointer = this.camera.screenToWorld(this.actions.aimScreenX, this.actions.aimScreenY);
    const snap = snapPlacement(pointer.x, pointer.y, this.buildRot);
    let problem: string | null = null;
    if (choice.type === FURNITURE_STRUCTURE) {
      if (!this.inventory.slots.some((st) => st?.id === furnitureItemId(choice.prop ?? ''))) problem = 'You are not carrying that.';
    } else {
      const con = this.content.findConstruction(choice.type);
      if (!con) problem = 'Unknown construction.';
      else {
        const check = checkMaterials(this.content, this.inventory, con.materials, con.tools);
        if (!check.ok) problem = check.problem;
      }
    }
    problem ??= placementProblem(
      {
        content: this.content,
        collision: this.world.compiled.collision,
        mapWidth: this.world.width,
        mapHeight: this.world.height,
        floorAt: (x, y) => this.floorAt(x, y),
        occupied: (x, y, r) => {
          if (Math.hypot(p.x - x, p.y - y) < r + 0.32) return true;
          for (const e of this.entities.all.values()) {
            if (e.kind !== EntityKind.Player && e.kind !== EntityKind.Zombie) continue;
            if (e.id !== this.entityId && Math.hypot(e.x - x, e.y - y) < r + 0.32) return true;
          }
          return false;
        },
      },
      choice.type,
      choice.prop,
      snap.x,
      snap.y,
      snap.rot,
      p,
    );
    return { ...snap, problem };
  }

  private updateBuildGhost(): void {
    if (!this.buildMode) return;
    const choice = this.buildChoice;
    const placement = this.buildPlacement();
    const shape = choice ? structureShape(this.content, choice.type, choice.prop) : null;
    if (!choice || !placement || !shape) {
      this.ghost.hide();
      this.hud.setPrompt('B', 'Pick something to build', 'Exit build mode');
      return;
    }
    this.ghost.show(shape, placement.x, placement.y, placement.rot, !placement.problem);
    if (placement.problem) this.hud.setPrompt('✕', placement.problem, `${choice.name}`);
    else this.hud.setPrompt('Click', `Build ${choice.name}`, 'R rotates');
  }

  private placeStructure(): void {
    const choice = this.buildChoice;
    const placement = this.buildPlacement();
    if (!choice || !placement) return;
    if (placement.problem) {
      this.hud.notice(placement.problem, 'warn');
      this.ui('ui_error');
      return;
    }
    this.send({ t: 'build', type: choice.type, prop: choice.prop, x: placement.x, y: placement.y, rot: placement.rot });
  }

  private buildInput(aim: number): PlayerInput {
    const a = this.actions;
    if (this.asleep) {
      // Sleepers lie still; the server simulates them with exactly this input.
      return quantizeInput({
        seq: ++this.seq,
        moveX: 0,
        moveY: 0,
        aim: this.prediction?.state.aim ?? aim,
        buttons: 0,
        slot: this.prediction?.state.slot ?? this.selectedSlot,
        viewTick: this.clock.renderTick(),
      });
    }
    const free = !this.modalOpen && !this.chat.isOpen && !this.buildMode;
    let buttons = 0;
    if (free && a.heldForStep('attack')) buttons |= Buttons.Attack;
    if (free && a.isHeld('aim')) buttons |= Buttons.Aim;
    if (a.isHeld('sprint') && !this.menu.isOpen) buttons |= Buttons.Sprint;
    if (this.crouchOn) buttons |= Buttons.Crouch;
    if (free && a.heldForStep('shove')) buttons |= Buttons.Shove;
    if (a.heldForStep('reload') && !this.buildMode) buttons |= Buttons.Reload;
    if (buttons & Buttons.Sprint) this.crouchOn = false;
    const moving = !this.menu.isOpen;
    return quantizeInput({
      seq: ++this.seq,
      moveX: moving ? a.moveX : 0,
      moveY: moving ? a.moveY : 0,
      aim,
      buttons: buttons & ~(this.crouchOn ? 0 : Buttons.Crouch),
      slot: this.selectedSlot,
      viewTick: this.clock.renderTick(),
    });
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.keyboard.enabled = !this.chat.isOpen && !this.menu.isOpen;
    this.keyboard.poll(this.actions);
    this.handleUiActions();
    const r = this.renderer;
    this.camera.resize(r.width, r.height);

    // --- Simulation steps -------------------------------------------------------------------
    const p = this.prediction;
    let px = this.camera.x;
    let py = this.camera.y;
    let aim = 0;
    if (p && this.alive) {
      const rp0 = p.renderPosition(this.acc / STEP);
      const pointer = this.camera.screenToWorld(this.actions.aimScreenX, this.actions.aimScreenY);
      aim = Math.atan2(pointer.y - rp0.y, pointer.x - rp0.x);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
        const input = this.buildInput(aim);
        p.step(input);
        this.outgoing.push(input);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      while (this.outgoing.length > 0) this.conn.sendInputs(this.outgoing.splice(0, 60));
      p.decay(dt);
      const rp = p.renderPosition(this.acc / STEP);
      px = rp.x;
      py = rp.y;
      if (this.interactHeld >= 0) this.interactHeld += dt;
    }

    // --- Entities, camera, world ------------------------------------------------------------
    this.entities.interpolate(this.clock.renderTick(), dt, this.entityId);
    const building = this.world.buildingAt(px, py);
    this.insideId = building?.id ?? null;
    const aiming = this.actions.isHeld('aim') && !this.modalOpen;
    this.camera.update(dt, px, py, this.actions.aimScreenX, this.actions.aimScreenY, aiming, !!building);
    r.applyCamera(this.camera);
    const view = this.camera.bounds(6);
    this.terrain.update(this.camera.x, this.camera.y);
    this.roads.cull(view);
    this.buildings.update(dt, this.insideId, view);
    this.props.update(dt, px, py, view);
    this.structures.update(dt, this.worldMinutes, view);
    this.visibility.update(px, py, VIEW_RADIUS);
    this.views.update(dt, this.entities.all.values(), { polygon: this.visibility.points, x: px, y: py });
    this.poseSelf(dt, px, py, aim);
    this.effects.update(dt);

    // --- Lighting ---------------------------------------------------------------------------
    const hour = (this.worldMinutes / 60) % 24;
    const lights = this.collectLights(px, py, aim);
    const roofs: number[][] = [];
    for (const b of this.world.buildings.values()) {
      if (b.id === this.insideId) continue;
      const cb = this.world.compiled.buildings.get(b.id);
      if (!cb || cb.bounds.maxX < view.minX || cb.bounds.minX > view.maxX || cb.bounds.maxY < view.minY || cb.bounds.minY > view.maxY)
        continue;
      roofs.push(buildingPolygon(b));
    }
    r.lighting.render(this.camera, this.visibility.points, hour, lights, this.effects.lights, !!building, roofs);

    // --- Interaction, HUD, audio ------------------------------------------------------------
    this.target = this.alive && p && !this.buildMode ? this.findTarget(p.state.x, p.state.y, aim) : null;
    this.updatePrompt();
    this.updateBuildGhost();
    this.craftTimer -= dt;
    if (this.craftTimer <= 0) {
      // Stations come and go as you move and fires burn out.
      this.craftTimer = 0.5;
      this.crafting.render();
      this.buildPanel.render();
    }
    const s = p?.state;
    this.hud.frame(dt, {
      stamina: s?.stamina ?? 1,
      maxStamina: this.status?.move.maxStamina ?? 1,
      exhausted: s?.exhausted ?? false,
      reloading: s?.action === PlayerAction.Reload,
      worldMinutes: this.worldMinutes,
    });
    const markers = this.mapMarkers();
    this.hud.updateMinimap(dt, this.mapView, px, py, aim, markers);
    if (this.mapScreen.isOpen && this.mapView) {
      this.mapTimer -= dt;
      if (this.mapTimer <= 0) {
        this.mapTimer = 0.25;
        this.mapScreen.draw(this.mapView, [...markers, { x: px, y: py, color: '#e8e4d0', angle: aim, self: true, label: 'You' }]);
      }
    }
    this.audio.setListener(px, py);
    this.refreshFloor(dt, px, py);
    const silence = performance.now() - this.conn.lastMessageAt;
    this.hud.setConnectionWarning(silence > 2500 ? `Connection problem — no data for ${Math.floor(silence / 1000)} s` : null);
    this.drawCrosshair(px, py);
    this.actions.endFrame();
    this.frameMs = this.frameMs * 0.9 + (performance.now() - now) * 0.1;
    this.updateDebug(dt, px, py);
  }

  private poseSelf(dt: number, x: number, y: number, aim: number): void {
    const view = this.views.character(this.entityId);
    const p = this.prediction;
    if (!view || !p) return;
    const s = p.state;
    const held = this.selectedSlot !== NO_SLOT ? this.inventory.slots[this.selectedSlot] : null;
    const def = held ? this.content.findItem(held.id) : undefined;
    view.setHeld(def?.icon, parseInt((def?.color ?? '#777777').slice(1), 16), !!def?.firearm, !!def?.melee);
    const speed = Math.hypot(s.vx, s.vy);
    view.update(dt, x, y, this.asleep ? s.aim : aim, speed, {
      aiming: s.aimProgress > 0.2,
      crouching: s.crouching,
      reloading: s.action === PlayerAction.Reload,
      windup: s.action === PlayerAction.Melee && s.actionTimer > 0,
      lunge: false,
      stagger: false,
      prone: this.asleep,
    });
  }

  private collectLights(px: number, py: number, aim: number): LightSource[] {
    const lights: LightSource[] = [];
    // Eyes adjust: a faint glow around the player so they never lose their own character.
    lights.push({ kind: 'radial', x: px, y: py, angle: 0, range: 3.2, cone: 0, intensity: 0.22, occluded: true });
    if (this.status?.flashlight && this.alive) {
      let range = 14;
      let cone = 26;
      for (const st of [...this.inventory.slots, ...this.inventory.pockets, ...(this.inventory.back?.contents ?? [])]) {
        const def = st ? this.content.findItem(st.id) : undefined;
        if (def?.light) {
          range = def.light.range;
          cone = def.light.cone;
          break;
        }
      }
      const charge = this.status.flashlightCharge;
      const flicker = charge < 0.1 ? 0.6 + Math.random() * 0.4 : 1;
      lights.push({ kind: 'cone', x: px, y: py, angle: aim, range, cone, intensity: 0.95 * flicker, occluded: true });
      lights.push({
        kind: 'radial',
        x: px + Math.cos(aim) * 0.6,
        y: py + Math.sin(aim) * 0.6,
        angle: 0,
        range: 2.4,
        cone: 0,
        intensity: 0.3 * flicker,
        occluded: true,
      });
    }
    for (const e of this.entities.all.values()) {
      if (e.kind !== EntityKind.Player || e.id === this.entityId || !(e.net.flags & PlayerFlags.Flashlight)) continue;
      lights.push({ kind: 'cone', x: e.x, y: e.y, angle: e.angle, range: 14, cone: 26, intensity: 0.85, occluded: true });
    }
    for (const f of this.structures.fires()) {
      lights.push({
        kind: 'radial',
        x: f.x,
        y: f.y,
        angle: 0,
        range: f.radius,
        cone: 0,
        intensity: f.intensity,
        occluded: true,
        color: 0xffb070,
      });
    }
    return lights;
  }

  private mapMarkers(): MapMarker[] {
    const out: MapMarker[] = [];
    for (const e of this.entities.all.values()) {
      if (e.kind !== EntityKind.Player || e.id === this.entityId) continue;
      out.push({ x: e.x, y: e.y, color: '#8ec06a', label: e.net.name });
    }
    return out;
  }

  private refreshFloor(dt: number, px: number, py: number): void {
    if (!this.inventoryScreen.showingFloor) return;
    this.floorTimer -= dt;
    if (this.floorTimer > 0) return;
    if (Math.hypot(px - this.lastFloorX, py - this.lastFloorY) < 0.8) return;
    this.floorTimer = 0.5;
    this.lastFloorX = px;
    this.lastFloorY = py;
    this.send({ t: 'open', target: 'floor' });
  }

  private drawCrosshair(px: number, py: number): void {
    const r = this.renderer;
    const p = this.prediction;
    if (this.modalOpen || this.chat.isOpen || !p || !this.alive) {
      r.drawCrosshair(0, 0, 0, 'hidden');
      return;
    }
    const sx = this.actions.aimScreenX;
    const sy = this.actions.aimScreenY;
    const held = this.selectedSlot !== NO_SLOT ? this.inventory.slots[this.selectedSlot] : null;
    const def = held ? this.content.findItem(held.id) : undefined;
    if (!def?.firearm) {
      r.drawCrosshair(sx, sy, 0, 'melee');
      return;
    }
    const spread = firearmSpread(p.state, def.firearm, this.status?.move.aimSway ?? 0);
    const w = this.camera.screenToWorld(sx, sy);
    const dist = Math.max(1.5, Math.hypot(w.x - px, w.y - py));
    const gap = Math.tan(spread) * dist * this.camera.scale;
    const color = p.state.magAmmo === 0 ? 0xd0624a : p.state.equipTimer > 0 || p.state.action === PlayerAction.Reload ? 0x9a978c : 0xe8e4d6;
    r.drawCrosshair(sx, sy, gap, 'gun', color);
  }
}

function corpseName(e: RemoteEntity): string {
  return e.net.flags & CorpseFlags.Player && e.net.name ? `${e.net.name}'s body` : 'Corpse';
}
