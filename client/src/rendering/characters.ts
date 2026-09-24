// Top-down characters: players, zombies and corpses, built from simple parts (shadow, feet, torso,
// arms, head, held item) that are animated with transforms rather than redrawn every frame.

import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { angleDelta, clamp, ZombieAnim } from '@tuff/shared';
import { drawHeldItem, holdStyle, type HoldStyle } from './held-items';
import { darken, playerLook, zombieLook, type Look } from './looks';

const SHOULDER = 0.2;
const ARM_LEN = 0.34;

function drawArm(g: Graphics, sleeve: number, skin: number, zombie: boolean): void {
  g.clear();
  g.roundRect(0, -0.055, ARM_LEN, 0.11, 0.055).fill(sleeve);
  g.circle(ARM_LEN, 0, 0.062).fill(skin);
  if (zombie) g.circle(ARM_LEN + 0.04, 0, 0.035).fill(darken(skin, 0.8));
}

function drawTorso(g: Graphics, look: Look, zombie: boolean): void {
  g.clear();
  const w = 0.3 * look.build;
  g.ellipse(0, 0, 0.17 * look.build, w).fill(look.top);
  g.ellipse(-0.03, 0, 0.1 * look.build, w * 0.82).fill({ color: look.topDark, alpha: 0.55 });
  if (zombie && look.gore > 0.3) {
    g.ellipse(0.05, -0.08, 0.06, 0.09).fill({ color: 0x4a0c08, alpha: 0.75 * look.gore });
    g.ellipse(-0.04, 0.12, 0.05, 0.06).fill({ color: 0x5a100a, alpha: 0.6 * look.gore });
  }
}

function drawHead(g: Graphics, look: Look, zombie: boolean): void {
  g.clear();
  g.circle(0, 0, 0.13).fill(look.skin);
  if (!look.bald) {
    g.circle(-0.025, 0, 0.12).fill(look.hair);
    g.ellipse(0.065, 0, 0.05, 0.1).fill(look.skin);
  }
  if (zombie) {
    g.circle(0.06, -0.04, 0.022).fill(0x2a2a1a);
    if (look.gore > 0.5) g.circle(-0.02, 0.06, 0.035).fill({ color: 0x5a0e0a, alpha: 0.8 });
  }
}

function drawFoot(g: Graphics, color: number): void {
  g.clear();
  g.roundRect(-0.07, -0.045, 0.14, 0.09, 0.04).fill(color);
}

/** A standing character (player or zombie). */
export class CharacterView {
  readonly root = new Container();
  private readonly shadow: Sprite;
  private readonly footL = new Graphics();
  private readonly footR = new Graphics();
  private readonly body = new Container();
  private readonly torso = new Graphics();
  private readonly armL = new Graphics();
  private readonly armR = new Graphics();
  private readonly head = new Graphics();
  private readonly held = new Graphics();
  private readonly prone = new Graphics();
  private label: Text | null = null;
  private heldKey = '';
  private hold: HoldStyle = 'none';
  private phase = 0;
  private swingT = 10;
  private swingDir = 1;
  private shoveT = 10;
  private recoilT = 10;
  private hitFlash = 0;
  private proneAmount = 0;
  readonly look: Look;

  constructor(
    readonly zombie: boolean,
    seed: number,
    shadowTex: Texture,
    name?: string,
  ) {
    this.look = zombie ? zombieLook(seed) : playerLook(seed);
    this.shadow = new Sprite(shadowTex);
    this.shadow.anchor.set(0.5);
    this.shadow.width = 0.9;
    this.shadow.height = 0.8;
    this.shadow.position.set(0.05, 0.07);
    drawFoot(this.footL, this.look.shoes);
    drawFoot(this.footR, this.look.shoes);
    drawTorso(this.torso, this.look, zombie);
    const sleeve = zombie ? darken(this.look.top, 0.9) : this.look.top;
    drawArm(this.armL, sleeve, this.look.skin, zombie);
    drawArm(this.armR, sleeve, this.look.skin, zombie);
    drawHead(this.head, this.look, zombie);
    drawProne(this.prone, this.look, zombie);
    this.prone.visible = false;
    this.body.addChild(this.footL, this.footR, this.armL, this.armR, this.held, this.torso, this.head);
    this.root.addChild(this.shadow, this.prone, this.body);
    if (name) {
      this.label = new Text({
        text: name,
        style: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 28,
          fill: 0xe8e4d8,
          fontWeight: '600',
          stroke: { color: 0x000000, width: 4 },
        },
      });
      this.label.anchor.set(0.5, 1);
      this.label.scale.set(1 / 80);
      this.label.position.set(0, -0.55);
      this.root.addChild(this.label);
    }
  }

  setHeld(icon: string | undefined, color: number, firearm: boolean, melee: boolean): void {
    const key = `${icon ?? ''}`;
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.hold = holdStyle(icon, firearm, melee);
    drawHeldItem(this.held, icon, color);
  }

  /** Swing animation (called when a melee event arrives or the local player swings). */
  swing(): void {
    this.swingT = 0;
    this.swingDir = -this.swingDir;
  }

  shove(): void {
    this.shoveT = 0;
  }

  recoil(): void {
    this.recoilT = 0;
  }

  flash(): void {
    this.hitFlash = 1;
  }

  /**
   * Poses the character. `angle` is the facing, `speed` in m/s, `flags` from replication.
   */
  update(dt: number, x: number, y: number, angle: number, speed: number, opts: PoseOptions): void {
    this.root.position.set(x, y);
    // The label should stay upright; everything else rotates with the facing.
    this.body.rotation = angle;
    this.prone.rotation = angle;
    this.swingT += dt;
    this.shoveT += dt;
    this.recoilT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    const moving = speed > 0.15;
    this.phase += dt * (moving ? 4 + speed * 2.2 : 0);
    const stride = moving ? Math.sin(this.phase) : 0;

    const proneTarget = opts.prone ? 1 : 0;
    this.proneAmount += (proneTarget - this.proneAmount) * Math.min(1, dt * (opts.prone ? 9 : 4));
    const lying = this.proneAmount > 0.5;
    this.prone.visible = lying;
    this.body.visible = !lying;
    this.shadow.visible = !lying;
    if (lying) {
      this.prone.alpha = 1;
      return;
    }

    // Feet alternate ahead/behind while walking.
    const footSwing = 0.13 * stride * Math.min(1, speed / 2.5 + 0.3);
    this.footL.position.set(0.02 + footSwing, -0.1);
    this.footR.position.set(0.02 - footSwing, 0.1);
    this.footL.visible = this.footR.visible = moving || opts.crouching;

    // Torso sway and lean.
    let lean = opts.crouching ? -0.02 : 0;
    if (opts.lunge) lean += 0.1;
    if (opts.stagger) lean -= 0.12;
    this.torso.rotation = stride * 0.07;
    this.torso.position.set(lean, 0);
    this.head.position.set(lean + 0.03 + (opts.lunge ? 0.05 : 0), stride * 0.012);
    const crouchScale = opts.crouching ? 0.92 : 1;
    this.body.scale.set(crouchScale);

    // Hands.
    let lx = 0.12;
    let ly = -0.24;
    let rx = 0.12;
    let ry = 0.24;
    let heldAngle = 0;
    let heldX = 0;
    let heldY = 0;
    if (this.zombie) {
      const reach = opts.lunge ? 0.62 : 0.46;
      lx = reach + stride * 0.05;
      ly = -0.17;
      rx = reach - stride * 0.05;
      ry = 0.17;
    } else {
      switch (this.hold) {
        case 'handgun': {
          const kick = this.recoilT < 0.08 ? -0.05 * (1 - this.recoilT / 0.08) : 0;
          const ext = opts.aiming ? 0.5 : 0.42;
          lx = rx = ext + kick;
          ly = -0.03;
          ry = 0.04;
          heldX = rx + 0.02;
          heldY = 0.02;
          break;
        }
        case 'long': {
          const kick = this.recoilT < 0.1 ? -0.07 * (1 - this.recoilT / 0.1) : 0;
          rx = 0.22 + kick;
          ry = 0.12;
          lx = 0.55 + kick;
          ly = -0.01;
          heldX = rx - 0.02;
          heldY = 0.06;
          heldAngle = -0.08;
          break;
        }
        case 'melee': {
          // Wind-up cocks the weapon back; the swing sweeps across the front.
          let a = 0.35 * this.swingDir;
          if (opts.windup) a = 1.35 * -this.swingDir;
          if (this.swingT < 0.2) {
            const t = this.swingT / 0.2;
            a = (1.35 - 2.6 * easeOut(t)) * -this.swingDir;
          }
          const r = 0.34;
          rx = Math.cos(a) * r + 0.08;
          ry = Math.sin(a) * r + 0.12;
          lx = 0.18;
          ly = -0.18;
          heldX = rx;
          heldY = ry;
          heldAngle = a * 0.9;
          break;
        }
        case 'item':
          rx = 0.32;
          ry = 0.16;
          heldX = rx;
          heldY = ry;
          break;
        default:
          lx = 0.1 + stride * 0.08;
          rx = 0.1 - stride * 0.08;
          break;
      }
      if (opts.reloading && this.hold !== 'melee') {
        lx -= 0.12;
        ly += 0.1;
        heldAngle += 0.5;
      }
      if (this.shoveT < 0.22) {
        const t = 1 - Math.abs(this.shoveT / 0.11 - 1);
        lx = 0.22 + 0.34 * t;
        rx = lx;
        ly = -0.15;
        ry = 0.15;
      }
    }
    this.poseArm(this.armL, -SHOULDER * this.look.build, lx, ly);
    this.poseArm(this.armR, SHOULDER * this.look.build, rx, ry);
    this.held.visible = !this.zombie && this.hold !== 'none';
    this.held.position.set(heldX, heldY);
    this.held.rotation = heldAngle;
    const tint = this.hitFlash > 0 ? 0xffffff : 0xffffff;
    this.torso.tint = tint;
    this.body.alpha = 1;
    if (this.hitFlash > 0) this.torso.tint = mixTint(0xffffff, 0xff9080, this.hitFlash);
  }

  private poseArm(arm: Graphics, shoulderY: number, hx: number, hy: number): void {
    arm.position.set(0.0, shoulderY);
    const dx = hx;
    const dy = hy - shoulderY;
    arm.rotation = Math.atan2(dy, dx);
    arm.scale.x = clamp(Math.hypot(dx, dy) / ARM_LEN, 0.4, 1.35);
  }

  setLabelVisible(v: boolean): void {
    if (this.label) this.label.visible = v;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

export interface PoseOptions {
  aiming: boolean;
  crouching: boolean;
  reloading: boolean;
  windup: boolean;
  lunge: boolean;
  stagger: boolean;
  prone: boolean;
}

export function zombiePose(anim: number): Pick<PoseOptions, 'lunge' | 'stagger' | 'prone'> {
  return {
    lunge: anim === ZombieAnim.Attack || anim === ZombieAnim.Bang,
    stagger: anim === ZombieAnim.Stagger,
    prone: anim === ZombieAnim.Down,
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function mixTint(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** A body lying on the ground (corpses and knocked-down zombies). Head points along +x. */
export function drawProne(g: Graphics, look: Look, zombie: boolean): void {
  g.clear();
  // Legs.
  g.roundRect(-0.78, -0.16, 0.5, 0.13, 0.06).fill(look.pants);
  g.roundRect(-0.74, 0.04, 0.48, 0.13, 0.06).fill(look.pants);
  g.roundRect(-0.86, -0.16, 0.12, 0.12, 0.05).fill(look.shoes);
  g.roundRect(-0.82, 0.05, 0.12, 0.12, 0.05).fill(look.shoes);
  // Torso.
  g.roundRect(-0.34, -0.23, 0.46, 0.46, 0.14).fill(look.top);
  g.roundRect(-0.3, -0.18, 0.36, 0.2, 0.08).fill({ color: look.topDark, alpha: 0.5 });
  // Arms splayed.
  g.roundRect(-0.05, -0.46, 0.13, 0.3, 0.06).fill(look.top);
  g.circle(0.02, -0.48, 0.06).fill(look.skin);
  g.roundRect(0.0, 0.18, 0.34, 0.12, 0.06).fill(look.top);
  g.circle(0.36, 0.24, 0.06).fill(look.skin);
  // Head.
  g.circle(0.24, 0.0, 0.13).fill(look.skin);
  if (!look.bald) g.circle(0.27, -0.01, 0.115).fill(look.hair);
  if (zombie || look.gore > 0) {
    g.ellipse(-0.1, 0.05, 0.12, 0.08).fill({ color: 0x4a0c08, alpha: 0.7 });
  }
}

export class CorpseView {
  readonly root = new Container();
  private readonly body = new Graphics();
  private label: Text | null = null;

  constructor(seed: number, player: boolean, angle: number, name?: string) {
    const look = player ? playerLook(seed) : zombieLook(seed);
    drawProne(this.body, look, !player);
    this.body.rotation = angle;
    this.root.addChild(this.body);
    if (player && name) {
      this.label = new Text({
        text: `${name}'s body`,
        style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 24, fill: 0xc8c4b8, stroke: { color: 0x000000, width: 4 } },
      });
      this.label.anchor.set(0.5, 1);
      this.label.scale.set(1 / 80);
      this.label.position.set(0, -0.6);
      this.label.visible = false;
      this.root.addChild(this.label);
    }
  }

  setLabelVisible(v: boolean): void {
    if (this.label) this.label.visible = v;
  }

  setLooted(looted: boolean): void {
    this.body.alpha = looted ? 0.8 : 1;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

export function facingDelta(a: number, b: number): number {
  return Math.abs(angleDelta(a, b));
}
