// Mouse-directed camera (design plan §3): the view leans toward where the player aims, more when
// precision aiming, less indoors, with smooth damping and mouse-wheel zoom clamped to 1.0–2.0×.
// The range sits closer than the plan's original 0.75–1.5× because playtesting found the view
// too far out: the widest zoom now shows about as much as the old default did.

import { clamp, damp, PIXELS_PER_METER } from '@tuff/shared';

export const MIN_ZOOM = 1.0;
export const MAX_ZOOM = 2.0;
export const DEFAULT_ZOOM = 1.4;

export class Camera {
  x = 0;
  y = 0;
  zoom = DEFAULT_ZOOM;
  targetZoom = DEFAULT_ZOOM;
  /** Zoom limits; the map editor widens them. */
  minZoom = MIN_ZOOM;
  maxZoom = MAX_ZOOM;
  /** Screen shake amplitude (meters) and time. */
  private shake = 0;
  private shakeTime = 0;
  private kickX = 0;
  private kickY = 0;
  screenW = 1;
  screenH = 1;

  get scale(): number {
    return PIXELS_PER_METER * this.zoom;
  }

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  addZoom(steps: number): void {
    this.targetZoom = clamp(this.targetZoom * Math.pow(0.9, steps), this.minZoom, this.maxZoom);
  }

  /** Camera shake, e.g. from firing or being hit. */
  addShake(amount: number): void {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  /** Recoil kick opposite to the firing direction. */
  addKick(angle: number, amount: number): void {
    this.kickX -= Math.cos(angle) * amount;
    this.kickY -= Math.sin(angle) * amount;
  }

  update(dt: number, px: number, py: number, pointerX: number, pointerY: number, aiming: boolean, indoors: boolean): void {
    this.zoom = damp(this.zoom, this.targetZoom, 10, dt);
    const w = this.screenW;
    const h = this.screenH;
    // Pointer offset from the screen centre, normalised to [-1, 1] per axis.
    let nx = (pointerX - w / 2) / (w / 2);
    let ny = (pointerY - h / 2) / (h / 2);
    const len = Math.hypot(nx, ny);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }
    // A small dead zone near the centre lets the camera settle when aim is "neutral".
    const dead = 0.08;
    const mag = Math.max(0, Math.min(1, len) - dead) / (1 - dead);
    const k = len > 1e-6 ? mag / Math.min(1, len) : 0;
    const lean = (aiming ? 0.26 : 0.17) * (indoors ? 0.6 : 1);
    const offX = (nx * k * lean * w) / this.scale;
    const offY = (ny * k * lean * h) / this.scale;
    const tx = px + offX;
    const ty = py + offY;
    const smooth = aiming ? 5 : 7;
    this.x = damp(this.x, tx, smooth, dt);
    this.y = damp(this.y, ty, smooth, dt);
    // Keep the player on screen even during fast movement.
    const maxDx = (w * 0.38) / this.scale;
    const maxDy = (h * 0.38) / this.scale;
    this.x = clamp(this.x, px - maxDx, px + maxDx);
    this.y = clamp(this.y, py - maxDy, py + maxDy);
    this.shakeTime += dt;
    this.shake = damp(this.shake, 0, 9, dt);
    this.kickX = damp(this.kickX, 0, 16, dt);
    this.kickY = damp(this.kickY, 0, 16, dt);
  }

  /** Final view centre including shake and recoil kick. */
  viewX(): number {
    return this.x + this.kickX + Math.sin(this.shakeTime * 47) * this.shake * 0.4;
  }

  viewY(): number {
    return this.y + this.kickY + Math.cos(this.shakeTime * 53) * this.shake * 0.4;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.viewX() + (sx - this.screenW / 2) / this.scale, y: this.viewY() + (sy - this.screenH / 2) / this.scale };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.viewX()) * this.scale + this.screenW / 2, y: (wy - this.viewY()) * this.scale + this.screenH / 2 };
  }

  /** Visible world rectangle, with a margin in meters. */
  bounds(margin = 0): { minX: number; minY: number; maxX: number; maxY: number } {
    const hw = this.screenW / 2 / this.scale + margin;
    const hh = this.screenH / 2 / this.scale + margin;
    return { minX: this.viewX() - hw, minY: this.viewY() - hh, maxX: this.viewX() + hw, maxY: this.viewY() + hh };
  }
}
