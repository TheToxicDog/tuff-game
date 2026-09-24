// Combat feedback (design plan §7, Pillar B): muzzle flashes, tracers, impact dust and sparks,
// blood spray and pools, shell casings and melee swing arcs. Short-lived lights are exposed for
// the lighting pass so gunfire briefly lights up dark rooms.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { IMPACT_FLESH, IMPACT_MATERIALS, Rng } from '@tuff/shared';
import { bloodTextures, radialTexture } from './textures';

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  drag: number;
  fade: boolean;
  grow: number;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  max: number;
  color: number;
  width: number;
}

interface Arc {
  x: number;
  y: number;
  angle: number;
  reach: number;
  arc: number;
  life: number;
  dir: number;
}

interface Casing {
  s: Sprite;
  vx: number;
  vy: number;
  spin: number;
  life: number;
}

export interface TransientLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: number;
  life: number;
  max: number;
}

const MAX_PARTICLES = 700;
const MAX_DECALS = 320;

const MATERIAL_DUST: Record<string, number> = {
  brick: 0x8a5a44,
  concrete: 0x9a9890,
  wood: 0x8a6a44,
  drywall: 0xd8d4c8,
  metal: 0xffd890,
  glass: 0xc8dce4,
  foliage: 0x4a6a34,
  fabric: 0x6a6a6a,
  plastic: 0x8a8a8a,
  stone: 0x8a8a84,
};

export class Effects {
  private readonly particles: Particle[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly arcs: Arc[] = [];
  private readonly casings: Casing[] = [];
  private readonly decals: Sprite[] = [];
  readonly lights: TransientLight[] = [];
  private readonly lineG = new Graphics();
  private readonly dot: Texture;
  private readonly glow: Texture;
  private readonly blood: Texture[];
  private readonly rng = new Rng(4242);
  private readonly casingTex: Texture;

  constructor(
    private readonly decalLayer: Container,
    private readonly layer: Container,
    private readonly topLayer: Container,
  ) {
    this.dot = radialTexture('dot', 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32, 2.6);
    this.glow = radialTexture('glow', 'rgba(255,230,180,1)', 'rgba(255,200,120,0)', 128, 1.2);
    this.blood = bloodTextures(8);
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c8a040';
    ctx.fillRect(0, 0, 8, 4);
    ctx.fillStyle = '#8a6a28';
    ctx.fillRect(6, 0, 2, 4);
    this.casingTex = Texture.from(canvas);
    this.lineG.blendMode = 'add';
    this.topLayer.addChild(this.lineG);
  }

  private particle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    color: number,
    life: number,
    opts: { drag?: number; add?: boolean; fade?: boolean; grow?: number; top?: boolean } = {},
  ): void {
    if (this.particles.length >= MAX_PARTICLES) {
      const old = this.particles.shift()!;
      old.s.destroy();
    }
    const s = new Sprite(this.dot);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.width = s.height = size;
    s.tint = color;
    if (opts.add) s.blendMode = 'add';
    (opts.top ? this.topLayer : this.layer).addChild(s);
    this.particles.push({ s, vx, vy, life, max: life, drag: opts.drag ?? 4, fade: opts.fade ?? true, grow: opts.grow ?? 0 });
  }

  muzzleFlash(x: number, y: number, angle: number, scale = 1): void {
    const s = new Sprite(this.glow);
    s.anchor.set(0.15, 0.5);
    s.position.set(x, y);
    s.rotation = angle;
    s.width = 1.1 * scale;
    s.height = 0.55 * scale;
    s.blendMode = 'add';
    this.topLayer.addChild(s);
    this.particles.push({ s, vx: 0, vy: 0, life: 0.06, max: 0.06, drag: 0, fade: true, grow: 0 });
    for (let i = 0; i < 4; i++) {
      const a = angle + this.rng.range(-0.4, 0.4);
      const sp = this.rng.range(3, 8);
      this.particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.12, 0xffd890, 0.08, { add: true, top: true, drag: 10 });
    }
    this.particle(
      x + Math.cos(angle) * 0.4,
      y + Math.sin(angle) * 0.4,
      Math.cos(angle) * 0.6,
      Math.sin(angle) * 0.6,
      0.5 * scale,
      0x6a6a64,
      0.6,
      { drag: 2, grow: 1.2 },
    );
    this.lights.push({ x, y, radius: 7 * scale, intensity: 0.9, color: 0xffd8a0, life: 0.07, max: 0.07 });
  }

  tracer(x0: number, y0: number, x1: number, y1: number): void {
    this.tracers.push({ x0, y0, x1, y1, life: 0.09, max: 0.09, color: 0xffe0a0, width: 0.05 });
  }

  impact(x: number, y: number, angle: number, impact: number): void {
    if (impact === IMPACT_FLESH) {
      this.bloodSpray(x, y, angle, 1);
      return;
    }
    const material = IMPACT_MATERIALS[impact - 2] ?? 'concrete';
    const color = MATERIAL_DUST[material] ?? 0x9a9890;
    const back = angle + Math.PI;
    const count = material === 'glass' ? 10 : 7;
    for (let i = 0; i < count; i++) {
      const a = back + this.rng.range(-1.1, 1.1);
      const sp = this.rng.range(1.5, 5);
      this.particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rng.range(0.05, 0.12), color, this.rng.range(0.2, 0.5), {
        drag: 7,
        add: material === 'metal',
      });
    }
    this.particle(x, y, Math.cos(back) * 0.5, Math.sin(back) * 0.5, 0.35, color, 0.5, { drag: 3, grow: 0.8 });
    if (material !== 'glass' && material !== 'foliage') this.decal(x, y, 0.12, 0x1a1a18, 0.8, this.dot);
  }

  bloodSpray(x: number, y: number, dir: number, amount: number): void {
    const n = Math.round(8 * amount);
    for (let i = 0; i < n; i++) {
      const a = dir + this.rng.range(-0.7, 0.7);
      const sp = this.rng.range(1.5, 6) * amount;
      this.particle(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        this.rng.range(0.05, 0.14),
        this.rng.chance(0.5) ? 0x7a0e0a : 0x9a1a12,
        this.rng.range(0.25, 0.5),
        { drag: 6 },
      );
    }
    // Spatter lands behind the target.
    const d = this.rng.range(0.4, 1.1);
    this.decal(x + Math.cos(dir) * d, y + Math.sin(dir) * d, this.rng.range(0.4, 0.8) * amount, 0xffffff, 0.85);
  }

  bloodPool(x: number, y: number, size: number): void {
    this.decal(x, y, size, 0xffffff, 0.95);
  }

  private decal(x: number, y: number, size: number, tint: number, alpha: number, texture?: Texture): void {
    if (this.decals.length >= MAX_DECALS) this.decals.shift()!.destroy();
    const s = new Sprite(texture ?? this.rng.pick(this.blood));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = this.rng.range(0, Math.PI * 2);
    s.width = s.height = size;
    s.tint = tint;
    s.alpha = alpha;
    this.decalLayer.addChild(s);
    this.decals.push(s);
  }

  casing(x: number, y: number, angle: number): void {
    const s = new Sprite(this.casingTex);
    s.anchor.set(0.5);
    s.width = 0.07;
    s.height = 0.035;
    s.position.set(x, y);
    this.layer.addChild(s);
    const a = angle + Math.PI / 2 + this.rng.range(-0.4, 0.4);
    const sp = this.rng.range(2, 3.5);
    this.casings.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spin: this.rng.range(-20, 20), life: 12 });
    if (this.casings.length > 80) this.casings.shift()!.s.destroy();
  }

  swing(x: number, y: number, angle: number, reach: number, arcDeg: number, dir: number): void {
    this.arcs.push({ x, y, angle, reach, arc: (arcDeg * Math.PI) / 180, life: 0.14, dir });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      if (p.grow) {
        p.s.width += p.grow * dt;
        p.s.height += p.grow * dt;
      }
      if (p.fade) p.s.alpha = Math.min(1, (p.life / p.max) * 1.4);
    }
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      const k = Math.exp(-5 * dt);
      c.vx *= k;
      c.vy *= k;
      c.spin *= k;
      c.s.x += c.vx * dt;
      c.s.y += c.vy * dt;
      c.s.rotation += c.spin * dt;
      if (c.life < 2) c.s.alpha = c.life / 2;
      if (c.life <= 0) {
        c.s.destroy();
        this.casings.splice(i, 1);
      }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      this.lights[i].life -= dt;
      if (this.lights[i].life <= 0) this.lights.splice(i, 1);
    }
    const g = this.lineG;
    g.clear();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      const a = t.life / t.max;
      // Draw the tracer as a streak that races toward the impact.
      const head = 1 - a * 0.6;
      const tail = Math.max(0, head - 0.55);
      g.moveTo(t.x0 + (t.x1 - t.x0) * tail, t.y0 + (t.y1 - t.y0) * tail)
        .lineTo(t.x0 + (t.x1 - t.x0) * head, t.y0 + (t.y1 - t.y0) * head)
        .stroke({ color: t.color, width: t.width, alpha: 0.35 + 0.65 * a });
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const s = this.arcs[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.arcs.splice(i, 1);
        continue;
      }
      const t = 1 - s.life / 0.14;
      const start = s.angle - (s.arc / 2) * s.dir;
      const end = start + s.arc * s.dir * Math.min(1, t * 1.6);
      const steps = 10;
      g.moveTo(s.x + Math.cos(start) * s.reach, s.y + Math.sin(start) * s.reach);
      for (let k = 1; k <= steps; k++) {
        const a = start + ((end - start) * k) / steps;
        g.lineTo(s.x + Math.cos(a) * s.reach, s.y + Math.sin(a) * s.reach);
      }
      g.stroke({ color: 0xd8d4c8, width: 0.1, alpha: 0.35 * (s.life / 0.14) });
    }
  }
}
