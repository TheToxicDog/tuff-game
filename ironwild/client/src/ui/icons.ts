// Item icons, painted procedurally on canvases: chunky flat shapes with dark outlines to match the
// world's style. Structure items get a miniature of the real structure from the renderer.

import { ITEM_BY_ID, type IconSpec, type ItemDef } from '@ironwild/shared';

const SIZE = 64;
const cache = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
const structureIcons = new Map<string, HTMLCanvasElement>();

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function shadeHex(c: number, f: number): string {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

const OUTLINE = 'rgba(25, 22, 18, 0.85)';

type Ctx = CanvasRenderingContext2D;

function fillStroke(ctx: Ctx, fill: string, width = 3): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function poly(ctx: Ctx, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function rock(ctx: Ctx, cx: number, cy: number, r: number, color: number, seed = 1): void {
  const pts: number[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 0.3;
    const rr = r * (0.82 + 0.18 * Math.sin(i * 2.3 + seed));
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
  }
  poly(ctx, pts);
  fillStroke(ctx, hex(color));
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  circle(ctx, cx - r * 0.3, cy - r * 0.3, r * 0.35);
  ctx.fill();
}

function gearPath(ctx: Ctx, cx: number, cy: number, r: number, teeth: number): void {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.78;
    ctx.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
    ctx.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr);
  }
  ctx.closePath();
}

function toolHead(ctx: Ctx, kind: string, color: string): void {
  // Handle
  ctx.save();
  ctx.translate(32, 32);
  ctx.rotate(-Math.PI / 4);
  ctx.beginPath();
  ctx.roundRect(-4, -26, 8, 52, 3);
  fillStroke(ctx, '#8a5a33');
  if (kind === 'axe') {
    ctx.beginPath();
    ctx.moveTo(2, -24);
    ctx.quadraticCurveTo(22, -24, 20, -6);
    ctx.lineTo(2, -10);
    ctx.closePath();
    fillStroke(ctx, color);
  } else if (kind === 'pickaxe') {
    ctx.beginPath();
    ctx.moveTo(-24, -14);
    ctx.quadraticCurveTo(0, -30, 24, -14);
    ctx.lineTo(18, -12);
    ctx.quadraticCurveTo(0, -22, -18, -12);
    ctx.closePath();
    fillStroke(ctx, color);
  } else if (kind === 'hammer') {
    ctx.beginPath();
    ctx.roundRect(-13, -28, 26, 13, 3);
    fillStroke(ctx, color);
  } else if (kind === 'hoe') {
    ctx.beginPath();
    ctx.moveTo(-2, -26);
    ctx.lineTo(16, -26);
    ctx.lineTo(16, -16);
    ctx.lineTo(4, -18);
    ctx.closePath();
    fillStroke(ctx, color);
  }
  ctx.restore();
}

function drawShape(ctx: Ctx, spec: IconSpec, def: ItemDef): void {
  const c = hex(spec.color);
  const a = spec.accent !== undefined ? hex(spec.accent) : shadeHex(spec.color, 1.3);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (spec.shape) {
    case 'log': {
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(-0.5);
      ctx.beginPath();
      ctx.roundRect(-24, -11, 44, 22, 8);
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.ellipse(20, 0, 7, 11, 0, 0, Math.PI * 2);
      fillStroke(ctx, a);
      ctx.strokeStyle = shadeHex(spec.color, 0.75);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(20, 0, 3, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'plank':
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.roundRect(10 + i * 4, 14 + i * 16, 42, 13, 3);
        fillStroke(ctx, i ? shadeHex(spec.color, 0.9) : c);
        ctx.strokeStyle = shadeHex(spec.color, 0.7);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(16 + i * 4, 20 + i * 16);
        ctx.lineTo(46 + i * 4, 20 + i * 16);
        ctx.stroke();
      }
      break;
    case 'stone':
      rock(ctx, 26, 36, 16, spec.color, 1);
      rock(ctx, 42, 28, 11, spec.color, 2);
      break;
    case 'ore': {
      rock(ctx, 32, 33, 22, spec.color, 3);
      const acc = spec.accent ?? 0xffffff;
      for (const [x, y, r] of [
        [24, 28, 5],
        [38, 24, 4],
        [36, 40, 6],
        [22, 42, 3],
      ]) {
        poly(ctx, [x - r, y, x, y - r, x + r, y, x, y + r]);
        fillStroke(ctx, hex(acc), 1.5);
      }
      break;
    }
    case 'crushed':
      for (const [x, y, r] of [
        [20, 38, 8],
        [34, 42, 7],
        [44, 32, 8],
        [28, 26, 7],
        [40, 20, 5],
      ]) {
        poly(ctx, [x - r, y, x - r * 0.3, y - r, x + r, y - r * 0.2, x + r * 0.4, y + r]);
        fillStroke(ctx, x % 2 ? c : a, 2);
      }
      break;
    case 'dust':
      ctx.beginPath();
      ctx.moveTo(8, 50);
      ctx.quadraticCurveTo(32, 6, 56, 50);
      ctx.closePath();
      fillStroke(ctx, c);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 6; i++) {
        circle(ctx, 20 + ((i * 7) % 24), 38 - ((i * 5) % 14), 2);
        ctx.fill();
      }
      break;
    case 'lump':
      ctx.beginPath();
      ctx.ellipse(32, 36, 22, 16, -0.2, 0, Math.PI * 2);
      fillStroke(ctx, c);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.ellipse(26, 30, 8, 5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'ingot':
      poly(ctx, [10, 44, 18, 24, 46, 24, 54, 44]);
      fillStroke(ctx, c);
      poly(ctx, [18, 24, 46, 24, 42, 30, 22, 30]);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
      break;
    case 'plate':
      poly(ctx, [12, 26, 38, 14, 54, 30, 28, 44]);
      fillStroke(ctx, c);
      poly(ctx, [12, 26, 28, 44, 28, 50, 12, 32]);
      fillStroke(ctx, shadeHex(spec.color, 0.7), 2);
      poly(ctx, [28, 44, 54, 30, 54, 36, 28, 50]);
      fillStroke(ctx, shadeHex(spec.color, 0.85), 2);
      break;
    case 'rod':
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(32, 32 + (i - 1) * 10);
        ctx.rotate(-0.35);
        ctx.beginPath();
        ctx.roundRect(-24, -4, 48, 8, 4);
        fillStroke(ctx, c, 2.5);
        ctx.restore();
      }
      break;
    case 'gear':
      gearPath(ctx, 32, 32, 24, 10);
      fillStroke(ctx, c);
      circle(ctx, 32, 32, 8);
      fillStroke(ctx, shadeHex(spec.color, 0.6));
      break;
    case 'wire':
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) ctx.ellipse(32, 18 + i * 9, 18, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) ctx.ellipse(32, 18 + i * 9, 18, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'bearing':
      circle(ctx, 32, 32, 24);
      fillStroke(ctx, c);
      circle(ctx, 32, 32, 13);
      fillStroke(ctx, shadeHex(spec.color, 0.6));
      ctx.fillStyle = '#e8ecf0';
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * Math.PI * 2;
        circle(ctx, 32 + Math.cos(an) * 18.5, 32 + Math.sin(an) * 18.5, 3.5);
        ctx.fill();
      }
      break;
    case 'box':
      ctx.beginPath();
      ctx.roundRect(10, 14, 44, 38, 5);
      fillStroke(ctx, c);
      gearPath(ctx, 32, 33, 12, 8);
      fillStroke(ctx, a, 2);
      break;
    case 'pump':
      ctx.beginPath();
      ctx.roundRect(8, 22, 34, 28, 6);
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.roundRect(38, 30, 18, 10, 3);
      fillStroke(ctx, '#9aa3ad');
      circle(ctx, 24, 36, 9);
      fillStroke(ctx, '#d0d6dd', 2);
      ctx.beginPath();
      ctx.roundRect(18, 10, 12, 14, 3);
      fillStroke(ctx, '#9aa3ad');
      break;
    case 'sack':
      ctx.beginPath();
      ctx.moveTo(18, 22);
      ctx.quadraticCurveTo(6, 54, 32, 54);
      ctx.quadraticCurveTo(58, 54, 46, 22);
      ctx.closePath();
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.roundRect(22, 12, 20, 12, 4);
      fillStroke(ctx, shadeHex(spec.color, 0.85));
      break;
    case 'bread':
      ctx.beginPath();
      ctx.ellipse(32, 36, 25, 15, -0.15, 0, Math.PI * 2);
      fillStroke(ctx, c);
      ctx.strokeStyle = shadeHex(spec.color, 1.3);
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(20 + i * 11, 28);
        ctx.lineTo(26 + i * 11, 40);
        ctx.stroke();
      }
      break;
    case 'bowl':
      ctx.beginPath();
      ctx.ellipse(32, 30, 24, 9, 0, 0, Math.PI * 2);
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.moveTo(8, 30);
      ctx.quadraticCurveTo(32, 66, 56, 30);
      ctx.closePath();
      fillStroke(ctx, '#8a5a33');
      break;
    case 'meat':
      ctx.beginPath();
      ctx.ellipse(28, 34, 20, 15, -0.4, 0, Math.PI * 2);
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.roundRect(40, 14, 8, 22, 4);
      fillStroke(ctx, '#f3ead8');
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.ellipse(24, 30, 8, 5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'hide':
      poly(ctx, [12, 18, 24, 12, 40, 12, 52, 18, 50, 34, 56, 48, 40, 52, 24, 52, 8, 48, 14, 34]);
      fillStroke(ctx, c);
      if (spec.accent !== undefined) {
        ctx.strokeStyle = a;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        poly(ctx, [18, 22, 46, 22, 44, 44, 20, 44]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      break;
    case 'antler':
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(18, 54);
      ctx.quadraticCurveTo(22, 24, 44, 10);
      ctx.moveTo(24, 36);
      ctx.lineTo(12, 22);
      ctx.moveTo(32, 22);
      ctx.lineTo(30, 10);
      ctx.moveTo(34, 30);
      ctx.lineTo(50, 26);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 5;
      ctx.stroke();
      break;
    case 'berry':
      for (const [x, y] of [
        [24, 30],
        [38, 28],
        [30, 42],
        [44, 40],
        [20, 44],
      ]) {
        circle(ctx, x, y, 8);
        fillStroke(ctx, c, 2.5);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        circle(ctx, x - 3, y - 3, 2);
        ctx.fill();
      }
      ctx.fillStyle = '#4f8a3a';
      poly(ctx, [30, 18, 40, 10, 42, 20]);
      ctx.fill();
      break;
    case 'mushroom':
      ctx.beginPath();
      ctx.roundRect(26, 30, 12, 22, 4);
      fillStroke(ctx, '#f0e6d2');
      ctx.beginPath();
      ctx.ellipse(32, 30, 22, 14, 0, Math.PI, 0);
      ctx.closePath();
      fillStroke(ctx, c);
      ctx.fillStyle = '#fff';
      for (const [x, y] of [
        [24, 24],
        [34, 20],
        [40, 26],
      ]) {
        circle(ctx, x, y, 2.5);
        ctx.fill();
      }
      break;
    case 'herb':
    case 'fiber':
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        ctx.moveTo(32, 56);
        ctx.quadraticCurveTo(20 + i * 6, 34, 12 + i * 10, 12 + (i % 2) * 6);
      }
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (spec.shape === 'herb') {
        ctx.fillStyle = a;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.ellipse(12 + i * 10, 14 + (i % 2) * 6, 5, 3, i, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case 'wheat':
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = shadeHex(spec.color, 0.7);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(24 + i * 8, 58);
        ctx.lineTo(20 + i * 12, 22);
        ctx.stroke();
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(20 + i * 12 + (k % 2 ? 3 : -3), 12 + k * 6, 3.5, 5, k % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
          fillStroke(ctx, c, 1.5);
        }
      }
      break;
    case 'seed':
      for (const [x, y] of [
        [22, 28],
        [36, 24],
        [30, 40],
        [44, 38],
        [18, 42],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x, y, 5, 7, x / 10, 0, Math.PI * 2);
        fillStroke(ctx, c, 2);
      }
      break;
    case 'carrot':
      poly(ctx, [18, 20, 30, 16, 50, 54, 44, 56]);
      fillStroke(ctx, c);
      ctx.fillStyle = '#5aa24a';
      poly(ctx, [18, 20, 8, 6, 22, 12, 30, 4, 30, 16]);
      ctx.fill();
      break;
    case 'potato':
      ctx.beginPath();
      ctx.ellipse(32, 34, 22, 16, 0.3, 0, Math.PI * 2);
      fillStroke(ctx, c);
      ctx.fillStyle = shadeHex(spec.color, 0.7);
      for (const [x, y] of [
        [24, 30],
        [38, 38],
        [34, 26],
      ]) {
        circle(ctx, x, y, 2);
        ctx.fill();
      }
      break;
    case 'cotton':
      ctx.strokeStyle = '#6b8a3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(32, 58);
      ctx.lineTo(32, 34);
      ctx.stroke();
      for (const [x, y] of [
        [26, 26],
        [38, 26],
        [32, 18],
        [32, 32],
      ]) {
        circle(ctx, x, y, 9);
        fillStroke(ctx, c, 2);
      }
      break;
    case 'egg':
      ctx.beginPath();
      ctx.ellipse(32, 34, 16, 21, 0, 0, Math.PI * 2);
      fillStroke(ctx, c);
      if (spec.accent !== undefined) {
        ctx.fillStyle = a;
        poly(ctx, [26, 12, 32, 6, 38, 12, 32, 16]);
        ctx.fill();
      }
      break;
    case 'bottle':
      ctx.beginPath();
      ctx.moveTo(24, 20);
      ctx.lineTo(24, 12);
      ctx.lineTo(40, 12);
      ctx.lineTo(40, 20);
      ctx.quadraticCurveTo(52, 26, 50, 52);
      ctx.lineTo(14, 52);
      ctx.quadraticCurveTo(12, 26, 24, 20);
      ctx.closePath();
      fillStroke(ctx, c);
      if (spec.accent !== undefined) {
        ctx.fillStyle = a;
        circle(ctx, 26, 38, 5);
        ctx.fill();
        circle(ctx, 38, 44, 4);
        ctx.fill();
      }
      break;
    case 'wool':
      for (const [x, y, r] of [
        [22, 34, 12],
        [38, 30, 13],
        [30, 42, 12],
        [42, 42, 10],
        [28, 24, 10],
      ]) {
        circle(ctx, x, y, r);
        fillStroke(ctx, c, 2.5);
      }
      if (spec.accent !== undefined) {
        ctx.fillStyle = a;
        ctx.beginPath();
        ctx.ellipse(48, 22, 7, 9, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'scrap':
      poly(ctx, [10, 40, 22, 20, 36, 26, 30, 44]);
      fillStroke(ctx, c);
      poly(ctx, [30, 18, 52, 14, 54, 34, 38, 38]);
      fillStroke(ctx, a);
      gearPath(ctx, 24, 46, 9, 7);
      fillStroke(ctx, '#9aa0a6', 2);
      break;
    case 'gem':
      poly(ctx, [14, 30, 24, 14, 42, 12, 52, 26, 46, 48, 24, 52]);
      fillStroke(ctx, c);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      poly(ctx, [24, 14, 42, 12, 34, 28]);
      ctx.fill();
      break;
    case 'cutgem':
      poly(ctx, [12, 26, 22, 14, 42, 14, 52, 26, 32, 54]);
      fillStroke(ctx, c);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(12, 26);
      ctx.lineTo(52, 26);
      ctx.moveTo(22, 14);
      ctx.lineTo(28, 26);
      ctx.lineTo(32, 54);
      ctx.moveTo(42, 14);
      ctx.lineTo(36, 26);
      ctx.lineTo(32, 54);
      ctx.stroke();
      break;
    case 'brick':
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.roundRect(8 + (i % 2) * 10, 12 + i * 14, 40, 12, 2);
        fillStroke(ctx, i % 2 ? shadeHex(spec.color, 0.9) : c, 2.5);
      }
      break;
    case 'glass':
      ctx.beginPath();
      ctx.roundRect(12, 12, 40, 40, 4);
      ctx.fillStyle = 'rgba(191, 227, 240, 0.6)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(20, 40);
      ctx.lineTo(34, 20);
      ctx.moveTo(28, 44);
      ctx.lineTo(40, 28);
      ctx.stroke();
      break;
    case 'rope':
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(32, 32, 20, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = shadeHex(spec.color, 0.7);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'axe':
    case 'pickaxe':
    case 'hammer':
    case 'hoe':
      toolHead(ctx, spec.shape, c);
      break;
    case 'sword':
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(-Math.PI / 4);
      poly(ctx, [-5, -10, 0, -30, 5, -10, 5, 12, -5, 12]);
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.roundRect(-12, 10, 24, 6, 2);
      fillStroke(ctx, '#c9a046');
      ctx.beginPath();
      ctx.roundRect(-3, 16, 6, 14, 2);
      fillStroke(ctx, '#6b4a2a');
      ctx.restore();
      break;
    case 'spear':
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.roundRect(-3, -18, 6, 48, 3);
      fillStroke(ctx, '#8a5a33');
      poly(ctx, [-7, -16, 0, -32, 7, -16]);
      fillStroke(ctx, c);
      ctx.restore();
      break;
    case 'club':
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-4, 28);
      ctx.lineTo(-9, -22);
      ctx.quadraticCurveTo(0, -34, 9, -22);
      ctx.lineTo(4, 28);
      ctx.closePath();
      fillStroke(ctx, c);
      ctx.restore();
      break;
    case 'bow':
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(20, 32, 26, -1.1, 1.1);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20 + Math.cos(-1.1) * 26, 32 + Math.sin(-1.1) * 26);
      ctx.lineTo(20 + Math.cos(1.1) * 26, 32 + Math.sin(1.1) * 26);
      ctx.stroke();
      break;
    case 'arrow':
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.roundRect(-2, -22, 4, 46, 2);
      fillStroke(ctx, c, 2);
      poly(ctx, [-6, -18, 0, -30, 6, -18]);
      fillStroke(ctx, '#9aa0a6', 2);
      poly(ctx, [-6, 26, 0, 18, 6, 26, 0, 22]);
      fillStroke(ctx, '#e8e2d4', 1.5);
      ctx.restore();
      break;
    case 'fishing_rod':
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(12, 54);
      ctx.quadraticCurveTo(30, 20, 52, 8);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#e8e2d4';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(52, 8);
      ctx.lineTo(50, 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(50, 44, 5, 0, Math.PI * 2);
      fillStroke(ctx, '#e0403a', 2);
      ctx.beginPath();
      ctx.arc(20, 44, 5, 0, Math.PI * 2);
      fillStroke(ctx, '#9aa0a6', 2);
      break;
    case 'fish':
      ctx.save();
      ctx.translate(32, 33);
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      ctx.quadraticCurveTo(-4, -16, 16, -2);
      ctx.lineTo(28, -12);
      ctx.lineTo(26, 0);
      ctx.lineTo(28, 12);
      ctx.lineTo(16, 2);
      ctx.quadraticCurveTo(-4, 16, -24, 0);
      ctx.closePath();
      fillStroke(ctx, c);
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.moveTo(-14, 3);
      ctx.quadraticCurveTo(0, 10, 12, 2);
      ctx.quadraticCurveTo(0, 6, -14, 3);
      ctx.fill();
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(-15, -3, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    case 'boot':
      poly(ctx, [20, 10, 38, 10, 38, 38, 54, 44, 54, 54, 14, 54, 16, 38]);
      fillStroke(ctx, c);
      ctx.strokeStyle = shadeHex(spec.color, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 48);
      ctx.lineTo(54, 48);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,180,220,0.8)';
      ctx.beginPath();
      ctx.arc(44, 20, 3, 0, Math.PI * 2);
      ctx.arc(48, 30, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'backpack':
      ctx.beginPath();
      ctx.roundRect(14, 14, 36, 42, 10);
      fillStroke(ctx, c);
      ctx.beginPath();
      ctx.roundRect(19, 32, 26, 16, 5);
      fillStroke(ctx, shadeHex(spec.color, 0.8));
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(24, 14);
      ctx.quadraticCurveTo(32, 2, 40, 14);
      ctx.stroke();
      break;
    case 'scroll':
      ctx.beginPath();
      ctx.roundRect(12, 14, 40, 36, 4);
      fillStroke(ctx, '#e8dcc0');
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      gearPath(ctx, 32, 32, 10, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(18, 22);
      ctx.lineTo(28, 22);
      ctx.moveTo(38, 44);
      ctx.lineTo(46, 44);
      ctx.stroke();
      break;
    case 'structure':
    default: {
      ctx.beginPath();
      ctx.roundRect(10, 10, 44, 44, 8);
      fillStroke(ctx, c);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(16, 16, 32, 12, 4);
      ctx.fill();
      ctx.fillStyle = OUTLINE;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def.name.slice(0, 5), 32, 44);
    }
  }
}

/** Icon canvas for an item (64 × 64). */
export function iconCanvas(id: string): HTMLCanvasElement {
  const existing = structureIcons.get(id) ?? cache.get(id);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const def = ITEM_BY_ID.get(id);
  if (def) drawShape(ctx, def.icon, def);
  cache.set(id, canvas);
  return canvas;
}

export function iconUrl(id: string): string {
  let url = urls.get(id);
  if (!url) {
    url = iconCanvas(id).toDataURL();
    urls.set(id, url);
  }
  return url;
}

/** Replaces a structure item's icon with a rendered miniature of the structure. */
export function setStructureIcon(id: string, canvas: HTMLCanvasElement): void {
  structureIcons.set(id, canvas);
  urls.delete(id);
}

export function iconImg(id: string, size = 42): HTMLImageElement {
  const img = document.createElement('img');
  img.src = iconUrl(id);
  img.width = img.height = size;
  img.draggable = false;
  return img;
}
