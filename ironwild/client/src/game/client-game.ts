// The running game on the client: owns the connection, world copy, prediction, renderers and UI;
// turns input into commands and server messages into pictures.

import {
  BUILD_RANGE,
  CREATURE_BY_ID,
  DX,
  DY,
  EntityFlags,
  FIST,
  FLUID_NAMES,
  INPUT_DT,
  INTERACT_RANGE,
  ITEM_BY_ID,
  InputFlags,
  PROFESSION_BY_ID,
  STATION_STRUCTURES,
  STRUCTURE_BY_ID,
  TILES,
  Tile,
  drillNode,
  rotatedSize,
  type ClientMessage,
  type Fluid,
  type GameEvent,
  type InputTuple,
  type ServerMessage,
  type SlotRef,
  type Snapshot,
  type UiState,
  type WelcomeMessage,
} from '@ironwild/shared';
import { Container } from 'pixi.js';
import { Sfx } from '../audio/sfx';
import { Input } from '../input/input';
import type { Connection } from '../net/connection';
import { BeltItems } from '../render/belt-items';
import { TS } from '../render/draw';
import { Effects } from '../render/effects';
import { FishingFloats } from '../render/fishing';
import { WireRenderer } from '../render/wires';
import { EntityViews } from '../render/entity-views';
import { Lighting } from '../render/lighting';
import { NodeRenderer } from '../render/nodes';
import { Overlay } from '../render/overlay';
import { Renderer } from '../render/renderer';
import { StructureRenderer } from '../render/structures';
import { TerrainRenderer } from '../render/terrain';
import { TownRenderer } from '../render/town';
import { Chat } from '../ui/chat';
import { h } from '../ui/dom';
import { Hud } from '../ui/hud';
import { setStructureIcon } from '../ui/icons';
import { InventoryWindow } from '../ui/inventory';
import { showDeath, showMessage } from '../ui/login';
import { companyWindow } from '../ui/company';
import { standingsWindow, type StandingsTab } from '../ui/standings';
import { Smithing, buildWindow, factoryWindow, helpWindow, mapWindow, researchWindow } from '../ui/menus';
import { contractsWindow, panelFor } from '../ui/panels';
import { initSlots, isDragging } from '../ui/slots';
import { Windows } from '../ui/windows';
import { EntityStore, ServerClock } from './entities';
import { Prediction } from './prediction';
import { ClientState, type UiContext } from './state';
import { ClientWorld, type ClientStruct } from './world';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;

type Target =
  | { kind: 'npc'; id: string; x: number; y: number; label: string }
  | { kind: 'struct'; id: number; x: number; y: number; label: string; crank?: boolean }
  | { kind: 'entity'; id: number; x: number; y: number; label: string; grab?: string };

/** Creatures an arrow tower turns toward. */
const HOSTILE = new Set(['wolf', 'bear', 'bandit']);

export class ClientGame {
  private readonly r = new Renderer();
  private readonly world: ClientWorld;
  private readonly state: ClientState;
  private readonly store = new EntityStore();
  private readonly clock = new ServerClock();
  private readonly prediction: Prediction;
  private readonly input: Input;
  private readonly sfx = new Sfx();
  private terrain!: TerrainRenderer;
  private nodes!: NodeRenderer;
  private structures!: StructureRenderer;
  private town!: TownRenderer;
  private entities!: EntityViews;
  private belts!: BeltItems;
  private effects!: Effects;
  private fishing!: FishingFloats;
  private wires!: WireRenderer;
  private lighting!: Lighting;
  private overlay!: Overlay;
  private hud!: Hud;
  private windows!: Windows;
  private chat!: Chat;
  private inventory!: InventoryWindow;
  private smithing!: Smithing;
  private readonly mapTab = { value: 'map' as 'map' | 'markets' };
  private ctx!: UiContext;

  private seq = 0;
  private acc = 0;
  private last = performance.now();
  private angle = 0;
  private dodgeQueued = false;
  private swingCd = 0;
  private chargeT = 0;
  private drawT = 0;
  private swingAt = 0;
  private heavy = false;
  private prevPrimary = false;
  private placing: string | null = null;
  private placeRot = 0;
  private target: Target | null = null;
  private cranking = 0;
  private crankTimer = 0;
  private deathEl: HTMLElement | null = null;
  private lastSmoke = 0;
  private currentSettlement: string | null = null;
  /** When the player closed a server panel (late refreshes for it are ignored briefly). */
  private uiClosedAt = 0;
  /** The inventory was opened automatically alongside a server panel. */
  private autoInventory = false;
  private lastStats = 0;
  private lastStandings = 0;
  private readonly standingsTab: { value: StandingsTab } = { value: 'ambitions' };
  private running = true;

  constructor(
    private readonly conn: Connection,
    private readonly welcome: WelcomeMessage,
    private readonly host: HTMLElement,
    private readonly ui: HTMLElement,
  ) {
    this.world = new ClientWorld(welcome);
    this.state = new ClientState(welcome);
    const spawn = welcome.world.settlements[0];
    this.prediction = new Prediction(spawn.x, spawn.y);
    this.input = new Input(host);
  }

  async start(): Promise<void> {
    await this.r.init(this.host);
    this.terrain = new TerrainRenderer(this.r, this.world);
    this.terrain.init();
    this.nodes = new NodeRenderer(this.r);
    this.structures = new StructureRenderer(this.r, this.world);
    this.town = new TownRenderer(this.r, this.world);
    this.town.init();
    this.entities = new EntityViews(this.r, this.store);
    this.belts = new BeltItems(this.r, this.world);
    this.effects = new Effects(this.r);
    this.fishing = new FishingFloats(this.r, (pid) => this.entities.rodTip(pid));
    this.wires = new WireRenderer(this.r, this.world);
    this.structures.targetNear = (x, y, range) => {
      let best: { x: number; y: number } | null = null;
      let bestD = range;
      for (const e of this.store.map.values()) {
        if (e.kind !== 'creature' || !HOSTILE.has(e.type ?? '')) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    };
    this.lighting = new Lighting(this.r);
    this.overlay = new Overlay(this.r, this.world);
    this.renderStructureIcons();
    this.world.listener = {
      chunkAdded: (k) => this.terrain.chunkAdded(k),
      chunkRemoved: (k) => {
        this.terrain.chunkRemoved(k);
        this.r.dropChunk(k);
      },
      nodeAdded: (n) => this.nodes.add(n),
      nodeChanged: (n) => this.nodes.changed(n),
      nodeRemoved: (n) => this.nodes.remove(n),
      structAdded: (s) => {
        this.structures.add(s);
        this.lighting.structAdded(s);
        this.wires.changed(s);
      },
      structRemoved: (s) => {
        this.structures.remove(s);
        this.lighting.structRemoved(s);
        this.wires.changed(s);
      },
      structChanged: (s) => {
        this.structures.changed(s);
        this.lighting.structChanged(s);
      },
      tilesChanged: (c) => this.terrain.tilesChanged(c),
    };
    this.setupUi();
    const unlock = () => this.sfx.start();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.conn.attach({ message: (m, at) => this.onMessage(m, at), closed: (reason) => this.onClosed(reason) });
    this.r.app.ticker.add(() => this.frame());
  }

  // ——— UI wiring ———

  private setupUi(): void {
    this.windows = new Windows(this.ui);
    const ctx: UiContext = {
      state: this.state,
      world: this.world,
      sfx: this.sfx,
      send: (m) => this.send(m),
      nearStations: () => this.nearStations(),
      startPlacement: (item) => this.startPlacement(item),
      startSmith: (recipe) => this.windows.show('smith', this.smithing.begin(recipe)),
      toggle: (w) => this.toggle(w),
      refresh: (w) => this.windows.refresh(w),
      close: (w) => this.windows.hide(w),
      isOpen: (w) => this.windows.isOpen(w),
      terrainCanvas: () => this.terrain.minimapCanvas(),
      notice: (t, k) => this.hud.notice(t, k),
    };
    this.ctx = ctx;
    this.inventory = new InventoryWindow(ctx);
    this.smithing = new Smithing(ctx);
    this.hud = new Hud(this.ui, ctx, [
      { label: 'Inventory', key: 'Tab', action: () => this.toggle('inventory') },
      { label: 'Build', key: 'B', action: () => this.toggle('build') },
      { label: 'Research', key: 'K', action: () => this.toggle('research') },
      { label: 'Map', key: 'M', action: () => this.toggle('map') },
      { label: 'Contracts', key: 'J', action: () => this.toggle('contracts') },
      { label: 'Factory', key: 'O', action: () => this.toggle('factory') },
      { label: 'Company', key: 'C', action: () => this.toggle('company') },
      { label: 'Standings', key: 'L', action: () => this.toggle('standings') },
      { label: 'Help', key: 'H', action: () => this.toggle('help') },
    ]);
    this.chat = new Chat(this.ui, (text) => this.send({ t: 'chat', text }));
    initSlots({
      move: (from, to, n) => this.send({ t: 'move', from, to, ...(n ? { n } : {}) }),
      quick: (from) => this.send({ t: 'quick', from }),
      dropOut: (from) => {
        if (from.s === 'inv') this.send({ t: 'drop', slot: from.i });
      },
      click: (ref) => this.slotClicked(ref),
    });
    this.hud.renderStatus();
    this.hud.renderHotbar();
    this.chat.add('', `Welcome to ${this.welcome.server.name}. ${this.welcome.server.motd} Press H for help.`, 'system');
  }

  private slotClicked(ref: SlotRef): void {
    if (ref.s === 'inv' && ref.i < 8 && !isDragging()) {
      this.send({ t: 'slot', slot: ref.i });
    }
  }

  private toggle(id: string): void {
    if (this.windows.isOpen(id)) {
      this.windows.hide(id);
      return;
    }
    switch (id) {
      case 'inventory':
        this.windows.show('inventory', this.inventory.def());
        break;
      case 'build':
        this.windows.show('build', buildWindow(this.ctx));
        break;
      case 'research':
        this.windows.show('research', researchWindow(this.ctx));
        break;
      case 'map':
        if (this.mapTab.value === 'markets') this.send({ t: 'markets' });
        this.windows.show('map', mapWindow(this.ctx, this.mapTab));
        break;
      case 'contracts':
        this.windows.show('contracts', contractsWindow(this.ctx));
        break;
      case 'help':
        this.windows.show('help', helpWindow());
        break;
      case 'factory':
        this.send({ t: 'stats' });
        this.windows.show('factory', factoryWindow(this.ctx));
        break;
      case 'company':
        this.send({ t: 'company', op: 'info' });
        this.windows.show('company', companyWindow(this.ctx));
        break;
      case 'standings':
        this.send({ t: 'standings' });
        this.lastStandings = performance.now();
        this.windows.show('standings', standingsWindow(this.ctx, this.standingsTab));
        break;
    }
  }

  private send(msg: ClientMessage): void {
    this.conn.send(msg);
  }

  /** Renders every structure item's icon from the real structure drawing. */
  private renderStructureIcons(): void {
    for (const def of STRUCTURE_BY_ID.values()) {
      if (def.id === 'crop') continue;
      const item = ITEM_BY_ID.get(def.item);
      if (!item?.place) continue;
      try {
        const view = this.structures.preview(def.id, 0, def);
        const holder = new Container();
        holder.addChild(view);
        const [w, hgt] = def.size;
        const size = Math.max(w, hgt) * TS;
        const extra = def.id === 'windmill' ? 3.6 : def.id === 'water_wheel' ? 1.6 : 1.25;
        const scale = 64 / (size * extra);
        view.scale.set(scale);
        view.position.set((64 - w * TS * scale) / 2, (64 - hgt * TS * scale) / 2);
        const canvas = this.r.app.renderer.extract.canvas({
          target: holder,
          frame: undefined,
          resolution: 1,
          clearColor: '#00000000',
        }) as HTMLCanvasElement;
        const out = document.createElement('canvas');
        out.width = out.height = 64;
        out
          .getContext('2d')!
          .drawImage(
            canvas,
            0,
            0,
            Math.min(64, canvas.width),
            Math.min(64, canvas.height),
            (64 - Math.min(64, canvas.width)) / 2,
            (64 - Math.min(64, canvas.height)) / 2,
            Math.min(64, canvas.width),
            Math.min(64, canvas.height),
          );
        setStructureIcon(item.id, out);
        holder.destroy({ children: true });
      } catch (err) {
        console.warn('icon render failed', def.id, err);
      }
    }
  }

  // ——— Messages ———

  private onMessage(msg: ServerMessage, at: number): void {
    switch (msg.t) {
      case 's':
        this.onSnapshot(msg, at);
        break;
      case 'chunk':
        this.world.addChunk(msg.cx, msg.cy, msg.n, msg.st);
        break;
      case 'unchunk':
        this.world.removeChunk(msg.cx, msg.cy);
        break;
      case 'node':
        this.world.setNode(msg.id, msg.a);
        break;
      case 'sa':
        for (const s of msg.s) this.world.addStruct(s);
        break;
      case 'sr':
        for (const id of msg.ids) this.world.removeStruct(id);
        break;
      case 'su':
        for (const u of msg.s) this.world.updateStruct(u.id, u.st);
        break;
      case 'kin':
        for (const [id, ...spin] of msg.s) this.world.setSpin(id, spin);
        for (const [id, net] of msg.of) this.world.setNet(id, net);
        this.world.networks = new Map(msg.nets.map((n) => [n.id, n]));
        break;
      case 'belt':
        this.world.beltKeyframes(msg.k);
        break;
      case 'company':
        this.state.company = msg.info;
        this.state.companyInvite = msg.invite;
        if (this.windows.isOpen('company')) this.windows.refresh('company');
        break;
      case 'power':
        this.world.powerNets = new Map(msg.nets.map(([id, supply, demand]) => [id, { supply, demand }]));
        if (msg.of) this.world.powerOf = new Map(msg.of);
        break;
      case 'fluids':
        this.world.fluidNets = new Map(msg.nets.map(([id, fluid, fill, flow]) => [id, { fluid, fill: fill / 1000, flow: flow / 10 }]));
        if (msg.of) this.world.fluidOf = new Map(msg.of);
        break;
      case 'tiles':
        this.world.applyTiles(msg.c);
        break;
      case 'inv':
        this.state.slots = msg.slots;
        this.state.sel = msg.sel;
        this.state.cap = msg.cap;
        this.hud.renderHotbar();
        this.windows.refresh(...this.windows.ids().filter((w) => ['inventory', 'build', 'server', 'contracts'].includes(w)));
        if (this.placing && this.state.count(this.placing) === 0) this.stopPlacement();
        break;
      case 'status': {
        const crestsChanged = msg.crests !== this.state.status.crests;
        this.state.status = msg;
        this.hud.renderStatus();
        // What you can afford changes with your Crests (status also arrives twice a second without them changing).
        if (crestsChanged && this.windows.isOpen('server') && (this.state.ui?.kind === 'trade' || this.state.ui?.kind === 'shop'))
          this.windows.refresh('server');
        break;
      }
      case 'research':
        this.state.research = { kp: msg.kp, unlocked: msg.unlocked, blueprints: msg.blueprints };
        this.windows.refresh(...this.windows.ids().filter((w) => ['research', 'inventory', 'build'].includes(w)));
        break;
      case 'tutorial':
        this.state.tutorial = msg;
        this.hud.renderObjective();
        break;
      case 'contracts':
        this.state.contracts = msg.list;
        this.hud.renderContracts();
        if (this.windows.isOpen('contracts')) this.windows.refresh('contracts');
        break;
      case 'ui':
        this.openServerUi(msg.ui);
        break;
      case 'uiclose':
        this.state.ui = null;
        this.windows.hide('server');
        if (this.autoInventory) this.windows.hide('inventory');
        this.autoInventory = false;
        break;
      case 'notice':
        this.hud.notice(msg.text, msg.kind);
        if (msg.kind === 'bad') this.sfx.play('miss');
        break;
      case 'chat':
        this.chat.add(msg.from, msg.text, msg.kind);
        break;
      case 'dead':
        this.state.dead = msg;
        this.deathEl?.remove();
        this.deathEl = showDeath(this.ui, msg.by, msg.crests, msg.items, () => this.send({ t: 'respawn' }));
        this.sfx.play('hurt');
        this.windows.closeAll();
        this.stopPlacement();
        break;
      case 'alive':
        this.state.dead = null;
        this.deathEl?.remove();
        this.deathEl = null;
        break;
      case 'markets':
        this.state.markets = msg.list;
        if (this.windows.isOpen('map')) this.windows.refresh('map');
        break;
      case 'towns':
        this.state.towns = new Map(msg.list.map((t) => [t.id, t]));
        if (this.windows.isOpen('map')) this.windows.refresh('map');
        this.town.setProsperity(new Map(msg.list.map((t) => [t.id, t.prosperity])));
        if (this.windows.isOpen('map')) this.windows.refresh('map');
        break;
      case 'stats':
        this.state.stats = msg;
        if (this.windows.isOpen('factory')) this.windows.refresh('factory');
        break;
      case 'standings':
        this.state.standings = msg;
        if (this.windows.isOpen('standings')) this.windows.refresh('standings');
        break;
      case 'monuments':
        this.state.monuments = msg.list;
        if (this.windows.isOpen('map')) this.windows.refresh('map');
        break;
    }
  }

  private openServerUi(ui: UiState): void {
    if (!this.windows.isOpen('server') && performance.now() - this.uiClosedAt < 700 && ui.kind !== 'station') return;
    const wasOpen =
      this.windows.isOpen('server') &&
      this.state.ui?.kind === ui.kind &&
      (this.state.ui as { id?: unknown; npc?: unknown }).id === (ui as { id?: unknown }).id;
    this.state.ui = ui;
    if (ui.kind === 'station') {
      this.inventory.forced = ui.station;
      if (!this.windows.isOpen('inventory')) this.windows.show('inventory', this.inventory.def());
      else this.windows.refresh('inventory');
      return;
    }
    const def = panelFor(ui, this.ctx);
    if (!def) return;
    def.onClose = () => {
      if (this.state.ui === ui || this.state.ui?.kind === ui.kind) {
        this.state.ui = null;
        this.uiClosedAt = performance.now();
        this.send({ t: 'close' });
        if (this.autoInventory) {
          this.autoInventory = false;
          this.windows.hide('inventory');
        }
      }
    };
    if (wasOpen) {
      // Keep the window; just re-render with the new data.
      this.windows.show('server', def);
      return;
    }
    this.windows.show('server', def);
    if (['container', 'machine', 'shop'].includes(ui.kind) && !this.windows.isOpen('inventory'))
      this.windows.show('inventory', this.inventory.def());
  }

  private onSnapshot(snap: Snapshot, at: number): void {
    this.clock.onSnapshot(snap.k, at);
    this.state.minutes = snap.tm;
    this.store.applySnapshot(snap);
    if (snap.me) this.prediction.reconcile(snap.me, this.world);
    for (const ev of snap.ev ?? []) this.onEvent(ev);
  }

  private onEvent(ev: GameEvent): void {
    const now = performance.now();
    switch (ev[0]) {
      case 'sw': {
        const e = this.store.map.get(ev[1]);
        if (e) {
          e.swingAt = now;
          e.heavy = ev[2] === 1;
          this.sfx.play('swing', e.x, e.y);
        }
        break;
      }
      case 'hit': {
        const x = ev[1] / 100;
        const y = ev[2] / 100;
        this.effects.burst(x, y, ev[3]);
        this.sfx.play(ev[3], x, y);
        break;
      }
      case 'nd':
        this.nodes.wiggle(ev[1], ev[2] / 100, ev[3] / 100);
        break;
      case 'pop':
        this.effects.text(ev[1] / 100, ev[2] / 100, ev[3], ev[4]);
        break;
      case 'dmg': {
        const e = this.store.map.get(ev[1]);
        if (e) {
          e.hurtAt = now;
          this.effects.text(e.x, e.y, String(ev[2]), ev[3] ? 0xf2c53d : 0xff6a5a, ev[3] ? 22 : 17);
          this.effects.burst(e.x, e.y, 'flesh', 5, 90);
          if (ev[1] === this.welcome.you.id) this.sfx.play('hurt');
        }
        break;
      }
      case 'sfx':
        this.sfx.play(ev[1], ev[2] / 100, ev[3] / 100);
        break;
      case 'fish': {
        const x = ev[2] / 100;
        const y = ev[3] / 100;
        this.fishing.set(ev[1], x, y, ev[4]);
        if (ev[4] === 2) {
          this.sfx.play('bite', x, y);
          this.effects.burst(x, y, 'water', 6, 80);
          if (ev[1] === this.welcome.you.id) this.effects.text(x, y, '!', 0xffe066, 30);
        }
        break;
      }
      case 'atk': {
        const e = this.store.map.get(ev[1]);
        if (e) e.attackAt = now;
        break;
      }
      case 'die': {
        const e = this.store.map.get(ev[1]);
        if (e) {
          this.effects.burst(e.x, e.y, 'flesh', 12, 140);
          this.sfx.play('die', e.x, e.y);
        }
        break;
      }
    }
  }

  private onClosed(reason: string): void {
    if (!this.running) return;
    this.running = false;
    showMessage(this.ui, reason, { label: 'Reconnect', run: () => location.reload() });
  }

  // ——— Frame ———

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const mouse = this.r.screenToWorld(this.input.mouseX, this.input.mouseY);
    this.handleKeys(mouse);

    // Fixed-rate input steps with prediction.
    this.acc += dt;
    const sent: InputTuple[] = [];
    while (this.acc >= INPUT_DT) {
      this.acc -= INPUT_DT;
      const input = this.sampleInput(mouse);
      this.prediction.apply(input, this.world);
      this.localActions(INPUT_DT, input[1], now);
      sent.push(input);
    }
    if (sent.length && !this.state.dead) this.conn.sendInputs(sent);

    this.clock.advance(dt);
    const renderTick = this.clock.renderTick;
    this.store.sample(renderTick);
    const pos = this.prediction.renderPosition(this.acc / INPUT_DT, dt);
    this.state.playerX = pos.x;
    this.state.playerY = pos.y;
    this.sfx.listenerX = pos.x;
    this.sfx.listenerY = pos.y;
    this.entities.local = {
      id: this.welcome.you.id,
      x: pos.x,
      y: pos.y,
      a: this.angle,
      swingAt: this.swingAt,
      heavy: this.heavy,
      held: this.state.held(),
      draw: this.drawT,
      charge: this.chargeT,
    };
    this.r.applyCamera(pos.x, pos.y, dt);

    this.terrain.animate(dt);
    this.nodes.animate(dt, pos.x, pos.y);
    this.structures.minutes = this.state.minutes;
    this.structures.animate(dt);
    this.town.animate(dt, pos.x, pos.y);
    this.entities.update(now);
    this.belts.update(renderTick);
    this.effects.update(dt);
    this.fishing.update(now);
    this.wires.update();
    this.lighting.update(dt, (this.state.minutes / 60) % 24);
    this.ambientEffects(now);
    this.updateOverlay(mouse, pos);
    this.hud.renderStamina(this.prediction.state.stamina);
    this.hud.update(now, pos.x, pos.y, this.angle, this.state.minutes);
    this.checkSettlement(pos.x, pos.y);
    if (this.windows.isOpen('factory') && now - this.lastStats > 2000) {
      this.lastStats = now;
      this.send({ t: 'stats' });
    }
    if (this.windows.isOpen('standings') && now - this.lastStandings > 3000) {
      this.lastStandings = now;
      this.send({ t: 'standings' });
    }
    this.input.endFrame();
  }

  private sampleInput(mouse: { x: number; y: number }): InputTuple {
    const inp = this.input;
    const typing = this.chat.typing;
    const dead = !!this.state.dead;
    let mx = 0;
    let my = 0;
    if (!typing && !dead) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) my -= 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) my += 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) mx -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) mx += 1;
    }
    const p = this.prediction.state;
    this.angle = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    let flags = 0;
    if (!typing && (inp.down('ShiftLeft') || inp.down('ShiftRight'))) flags |= InputFlags.Sprint;
    const overUi = inp.overUi || isDragging();
    const held = this.state.held();
    const def = held ? ITEM_BY_ID.get(held) : undefined;
    const left = inp.mouseLeft || inp.leftLatch;
    const right = inp.mouseRight || inp.rightLatch;
    inp.leftLatch = inp.rightLatch = false;
    if (left && !overUi && !this.placing && !def?.place && !dead && !this.smithing.active) flags |= InputFlags.Primary;
    if (right && !overUi && !this.placing && !dead) flags |= InputFlags.Secondary;
    if (this.dodgeQueued) {
      flags |= InputFlags.Dodge;
      this.dodgeQueued = false;
    }
    const kind = def?.tool?.kind;
    const blocking = (flags & InputFlags.Secondary) !== 0 && (kind === 'sword' || kind === 'club' || kind === 'spear' || kind === 'axe');
    if (blocking || (kind === 'bow' && (flags & InputFlags.Primary) !== 0)) flags |= InputFlags.Slow;
    return [++this.seq, flags, mx, my, Math.round(this.angle * 1000)];
  }

  /** Mirrors the server's swing timing so our own swings animate without delay. */
  private localActions(dt: number, flags: number, now: number): void {
    if (this.swingCd > 0) this.swingCd -= dt;
    const held = this.state.held();
    const tool = (held ? ITEM_BY_ID.get(held)?.tool : undefined) ?? FIST;
    const primary = (flags & InputFlags.Primary) !== 0;
    const was = this.prevPrimary;
    this.prevPrimary = primary;
    const swing = (heavy: boolean) => {
      this.swingCd = (1 / tool.rate) * (heavy ? 1.3 : 1);
      this.swingAt = now;
      this.heavy = heavy;
      this.sfx.play('swing');
    };
    if (tool.kind === 'bow') {
      if (primary) this.drawT += dt;
      else this.drawT = 0;
      return;
    }
    if (tool.kind === 'sword' || tool.kind === 'club' || tool.kind === 'spear') {
      if (primary && !was && this.swingCd <= 0) swing(false);
      if (primary) this.chargeT += dt;
      else if (was) {
        if (this.chargeT >= 0.5 && this.swingCd <= 0.15 && this.prediction.state.stamina >= 14) swing(true);
        this.chargeT = 0;
      }
      return;
    }
    if (primary && this.swingCd <= 0) swing(false);
  }

  // ——— Keys ———

  private handleKeys(mouse: { x: number; y: number }): void {
    const inp = this.input;
    if (this.chat.typing) return;
    // The forge takes Space and clicks itself (see Smithing); here they must not dodge or swing.
    if (this.smithing.active) {
      inp.hit('Space');
      inp.leftPressed = inp.leftLatch = false;
    }
    if (inp.hit('Enter')) {
      this.chat.open();
      return;
    }
    if (inp.hit('Slash')) {
      this.chat.open('/');
      return;
    }
    if (inp.hit('Escape')) {
      if (this.placing) this.stopPlacement();
      else this.windows.closeAll();
    }
    if (inp.hit('Tab') || inp.hit('KeyI')) this.toggle('inventory');
    if (inp.hit('KeyB')) this.toggle('build');
    if (inp.hit('KeyK')) this.toggle('research');
    if (inp.hit('KeyM')) this.toggle('map');
    if (inp.hit('KeyJ')) this.toggle('contracts');
    if (inp.hit('KeyO')) this.toggle('factory');
    if (inp.hit('KeyC')) this.toggle('company');
    if (inp.hit('KeyL')) this.toggle('standings');
    if (inp.hit('KeyH') || inp.hit('F1')) this.toggle('help');
    for (let i = 0; i < 8; i++) {
      if (inp.hit(`Digit${i + 1}`)) {
        this.send({ t: 'slot', slot: i });
        this.state.sel = i;
        this.hud.renderHotbar();
        const id = this.state.slots[i]?.id;
        if (id && ITEM_BY_ID.get(id)?.place) this.startPlacement(id);
        else this.stopPlacement();
      }
    }
    if (inp.wheel !== 0 && !inp.overUi) {
      this.r.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.r.targetZoom * (inp.wheel > 0 ? 0.88 : 1.14)));
    }
    if (inp.hit('Space')) this.dodgeQueued = true;
    if (this.state.dead) return;
    if (inp.hit('KeyQ')) {
      const s = this.state.slots[this.state.sel];
      if (s) this.send({ t: 'drop', slot: this.state.sel, n: inp.down('ControlLeft') ? s.n : 1 });
    }
    if (inp.hit('KeyF')) this.send({ t: 'pickup' });
    if (inp.hit('KeyR')) {
      if (this.placing) this.placeRot = (this.placeRot + 1) % 4;
      else {
        const s = this.world.structAt(Math.floor(mouse.x), Math.floor(mouse.y));
        if (s && s.owner === this.welcome.you.name) this.send({ t: 'rotate', id: s.id });
      }
    }
    // Placement.
    if (this.placing) {
      inp.leftLatch = inp.rightLatch = false;
      if (inp.rightPressed && !inp.overUi) this.stopPlacement();
      else if (inp.leftPressed && !inp.overUi) this.placeAt(mouse);
      else if (inp.mouseLeft && !inp.overUi && this.isDragPlaceable()) this.placeAt(mouse, true);
    } else if (inp.rightPressed && !inp.overUi) {
      this.useHeld(mouse);
    }
    // Interaction.
    if (inp.hit('KeyE') && this.target) {
      const t = this.target;
      if (t.kind === 'struct' && t.crank) {
        this.cranking = t.id;
        this.crankTimer = 0;
        this.send({ t: 'crank', id: t.id, on: true });
      } else this.send({ t: 'interact', kind: t.kind, id: t.id });
    }
    if (this.cranking) {
      if (!inp.down('KeyE')) {
        this.send({ t: 'crank', id: this.cranking, on: false });
        this.cranking = 0;
      } else if ((this.crankTimer += 1 / 60) > 0.8) {
        this.crankTimer = 0;
        this.send({ t: 'crank', id: this.cranking, on: true });
      }
    }
    if (inp.hit('KeyG')) {
      const t = this.target;
      // In the saddle G gets you down, unless you are hitching a wagon.
      if (this.riding() && !this.hitching(t)) this.send({ t: 'dismount' });
      else if (t?.kind === 'entity' && t.grab) this.send({ t: 'interact', kind: 'entity', id: t.id, op: 'grab' });
    }
  }

  /** Whether you are on a horse (your own entity carries the flag; the horse itself is not sent while ridden). */
  private riding(): boolean {
    const me = this.store.map.get(this.welcome.you.id);
    return !!me && (me.flags & EntityFlags.Mounted) !== 0;
  }

  private hitching(t: Target | null): boolean {
    return t?.kind === 'entity' && !!t.grab?.startsWith('Hitch');
  }

  private useHeld(mouse: { x: number; y: number }): void {
    const held = this.state.held();
    const def = held ? ITEM_BY_ID.get(held) : undefined;
    if (!def) return;
    if (def.food) return; // eating goes through the secondary input flag
    if (def.tool?.kind === 'hoe' || def.plant || def.animal || def.vehicle || def.backpack || def.teaches) {
      this.send({ t: 'use', slot: this.state.sel, x: mouse.x, y: mouse.y });
    }
  }

  // ——— Building ———

  private startPlacement(item: string): void {
    const def = ITEM_BY_ID.get(item);
    if (!def?.place) return;
    this.placing = item;
    this.windows.hide('build');
  }

  private stopPlacement(): void {
    this.placing = null;
    this.overlay.hideGhost();
  }

  private isDragPlaceable(): boolean {
    const t = this.placing;
    return (
      !!t &&
      ['conveyor', 'shaft', 'pipe', 'rail', 'wood_wall', 'stone_wall', 'fence', 'wood_floor', 'stone_floor', 'spike_trap'].includes(t)
    );
  }

  private lastPlaced = '';

  private placeAt(mouse: { x: number; y: number }, drag = false): void {
    const def = STRUCTURE_BY_ID.get(ITEM_BY_ID.get(this.placing!)!.place!)!;
    const [w, hgt] = rotatedSize(def, this.placeRot);
    const x = Math.floor(mouse.x - w / 2 + 0.5);
    const y = Math.floor(mouse.y - hgt / 2 + 0.5);
    const key = `${x},${y}`;
    if (drag && key === this.lastPlaced) return;
    this.lastPlaced = key;
    this.send({ t: 'place', item: this.placing!, x, y, rot: this.placeRot });
    this.sfx.play('build');
  }

  /** Approximate client-side check for the ghost colour (the server has the final say). */
  private canPlace(type: string, x: number, y: number, rot: number): boolean {
    const def = STRUCTURE_BY_ID.get(type)!;
    const [w, hgt] = rotatedSize(def, rot);
    const p = this.prediction.state;
    if (Math.hypot(x + w / 2 - p.x, y + hgt / 2 - p.y) > BUILD_RANGE) return false;
    if (this.world.settlementAt(x + w / 2, y + hgt / 2, 3)) return false;
    for (let ty = y; ty < y + hgt; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const t = this.world.tile(tx, ty);
        const info = TILES[t];
        if (def.placement === 'land' && !info.land) return false;
        if (def.placement === 'water' && !info.flowing) return false;
        if (def.placement === 'farmland' && t !== Tile.Farmland) return false;
        if (def.placement === 'any' && (t === Tile.DeepWater || t === Tile.Cliff || t === Tile.House || t === Tile.Plaza)) return false;
        if (def.layer === 'floor' ? this.world.floorAtTile(tx, ty) : this.world.structAt(tx, ty)) return false;
      }
    }
    // A drill has to stand over a vein, seam or rock.
    const vein = def.drill ? drillNode(this.world.nodesNear(x + w / 2, y + hgt / 2, Math.max(w, hgt)), x, y, w, hgt) : undefined;
    if (def.drill && (!vein || vein.def.tier > def.drill.tier)) return false;
    for (const n of this.world.nodesNear(x + w / 2, y + hgt / 2, Math.max(w, hgt))) {
      if (n === vein || !n.def.solid || n.state === 0) continue;
      const nx = Math.max(x, Math.min(n.x, x + w));
      const ny = Math.max(y, Math.min(n.y, y + hgt));
      if (Math.hypot(n.x - nx, n.y - ny) < n.def.radius) return false;
    }
    return true;
  }

  // ——— Targets, hover and overlay ———

  private nearStations(): Set<string> {
    const out = new Set<string>();
    const p = this.prediction.state;
    for (const [station, types] of Object.entries(STATION_STRUCTURES)) {
      for (let ty = Math.floor(p.y) - 4; ty <= Math.floor(p.y) + 4; ty++) {
        for (let tx = Math.floor(p.x) - 4; tx <= Math.floor(p.x) + 4; tx++) {
          const s = this.world.structAt(tx, ty);
          if (!s || !types.includes(s.type)) continue;
          const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
          const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
          if (Math.hypot(nx - p.x, ny - p.y) <= 3.5) out.add(station);
        }
      }
    }
    return out;
  }

  private findTarget(mouse: { x: number; y: number }, px: number, py: number): Target | null {
    const range = INTERACT_RANGE;
    const candidates: (Target & { d: number; m: number })[] = [];
    const add = (t: Target, dist: number) => {
      if (dist > range + 0.6) return;
      candidates.push({ ...t, d: dist, m: Math.hypot(t.x - mouse.x, t.y - mouse.y) });
    };
    for (const s of this.world.settlements) {
      if (Math.hypot(s.x - px, s.y - py) > s.radius + 4) continue;
      for (const n of s.npcs) {
        if ((n.unlock ?? 0) > (this.state.towns.get(s.id)?.prosperity ?? 0)) continue;
        const title = PROFESSION_BY_ID.get(n.profession)?.title ?? n.title;
        const verb =
          n.profession === 'board'
            ? 'Read the contract board'
            : n.profession === 'exchange'
              ? 'Use the Exchange'
              : `Trade with ${n.name} (${title})`;
        add({ kind: 'npc', id: n.id, x: n.x, y: n.y, label: verb }, Math.hypot(n.x - px, n.y - py));
      }
    }
    const seen = new Set<number>();
    for (let ty = Math.floor(py) - 3; ty <= Math.floor(py) + 3; ty++) {
      for (let tx = Math.floor(px) - 3; tx <= Math.floor(px) + 3; tx++) {
        const s = this.world.structAt(tx, ty);
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        const label = this.structLabel(s);
        if (!label) continue;
        const nx = Math.max(s.x, Math.min(px, s.x + s.w));
        const ny = Math.max(s.y, Math.min(py, s.y + s.h));
        add(
          { kind: 'struct', id: s.id, x: s.x + s.w / 2, y: s.y + s.h / 2, label, crank: s.type === 'hand_crank' },
          Math.hypot(nx - px, ny - py),
        );
      }
    }
    for (const e of this.store.map.values()) {
      if (e.kind === 'bag')
        add(
          { kind: 'entity', id: e.id, x: e.x, y: e.y, label: `Search ${e.owner ?? 'a'}'s bag (F takes all)` },
          Math.hypot(e.x - px, e.y - py),
        );
      if (e.kind === 'cart') {
        const what = e.type === 'wagon' ? 'wagon' : e.type === 'minecart' ? 'minecart' : 'cart';
        add(
          {
            kind: 'entity',
            id: e.id,
            x: e.x,
            y: e.y,
            label: `Open ${e.owner ?? ''}'s ${what}`,
            grab: e.type === 'minecart' ? 'Reverse' : e.type === 'wagon' ? 'Hitch (on a horse)' : 'Pull',
          },
          Math.hypot(e.x - px, e.y - py),
        );
      }
      if (e.kind === 'creature' && e.owner) {
        const def = CREATURE_BY_ID.get(e.type ?? '');
        const ready = (e.flags & EntityFlags.Product) !== 0;
        add(
          {
            kind: 'entity',
            id: e.id,
            x: e.x,
            y: e.y,
            label: ready ? `Collect from ${def?.name.toLowerCase()}` : `${e.owner}'s ${def?.name.toLowerCase()}`,
            grab: e.type === 'horse' ? 'Ride' : undefined,
          },
          Math.hypot(e.x - px, e.y - py) - (def?.radius ?? 0.5),
        );
      }
    }
    if (candidates.length === 0) return null;
    // Prefer what the mouse points at, then what is closest.
    candidates.sort((a, b) => (a.m < 1.2 ? a.m - 10 : a.d) - (b.m < 1.2 ? b.m - 10 : b.d));
    return candidates[0];
  }

  private structLabel(s: ClientStruct): string | null {
    const d = s.def;
    if (d.door) return s.st.open ? 'Close door' : 'Open door';
    if (d.bed) return 'Set your respawn point';
    if (s.type === 'hand_crank') return 'Hold to turn the crank';
    if (s.type === 'crop') return (s.st.stage ?? 0) >= 4 ? 'Harvest' : null;
    if (d.claimRadius) return 'Manage land claim';
    if (d.shop) return `Browse ${s.owner ?? ''}'s shop`;
    if (d.machine || d.logistics === 'filter') return `Open ${d.name}`;
    if (d.container) return `Open ${d.name}`;
    if (d.station) return `Use ${d.name}`;
    if (d.rail === 'station') return `Station: ${s.st.mode ?? 'load'} (E to change)`;
    if (d.rail) {
      const links = [0, 1, 2, 3].filter((dir) => this.world.structAt(s.x + DX[dir], s.y + DY[dir])?.def.rail).length;
      if (links >= 3) return 'Flip the switch';
    }
    return null;
  }

  private updateOverlay(mouse: { x: number; y: number }, pos: { x: number; y: number }): void {
    this.overlay.clear();
    const prompt = this.hud.prompt;
    // Build mode.
    const held = this.state.held();
    if (!this.placing && held && ITEM_BY_ID.get(held)?.place && !this.input.overUi) this.placing = held;
    if (this.placing) {
      const def = STRUCTURE_BY_ID.get(ITEM_BY_ID.get(this.placing)!.place!)!;
      const [w, hgt] = rotatedSize(def, this.placeRot);
      const x = Math.floor(mouse.x - w / 2 + 0.5);
      const y = Math.floor(mouse.y - hgt / 2 + 0.5);
      this.overlay.grid(mouse.x, mouse.y);
      const ok = this.canPlace(def.id, x, y, this.placeRot);
      this.overlay.setGhost(`${def.id}:${this.placeRot}`, () => this.structures.preview(def.id, this.placeRot, def), x, y, w, hgt, ok);
      if (def.claimRadius) this.overlay.claimArea(x, y, def.claimRadius, true);
      prompt.style.display = 'block';
      prompt.replaceChildren(
        h('kbd', null, 'Click'),
        `Place ${def.name} (${this.state.count(this.placing)})`,
        '  ',
        h('kbd', null, 'R'),
        'Rotate  ',
        h('kbd', null, 'Right click'),
        'Cancel',
      );
      this.hideHover();
      return;
    }
    this.target = this.state.dead ? null : this.findTarget(mouse, pos.x, pos.y);
    // In the saddle G dismounts, unless it hitches the wagon you ride up to.
    const riding = !this.state.dead && this.riding();
    const g = (t: Target | null) => (riding && !this.hitching(t) ? 'Dismount' : t?.kind === 'entity' && t.grab ? t.grab : null);
    if (this.target) {
      prompt.style.display = 'block';
      const t = this.target;
      const grab = g(t);
      prompt.replaceChildren(h('kbd', null, 'E'), t.label, ...(grab ? ['  ', h('kbd', null, 'G'), grab] : []));
      if (t.kind === 'struct') {
        const s = this.world.structs.get(t.id);
        if (s) this.overlay.outlineStruct(s);
      } else this.overlay.outlineCircle(t.x, t.y, 0.7);
    } else if (riding) {
      prompt.style.display = 'block';
      prompt.replaceChildren(h('kbd', null, 'G'), 'Dismount');
    } else prompt.style.display = 'none';
    this.hoverInfo(mouse);
  }

  private hoverInfo(mouse: { x: number; y: number }): void {
    if (this.input.overUi) {
      this.hideHover();
      return;
    }
    const el = this.hud.hover;
    const tx = Math.floor(mouse.x);
    const ty = Math.floor(mouse.y);
    const s = this.world.structAt(tx, ty) ?? this.world.floorAtTile(tx, ty);
    let content: HTMLElement | null = null;
    if (s) {
      content = h('div', null, h('b', null, s.def.name));
      if (s.def.monument) {
        content.append(h('div', { class: 'gold' }, `Raised by ${s.owner ?? 'someone'} · ★ ${s.def.monument.prestige} prestige`));
        if (s.def.monument.refresh) content.append(h('div', { class: 'muted' }, 'Rest nearby to get your wind back and heal faster.'));
      } else if (s.owner) content.append(h('div', { class: 'muted' }, `Owner: ${s.owner}`));
      if (s.def.kinetic || s.def.logistics === 'conveyor' || s.def.logistics === 'splitter' || s.def.logistics === 'filter') {
        const net = s.net !== undefined ? this.world.networks.get(s.net) : undefined;
        const speed = s.spin[0] ?? 0;
        if (s.def.logistics)
          content.append(
            h(
              'div',
              null,
              speed > 0
                ? `Moving ${speed.toFixed(1)} tiles/s`
                : h('span', { class: 'bad' }, 'Not moving — needs rotation from a shaft or gearbox'),
            ),
          );
        else content.append(h('div', null, `${(s.spin[s.spin.length - 1] ?? 0).toFixed(1)} RPM`));
        if (net) {
          const pct = net.cap > 0 ? Math.min(100, (net.load / net.cap) * 100) : 100;
          content.append(
            h(
              'div',
              { class: net.stalled ? 'bad' : '' },
              `Stress ${net.load.toFixed(1)} / ${net.cap.toFixed(0)}${net.stalled ? ' — OVERLOADED' : ''}${net.conflict ? ' — gears locked' : ''}`,
            ),
            h(
              'div',
              { class: 'stress' },
              h('div', { style: `width:${pct}%;background:${net.stalled ? '#e8645a' : pct > 85 ? '#f0a13c' : '#8fd45a'}` }),
            ),
          );
          this.overlay.network(net.id, net.stalled || net.conflict);
        } else if (s.def.kinetic?.role === 'consumer')
          content.append(h('div', { class: 'bad' }, 'No power — connect it to a water wheel with shafts'));
      }
      if (s.def.electric) {
        const gid = this.world.powerOf.get(s.id);
        const g = gid !== undefined ? this.world.powerNets.get(gid) : undefined;
        if (!g)
          content.append(h('div', { class: 'bad' }, s.def.electric.role === 'pole' ? 'Not connected' : 'No power pole within 3 tiles'));
        else {
          const short = g.demand > g.supply;
          content.append(
            h(
              'div',
              { class: short ? 'bad' : '' },
              `Grid: ${g.supply} power made, ${g.demand} used${short ? ` — short, everything runs at ${Math.round((g.supply / g.demand) * 100)}%` : ''}`,
            ),
          );
        }
      }
      if (s.def.fluid?.role === 'pipe' || s.def.fluid?.role === 'tank') {
        const f = this.world.fluidAt(s.id);
        if (!f?.fluid) content.append(h('div', { class: 'muted' }, 'Empty'));
        else
          content.append(
            h(
              'div',
              null,
              `${FLUID_NAMES[f.fluid as Fluid] ?? f.fluid} — ${Math.round(f.fill * 100)}% full${f.flow > 0.05 ? `, ${f.flow.toFixed(1)}/s flowing in` : ''}`,
            ),
          );
      }
      if (s.def.machine && s.st.on !== undefined)
        content.append(h('div', { class: s.st.on ? 'good' : 'muted' }, s.st.on ? 'Working' : 'Idle'));
      if (s.st.fill !== undefined) content.append(h('div', { class: 'muted' }, `${Math.round(s.st.fill * 100)}% full`));
      if (s.def.claimRadius) this.overlay.claimArea(s.x, s.y, s.def.claimRadius, s.owner === this.welcome.you.name);
    } else {
      const node = this.world
        .nodesNear(mouse.x, mouse.y, 0.1)
        .find((n) => Math.hypot(n.x - mouse.x, n.y - mouse.y) < Math.max(0.6, n.def.radius));
      if (node) {
        const toolName =
          node.def.tool === 'hand' ? 'any tool' : `${['', 'stone', 'iron', 'steel'][node.def.tier] ?? ''} ${node.def.tool}`.trim();
        content = h(
          'div',
          null,
          h('b', null, node.def.name),
          h('div', { class: 'muted' }, node.state === 0 ? 'Regrowing…' : `${node.state}% left · ${toolName}`),
        );
      } else {
        for (const e of this.store.map.values()) {
          if (e.kind !== 'creature' && e.kind !== 'player') continue;
          if (Math.hypot(e.x - mouse.x, e.y - mouse.y) > 0.7) continue;
          const def = e.kind === 'creature' ? CREATURE_BY_ID.get(e.type ?? '') : undefined;
          content = h(
            'div',
            null,
            h('b', null, def ? def.name : (e.name ?? 'Player')),
            def?.temperament === 'aggressive' ? h('div', { class: 'bad' }, 'Hostile') : null,
            e.owner ? h('div', { class: 'muted' }, `Owned by ${e.owner}`) : null,
          );
          break;
        }
      }
    }
    if (!content) {
      this.hideHover();
      return;
    }
    el.replaceChildren(content);
    el.style.display = 'block';
    el.style.left = `${Math.min(window.innerWidth - 290, this.input.mouseX + 18)}px`;
    el.style.top = `${Math.min(window.innerHeight - 120, this.input.mouseY + 18)}px`;
  }

  private hideHover(): void {
    this.hud.hover.style.display = 'none';
  }

  /** Smoke from working furnaces and engines, sparks from crushers. */
  private ambientEffects(now: number): void {
    if (now - this.lastSmoke < 180) return;
    this.lastSmoke = now;
    const v = this.r.view(1);
    for (const s of this.world.structs.values()) {
      if (!s.st.on) continue;
      if (s.x < v.x0 || s.x > v.x1 || s.y < v.y0 || s.y > v.y1) continue;
      if (
        s.type === 'furnace' ||
        s.type === 'blast_furnace' ||
        s.type === 'oven' ||
        s.type === 'boiler' ||
        s.type === 'steam_engine' ||
        s.type === 'refinery'
      ) {
        // Coal smoke from fires; white puffs of spent steam from engines.
        if (Math.random() < 0.5) this.effects.smoke(s.x + s.w / 2, s.y + 0.2, s.type === 'boiler');
      } else if (s.type === 'steam_turbine') {
        // Spent steam out of the stack at the front left, turned with the turbine.
        const [dx, dy] = [
          [-0.83, -0.84],
          [0.84, -0.83],
          [0.83, 0.84],
          [-0.84, 0.83],
        ][s.rot];
        if (Math.random() < 0.6) this.effects.smoke(s.x + s.w / 2 + dx, s.y + s.h / 2 + dy, true);
      } else if (s.type === 'drill' && Math.random() < 0.35) this.effects.burst(s.x + s.w / 2, s.y + s.h / 2, 'stone', 2, 60);
      else if (s.type === 'crusher' && Math.random() < 0.3) this.effects.burst(s.x + 0.5, s.y + 0.5, 'stone', 2, 60);
      else if (s.type === 'saw' && Math.random() < 0.3) this.effects.burst(s.x + 0.5, s.y + 0.5, 'wood', 2, 70);
      else if (s.type === 'lathe' && Math.random() < 0.35) this.effects.sparks(s.x + 0.4, s.y + 0.5, 3);
    }
  }

  private checkSettlement(x: number, y: number): void {
    const s = this.world.settlementAt(x, y);
    const id = s?.id ?? null;
    if (id === this.currentSettlement) return;
    this.currentSettlement = id;
    if (s) this.hud.notice(`Entering ${s.name}`, 'info');
  }
}
