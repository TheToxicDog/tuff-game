// Characters in the MooMoo style: a round body seen from above, two hands, the held tool swinging
// in an arc. Also creatures, NPC traders and the things lying on the ground.

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { ITEM_BY_ID, PLAYER_RADIUS, type ToolKind } from '@ironwild/shared';
import { OUTLINE, SHIRTS, SKIN, TS, arcPath, shade } from './draw';
import { itemTexture } from './structures';

export const NAME_STYLE = {
  fontFamily: 'Hammersmith One, Trebuchet MS, sans-serif',
  fontSize: 17,
  fill: 0xffffff,
  stroke: { color: 0x1a1612, width: 4 },
} as const;

export interface CharacterParts {
  root: Container;
  body: Container;
  arm: Container;
  label: Text | null;
  hp: Graphics;
  bubble: Container | null;
  skin: number;
}

const R = PLAYER_RADIUS * TS;

/** Draws a held item into the arm group (local frame: facing +x). */
export function drawHeld(arm: Container, held: string | undefined, skin: number): void {
  arm.removeChildren().forEach((c) => c.destroy());
  const g = new Graphics();
  arm.addChild(g);
  const def = held ? ITEM_BY_ID.get(held) : undefined;
  const kind: ToolKind | undefined = def?.tool?.kind;
  const color = def?.icon.color ?? 0x9aa0a6;
  const hx = R * 0.55;
  const hy = R * 0.72;
  if (kind === 'axe' || kind === 'pickaxe' || kind === 'hammer' || kind === 'hoe') {
    g.roundRect(hx - 6, hy - 4, 50, 8, 4)
      .fill(0x8a5a33)
      .stroke({ width: 3, color: OUTLINE });
    const tx = hx + 40;
    if (kind === 'axe')
      g.poly([tx, hy - 4, tx + 6, hy - 22, tx + 18, hy - 18, tx + 12, hy - 2], true)
        .fill(color)
        .stroke({ width: 3, color: OUTLINE });
    else if (kind === 'pickaxe')
      g.poly([tx - 2, hy - 26, tx + 10, hy - 20, tx + 12, hy + 20, tx - 2, hy + 26, tx + 4, hy], true)
        .fill(color)
        .stroke({ width: 3, color: OUTLINE });
    else if (kind === 'hammer')
      g.roundRect(tx - 4, hy - 14, 16, 28, 3)
        .fill(color)
        .stroke({ width: 3, color: OUTLINE });
    else
      g.poly([tx, hy - 4, tx + 14, hy - 4, tx + 14, hy + 14, tx + 6, hy + 8], true)
        .fill(color)
        .stroke({ width: 3, color: OUTLINE });
  } else if (kind === 'sword') {
    g.roundRect(hx - 8, hy - 4, 14, 8, 3)
      .fill(0x6b4a2a)
      .stroke({ width: 2, color: OUTLINE });
    g.roundRect(hx + 4, hy - 10, 6, 20, 2)
      .fill(0xc9a046)
      .stroke({ width: 2, color: OUTLINE });
    g.poly([hx + 10, hy - 5, hx + 58, hy - 2, hx + 66, hy, hx + 58, hy + 2, hx + 10, hy + 5], true)
      .fill(color)
      .stroke({ width: 3, color: OUTLINE });
  } else if (kind === 'spear') {
    g.roundRect(hx - 18, hy - 3, 84, 6, 3)
      .fill(0x8a5a33)
      .stroke({ width: 2.5, color: OUTLINE });
    g.poly([hx + 64, hy - 7, hx + 84, hy, hx + 64, hy + 7], true)
      .fill(color)
      .stroke({ width: 3, color: OUTLINE });
  } else if (kind === 'club') {
    g.poly([hx - 6, hy - 4, hx + 44, hy - 10, hx + 50, hy, hx + 44, hy + 10, hx - 6, hy + 4], true)
      .fill(color)
      .stroke({ width: 3, color: OUTLINE });
  } else if (kind === 'bow') {
    arcPath(g, R * 0.7, 0, R * 0.9, -1.2, 1.2).stroke({ width: 7, color: OUTLINE });
    arcPath(g, R * 0.7, 0, R * 0.9, -1.2, 1.2).stroke({ width: 4, color });
    g.moveTo(R * 0.7 + Math.cos(-1.2) * R * 0.9, Math.sin(-1.2) * R * 0.9)
      .lineTo(R * 0.7 + Math.cos(1.2) * R * 0.9, Math.sin(1.2) * R * 0.9)
      .stroke({ width: 1.5, color: 0xeeeeee });
  } else if (kind === 'rod') {
    g.moveTo(hx - 6, hy)
      .quadraticCurveTo(hx + 34, hy - 6, hx + 70, hy - 26)
      .stroke({ width: 6, color: OUTLINE });
    g.moveTo(hx - 6, hy)
      .quadraticCurveTo(hx + 34, hy - 6, hx + 70, hy - 26)
      .stroke({ width: 3, color });
    g.circle(hx + 6, hy + 5, 4)
      .fill(0x9aa0a6)
      .stroke({ width: 2, color: OUTLINE });
  } else if (def) {
    // Anything else is carried in front.
    const sp = new Sprite(itemTexture(def.id));
    sp.anchor.set(0.5);
    sp.width = sp.height = 30;
    sp.position.set(R * 1.15, 0);
    arm.addChild(sp);
  }
  // Hands on top.
  const hands = new Graphics();
  hands.circle(hx, hy, 8.5).fill(skin).stroke({ width: 3, color: OUTLINE });
  hands.circle(hx, -hy, 8.5).fill(skin).stroke({ width: 3, color: OUTLINE });
  arm.addChild(hands);
}

export function makeCharacter(opts: {
  look: number;
  name?: string;
  tag?: string;
  shirt?: number;
  hat?: number;
  npc?: string;
}): CharacterParts {
  const root = new Container();
  const body = new Container();
  const arm = new Container();
  const skin = SKIN[opts.look % SKIN.length];
  const shirt = opts.shirt ?? SHIRTS[opts.look % SHIRTS.length];
  body.addChild(arm);
  const torso = new Graphics();
  // Seen from above: shoulders in the shirt colour, a big round head on top.
  torso
    .ellipse(-R * 0.12, 0, R * 0.78, R * 1.02)
    .fill(shirt)
    .stroke({ width: 4, color: OUTLINE });
  torso
    .circle(R * 0.08, 0, R * 0.8)
    .fill(skin)
    .stroke({ width: 4, color: OUTLINE });
  if (opts.hat !== undefined) {
    torso
      .circle(R * 0.02, 0, R * 0.74)
      .fill(opts.hat)
      .stroke({ width: 3, color: OUTLINE });
    torso.ellipse(R * 0.42, 0, R * 0.22, R * 0.6).fill(shade(opts.hat, 0.8));
  } else {
    torso.ellipse(-R * 0.18, 0, R * 0.5, R * 0.62).fill({ color: shade(skin, 0.55), alpha: 0.9 });
  }
  body.addChild(torso);
  root.addChild(body);
  drawHeld(arm, undefined, skin);
  let label: Text | null = null;
  if (opts.name) {
    label = new Text({ text: opts.tag ? `[${opts.tag}] ${opts.name}` : opts.name, style: NAME_STYLE, resolution: 2 });
    label.anchor.set(0.5, 1);
    label.position.set(0, -R - 12);
    root.addChild(label);
  }
  const hp = new Graphics();
  hp.position.set(0, R + 14);
  root.addChild(hp);
  return { root, body, arm, label, hp, bubble: null, skin };
}

export function drawHealth(g: Graphics, pct: number, friendly: boolean, width = 56): void {
  g.clear();
  g.roundRect(-width / 2, -5, width, 10, 5).fill({ color: 0x1a1612, alpha: 0.85 });
  const w = Math.max(0, Math.min(1, pct / 100)) * (width - 4);
  if (w > 0) g.roundRect(-width / 2 + 2, -3, w, 6, 3).fill(friendly ? 0x8fd45a : 0xe8645a);
}

/** Swing offset of the arm group for a swing that started `t` seconds ago. */
export function swingAngle(t: number, heavy: boolean): number {
  const dur = heavy ? 0.42 : 0.26;
  if (t < 0 || t > dur) return 0;
  const f = t / dur;
  const amp = heavy ? 1.9 : 1.25;
  return -Math.sin(f * Math.PI) * amp;
}

// ——— Creatures ———

export function makeCreature(type: string): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  switch (type) {
    case 'rabbit':
      g.ellipse(-12, 0, 5, 5).fill(0xffffff);
      g.ellipse(0, 0, 15, 12).fill(0xc9a57a).stroke({ width: 3, color: OUTLINE });
      g.ellipse(-2, -9, 9, 3.5).fill(0xb8946a).stroke({ width: 2, color: OUTLINE });
      g.ellipse(-2, 9, 9, 3.5).fill(0xb8946a).stroke({ width: 2, color: OUTLINE });
      g.circle(13, 0, 8).fill(0xd4b088).stroke({ width: 2.5, color: OUTLINE });
      g.circle(19, -3, 1.5).fill(0x111111);
      g.circle(19, 3, 1.5).fill(0x111111);
      break;
    case 'deer':
      g.ellipse(0, 0, 32, 19).fill(0xa0703f).stroke({ width: 3.5, color: OUTLINE });
      for (const [x, y] of [
        [-12, -6],
        [-4, 8],
        [6, -8],
        [-18, 6],
      ])
        g.circle(x, y, 2.5).fill(0xf3ecd9);
      g.ellipse(34, 0, 13, 9).fill(0xb07d4a).stroke({ width: 3, color: OUTLINE });
      g.circle(45, 0, 3).fill(0x2a1a14);
      for (const s of [-1, 1]) {
        g.moveTo(30, s * 6)
          .lineTo(20, s * 26)
          .moveTo(24, s * 17)
          .lineTo(34, s * 26)
          .moveTo(22, s * 22)
          .lineTo(12, s * 28)
          .stroke({ width: 5, color: OUTLINE, cap: 'round' });
        g.moveTo(30, s * 6)
          .lineTo(20, s * 26)
          .moveTo(24, s * 17)
          .lineTo(34, s * 26)
          .moveTo(22, s * 22)
          .lineTo(12, s * 28)
          .stroke({ width: 2.5, color: 0xe6d6b0, cap: 'round' });
      }
      break;
    case 'boar':
      g.ellipse(-2, 0, 32, 23).fill(0x5a3a28).stroke({ width: 3.5, color: OUTLINE });
      g.moveTo(-28, 0).lineTo(14, 0).stroke({ width: 4, color: 0x3a2418 });
      g.circle(28, 0, 14).fill(0x6b4632).stroke({ width: 3, color: OUTLINE });
      g.ellipse(40, 0, 6, 8).fill(0xd08a80).stroke({ width: 2, color: OUTLINE });
      g.moveTo(36, -8)
        .quadraticCurveTo(44, -16, 40, -20)
        .moveTo(36, 8)
        .quadraticCurveTo(44, 16, 40, 20)
        .stroke({ width: 4, color: 0xf3ecd9, cap: 'round' });
      break;
    case 'wolf':
      g.moveTo(-26, 0).lineTo(-46, 0).stroke({ width: 9, color: OUTLINE, cap: 'round' });
      g.moveTo(-26, 0).lineTo(-46, 0).stroke({ width: 5, color: 0x7a7d84, cap: 'round' });
      g.ellipse(-2, 0, 28, 17).fill(0x8d9096).stroke({ width: 3.5, color: OUTLINE });
      g.ellipse(-6, 0, 16, 9).fill(0xa4a7ad);
      g.circle(26, 0, 13).fill(0x8d9096).stroke({ width: 3, color: OUTLINE });
      g.poly([22, -10, 16, -22, 30, -12], true).fill(0x7a7d84).stroke({ width: 2, color: OUTLINE });
      g.poly([22, 10, 16, 22, 30, 12], true).fill(0x7a7d84).stroke({ width: 2, color: OUTLINE });
      g.ellipse(38, 0, 7, 5).fill(0xa4a7ad).stroke({ width: 2, color: OUTLINE });
      g.circle(44, 0, 2.5).fill(0x111111);
      g.circle(30, -5, 2).fill(0xf2c53d);
      g.circle(30, 5, 2).fill(0xf2c53d);
      break;
    case 'bear':
      g.circle(0, 0, 50).fill(0x5b4030).stroke({ width: 4.5, color: OUTLINE });
      g.circle(-6, 0, 34).fill(0x6b4a38);
      g.circle(40, 0, 22).fill(0x6b4a38).stroke({ width: 4, color: OUTLINE });
      g.circle(34, -18, 8).fill(0x5b4030).stroke({ width: 3, color: OUTLINE });
      g.circle(34, 18, 8).fill(0x5b4030).stroke({ width: 3, color: OUTLINE });
      g.ellipse(56, 0, 9, 8).fill(0xa08060).stroke({ width: 2.5, color: OUTLINE });
      g.circle(62, 0, 3).fill(0x111111);
      break;
    case 'chicken':
      g.circle(0, 0, 15).fill(0xffffff).stroke({ width: 3, color: OUTLINE });
      g.ellipse(-4, -10, 8, 4).fill(0xe8e8e8).stroke({ width: 2, color: OUTLINE });
      g.ellipse(-4, 10, 8, 4).fill(0xe8e8e8).stroke({ width: 2, color: OUTLINE });
      g.poly([14, -3, 22, 0, 14, 3], true).fill(0xf0a13c);
      g.poly([6, -4, 10, -9, 12, -3], true).fill(0xe03b2b);
      break;
    case 'sheep':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        g.circle(Math.cos(a) * 18 - 4, Math.sin(a) * 15, 13)
          .fill(0xf3efe6)
          .stroke({ width: 2.5, color: OUTLINE });
      }
      g.circle(-4, 0, 18).fill(0xf3efe6);
      g.ellipse(24, 0, 11, 9).fill(0x333333).stroke({ width: 2.5, color: OUTLINE });
      g.ellipse(20, -9, 6, 3).fill(0x333333);
      g.ellipse(20, 9, 6, 3).fill(0x333333);
      break;
    case 'cow':
      g.ellipse(0, 0, 42, 27).fill(0xf5f5f0).stroke({ width: 4, color: OUTLINE });
      for (const [x, y, r] of [
        [-16, -8, 10],
        [8, 10, 12],
        [18, -12, 7],
        [-24, 12, 7],
      ])
        g.ellipse(x, y, r, r * 0.8).fill(0x2a2a2a);
      g.ellipse(44, 0, 16, 13).fill(0xf5f5f0).stroke({ width: 3, color: OUTLINE });
      g.ellipse(54, 0, 7, 9).fill(0xe0a0a0).stroke({ width: 2, color: OUTLINE });
      g.moveTo(40, -10).lineTo(38, -22).moveTo(40, 10).lineTo(38, 22).stroke({ width: 4, color: 0xe6d6b0, cap: 'round' });
      break;
    case 'horse':
      g.ellipse(0, 0, 42, 20).fill(0x8a5a33).stroke({ width: 4, color: OUTLINE });
      g.moveTo(-40, 0).lineTo(-54, 0).stroke({ width: 8, color: 0x3a2515, cap: 'round' });
      g.ellipse(46, 0, 20, 11).fill(0x9a6a40).stroke({ width: 3, color: OUTLINE });
      g.moveTo(10, 0).lineTo(40, 0).stroke({ width: 7, color: 0x3a2515 });
      g.circle(60, 0, 3).fill(0x111111);
      break;
    case 'bandit': {
      const parts = makeCharacter({ look: 3, shirt: 0x5a2a2a, hat: 0xa0302a });
      drawHeld(parts.arm, 'wooden_club', parts.skin);
      c.removeChildren();
      c.addChild(parts.root);
      (c as Container & { arm?: Container }).arm = parts.arm;
      return c;
    }
    default:
      g.circle(0, 0, 20).fill(0x888888).stroke({ width: 3, color: OUTLINE });
  }
  return c;
}

// ——— Ground things ———

export function makeDrop(item: string, n: number): Container {
  const c = new Container();
  const shadow = new Graphics().ellipse(0, 12, 14, 5).fill({ color: 0x000000, alpha: 0.22 });
  const sp = new Sprite(itemTexture(item));
  sp.anchor.set(0.5);
  sp.width = sp.height = 30;
  c.addChild(shadow, sp);
  if (n > 1) {
    const t = new Text({ text: String(n), style: { ...NAME_STYLE, fontSize: 13 }, resolution: 2 });
    t.anchor.set(0, 0);
    t.position.set(6, 2);
    c.addChild(t);
  }
  (c as Container & { bob?: Sprite }).bob = sp;
  return c;
}

export function makeBag(): Container {
  const g = new Graphics();
  g.ellipse(0, 14, 18, 6).fill({ color: 0x000000, alpha: 0.2 });
  g.moveTo(-14, -2)
    .quadraticCurveTo(-20, 18, 0, 18)
    .quadraticCurveTo(20, 18, 14, -2)
    .closePath()
    .fill(0xa07a4a)
    .stroke({ width: 3, color: OUTLINE });
  g.roundRect(-8, -12, 16, 10, 3).fill(0x8a6a3a).stroke({ width: 2.5, color: OUTLINE });
  g.moveTo(-9, -3).lineTo(9, -3).stroke({ width: 3, color: 0x5a3a20 });
  const c = new Container();
  c.addChild(g);
  return c;
}

export function makeArrow(): Container {
  const g = new Graphics();
  g.moveTo(-18, 0).lineTo(14, 0).stroke({ width: 3, color: 0x8a5a33 });
  g.poly([14, -4, 22, 0, 14, 4], true).fill(0x9aa0a6);
  g.poly([-18, 0, -24, -4, -20, 0, -24, 4], true).fill(0xe8e2d4);
  const c = new Container();
  c.addChild(g);
  return c;
}

export function makeCart(): Container {
  const g = new Graphics();
  g.roundRect(-30, -24, 14, 10, 3).fill(0x3a2a1a).stroke({ width: 2, color: OUTLINE });
  g.roundRect(-30, 14, 14, 10, 3).fill(0x3a2a1a).stroke({ width: 2, color: OUTLINE });
  g.roundRect(-34, -18, 52, 36, 5).fill(0x9a6b3f).stroke({ width: 4, color: OUTLINE });
  for (let i = 1; i < 4; i++)
    g.moveTo(-34 + i * 13, -18)
      .lineTo(-34 + i * 13, 18)
      .stroke({ width: 2, color: 0x7a5230 });
  g.moveTo(18, -10).lineTo(40, 0).lineTo(18, 10).stroke({ width: 4, color: 0x7a5230 });
  const c = new Container();
  c.addChild(g);
  return c;
}
