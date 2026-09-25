// Short-lived effects: chips flying off trees and rocks, blood, smoke from furnaces and engines,
// sparks, and floating text for gathered resources and damage.

import { Container, Graphics, Text } from 'pixi.js';
import { NAME_STYLE } from './characters';
import { TS } from './draw';
import type { Renderer } from './renderer';

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  max: number;
  grow: number;
  gravity: number;
  spin: number;
}

interface Floater {
  t: Text;
  life: number;
  max: number;
  vy: number;
}

const MATERIAL_COLORS: Record<string, number[]> = {
  wood: [0x9a6b3f, 0xc99a5b, 0x6f9a3f],
  stone: [0x9aa0a6, 0x7d8189, 0xc0c4c8],
  plant: [0x6fae4a, 0x8fbf5a, 0x4f8f3a],
  flesh: [0xb03030, 0x8a2020, 0xd04040],
  dirt: [0x8a6440, 0x6b4a2a, 0xa07850],
  metal: [0xffd35a, 0xffffff, 0xf07a2a],
  water: [0xbfe3f0, 0xffffff, 0x7ab8e0],
};

export class Effects {
  private readonly particles: Particle[] = [];
  private readonly floaters: Floater[] = [];
  private readonly layer: Container;

  constructor(r: Renderer) {
    this.layer = r.layers.effects;
  }

  burst(x: number, y: number, material: string, count = 7, speed = 120): void {
    const colors = MATERIAL_COLORS[material] ?? MATERIAL_COLORS.stone;
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      const size = 3 + Math.random() * 4;
      if (material === 'plant') g.ellipse(0, 0, size * 1.4, size * 0.7).fill(colors[i % colors.length]);
      else g.rect(-size / 2, -size / 2, size, size).fill(colors[i % colors.length]);
      g.position.set(x * TS, y * TS);
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.layer.addChild(g);
      this.particles.push({
        g,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: 0.45 + Math.random() * 0.3,
        grow: -0.5,
        gravity: 0,
        spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  smoke(x: number, y: number, dark = false): void {
    const g = new Graphics();
    g.circle(0, 0, 9 + Math.random() * 5).fill({ color: dark ? 0x3a3a3a : 0xd8d8d8, alpha: 0.55 });
    g.position.set(x * TS + (Math.random() - 0.5) * 10, y * TS + (Math.random() - 0.5) * 10);
    this.layer.addChild(g);
    this.particles.push({
      g,
      vx: 8 + Math.random() * 10,
      vy: -25 - Math.random() * 15,
      life: 0,
      max: 1.6 + Math.random() * 0.8,
      grow: 1.2,
      gravity: 0,
      spin: 0,
    });
  }

  sparks(x: number, y: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.circle(0, 0, 2.2).fill(i % 2 ? 0xffd35a : 0xffffff);
      g.position.set(x * TS, y * TS);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 150 + Math.random() * 120;
      this.layer.addChild(g);
      this.particles.push({
        g,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: 0.35 + Math.random() * 0.25,
        grow: -0.8,
        gravity: 420,
        spin: 0,
      });
    }
  }

  text(x: number, y: number, text: string, color = 0xffffff, size = 17): void {
    const t = new Text({ text, style: { ...NAME_STYLE, fontSize: size, fill: color }, resolution: 2 });
    t.anchor.set(0.5);
    t.position.set(x * TS + (Math.random() - 0.5) * 16, y * TS - 30);
    this.layer.addChild(t);
    this.floaters.push({ t, life: 0, max: 1.2, vy: -38 });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        p.g.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vx *= Math.pow(0.08, dt);
      if (p.gravity === 0) p.vy *= Math.pow(0.08, dt);
      p.g.rotation += p.spin * dt;
      const f = p.life / p.max;
      p.g.alpha = 1 - f;
      p.g.scale.set(Math.max(0.1, 1 + p.grow * f));
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life += dt;
      if (f.life >= f.max) {
        f.t.destroy();
        this.floaters.splice(i, 1);
        continue;
      }
      f.t.y += f.vy * dt;
      f.vy *= Math.pow(0.3, dt);
      f.t.alpha = f.life < f.max * 0.6 ? 1 : 1 - (f.life - f.max * 0.6) / (f.max * 0.4);
    }
  }
}
