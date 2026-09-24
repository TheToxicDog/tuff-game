// Procedural inventory icons, drawn per item from its `icon` shape and `color`. Every item gets a
// readable silhouette until hand-painted icons exist (design plan §82, Item icons).

import type { ItemDef } from '@tuff/shared';

const cache = new Map<string, string>();
const SIZE = 64;

type Draw = (g: CanvasRenderingContext2D, c: string, dark: string) => void;

function shadeHex(hex: string, f: number): string {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.round(((v >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((v >> 8) & 255) * f));
  const b = Math.min(255, Math.round((v & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

const ICONS: Record<string, Draw> = {
  pistol: (g, c, d) => {
    g.fillStyle = d;
    rr(g, 10, 22, 42, 12, 3);
    g.fillStyle = c;
    rr(g, 12, 24, 38, 7, 2);
    g.fillStyle = d;
    g.beginPath();
    g.moveTo(14, 32);
    g.lineTo(26, 32);
    g.lineTo(22, 50);
    g.lineTo(12, 50);
    g.closePath();
    g.fill();
  },
  revolver: (g, c, d) => {
    g.fillStyle = shadeHex('#8a8e92', 1);
    rr(g, 26, 25, 30, 7, 2);
    g.fillStyle = d;
    g.beginPath();
    g.arc(24, 30, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(14, 30);
    g.lineTo(22, 34);
    g.lineTo(18, 50);
    g.lineTo(9, 48);
    g.closePath();
    g.fill();
  },
  shotgun: (g, c, d) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.5);
    g.fillStyle = c;
    rr(g, -30, -4, 18, 9, 3);
    g.fillStyle = d;
    rr(g, -12, -4, 40, 6, 2);
    g.fillStyle = shadeHex('#5a4028', 1);
    rr(g, 2, 1, 12, 5, 2);
    g.restore();
  },
  rifle: (g, c, d) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.5);
    g.fillStyle = c;
    rr(g, -30, -4, 26, 8, 3);
    g.fillStyle = d;
    rr(g, -6, -3, 36, 5, 2);
    rr(g, -10, -9, 16, 4, 2);
    g.restore();
  },
  carbine: (g, c, d) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.5);
    g.fillStyle = d;
    rr(g, -28, -4, 50, 8, 2);
    g.fillStyle = c;
    rr(g, -4, 3, 7, 12, 1);
    g.restore();
  },
  rounds: (g, c) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = c;
      rr(g, 14 + i * 9, 24, 6, 22, 2);
      g.fillStyle = '#b8b0a0';
      g.beginPath();
      g.ellipse(17 + i * 9, 23, 3, 6, 0, Math.PI, 0);
      g.fill();
    }
  },
  shells: (g, c) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle = c;
      rr(g, 14 + i * 13, 18, 10, 24, 2);
      g.fillStyle = '#c8a040';
      rr(g, 14 + i * 13, 38, 10, 8, 1);
    }
  },
  bat: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(-26, -2);
    g.lineTo(24, -5);
    g.lineTo(26, 0);
    g.lineTo(24, 5);
    g.lineTo(-26, 2);
    g.closePath();
    g.fill();
    g.restore();
  },
  knife: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = '#2a2420';
    rr(g, -24, -3, 16, 7, 2);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(-8, -4);
    g.lineTo(24, 0);
    g.lineTo(-8, 5);
    g.closePath();
    g.fill();
    g.restore();
  },
  blade: (g, c) => ICONS.knife(g, c, c),
  machete: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = '#2a2420';
    rr(g, -26, -3, 14, 7, 2);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(-12, -5);
    g.lineTo(24, -7);
    g.lineTo(26, 1);
    g.lineTo(-12, 5);
    g.closePath();
    g.fill();
    g.restore();
  },
  hammer: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = c;
    rr(g, -24, -3, 40, 6, 2);
    g.fillStyle = '#6a6e72';
    rr(g, 12, -11, 9, 22, 2);
    g.restore();
  },
  crowbar: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.strokeStyle = c;
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-24, 0);
    g.lineTo(20, 0);
    g.quadraticCurveTo(28, 0, 26, -8);
    g.stroke();
    g.restore();
  },
  hatchet: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = c;
    rr(g, -24, -3, 42, 6, 2);
    g.fillStyle = '#8a8e92';
    g.beginPath();
    g.moveTo(8, -3);
    g.lineTo(22, -14);
    g.lineTo(24, 3);
    g.lineTo(8, 3);
    g.closePath();
    g.fill();
    g.restore();
  },
  axe: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = '#8a6a44';
    rr(g, -28, -3, 50, 6, 2);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(10, -3);
    g.lineTo(24, -16);
    g.lineTo(27, 4);
    g.lineTo(10, 4);
    g.closePath();
    g.fill();
    g.restore();
  },
  shovel: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = '#7a6040';
    rr(g, -28, -2, 40, 5, 2);
    g.fillStyle = c;
    rr(g, 10, -8, 18, 16, 4);
    g.restore();
  },
  pipe: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = c;
    rr(g, -26, -4, 52, 8, 3);
    g.restore();
  },
  wrench: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = c;
    rr(g, -24, -3, 36, 7, 2);
    g.fillStyle = '#6a6e72';
    rr(g, 10, -9, 12, 18, 2);
    g.restore();
  },
  pan: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(38, 30, 16, 0, Math.PI * 2);
    g.fill();
    rr(g, 6, 27, 20, 6, 3);
  },
  baton: (g, c) => ICONS.pipe(g, c, c),
  spear: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.8);
    g.fillStyle = c;
    rr(g, -30, -2, 48, 4, 2);
    g.fillStyle = '#b7b9bb';
    g.beginPath();
    g.moveTo(16, -5);
    g.lineTo(30, 0);
    g.lineTo(16, 5);
    g.closePath();
    g.fill();
    g.restore();
  },
  can: (g, c) => {
    g.fillStyle = '#9a9ea2';
    rr(g, 18, 14, 28, 38, 5);
    g.fillStyle = c;
    rr(g, 18, 22, 28, 22, 2);
    g.fillStyle = '#c8ccd0';
    g.beginPath();
    g.ellipse(32, 15, 14, 4, 0, 0, Math.PI * 2);
    g.fill();
  },
  tin: (g, c) => {
    g.fillStyle = '#b8bcc0';
    rr(g, 12, 22, 40, 22, 8);
    g.fillStyle = c;
    rr(g, 14, 27, 36, 12, 5);
  },
  jar: (g, c) => {
    g.fillStyle = c;
    rr(g, 18, 18, 28, 34, 7);
    g.fillStyle = '#6a6a64';
    rr(g, 20, 12, 24, 8, 2);
  },
  box: (g, c) => {
    g.fillStyle = c;
    rr(g, 16, 12, 32, 42, 3);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    rr(g, 20, 20, 24, 10, 2);
  },
  bag: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(16, 16);
    g.lineTo(48, 16);
    g.lineTo(50, 52);
    g.lineTo(14, 52);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(16, 16, 32, 5);
  },
  bar: (g, c) => {
    g.fillStyle = c;
    rr(g, 10, 24, 44, 16, 3);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(24, 24, 8, 16);
  },
  bread: (g, c) => {
    g.fillStyle = c;
    rr(g, 12, 20, 40, 26, 12);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let x = 20; x < 48; x += 8) {
      g.beginPath();
      g.moveTo(x, 24);
      g.lineTo(x + 4, 40);
      g.stroke();
    }
  },
  fruit: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(32, 36, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4a6a2a';
    g.beginPath();
    g.ellipse(36, 18, 6, 3, -0.5, 0, Math.PI * 2);
    g.fill();
  },
  banana: (g, c) => {
    g.strokeStyle = c;
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(32, 16, 24, 0.5, 2.6);
    g.stroke();
  },
  carrot: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(20, 20);
    g.lineTo(46, 46);
    g.lineTo(28, 16);
    g.closePath();
    g.fill();
    g.fillStyle = '#4a7a2a';
    g.fillRect(16, 12, 8, 8);
  },
  potato: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(32, 34, 18, 13, 0.3, 0, Math.PI * 2);
    g.fill();
  },
  cheese: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(10, 44);
    g.lineTo(54, 44);
    g.lineTo(54, 26);
    g.closePath();
    g.fill();
  },
  candy: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(32, 32, 10, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(22, 32);
    g.lineTo(10, 24);
    g.lineTo(10, 40);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(42, 32);
    g.lineTo(54, 24);
    g.lineTo(54, 40);
    g.closePath();
    g.fill();
  },
  bottle: (g, c) => {
    g.fillStyle = c;
    rr(g, 22, 20, 20, 36, 5);
    rr(g, 27, 8, 10, 14, 2);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(25, 24, 4, 26);
  },
  soda: (g, c) => {
    g.fillStyle = c;
    rr(g, 20, 12, 24, 42, 6);
    g.fillStyle = '#c8ccd0';
    rr(g, 21, 10, 22, 5, 2);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(24, 22, 4, 26);
  },
  carton: (g, c) => {
    g.fillStyle = c;
    rr(g, 20, 14, 24, 40, 2);
    g.fillStyle = '#e8e8e0';
    g.fillRect(24, 22, 16, 12);
  },
  cloth: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(12, 18);
    g.lineTo(50, 14);
    g.lineTo(52, 46);
    g.lineTo(14, 50);
    g.closePath();
    g.fill();
  },
  plaster: (g, c) => {
    g.fillStyle = c;
    rr(g, 10, 24, 44, 16, 7);
    g.fillStyle = '#f0e8dc';
    rr(g, 24, 26, 16, 12, 3);
  },
  bandage: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(32, 32, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.beginPath();
    g.arc(32, 32, 6, 0, Math.PI * 2);
    g.fill();
  },
  gauze: (g, c) => {
    g.fillStyle = c;
    rr(g, 14, 14, 36, 36, 3);
    g.strokeStyle = '#c8c4b8';
    g.strokeRect(18, 18, 28, 28);
  },
  wipe: (g, c) => {
    g.fillStyle = c;
    rr(g, 12, 20, 40, 24, 3);
    g.fillStyle = '#3a6aa8';
    g.fillRect(12, 28, 40, 6);
  },
  vial: (g, c) => {
    g.fillStyle = c;
    rr(g, 22, 18, 20, 36, 4);
    g.fillStyle = '#e8e8e0';
    rr(g, 24, 10, 16, 10, 2);
  },
  pills: (g, c) => {
    g.fillStyle = '#e8e4d8';
    rr(g, 20, 16, 24, 38, 5);
    g.fillStyle = c;
    rr(g, 20, 26, 24, 14, 2);
    g.fillStyle = '#d8d4c8';
    rr(g, 18, 10, 28, 8, 2);
  },
  splint: (g, c) => {
    g.fillStyle = c;
    rr(g, 12, 16, 10, 34, 3);
    rr(g, 42, 16, 10, 34, 3);
    g.fillStyle = '#e8e8e0';
    g.fillRect(12, 26, 40, 5);
    g.fillRect(12, 38, 40, 5);
  },
  kit: (g, c) => {
    g.fillStyle = c;
    rr(g, 10, 18, 44, 30, 5);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(28, 12, 8, 8);
  },
  medkit: (g, c) => {
    g.fillStyle = c;
    rr(g, 10, 16, 44, 34, 5);
    g.fillStyle = '#f0f0e8';
    g.fillRect(28, 22, 8, 22);
    g.fillRect(21, 29, 22, 8);
  },
  flashlight: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.6);
    g.fillStyle = c;
    rr(g, -22, -6, 34, 12, 3);
    g.fillStyle = '#5a5a5c';
    rr(g, 10, -9, 12, 18, 3);
    g.fillStyle = '#f0e8b0';
    g.fillRect(20, -6, 3, 12);
    g.restore();
  },
  lantern: (g, c) => {
    g.fillStyle = c;
    rr(g, 18, 16, 28, 36, 5);
    g.fillStyle = '#f0e0a0';
    rr(g, 24, 24, 16, 20, 4);
  },
  battery: (g, c) => {
    g.fillStyle = c;
    rr(g, 12, 22, 36, 20, 3);
    g.fillStyle = '#2a2a2a';
    g.fillRect(12, 22, 12, 20);
    g.fillStyle = '#9a9a9a';
    g.fillRect(48, 28, 4, 8);
  },
  backpack: (g, c) => {
    g.fillStyle = c;
    rr(g, 14, 12, 36, 44, 10);
    g.fillStyle = shadeHex('#000000', 1);
    g.globalAlpha = 0.25;
    rr(g, 18, 34, 28, 16, 5);
    g.globalAlpha = 1;
  },
  duffel: (g, c) => {
    g.fillStyle = c;
    rr(g, 8, 22, 48, 24, 12);
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 22, 10, Math.PI, 0);
    g.stroke();
  },
  plasticbag: (g, c) => {
    g.fillStyle = c;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(18, 22);
    g.lineTo(46, 22);
    g.lineTo(50, 52);
    g.lineTo(14, 52);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = c;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(26, 22, 5, Math.PI, 0);
    g.arc(38, 22, 5, Math.PI, 0);
    g.stroke();
  },
  plank: (g, c) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.6);
    g.fillStyle = c;
    rr(g, -28, -6, 56, 12, 1);
    g.restore();
  },
  nails: (g, c) => {
    g.strokeStyle = c;
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(14 + i * 8, 16 + (i % 2) * 6);
      g.lineTo(20 + i * 8, 48);
      g.stroke();
    }
  },
  scrap: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(10, 30);
    g.lineTo(30, 12);
    g.lineTo(52, 22);
    g.lineTo(46, 50);
    g.lineTo(18, 48);
    g.closePath();
    g.fill();
  },
  gascan: (g, c) => {
    g.fillStyle = c;
    rr(g, 14, 16, 36, 40, 4);
    g.fillStyle = '#1a1a1a';
    g.fillRect(40, 10, 8, 8);
  },
  tank: (g, c) => {
    g.fillStyle = c;
    rr(g, 18, 16, 28, 40, 12);
  },
  tape: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(32, 32, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#121413';
    g.beginPath();
    g.arc(32, 32, 9, 0, Math.PI * 2);
    g.fill();
  },
  rope: (g, c) => {
    g.strokeStyle = c;
    g.lineWidth = 5;
    for (let r = 6; r < 22; r += 6) {
      g.beginPath();
      g.arc(32, 32, r, 0, Math.PI * 2);
      g.stroke();
    }
  },
  book: (g, c) => {
    g.fillStyle = c;
    rr(g, 16, 12, 32, 42, 2);
    g.fillStyle = '#e8e4d8';
    g.fillRect(44, 14, 3, 38);
  },
  magazine: (g, c) => {
    g.fillStyle = c;
    rr(g, 16, 12, 32, 42, 1);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(20, 16, 24, 6);
  },
  paper: (g, c) => {
    g.fillStyle = c;
    g.fillRect(14, 12, 36, 42);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 20; y < 50; y += 6) g.fillRect(18, y, 28, 2);
  },
  key: (g, c) => {
    g.strokeStyle = c;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(22, 26, 8, 0, Math.PI * 2);
    g.moveTo(28, 32);
    g.lineTo(48, 50);
    g.stroke();
  },
  phone: (g, c) => {
    g.fillStyle = c;
    rr(g, 20, 10, 24, 44, 5);
    g.fillStyle = '#2a3a44';
    rr(g, 23, 15, 18, 32, 2);
  },
  radio: (g, c) => {
    g.fillStyle = c;
    rr(g, 12, 20, 40, 30, 4);
    g.fillStyle = '#8a8a8a';
    g.beginPath();
    g.arc(24, 35, 7, 0, Math.PI * 2);
    g.fill();
    g.fillRect(40, 8, 3, 14);
  },
  laptop: (g, c) => {
    g.fillStyle = c;
    rr(g, 10, 16, 44, 30, 3);
    g.fillStyle = '#1a2228';
    rr(g, 14, 20, 36, 22, 2);
  },
  wallet: (g, c) => {
    g.fillStyle = c;
    rr(g, 12, 20, 40, 26, 4);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(12, 30, 40, 3);
  },
  watch: (g, c) => {
    g.fillStyle = '#3a3a3a';
    g.fillRect(27, 8, 10, 48);
    g.fillStyle = c;
    g.beginPath();
    g.arc(32, 32, 12, 0, Math.PI * 2);
    g.fill();
  },
  ring: (g, c) => {
    g.strokeStyle = c;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(32, 34, 14, 0, Math.PI * 2);
    g.stroke();
  },
  pot: (g, c, d) => {
    g.fillStyle = d;
    rr(g, 6, 26, 10, 5, 2);
    rr(g, 48, 26, 10, 5, 2);
    g.fillStyle = c;
    rr(g, 14, 20, 36, 32, 6);
    g.fillStyle = shadeHex('#8a8e92', 1.25);
    g.beginPath();
    g.ellipse(32, 21, 18, 5, 0, 0, Math.PI * 2);
    g.fill();
  },
  bowl: (g, c) => {
    g.fillStyle = '#d8d0c0';
    g.beginPath();
    g.ellipse(32, 34, 22, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(32, 32, 17, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(24, 22, 3, 6);
    g.fillRect(34, 20, 3, 6);
  },
  meat: (g, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(30, 32, 20, 14, -0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,240,220,0.55)';
    g.beginPath();
    g.ellipse(22, 28, 5, 3, -0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8e0d0';
    rr(g, 46, 36, 12, 5, 2);
  },
  mug: (g, c) => {
    g.strokeStyle = c;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(46, 34, 7, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.fillStyle = c;
    rr(g, 16, 18, 30, 34, 5);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(31, 20, 13, 3, 0, 0, Math.PI * 2);
    g.fill();
  },
  default: (g, c) => {
    g.fillStyle = c;
    rr(g, 14, 14, 36, 36, 8);
  },
};

const canvasCache = new Map<string, HTMLCanvasElement>();

/** The icon drawn into a canvas (shared; do not draw into it). */
export function itemIconCanvas(def: ItemDef | undefined): HTMLCanvasElement {
  const key = def ? def.id : '?';
  let canvas = canvasCache.get(key);
  if (!canvas) {
    canvas = drawIcon(def);
    canvasCache.set(key, canvas);
  }
  return canvas;
}

/** Data URL of an item's icon. */
export function itemIconUrl(def: ItemDef | undefined): string {
  const key = def ? def.id : '?';
  const cached = cache.get(key);
  if (cached) return cached;
  const url = itemIconCanvas(def).toDataURL();
  cache.set(key, url);
  return url;
}

function drawIcon(def: ItemDef | undefined): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  const color = def?.color ?? '#8a8a84';
  const dark = shadeHex(color, 0.55);
  // Soft shadow for depth.
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 2;
  const draw = ICONS[def?.icon ?? 'default'] ?? ICONS.default;
  draw(g, color, dark);
  return canvas;
}

export function iconImage(def: ItemDef | undefined, size = 34): HTMLImageElement {
  const img = new Image(size, size);
  img.src = itemIconUrl(def);
  img.alt = def?.name ?? '';
  img.draggable = false;
  return img;
}
