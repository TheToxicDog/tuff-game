// Views for replicated entities: characters (players, zombies), corpses and items on the ground.
// Entities outside the local player's line of sight fade out — the top-down camera must not show
// what the character cannot see (design plan §85).

import { Container, Graphics, Sprite, Texture, type Texture as TextureType } from 'pixi.js';
import { CorpseFlags, EntityKind, PlayerFlags, pointInPolygon, type ContentRegistry } from '@tuff/shared';
import type { RemoteEntity } from '../game/entities';
import type { EntityListener } from '../game/entities';
import { itemIconCanvas } from '../ui/icons';
import { CharacterView, CorpseView, zombiePose } from './characters';
import type { WorldLayers } from './renderer';
import { shadowTexture } from './textures';

class ItemView {
  readonly root = new Container();

  constructor(texture: TextureType) {
    const shadow = new Graphics();
    shadow.ellipse(0.03, 0.05, 0.24, 0.2).fill({ color: 0x000000, alpha: 0.35 });
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.width = s.height = 0.5;
    this.root.addChild(shadow, s);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

type View = CharacterView | CorpseView | ItemView;

export interface VisibilityInfo {
  polygon: number[];
  x: number;
  y: number;
}

export class EntityViews implements EntityListener {
  private readonly views = new Map<number, View>();
  private readonly shadow = shadowTexture();
  private readonly iconTextures = new Map<string, Texture>();
  private readonly lastPos = new Map<number, { x: number; y: number; stride: number }>();
  selfId = 0;
  showNames = true;
  /** Called for footsteps of visible, moving characters (for positional audio). */
  onStep: ((x: number, y: number, zombie: boolean, running: boolean) => void) | null = null;

  constructor(
    private readonly layers: WorldLayers,
    private readonly content: ContentRegistry,
  ) {}

  private iconTexture(itemIndex: number): Texture {
    const def = this.content.itemAt(itemIndex - 1);
    const key = def?.id ?? '?';
    let t = this.iconTextures.get(key);
    if (!t) {
      t = Texture.from(itemIconCanvas(def));
      this.iconTextures.set(key, t);
    }
    return t;
  }

  spawned(e: RemoteEntity): void {
    let view: View;
    switch (e.kind) {
      case EntityKind.Player: {
        const v = new CharacterView(false, e.net.look, this.shadow, e.id === this.selfId ? undefined : e.net.name);
        this.layers.entities.addChild(v.root);
        view = v;
        break;
      }
      case EntityKind.Zombie: {
        const v = new CharacterView(true, e.net.look, this.shadow);
        this.layers.entities.addChild(v.root);
        view = v;
        break;
      }
      case EntityKind.Corpse: {
        const v = new CorpseView(e.net.look, (e.net.flags & CorpseFlags.Player) !== 0, e.net.angle, e.net.name);
        v.root.position.set(e.net.x, e.net.y);
        this.layers.corpses.addChild(v.root);
        view = v;
        break;
      }
      default: {
        const v = new ItemView(this.iconTexture(e.net.item));
        v.root.position.set(e.net.x, e.net.y);
        v.root.rotation = e.net.angle * 0.3;
        this.layers.items.addChild(v.root);
        view = v;
      }
    }
    // Fade in rather than pop.
    const root = view.root;
    root.alpha = 0;
    e.alpha = 0;
    e.view = view;
    this.views.set(e.id, view);
  }

  despawned(e: RemoteEntity): void {
    const v = this.views.get(e.id);
    if (!v) return;
    v.destroy();
    this.views.delete(e.id);
    this.lastPos.delete(e.id);
  }

  view(id: number): View | undefined {
    return this.views.get(id);
  }

  character(id: number): CharacterView | undefined {
    const v = this.views.get(id);
    return v instanceof CharacterView ? v : undefined;
  }

  update(dt: number, entities: Iterable<RemoteEntity>, vis: VisibilityInfo): void {
    for (const e of entities) {
      const view = e.view as View | null;
      if (!view) continue;
      const self = e.id === this.selfId;
      // Visible if inside the line-of-sight polygon, or close enough to sense.
      const dx = e.x - vis.x;
      const dy = e.y - vis.y;
      const near = dx * dx + dy * dy < 1.4 * 1.4;
      const inSight = self || near || (vis.polygon.length >= 6 && pointInPolygon(e.x, e.y, vis.polygon));
      e.visible = inSight;
      const fade = e.kind === EntityKind.Corpse || e.kind === EntityKind.Item ? 3 : 7;
      e.alpha += ((inSight ? 1 : 0) - e.alpha) * Math.min(1, dt * fade);
      view.root.alpha = e.alpha;
      view.root.visible = e.alpha > 0.01;

      if (view instanceof CharacterView) {
        if (self) continue; // The local player is posed by the game from prediction.
        const last = this.lastPos.get(e.id) ?? { x: e.x, y: e.y, stride: 0 };
        const moved = Math.hypot(e.x - last.x, e.y - last.y);
        const speed = dt > 0 ? Math.min(8, moved / dt) : 0;
        last.x = e.x;
        last.y = e.y;
        last.stride += moved;
        const strideLen = e.kind === EntityKind.Zombie ? 0.75 : 0.9;
        if (last.stride > strideLen) {
          last.stride = 0;
          if (e.visible || e.kind === EntityKind.Zombie) this.onStep?.(e.x, e.y, e.kind === EntityKind.Zombie, speed > 3.2);
        }
        this.lastPos.set(e.id, last);
        if (!view.root.visible) continue;
        if (e.kind === EntityKind.Player) {
          const f = e.net.flags;
          const def = e.net.item ? this.content.itemAt(e.net.item - 1) : undefined;
          view.setHeld(def?.icon, parseInt((def?.color ?? '#777777').slice(1), 16), !!def?.firearm, !!def?.melee);
          view.setLabelVisible(this.showNames);
          view.update(dt, e.x, e.y, e.angle, speed, {
            aiming: (f & PlayerFlags.Aiming) !== 0,
            crouching: (f & PlayerFlags.Crouching) !== 0,
            reloading: (f & PlayerFlags.Reloading) !== 0,
            windup: false,
            lunge: false,
            stagger: false,
            prone: false,
          });
        } else {
          view.update(dt, e.x, e.y, e.angle, speed, {
            aiming: false,
            crouching: false,
            reloading: false,
            windup: false,
            ...zombiePose(e.net.anim),
          });
        }
      } else if (view instanceof CorpseView) {
        view.setLooted((e.net.flags & CorpseFlags.Looted) !== 0);
        const d2 = dx * dx + dy * dy;
        view.setLabelVisible(e.visible && d2 < 25);
      }
    }
  }

  clear(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.lastPos.clear();
  }
}
