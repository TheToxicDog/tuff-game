// Views for replicated entities: builds a drawing when an entity appears, positions and animates
// it every frame (swings, hurt flashes, health bars, farm animals with produce, the horse or truck
// under a rider).

import { Container, Graphics, Sprite } from 'pixi.js';
import { CREATURE_BY_ID, EntityFlags, angleDiff } from '@ironwild/shared';
import type { EntityStore, EntityView } from '../game/entities';
import {
  drawHealth,
  drawHeld,
  makeArrow,
  makeBag,
  makeCart,
  makeCharacter,
  makeCreature,
  makeDrop,
  setTitle,
  TRUCK_SCALE,
  swingAngle,
  type CharacterParts,
  type Humanoid,
} from './characters';
import { OUTLINE, TS } from './draw';
import type { Renderer } from './renderer';
import { itemTexture } from './structures';

interface View {
  e: EntityView;
  root: Container;
  parts: CharacterParts | null;
  body: Container | null;
  hp: Graphics | null;
  bubble: Container | null;
  held: string | undefined;
  /** The horse or truck drawn under a rider, facing where they travel. */
  mount: Container | null;
  mountKind: string | undefined;
  heading: number;
  lastX: number;
  lastY: number;
}

/** A truck's exhaust stack in its own frame (pixels, facing +x; the drawing is scaled by TRUCK_SCALE). */
const EXHAUST = { x: -30 * TRUCK_SCALE, y: -22 * TRUCK_SCALE };

export interface LocalOverride {
  id: number;
  x: number;
  y: number;
  a: number;
  swingAt: number;
  heavy: boolean;
  held: string | undefined;
  draw: number;
  charge: number;
}

export class EntityViews {
  private readonly views = new Map<number, View>();
  local: LocalOverride | null = null;
  private lastNow = 0;

  constructor(
    private readonly r: Renderer,
    store: EntityStore,
  ) {
    store.onSpawn = (e) => this.spawn(e);
    store.onDespawn = (e) => this.despawn(e.id);
  }

  view(id: number): View | undefined {
    return this.views.get(id);
  }

  /** A player's rod tip in world pixels (for fishing lines). */
  rodTip(id: number): { x: number; y: number } | null {
    const v = this.views.get(id);
    if (!v?.parts) return null;
    const R = 0.42 * TS;
    const p = this.r.world.toLocal(v.parts.arm.toGlobal({ x: R * 0.55 + 70, y: R * 0.72 - 26 }));
    return { x: p.x, y: p.y };
  }

  private spawn(e: EntityView): void {
    let root: Container;
    let parts: CharacterParts | null = null;
    let body: Container | null = null;
    let hp: Graphics | null = null;
    let layer: 'entities' | 'drops' = 'entities';
    switch (e.kind) {
      case 'player':
        parts = makeCharacter({ look: e.look ?? 0, name: e.name, tag: e.tag, title: e.title });
        drawHeld(parts.arm, e.held, parts.skin);
        root = parts.root;
        body = parts.body;
        hp = parts.hp;
        break;
      case 'creature': {
        root = new Container();
        body = makeCreature(e.type ?? '');
        root.addChild(body);
        hp = new Graphics();
        const def = CREATURE_BY_ID.get(e.type ?? '');
        hp.position.set(0, (def?.radius ?? 0.5) * TS + 12);
        root.addChild(hp);
        break;
      }
      case 'drop':
        root = makeDrop(e.type ?? 'stone', e.n ?? 1);
        layer = 'drops';
        break;
      case 'bag':
        root = makeBag();
        layer = 'drops';
        break;
      case 'arrow':
        root = makeArrow();
        body = root;
        break;
      case 'cart':
        root = new Container();
        body = makeCart(e.type, e.n);
        root.addChild(body);
        root.zIndex = -1;
        break;
    }
    root.position.set(e.x * TS, e.y * TS);
    this.r.layers[layer].addChild(root);
    this.views.set(e.id, {
      e,
      root,
      parts,
      body,
      hp,
      bubble: null,
      held: e.held,
      mount: null,
      mountKind: undefined,
      heading: e.a,
      lastX: e.x,
      lastY: e.y,
    });
  }

  /** Puts a horse or truck under a rider (or takes it away), keeping its heading. */
  private setMount(v: View, kind: string | undefined): void {
    v.mount?.destroy({ children: true });
    v.mount = null;
    v.mountKind = kind;
    if (!kind || !v.parts) return;
    v.mount = kind === 'truck' ? makeCart('truck', v.e.n ?? 0) : makeCreature(kind);
    v.mount.rotation = v.heading;
    v.parts.root.addChildAt(v.mount, 0);
  }

  /** Where the exhaust of each truck being driven is, in tiles. */
  exhausts(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const v of this.views.values()) {
      if (v.mountKind !== 'truck' || !v.mount) continue;
      const c = Math.cos(v.heading);
      const s = Math.sin(v.heading);
      out.push({
        x: (v.root.x + EXHAUST.x * c - EXHAUST.y * s) / TS,
        y: (v.root.y + EXHAUST.x * s + EXHAUST.y * c) / TS,
      });
    }
    return out;
  }

  private despawn(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.root.destroy({ children: true });
    this.views.delete(id);
  }

  update(now: number): void {
    const t = now / 1000;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    for (const v of this.views.values()) {
      const e = v.e;
      let x = e.x;
      let y = e.y;
      let a = e.a;
      let swingAt = e.swingAt;
      let heavy = e.heavy;
      let held = e.held;
      if (this.local && e.id === this.local.id) {
        x = this.local.x;
        y = this.local.y;
        a = this.local.a;
        swingAt = this.local.swingAt;
        heavy = this.local.heavy;
        held = this.local.held;
      }
      v.root.position.set(x * TS, y * TS);
      if (v.body) v.body.rotation = a;
      if (v.parts) {
        const kind = e.flags & (EntityFlags.Mounted | EntityFlags.Driving) ? e.mount : undefined;
        if (kind !== v.mountKind) this.setMount(v, kind);
        // The mount turns toward the way it moves; the rider still faces where they aim.
        const mx = x - v.lastX;
        const my = y - v.lastY;
        if (mx * mx + my * my > 1e-6) v.heading += angleDiff(Math.atan2(my, mx), v.heading) * Math.min(1, dt * 10);
        if (v.mount) v.mount.rotation = v.heading;
        v.lastX = x;
        v.lastY = y;
      }
      if (e.dirty || held !== v.held) {
        e.dirty = false;
        v.held = held;
        if (v.parts) {
          drawHeld(v.parts.arm, held, v.parts.skin);
          if (v.parts.label && e.name) v.parts.label.text = e.tag ? `[${e.tag}] ${e.name}` : e.name;
          setTitle(v.parts, e.title);
          // A truck's load changed: redraw it.
          if (v.mountKind === 'truck') this.setMount(v, 'truck');
        } else if (e.kind === 'cart' && v.body) {
          // Cargo changed: redraw.
          const next = makeCart(e.type, e.n);
          next.rotation = v.body.rotation;
          v.root.addChildAt(next, v.root.getChildIndex(v.body));
          v.body.destroy({ children: true });
          v.body = next;
        }
      }
      if (v.parts) {
        let armRot = swingAngle((now - swingAt) / 1000, heavy);
        const drawing = this.local && e.id === this.local.id ? this.local.draw > 0 : (e.flags & EntityFlags.Drawing) !== 0;
        const charging = this.local && e.id === this.local.id ? this.local.charge > 0.2 : (e.flags & EntityFlags.Charging) !== 0;
        if (charging) armRot = 0.5 + Math.sin(t * 20) * 0.05;
        if (e.flags & EntityFlags.Blocking) armRot = -0.9;
        if (drawing) v.parts.arm.scale.x = 0.9;
        else v.parts.arm.scale.x = 1;
        v.parts.arm.rotation = armRot;
        v.parts.body.alpha = e.flags & EntityFlags.Dodging ? 0.6 : 1;
        v.parts.root.visible = !(e.flags & EntityFlags.Sleeping);
      }
      if (v.hp) {
        const show = e.kind === 'player' || e.hp < 100;
        v.hp.visible = show;
        // Players and hired guards get the friendly (green) bar.
        if (show) drawHealth(v.hp, e.hp, e.kind === 'player' || e.type === 'guard', e.kind === 'player' ? 56 : 46);
      }
      // Hurt flash.
      const hurt = now - e.hurtAt < 160 || (e.flags & EntityFlags.Hurt) !== 0;
      if (v.body) v.body.tint = hurt ? 0xff9090 : 0xffffff;
      // Creature attack wind-up: a lunge.
      if (e.kind === 'creature' && v.body) {
        const since = (now - e.attackAt) / 1000;
        const lunge = since >= 0 && since < 0.45 ? Math.sin((since / 0.45) * Math.PI) * 10 : 0;
        v.body.position.set(Math.cos(a) * lunge, Math.sin(a) * lunge);
        const busy = (e.flags & EntityFlags.Busy) !== 0;
        v.body.scale.set(busy ? 1.06 : 1);
        // People (bandits, guards) swing their weapon as the blow lands.
        const arm = (v.body as Humanoid).arm;
        if (arm) arm.rotation = swingAngle(since - 0.2, false);
        this.updateBubble(v, (e.flags & EntityFlags.Product) !== 0);
      }
      if (e.kind === 'drop') {
        const bob = (v.root as Container & { bob?: Sprite }).bob;
        if (bob) bob.y = Math.sin(t * 3 + e.id) * 3 - 3;
      }
    }
  }

  private updateBubble(v: View, show: boolean): void {
    if (!show) {
      if (v.bubble) {
        v.bubble.destroy({ children: true });
        v.bubble = null;
      }
      return;
    }
    if (v.bubble) return;
    const product = CREATURE_BY_ID.get(v.e.type ?? '')?.product?.item;
    if (!product) return;
    const b = new Container();
    b.addChild(new Graphics().circle(0, 0, 17).fill(0xffffff).stroke({ width: 3, color: OUTLINE }));
    const sp = new Sprite(itemTexture(product));
    sp.anchor.set(0.5);
    sp.width = sp.height = 24;
    b.addChild(sp);
    b.position.set(0, -(CREATURE_BY_ID.get(v.e.type ?? '')?.radius ?? 0.5) * TS - 26);
    v.root.addChild(b);
    v.bubble = b;
  }
}
