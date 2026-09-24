// In-hand weapon and item drawings. Local space: +x points forward from the grip (the hand),
// units are meters. Equipment rotates independently of the body, as the design suggests for a
// top-down view instead of per-direction sprite sheets.

import type { Graphics } from 'pixi.js';

export type HoldStyle = 'none' | 'handgun' | 'long' | 'melee' | 'item';

export function holdStyle(icon: string | undefined, isFirearm: boolean, isMelee: boolean): HoldStyle {
  if (!icon) return 'none';
  if (isFirearm) return icon === 'pistol' || icon === 'revolver' ? 'handgun' : 'long';
  if (isMelee) return 'melee';
  return 'item';
}

export function drawHeldItem(g: Graphics, icon: string | undefined, color: number): void {
  g.clear();
  const steel = 0x55595d;
  const dark = 0x1f2123;
  const wood = 0x7a5634;
  switch (icon) {
    case 'pistol':
      g.roundRect(-0.03, -0.024, 0.24, 0.048, 0.012).fill(dark);
      g.rect(0.05, -0.016, 0.16, 0.032).fill(0x33363a);
      break;
    case 'revolver':
      g.roundRect(-0.03, -0.022, 0.1, 0.044, 0.01).fill(0x3a2a1c);
      g.circle(0.07, 0, 0.034).fill(0x4a4d50);
      g.rect(0.08, -0.013, 0.17, 0.026).fill(0x5a5d60);
      break;
    case 'shotgun':
      g.roundRect(-0.34, -0.035, 0.34, 0.07, 0.02).fill(wood);
      g.rect(-0.02, -0.03, 0.2, 0.06).fill(dark);
      g.rect(0.16, -0.022, 0.52, 0.044).fill(0x3a3d40);
      g.roundRect(0.26, -0.038, 0.18, 0.076, 0.02).fill(0x5a4028);
      break;
    case 'rifle':
      g.roundRect(-0.36, -0.035, 0.4, 0.07, 0.02).fill(wood);
      g.rect(0.02, -0.026, 0.2, 0.052).fill(dark);
      g.rect(0.2, -0.016, 0.62, 0.032).fill(0x2e3134);
      g.roundRect(0.0, -0.05, 0.28, 0.03, 0.01).fill(0x16181a);
      break;
    case 'carbine':
      g.roundRect(-0.3, -0.032, 0.26, 0.064, 0.015).fill(0x202224);
      g.rect(-0.04, -0.034, 0.36, 0.068).fill(0x2a2c2e);
      g.rect(0.3, -0.017, 0.34, 0.034).fill(0x1c1e20);
      g.rect(0.08, 0.03, 0.06, 0.12).fill(0x26282a);
      break;
    case 'bat':
      g.poly([0, -0.018, 0.82, -0.036, 0.84, 0, 0.82, 0.036, 0, 0.018]).fill(0x9c7a4f);
      g.rect(-0.08, -0.02, 0.1, 0.04).fill(0x2a2420);
      break;
    case 'knife':
      g.rect(-0.08, -0.016, 0.1, 0.032).fill(0x2a2420);
      g.poly([0.02, -0.02, 0.26, -0.004, 0.02, 0.022]).fill(0xb7b9bb);
      break;
    case 'hammer':
      g.rect(-0.02, -0.016, 0.34, 0.032).fill(wood);
      g.rect(0.28, -0.08, 0.07, 0.16).fill(steel);
      break;
    case 'crowbar':
      g.rect(-0.02, -0.018, 0.74, 0.036).fill(0x7a2e2a);
      g.poly([0.72, -0.018, 0.8, -0.06, 0.82, -0.04, 0.76, 0.018]).fill(0x7a2e2a);
      break;
    case 'machete':
      g.rect(-0.1, -0.02, 0.12, 0.04).fill(0x2a2420);
      g.poly([0.02, -0.03, 0.54, -0.05, 0.6, 0.0, 0.02, 0.03]).fill(0x8f9396);
      break;
    case 'hatchet':
      g.rect(-0.04, -0.017, 0.44, 0.034).fill(wood);
      g.poly([0.3, -0.02, 0.44, -0.11, 0.46, 0.02, 0.3, 0.03]).fill(steel);
      break;
    case 'axe':
      g.rect(-0.05, -0.02, 0.9, 0.04).fill(0x8a6a44);
      g.poly([0.66, -0.02, 0.86, -0.16, 0.9, 0.03, 0.66, 0.03]).fill(0xb0302a);
      g.poly([0.86, -0.16, 0.9, 0.03, 0.93, -0.06]).fill(0x9a9ea2);
      break;
    case 'shovel':
      g.rect(-0.05, -0.018, 0.86, 0.036).fill(0x7a6040);
      g.roundRect(0.8, -0.1, 0.24, 0.2, 0.04).fill(0x6b6a5a);
      break;
    case 'pipe':
      g.rect(-0.04, -0.024, 0.72, 0.048).fill(0x72767a);
      g.rect(-0.04, -0.03, 0.05, 0.06).fill(0x5a5e62);
      break;
    case 'wrench':
      g.rect(-0.04, -0.02, 0.36, 0.04).fill(0x9a3024);
      g.rect(0.3, -0.06, 0.1, 0.12).fill(0x6a6e72);
      break;
    case 'pan':
      g.rect(-0.04, -0.016, 0.24, 0.032).fill(0x303234);
      g.circle(0.34, 0, 0.14).fill(0x28292b);
      g.circle(0.34, 0, 0.11).fill(0x38393b);
      break;
    case 'baton':
      g.rect(-0.08, -0.02, 0.66, 0.04).fill(0x1e1f22);
      g.rect(0.05, -0.02, 0.02, 0.1).fill(0x1e1f22);
      break;
    case 'spear':
      g.rect(-0.3, -0.018, 1.45, 0.036).fill(0x8c7250);
      g.poly([1.12, -0.03, 1.4, 0, 1.12, 0.03]).fill(0xb7b9bb);
      g.rect(1.08, -0.03, 0.06, 0.06).fill(0x8a8e92);
      break;
    case 'flashlight':
      g.roundRect(-0.03, -0.025, 0.2, 0.05, 0.015).fill(0x3a3a3c);
      g.rect(0.15, -0.032, 0.04, 0.064).fill(0x5a5a5c);
      break;
    case 'lantern':
      g.roundRect(-0.02, -0.06, 0.12, 0.12, 0.03).fill(0x4a6a3a);
      g.circle(0.04, 0, 0.035).fill(0xf0e0a0);
      break;
    default:
      if (icon) g.roundRect(-0.02, -0.05, 0.12, 0.1, 0.02).fill(color);
      break;
  }
}
