// Procedural drawings for props and furniture, keyed by the `style` field in data/world/props.json.
// Coordinates are meters, centred on the prop, with the "front" facing local +y. Shapes are built
// once per style/size/variant into GraphicsContexts and shared between instances.

import { GraphicsContext } from 'pixi.js';
import { Rng } from '@tuff/shared';

export interface StyleArgs {
  w: number;
  h: number;
  r: number;
  color: number;
  rng: Rng;
}

type StyleFn = (g: GraphicsContext, a: StyleArgs) => void;

const SHADOW = { color: 0x000000, alpha: 0.28 };

function shade(c: number, f: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * f);
  const g = Math.min(255, ((c >> 8) & 255) * f);
  const b = Math.min(255, (c & 255) * f);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function boxWithShadow(g: GraphicsContext, w: number, h: number, color: number, radius = 0.04, shadow = 0.08): void {
  if (shadow > 0) g.roundRect(-w / 2 + shadow, -h / 2 + shadow, w, h, radius).fill(SHADOW);
  g.roundRect(-w / 2, -h / 2, w, h, radius).fill(color);
  g.roundRect(-w / 2, -h / 2, w, h, radius).stroke({ color: shade(color, 0.55), width: 0.03 });
}

function cabinetFront(g: GraphicsContext, w: number, h: number, color: number, doors: number): void {
  // Handles along the front edge (local +y).
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    g.rect(x - 0.06, h / 2 - 0.07, 0.12, 0.025).fill(shade(color, 0.5));
    if (i > 0) g.rect(-w / 2 + (w / doors) * i - 0.008, -h / 2 + 0.05, 0.016, h - 0.1).fill({ color: shade(color, 0.6), alpha: 0.7 });
  }
}

function car(g: GraphicsContext, a: StyleArgs, kind: 'sedan' | 'compact' | 'suv' | 'pickup' | 'van' | 'police'): void {
  const { w, h, rng } = a;
  const palette = [0x5a6470, 0x7a3a32, 0x2e3a30, 0x6a5a3a, 0x8a8a84, 0x3a3e4a, 0x5a2a2a, 0x9a9488, 0x2a2c30, 0x4a5a64];
  let body = kind === 'police' ? 0x1e2226 : kind === 'van' ? 0xb8b4a8 : rng.pick(palette);
  body = shade(body, rng.range(0.85, 1.05));
  const L = w;
  const W = h;
  g.roundRect(-L / 2 + 0.12, -W / 2 + 0.14, L, W, 0.35).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(-L / 2, -W / 2, L, W, 0.32).fill(body);
  // Wheels peeking out.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.roundRect(sx * L * 0.3 - 0.3, sy * (W / 2) - 0.1, 0.6, 0.2, 0.06).fill(0x151515);
  g.roundRect(-L / 2, -W / 2, L, W, 0.32).fill(body);
  g.roundRect(-L / 2 + 0.05, -W / 2 + 0.05, L - 0.1, W - 0.1, 0.28).stroke({ color: shade(body, 0.6), width: 0.05 });
  const glass = 0x2a3238;
  const cabinFront = kind === 'pickup' ? L * 0.12 : kind === 'van' ? L * 0.34 : L * 0.2;
  const cabinBack = kind === 'pickup' ? -L * 0.08 : kind === 'van' ? -L * 0.45 : kind === 'compact' ? -L * 0.28 : -L * 0.24;
  // Windshield, roof, rear window.
  g.poly([cabinFront, -W / 2 + 0.18, cabinFront + 0.45, -W / 2 + 0.26, cabinFront + 0.45, W / 2 - 0.26, cabinFront, W / 2 - 0.18]).fill(
    glass,
  );
  g.roundRect(cabinBack, -W / 2 + 0.2, cabinFront - cabinBack, W - 0.4, 0.12).fill(shade(body, 1.12));
  if (kind !== 'van' && kind !== 'pickup')
    g.poly([cabinBack, -W / 2 + 0.22, cabinBack - 0.32, -W / 2 + 0.3, cabinBack - 0.32, W / 2 - 0.3, cabinBack, W / 2 - 0.22]).fill(glass);
  if (kind === 'pickup') {
    g.roundRect(-L / 2 + 0.12, -W / 2 + 0.14, L * 0.42, W - 0.28, 0.06).fill(shade(body, 0.62));
    g.roundRect(-L / 2 + 0.2, -W / 2 + 0.22, L * 0.42 - 0.16, W - 0.44, 0.04).stroke({ color: shade(body, 0.45), width: 0.04 });
  }
  if (kind === 'police') {
    g.rect(-0.1, -W / 2 + 0.25, 0.2, W - 0.5).fill(0x111111);
    g.rect(-0.08, -W / 2 + 0.3, 0.16, (W - 0.6) / 2).fill(0x2a4aa8);
    g.rect(-0.08, 0, 0.16, (W - 0.6) / 2).fill(0xa82a2a);
    g.rect(cabinBack, -W / 2 + 0.02, cabinFront - cabinBack, 0.14).fill(0xe8e8e8);
    g.rect(cabinBack, W / 2 - 0.16, cabinFront - cabinBack, 0.14).fill(0xe8e8e8);
  }
  // Headlights and tail lights.
  g.roundRect(L / 2 - 0.1, -W / 2 + 0.18, 0.08, 0.28, 0.03).fill(0xd8d4c0);
  g.roundRect(L / 2 - 0.1, W / 2 - 0.46, 0.08, 0.28, 0.03).fill(0xd8d4c0);
  g.roundRect(-L / 2 + 0.02, -W / 2 + 0.16, 0.07, 0.26, 0.03).fill(0x7a1a14);
  g.roundRect(-L / 2 + 0.02, W / 2 - 0.42, 0.07, 0.26, 0.03).fill(0x7a1a14);
  // Mirrors.
  g.roundRect(cabinFront - 0.05, -W / 2 - 0.1, 0.12, 0.12, 0.03).fill(shade(body, 0.8));
  g.roundRect(cabinFront - 0.05, W / 2 - 0.02, 0.12, 0.12, 0.03).fill(shade(body, 0.8));
  // Grime, rust and the occasional smashed windshield.
  for (let i = 0; i < 5; i++) {
    g.ellipse(rng.range(-L / 2, L / 2) * 0.8, rng.range(-W / 2, W / 2) * 0.8, rng.range(0.1, 0.35), rng.range(0.08, 0.2)).fill({
      color: rng.chance(0.5) ? 0x3a2a1a : 0x1a1a18,
      alpha: 0.18,
    });
  }
  if (rng.chance(0.3)) {
    const cx = cabinFront + 0.22;
    for (let i = 0; i < 7; i++) {
      const ang = rng.range(0, Math.PI * 2);
      g.moveTo(cx, 0).lineTo(cx + Math.cos(ang) * 0.35, Math.sin(ang) * 0.5);
    }
    g.stroke({ color: 0xc8d0d4, width: 0.02, alpha: 0.6 });
  }
}

function tree(g: GraphicsContext, a: StyleArgs, kind: 'oak' | 'pine' | 'birch' | 'dead'): void {
  const { rng, color } = a;
  if (kind === 'dead') {
    const n = rng.int(5, 8);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const len = rng.range(1.2, 2.4);
      g.moveTo(0, 0)
        .lineTo(Math.cos(ang) * len * 0.6 + rng.range(-0.2, 0.2), Math.sin(ang) * len * 0.6)
        .lineTo(Math.cos(ang + 0.2) * len, Math.sin(ang + 0.2) * len);
    }
    g.stroke({ color: 0x3a322a, width: 0.09, alpha: 0.9 });
    g.circle(0, 0, 0.3).fill(0x4a4036);
    return;
  }
  const radius = kind === 'pine' ? rng.range(1.7, 2.4) : kind === 'birch' ? rng.range(1.5, 2.1) : rng.range(2.2, 3.1);
  const base = shade(color, rng.range(0.85, 1.1));
  // Drop shadow.
  g.circle(0.35, 0.45, radius * 0.95).fill({ color: 0x000000, alpha: 0.25 });
  if (kind === 'pine') {
    for (let layer = 0; layer < 3; layer++) {
      const r = radius * (1 - layer * 0.28);
      const pts: number[] = [];
      const spikes = 11;
      for (let i = 0; i < spikes * 2; i++) {
        const ang = (i / (spikes * 2)) * Math.PI * 2 + layer * 0.3;
        const rr = i % 2 === 0 ? r : r * 0.72;
        pts.push(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      g.poly(pts).fill(shade(base, 0.75 + layer * 0.17));
    }
    g.circle(0, 0, radius * 0.12).fill(shade(base, 1.4));
    return;
  }
  const blobs = kind === 'birch' ? 9 : 12;
  for (let i = 0; i < blobs; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const d = rng.range(0, radius * 0.55);
    g.circle(Math.cos(ang) * d, Math.sin(ang) * d, radius * rng.range(0.4, 0.58)).fill(shade(base, 0.72));
  }
  for (let i = 0; i < blobs; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const d = rng.range(0, radius * 0.45);
    g.circle(Math.cos(ang) * d - 0.1, Math.sin(ang) * d - 0.1, radius * rng.range(0.28, 0.42)).fill(shade(base, rng.range(0.95, 1.2)));
  }
  for (let i = 0; i < 6; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const d = rng.range(0, radius * 0.4);
    g.circle(Math.cos(ang) * d - 0.25, Math.sin(ang) * d - 0.25, radius * rng.range(0.12, 0.2)).fill({
      color: shade(base, 1.45),
      alpha: 0.5,
    });
  }
}

export const PROP_STYLES: Record<string, StyleFn> = {
  // ---------------------------------------------------------------- nature
  tree_oak: (g, a) => tree(g, a, 'oak'),
  tree_pine: (g, a) => tree(g, a, 'pine'),
  tree_birch: (g, a) => tree(g, a, 'birch'),
  tree_dead: (g, a) => tree(g, a, 'dead'),
  stump: (g) => {
    g.circle(0.05, 0.06, 0.38).fill(SHADOW);
    g.circle(0, 0, 0.36).fill(0x5a4a36);
    g.circle(0, 0, 0.26).fill(0x8a7050);
    g.circle(0, 0, 0.16).stroke({ color: 0x6a5238, width: 0.02 });
    g.circle(0, 0, 0.08).stroke({ color: 0x6a5238, width: 0.02 });
  },
  log: (g, a) => {
    g.roundRect(-a.w / 2 + 0.08, -a.h / 2 + 0.1, a.w, a.h, a.h / 2).fill(SHADOW);
    g.roundRect(-a.w / 2, -a.h / 2, a.w, a.h, a.h / 2).fill(0x5a4632);
    g.moveTo(-a.w / 2 + 0.2, -0.05)
      .lineTo(a.w / 2 - 0.3, -0.08)
      .stroke({ color: 0x3e3022, width: 0.03 });
    g.circle(a.w / 2 - 0.1, 0, a.h / 2 - 0.04).fill(0x8a7050);
  },
  bush: (g, a) => {
    const base = shade(a.color, a.rng.range(0.85, 1.1));
    const n = a.rng.int(4, 7);
    for (let i = 0; i < n; i++) g.circle(a.rng.range(-0.35, 0.35), a.rng.range(-0.35, 0.35), a.rng.range(0.3, 0.5)).fill(shade(base, 0.75));
    for (let i = 0; i < n; i++)
      g.circle(a.rng.range(-0.3, 0.3) - 0.05, a.rng.range(-0.3, 0.3) - 0.05, a.rng.range(0.18, 0.32)).fill(shade(base, 1.1));
  },
  bush_large: (g, a) => {
    const base = shade(a.color, a.rng.range(0.85, 1.1));
    g.circle(0.12, 0.15, 0.9).fill(SHADOW);
    for (let i = 0; i < 9; i++) g.circle(a.rng.range(-0.5, 0.5), a.rng.range(-0.5, 0.5), a.rng.range(0.35, 0.55)).fill(shade(base, 0.75));
    for (let i = 0; i < 9; i++)
      g.circle(a.rng.range(-0.45, 0.45) - 0.08, a.rng.range(-0.45, 0.45) - 0.08, a.rng.range(0.2, 0.36)).fill(shade(base, 1.12));
  },
  hedge: (g, a) => {
    g.roundRect(-a.w / 2 + 0.1, -a.h / 2 + 0.12, a.w, a.h, 0.3).fill(SHADOW);
    g.roundRect(-a.w / 2, -a.h / 2, a.w, a.h, 0.3).fill(shade(a.color, 0.8));
    for (let x = -a.w / 2 + 0.25; x < a.w / 2; x += 0.35)
      g.circle(x, a.rng.range(-0.1, 0.1), a.h * 0.42).fill(shade(a.color, a.rng.range(0.95, 1.2)));
  },
  rock: (g, a) => {
    const pts: number[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const r = a.r * a.rng.range(0.8, 1.15);
      pts.push(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    g.poly(pts.map((v, i) => v + (i % 2 === 0 ? 0.08 : 0.1))).fill(SHADOW);
    g.poly(pts).fill(a.color);
    g.poly(pts.map((v) => v * 0.6 - 0.06)).fill(shade(a.color, 1.18));
  },
  grass_tuft: (g, a) => {
    for (let i = 0; i < 9; i++) {
      const x = a.rng.range(-0.35, 0.35);
      const y = a.rng.range(-0.35, 0.35);
      g.moveTo(x, y).lineTo(x + a.rng.range(-0.15, 0.15), y - a.rng.range(0.15, 0.4));
    }
    g.stroke({ color: shade(a.color, a.rng.range(0.8, 1.2)), width: 0.035, alpha: 0.8 });
  },
  flowers: (g, a) => {
    for (let i = 0; i < 7; i++) {
      const c = a.rng.pick([0x8a5a6a, 0xb8a050, 0xc8c8c0, 0x7a4a8a]);
      g.circle(a.rng.range(-0.35, 0.35), a.rng.range(-0.35, 0.35), 0.05).fill({ color: c, alpha: 0.85 });
    }
  },
  leaves: (g, a) => {
    for (let i = 0; i < 18; i++) {
      g.ellipse(a.rng.range(-0.8, 0.8), a.rng.range(-0.8, 0.8), 0.07, 0.04).fill({
        color: a.rng.pick([0x6a5030, 0x7a5a28, 0x5a4a30, 0x8a6a30]),
        alpha: 0.8,
      });
    }
  },
  // ---------------------------------------------------------------- vehicles and street
  car_sedan: (g, a) => car(g, a, 'sedan'),
  car_compact: (g, a) => car(g, a, 'compact'),
  car_suv: (g, a) => car(g, a, 'suv'),
  car_pickup: (g, a) => car(g, a, 'pickup'),
  van: (g, a) => car(g, a, 'van'),
  police_car: (g, a) => car(g, a, 'police'),
  dumpster: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.06, 0.12);
    g.rect(-a.w / 2 + 0.08, -a.h / 2 + 0.08, a.w / 2 - 0.12, a.h - 0.16).fill(shade(a.color, 0.8));
    g.rect(0.04, -a.h / 2 + 0.08, a.w / 2 - 0.12, a.h - 0.16).fill(shade(a.color, 0.9));
    g.circle(a.rng.range(-0.5, 0.5), a.rng.range(-0.3, 0.3), 0.2).fill({ color: 0x5a3a20, alpha: 0.3 });
  },
  trash_can: (g, a) => {
    g.circle(0.05, 0.06, a.r).fill(SHADOW);
    g.circle(0, 0, a.r).fill(a.color);
    g.circle(0, 0, a.r * 0.8).stroke({ color: shade(a.color, 0.6), width: 0.03 });
    g.rect(-0.08, -0.02, 0.16, 0.04).fill(shade(a.color, 0.5));
  },
  streetlight: (g) => {
    g.circle(0.04, 0.05, 0.16).fill(SHADOW);
    g.circle(0, 0, 0.12).fill(0x4a4c4e);
    g.rect(0, -0.04, 1.4, 0.08).fill(0x3e4042);
    g.roundRect(1.25, -0.12, 0.4, 0.24, 0.06).fill(0x2e3032);
    g.roundRect(1.3, -0.08, 0.3, 0.16, 0.05).fill(0x6a6a5a);
  },
  bench: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x2e2e30, 0.04, 0.06);
    for (let i = 0; i < 4; i++) g.rect(-a.w / 2 + 0.05, -a.h / 2 + 0.06 + i * 0.13, a.w - 0.1, 0.09).fill(shade(a.color, 0.9 + i * 0.05));
  },
  mailbox: (g, a) => {
    g.circle(0.04, 0.05, 0.16).fill(SHADOW);
    g.roundRect(-0.12, -0.22, 0.24, 0.44, 0.1).fill(a.color);
    g.rect(0.12, -0.18, 0.04, 0.12).fill(0xa82a22);
  },
  hydrant: (g, a) => {
    g.circle(0.04, 0.05, 0.17).fill(SHADOW);
    g.circle(0, 0, 0.16).fill(a.color);
    g.circle(0, 0, 0.09).fill(shade(a.color, 1.2));
    g.rect(-0.22, -0.04, 0.44, 0.08).fill(shade(a.color, 0.8));
  },
  gas_pump: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0xc8c8c0, 0.06);
    g.rect(-a.w / 2 + 0.1, -a.h / 2 + 0.08, a.w - 0.2, 0.2).fill(0x2a2c2e);
    g.rect(-a.w / 2 + 0.1, -0.02, 0.3, 0.14).fill(0xa82a22);
    g.moveTo(a.w / 2 - 0.1, 0)
      .lineTo(a.w / 2 + 0.3, 0.25)
      .stroke({ color: 0x1a1a1a, width: 0.04 });
  },
  canopy: (g, a) => {
    g.rect(-a.w / 2 + 0.3, -a.h / 2 + 0.4, a.w, a.h).fill({ color: 0x000000, alpha: 0.2 });
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h).fill(0xb8b4ac);
    g.rect(-a.w / 2, -a.h / 2, a.w, 0.5).fill(0xa82a22);
    g.rect(-a.w / 2, a.h / 2 - 0.5, a.w, 0.5).fill(0xa82a22);
    for (let x = -a.w / 2 + 1.5; x < a.w / 2; x += 3) g.rect(x, -a.h / 2 + 0.6, 0.06, a.h - 1.2).fill({ color: 0x8a8680, alpha: 0.6 });
  },
  picnic_table: (g, a) => {
    boxWithShadow(g, a.w, 0.8, a.color, 0.03, 0.06);
    g.rect(-a.w / 2, -a.h / 2, a.w, 0.25).fill(shade(a.color, 0.85));
    g.rect(-a.w / 2, a.h / 2 - 0.25, a.w, 0.25).fill(shade(a.color, 0.85));
  },
  pallet: (g, a) => {
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h).fill({ color: shade(a.color, 0.7), alpha: 0.9 });
    for (let x = -a.w / 2 + 0.05; x < a.w / 2; x += 0.2) g.rect(x, -a.h / 2, 0.14, a.h).fill(a.color);
  },
  barrel: (g, a) => {
    g.circle(0.05, 0.06, a.r).fill(SHADOW);
    g.circle(0, 0, a.r).fill(a.color);
    g.circle(0, 0, a.r * 0.75).stroke({ color: shade(a.color, 0.6), width: 0.03 });
    g.circle(a.r * 0.4, 0, 0.04).fill(0x1a1a1a);
  },
  tires: (g, a) => {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.18;
      g.circle(x, (i % 2) * 0.1, 0.3).fill(0x141414);
      g.circle(x, (i % 2) * 0.1, 0.14).fill(0x2a2a2a);
    }
    void a;
  },
  shopping_cart: (g, a) => {
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h).stroke({ color: a.color, width: 0.035 });
    for (let x = -a.w / 2 + 0.12; x < a.w / 2; x += 0.12) g.moveTo(x, -a.h / 2).lineTo(x, a.h / 2);
    g.stroke({ color: shade(a.color, 0.8), width: 0.015 });
    g.rect(-a.w / 2 - 0.12, -a.h / 2, 0.06, a.h).fill(0x2a2a2a);
  },
  parking_line: (g, a) => {
    g.rect(-0.06, -2.5, 0.12, 5).fill({ color: a.color, alpha: 0.55 });
  },
  manhole: (g) => {
    g.circle(0, 0, 0.35).fill(0x2e2e2c);
    g.circle(0, 0, 0.3).stroke({ color: 0x4a4a46, width: 0.03 });
    for (let i = -2; i <= 2; i++) g.rect(-0.22, i * 0.09 - 0.015, 0.44, 0.03).fill(0x3e3e3a);
  },
  oil_stain: (g, a) => {
    for (let i = 0; i < 5; i++)
      g.ellipse(a.rng.range(-0.4, 0.4), a.rng.range(-0.3, 0.3), a.rng.range(0.3, 0.7), a.rng.range(0.2, 0.5)).fill({
        color: 0x0a0a08,
        alpha: 0.22,
      });
  },
  blood_stain: (g, a) => {
    for (let i = 0; i < 7; i++)
      g.ellipse(a.rng.range(-0.5, 0.5), a.rng.range(-0.4, 0.4), a.rng.range(0.15, 0.5), a.rng.range(0.1, 0.35)).fill({
        color: 0x4a0c08,
        alpha: 0.55,
      });
    for (let i = 0; i < 12; i++)
      g.circle(a.rng.range(-1, 1), a.rng.range(-1, 1), a.rng.range(0.02, 0.06)).fill({ color: 0x5a0e0a, alpha: 0.6 });
  },
  trash_pile: (g, a) => {
    for (let i = 0; i < 10; i++) {
      g.rect(a.rng.range(-0.6, 0.5), a.rng.range(-0.5, 0.4), a.rng.range(0.1, 0.3), a.rng.range(0.06, 0.2)).fill({
        color: a.rng.pick([0x6a6458, 0x8a8478, 0x4a4a44, 0x7a6a4a, 0x9a3a2a]),
        alpha: 0.85,
      });
    }
  },
  debris: (g, a) => {
    for (let i = 0; i < 14; i++) {
      g.rect(a.rng.range(-1, 1), a.rng.range(-1, 1), a.rng.range(0.05, 0.25), a.rng.range(0.05, 0.15)).fill({
        color: a.rng.pick([0x5a5650, 0x7a7670, 0x3a3a38, 0x9aa0a4]),
        alpha: 0.85,
      });
    }
  },
  // ---------------------------------------------------------------- furniture
  bed: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x4a3a2c, 0.06);
    g.roundRect(-a.w / 2 + 0.05, -a.h / 2 + 0.05, a.w - 0.1, a.h - 0.1, 0.05).fill(0xd8d4c8);
    g.roundRect(-a.w / 2 + 0.05, -a.h / 2 + 0.55, a.w - 0.1, a.h - 0.62, 0.05).fill(a.color);
    g.roundRect(-a.w / 2 + 0.05, -a.h / 2 + 0.55, a.w - 0.1, 0.12, 0.03).fill(shade(a.color, 1.2));
    const pillows = a.w > 1.3 ? 2 : 1;
    for (let i = 0; i < pillows; i++) {
      const px = pillows === 1 ? 0 : (i - 0.5) * (a.w / 2);
      g.roundRect(px - 0.3, -a.h / 2 + 0.12, 0.6, 0.32, 0.1).fill(0xeeeae0);
    }
    if (a.rng.chance(0.3)) g.ellipse(a.rng.range(-0.2, 0.2), a.rng.range(0, 0.5), 0.2, 0.14).fill({ color: 0x5a1410, alpha: 0.6 });
  },
  nightstand: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03);
    cabinetFront(g, a.w, a.h, a.color, 1);
    g.circle(0, -0.02, 0.1).fill({ color: 0xd8c8a0, alpha: 0.8 });
  },
  wardrobe: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.14);
    g.rect(-a.w / 2 + 0.04, -a.h / 2 + 0.04, a.w - 0.08, a.h - 0.08).fill(shade(a.color, 1.15));
    g.rect(-0.01, -a.h / 2 + 0.04, 0.02, a.h - 0.08).fill(shade(a.color, 0.6));
  },
  dresser: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03);
    g.rect(-a.w / 2 + 0.04, -a.h / 2 + 0.04, a.w - 0.08, a.h - 0.08).fill(shade(a.color, 1.1));
    cabinetFront(g, a.w, a.h, a.color, 3);
  },
  couch: (g, a) => {
    boxWithShadow(g, a.w, a.h, shade(a.color, 0.8), 0.14);
    g.roundRect(-a.w / 2, -a.h / 2, a.w, 0.28, 0.1).fill(shade(a.color, 0.72));
    g.roundRect(-a.w / 2, -a.h / 2, 0.22, a.h, 0.1).fill(shade(a.color, 0.72));
    g.roundRect(a.w / 2 - 0.22, -a.h / 2, 0.22, a.h, 0.1).fill(shade(a.color, 0.72));
    const seats = 3;
    const sw = (a.w - 0.46) / seats;
    for (let i = 0; i < seats; i++)
      g.roundRect(-a.w / 2 + 0.23 + i * sw + 0.02, -a.h / 2 + 0.3, sw - 0.04, a.h - 0.34, 0.06).fill(shade(a.color, 1.05));
  },
  armchair: (g, a) => {
    boxWithShadow(g, a.w, a.h, shade(a.color, 0.75), 0.14);
    g.roundRect(-a.w / 2 + 0.18, -a.h / 2 + 0.26, a.w - 0.36, a.h - 0.3, 0.08).fill(shade(a.color, 1.05));
  },
  table: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.04);
    g.rect(-a.w / 2 + 0.05, -a.h / 2 + 0.05, a.w - 0.1, a.h - 0.1).stroke({ color: shade(a.color, 1.2), width: 0.02 });
    if (a.rng.chance(0.5)) g.circle(a.rng.range(-0.3, 0.3), a.rng.range(-0.15, 0.15), 0.08).fill(0xd8d4c8);
  },
  chair: (g, a) => {
    g.roundRect(-0.21, -0.21, 0.42, 0.42, 0.05).fill(a.color);
    g.rect(-0.21, -0.21, 0.42, 0.08).fill(shade(a.color, 0.7));
  },
  tv_stand: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03);
    g.rect(-a.w * 0.35, -a.h / 2 + 0.04, a.w * 0.7, 0.1).fill(0x0e0e10);
  },
  bookshelf: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.14);
    let x = -a.w / 2 + 0.04;
    while (x < a.w / 2 - 0.08) {
      const bw = a.rng.range(0.04, 0.09);
      g.rect(x, -a.h / 2 + 0.05, bw, a.h - 0.1).fill(a.rng.pick([0x6a2a22, 0x2a3a5a, 0x3a5a3a, 0x8a7a5a, 0x4a3a2a, 0xa89a7a]));
      x += bw + 0.005;
    }
  },
  desk: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03);
    g.rect(-a.w / 2 + 0.1, -a.h / 2 + 0.08, 0.42, 0.28).fill({ color: 0xd8d4c8, alpha: 0.9 });
    g.rect(0.15, -0.1, 0.35, 0.22).fill(0x1c1c1e);
    cabinetFront(g, a.w, a.h, a.color, 2);
  },
  counter: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x5a4a38, 0.02, 0.06);
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h - 0.06).fill(a.color);
    g.rect(-a.w / 2, a.h / 2 - 0.08, a.w, 0.08).fill(shade(a.color, 0.7));
    cabinetFront(g, a.w, a.h, 0x8a7a64, Math.max(1, Math.round(a.w / 0.6)));
    if (a.rng.chance(0.5)) g.rect(a.rng.range(-a.w / 3, a.w / 3), -0.15, 0.18, 0.14).fill(0x9a9a92);
  },
  sink: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.06);
    g.roundRect(-a.w / 2 + 0.14, -a.h / 2 + 0.1, a.w - 0.28, a.h - 0.28, 0.06).fill(0x9aa0a4);
    g.circle(0, -a.h / 2 + 0.08, 0.035).fill(0x6a6e72);
  },
  stove: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.06);
    for (const [bx, by] of [
      [-0.18, -0.15],
      [0.18, -0.15],
      [-0.18, 0.12],
      [0.18, 0.12],
    ])
      g.circle(bx, by, 0.1).stroke({ color: 0x1a1a1a, width: 0.03 });
    g.rect(-a.w / 2, a.h / 2 - 0.06, a.w, 0.06).fill(0x2a2a2a);
  },
  fridge: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.05, 0.14);
    g.rect(-a.w / 2 + 0.04, -a.h / 2 + 0.04, a.w - 0.08, a.h - 0.1).fill(shade(a.color, 1.06));
    g.rect(a.w / 2 - 0.12, a.h / 2 - 0.08, 0.05, 0.05).fill(0x8a8a84);
  },
  toilet: (g, a) => {
    g.roundRect(-a.w / 2, -a.h / 2, a.w, 0.2, 0.04).fill(a.color);
    g.ellipse(0, 0.08, a.w / 2 - 0.02, a.h / 2 - 0.12).fill(a.color);
    g.ellipse(0, 0.1, a.w / 2 - 0.08, a.h / 2 - 0.2).fill(0xb8c4c8);
  },
  bathtub: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.12, 0.05);
    g.roundRect(-a.w / 2 + 0.08, -a.h / 2 + 0.08, a.w - 0.16, a.h - 0.16, 0.2).fill(0xc8d0d4);
    g.circle(a.w / 2 - 0.2, 0, 0.04).fill(0x6a6e72);
  },
  shower: (g, a) => {
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h).fill(0xd0d6d8);
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h).stroke({ color: 0x8a9ea8, width: 0.04 });
    g.circle(0, 0, 0.05).fill(0x6a6e72);
  },
  vanity: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.05);
    g.ellipse(0, -0.02, a.w / 2 - 0.14, a.h / 2 - 0.12).fill(0xe0e4e6);
    cabinetFront(g, a.w, a.h, a.color, 2);
  },
  washer: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.04, 0.06);
    g.circle(0, 0.02, 0.22).fill(0x8a9094);
    g.circle(0, 0.02, 0.16).fill(0x3a4044);
  },
  workbench: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.06);
    g.rect(-a.w / 2, -a.h / 2, a.w, 0.1).fill(shade(a.color, 0.7));
    for (let i = 0; i < 4; i++)
      g.rect(a.rng.range(-a.w / 2 + 0.1, a.w / 2 - 0.3), a.rng.range(-0.2, 0.15), a.rng.range(0.1, 0.25), 0.05).fill(
        a.rng.pick([0x6a6e72, 0xa83a2a, 0x3a3a3a, 0xc8a030]),
      );
  },
  metal_shelf: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.12);
    for (let i = 0; i < 6; i++)
      g.rect(
        a.rng.range(-a.w / 2 + 0.05, a.w / 2 - 0.35),
        a.rng.range(-a.h / 2 + 0.05, a.h / 2 - 0.25),
        a.rng.range(0.15, 0.35),
        a.rng.range(0.12, 0.2),
      ).fill(a.rng.pick([0x8a6a44, 0x6a6e72, 0x3a5a7a, 0xa8342a, 0x5a5a4a]));
  },
  toolbox: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.04);
    g.rect(-a.w / 2 + 0.06, -0.02, a.w - 0.12, 0.04).fill(shade(a.color, 0.6));
  },
  lawn_mower: (g, a) => {
    boxWithShadow(g, a.w, a.h * 0.6, a.color, 0.08, 0.05);
    g.circle(0, -0.05, 0.14).fill(0x2a2a2a);
    g.moveTo(-0.2, a.h * 0.3)
      .lineTo(-0.2, a.h / 2)
      .lineTo(0.2, a.h / 2)
      .lineTo(0.2, a.h * 0.3)
      .stroke({ color: 0x1a1a1a, width: 0.03 });
  },
  rug: (g, a) => {
    g.roundRect(-a.w / 2, -a.h / 2, a.w, a.h, 0.04).fill({ color: a.color, alpha: 0.9 });
    g.roundRect(-a.w / 2 + 0.12, -a.h / 2 + 0.12, a.w - 0.24, a.h - 0.24, 0.03).stroke({
      color: shade(a.color, 1.35),
      width: 0.05,
      alpha: 0.7,
    });
    g.roundRect(-a.w / 2 + 0.25, -a.h / 2 + 0.25, a.w - 0.5, a.h - 0.5, 0.03).stroke({
      color: shade(a.color, 0.7),
      width: 0.03,
      alpha: 0.7,
    });
  },
  plant_pot: (g, a) => {
    g.circle(0.04, 0.05, 0.22).fill(SHADOW);
    g.circle(0, 0, 0.2).fill(0x8a5a3a);
    for (let i = 0; i < 7; i++)
      g.ellipse(a.rng.range(-0.15, 0.15), a.rng.range(-0.15, 0.15), 0.14, 0.06).fill(shade(a.color, a.rng.range(0.8, 1.3)));
  },
  safe: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.12);
    g.circle(0, 0.05, 0.1).stroke({ color: 0x8a8a84, width: 0.03 });
    g.rect(-0.02, 0.12, 0.04, 0.12).fill(0x8a8a84);
  },
  filing_cabinet: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.12);
    g.rect(-a.w / 2 + 0.05, -a.h / 2 + 0.05, a.w - 0.1, a.h - 0.12).fill(shade(a.color, 1.08));
    g.rect(-0.08, a.h / 2 - 0.08, 0.16, 0.03).fill(0x3a3a3a);
  },
  locker: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.12);
    for (let i = 0; i < 3; i++) g.rect(-a.w / 2 + 0.08, -a.h / 2 + 0.08 + i * 0.06, a.w - 0.16, 0.02).fill(shade(a.color, 0.7));
  },
  weapon_locker: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.12);
    g.rect(-a.w / 2 + 0.05, -a.h / 2 + 0.05, a.w - 0.1, a.h - 0.1).stroke({ color: 0x5a6a5a, width: 0.03 });
    g.rect(-0.04, a.h / 2 - 0.1, 0.08, 0.06).fill(0xc8a030);
  },
  store_counter: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.02, 0.06);
    g.rect(-a.w / 2, -a.h / 2, a.w, 0.12).fill(shade(a.color, 1.2));
    for (let i = 0; i < 3; i++)
      g.rect(a.rng.range(-a.w / 2 + 0.1, a.w / 2 - 0.3), a.rng.range(-0.1, 0.15), 0.18, 0.12).fill(
        a.rng.pick([0xc8b890, 0x8a2a22, 0x3a5a8a]),
      );
  },
  register: (g, a) => {
    g.roundRect(-a.w / 2, -a.h / 2, a.w, a.h, 0.03).fill(a.color);
    g.rect(-a.w / 2 + 0.05, -a.h / 2 + 0.05, a.w - 0.1, 0.12).fill(0x3a6a4a);
  },
  checkout: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.06);
    g.rect(-a.w / 2 + 0.1, -a.h / 2 + 0.1, a.w * 0.6, a.h - 0.2).fill(0x1c1c1e);
    for (let x = -a.w / 2 + 0.2; x < -a.w / 2 + a.w * 0.6; x += 0.12)
      g.rect(x, -a.h / 2 + 0.12, 0.02, a.h - 0.24).fill({ color: 0x3a3a3c, alpha: 0.8 });
  },
  store_shelf: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x5a5a58, 0.02, 0.12);
    g.rect(-a.w / 2 + 0.03, -a.h / 2 + 0.03, a.w - 0.06, a.h - 0.06).fill(a.color);
    // Stock on the shelves — sparse and knocked over.
    const rows = a.h > 0.8 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const y0 = -a.h / 2 + 0.06 + r * (a.h / 2);
      let x = -a.w / 2 + 0.06;
      while (x < a.w / 2 - 0.1) {
        const bw = a.rng.range(0.06, 0.18);
        if (a.rng.chance(0.55))
          g.rect(x, y0, bw, a.h / rows - 0.12).fill(a.rng.pick([0xa83a2a, 0xc8a040, 0x3a6a3a, 0x3a4a7a, 0xd8d0c0, 0x7a4a2a, 0x8a3a6a]));
        x += bw + a.rng.range(0.01, 0.12);
      }
    }
    g.rect(-a.w / 2, -0.015, a.w, 0.03).fill(0x4a4a48);
  },
  produce_bin: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.04, 0.06);
    g.rect(-a.w / 2 + 0.06, -a.h / 2 + 0.06, a.w - 0.12, a.h - 0.12).fill(shade(a.color, 0.7));
    for (let i = 0; i < 26; i++)
      g.circle(a.rng.range(-a.w / 2 + 0.12, a.w / 2 - 0.12), a.rng.range(-a.h / 2 + 0.12, a.h / 2 - 0.12), 0.06).fill(
        a.rng.pick([0xa83a2a, 0xc88a2a, 0x6a8a3a, 0xc8b040, 0x5a3a2a]),
      );
  },
  cooler: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x8a9094, 0.02, 0.12);
    g.rect(-a.w / 2 + 0.05, -a.h / 2 + 0.05, a.w - 0.1, a.h - 0.1).fill({ color: a.color, alpha: 0.9 });
    for (let x = -a.w / 2 + 0.08; x < a.w / 2 - 0.08; x += 0.14)
      if (a.rng.chance(0.6))
        g.rect(x, -a.h / 2 + 0.12, 0.1, a.h - 0.3).fill(a.rng.pick([0xa82a2a, 0x3a6aa8, 0xe8e8e0, 0x3a8a3a, 0xc8a030]));
    g.rect(-a.w / 2, a.h / 2 - 0.08, a.w, 0.08).fill({ color: 0xd8e8f0, alpha: 0.5 });
  },
  freezer: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.06, 0.06);
    g.rect(-a.w / 2 + 0.06, -a.h / 2 + 0.06, a.w - 0.12, a.h - 0.12).fill({ color: 0xb8c8d4, alpha: 0.8 });
  },
  storage_rack: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x3a3e42, 0.02, 0.12);
    g.rect(-a.w / 2, -a.h / 2, a.w, a.h).stroke({ color: a.color, width: 0.06 });
    for (let i = 0; i < 4; i++)
      g.rect(-a.w / 2 + 0.1 + i * (a.w / 4), -a.h / 2 + 0.1, a.w / 4 - 0.15, a.h - 0.2).fill(
        a.rng.pick([0xa0845a, 0x8a7050, 0xb89a6a, 0x5a5a5a]),
      );
  },
  boxes: (g, a) => {
    for (let i = 0; i < 4; i++) {
      const bw = a.rng.range(0.4, 0.6);
      const bh = a.rng.range(0.35, 0.5);
      const x = a.rng.range(-a.w / 2 + bw / 2, a.w / 2 - bw / 2);
      const y = a.rng.range(-a.h / 2 + bh / 2, a.h / 2 - bh / 2);
      g.rect(x - bw / 2 + 0.05, y - bh / 2 + 0.06, bw, bh).fill(SHADOW);
      g.rect(x - bw / 2, y - bh / 2, bw, bh).fill(shade(a.color, a.rng.range(0.85, 1.1)));
      g.rect(x - 0.03, y - bh / 2, 0.06, bh).fill({ color: 0xc8b890, alpha: 0.7 });
    }
  },
  vending: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.12);
    g.rect(-a.w / 2 + 0.08, -a.h / 2 + 0.08, a.w * 0.6, a.h - 0.16).fill(0x1c2a34);
    g.rect(a.w / 2 - 0.2, -0.1, 0.1, 0.2).fill(0x8a8a84);
  },
  bunk: (g, a) => {
    boxWithShadow(g, a.w, a.h, a.color, 0.03, 0.05);
    g.rect(-a.w / 2 + 0.06, -a.h / 2 + 0.06, a.w - 0.12, a.h - 0.12).fill(0x5a6a5a);
  },
  water_cooler: (g) => {
    g.circle(0.04, 0.05, 0.24).fill(SHADOW);
    g.roundRect(-0.2, -0.2, 0.4, 0.4, 0.05).fill(0xd8d8d0);
    g.circle(0, 0, 0.15).fill({ color: 0x6aa0c8, alpha: 0.85 });
  },
  lumber_rack: (g, a) => {
    boxWithShadow(g, a.w, a.h, 0x4a4a48, 0.02, 0.06);
    for (let y = -a.h / 2 + 0.08; y < a.h / 2 - 0.08; y += 0.14)
      g.rect(-a.w / 2 + 0.05, y, a.w - 0.1, 0.1).fill(shade(a.color, a.rng.range(0.85, 1.1)));
  },
};

const contextCache = new Map<string, GraphicsContext>();

/** Returns a shared, cached GraphicsContext for a prop style. */
export function propContext(style: string, w: number, h: number, r: number, color: number, variant: number): GraphicsContext {
  const v = variant % 8;
  const key = `${style}|${w.toFixed(2)}|${h.toFixed(2)}|${r.toFixed(2)}|${color}|${v}`;
  let ctx = contextCache.get(key);
  if (ctx) return ctx;
  ctx = new GraphicsContext();
  const fn = PROP_STYLES[style];
  const rng = new Rng((v + 1) * 7919 + style.length * 131);
  if (fn) fn(ctx, { w, h, r, color, rng });
  else
    ctx
      .roundRect(-w / 2, -h / 2, w, h, 0.03)
      .fill(color)
      .stroke({ color: shade(color, 0.6), width: 0.03 });
  contextCache.set(key, ctx);
  return ctx;
}

export { shade };
