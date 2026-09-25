// Views for replicated entities: builds a drawing when an entity appears, positions and animates
// it every frame (swings, hurt flashes, health bars, farm animals with produce).

import { Container, Graphics, Sprite } from 'pixi.js';
import { CREATURE_BY_ID, EntityFlags } from '@ironwild/shared';
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
  swingAngle,
  type CharacterParts,
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
}

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

  private spawn(e: EntityView): void {
    let root: Container;
    let parts: CharacterParts | null = null;
    let body: Container | null = null;
    let hp: Graphics | null = null;
    let layer: 'entities' | 'drops' = 'entities';
    switch (e.kind) {
      case 'player':
        parts = makeCharacter({ look: e.look ?? 0, name: e.name, tag: e.tag });
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
        body = makeCart();
        root.addChild(body);
        break;
    }
    root.position.set(e.x * TS, e.y * TS);
    this.r.layers[layer].addChild(root);
    this.views.set(e.id, { e, root, parts, body, hp, bubble: null, held: e.held });
  }

  private despawn(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.root.destroy({ children: true });
    this.views.delete(id);
  }

  update(now: number): void {
    const t = now / 1000;
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
      if (e.dirty || held !== v.held) {
        e.dirty = false;
        v.held = held;
        if (v.parts) {
          drawHeld(v.parts.arm, held, v.parts.skin);
          if (v.parts.label && e.name) v.parts.label.text = e.tag ? `[${e.tag}] ${e.name}` : e.name;
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
        if (show) drawHealth(v.hp, e.hp, e.kind === 'player', e.kind === 'player' ? 56 : 46);
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
