// Map rendering for the minimap and the full map screen. The whole map is painted once into an
// offscreen canvas from the coarse overview the server sends; unexplored areas are covered by a
// fog layer at overview-cell resolution (design plan §86: fog of war).

import { OVERVIEW_CELL, type MapInfo, type MapOverview } from '@tuff/shared';

const BASE_SCALE = 2;

const ROAD_COLORS: Record<string, string> = {
  highway: '#4a4a46',
  main: '#45453f',
  street: '#403f3a',
  country: '#3f3c34',
  dirt: '#4a3f2c',
};

const ZONE_COLORS: Record<string, string> = {
  forest: '#14200f',
  rural: '#2a2918',
  residential: '#1c2519',
  commercial: '#20231d',
  industrial: '#22221f',
  downtown: '#232320',
};

const BUILDING_COLORS: Record<string, string> = {
  grocery: '#7a6a3e',
  gas_station: '#7a4a3a',
  police: '#3e527a',
  hardware: '#6a5a3a',
};

export interface MapMarker {
  x: number;
  y: number;
  color: string;
  angle?: number;
  label?: string;
  self?: boolean;
}

export class MapView {
  private readonly base: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly cols: number;
  private readonly rows: number;
  private explored: Uint8Array;
  version = 0;

  constructor(
    readonly info: MapInfo,
    readonly overview: MapOverview,
  ) {
    this.cols = Math.ceil(info.width / OVERVIEW_CELL);
    this.rows = Math.ceil(info.height / OVERVIEW_CELL);
    this.explored = decodeBase64(overview.explored, Math.ceil((this.cols * this.rows) / 8));
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil(info.width * BASE_SCALE);
    this.base.height = Math.ceil(info.height * BASE_SCALE);
    this.paintBase();
    this.fog = document.createElement('canvas');
    this.fog.width = this.cols;
    this.fog.height = this.rows;
    this.fogCtx = this.fog.getContext('2d')!;
    this.paintFog();
  }

  private paintBase(): void {
    const g = this.base.getContext('2d')!;
    g.scale(BASE_SCALE, BASE_SCALE);
    g.fillStyle = '#1e281b';
    g.fillRect(0, 0, this.info.width, this.info.height);
    for (const z of this.info.zones) {
      g.fillStyle = ZONE_COLORS[z.kind] ?? '#1e281b';
      const [x, y, w, h] = z.rect;
      g.fillRect(x, y, w, h);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const r of this.overview.roads) {
      if (r.points.length < 2) continue;
      g.strokeStyle = ROAD_COLORS[r.kind] ?? '#45453f';
      g.lineWidth = Math.max(2, r.width);
      g.beginPath();
      g.moveTo(r.points[0][0], r.points[0][1]);
      for (let i = 1; i < r.points.length; i++) g.lineTo(r.points[i][0], r.points[i][1]);
      g.stroke();
    }
    for (const b of this.overview.buildings) {
      g.fillStyle = BUILDING_COLORS[b.type] ?? (b.type === 'shed' ? '#4e4a42' : '#6a6358');
      g.strokeStyle = '#141412';
      g.lineWidth = 0.6;
      g.beginPath();
      for (let i = 0; i < b.poly.length; i += 2) {
        if (i === 0) g.moveTo(b.poly[i], b.poly[i + 1]);
        else g.lineTo(b.poly[i], b.poly[i + 1]);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  private paintFog(): void {
    const img = this.fogCtx.createImageData(this.cols, this.rows);
    for (let i = 0; i < this.cols * this.rows; i++) {
      const seen = (this.explored[i >> 3] & (1 << (i & 7))) !== 0;
      img.data[i * 4] = 9;
      img.data[i * 4 + 1] = 10;
      img.data[i * 4 + 2] = 10;
      img.data[i * 4 + 3] = seen ? 0 : 245;
    }
    this.fogCtx.putImageData(img, 0, 0);
    this.version++;
  }

  markExplored(cells: number[]): void {
    for (const idx of cells) this.explored[idx >> 3] |= 1 << (idx & 7);
    this.paintFog();
  }

  isExplored(x: number, y: number): boolean {
    const i = Math.floor(y / OVERVIEW_CELL) * this.cols + Math.floor(x / OVERVIEW_CELL);
    return i >= 0 && (this.explored[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /**
   * Draws the map so that world point (cx, cy) is at the canvas centre with `scale` pixels per meter.
   */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, markers: MapMarker[], labels: boolean): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.save();
    ctx.fillStyle = '#090a0a';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2 - cx * scale, h / 2 - cy * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, this.info.width * scale, this.info.height * scale);
    ctx.drawImage(this.fog, 0, 0, this.cols * OVERVIEW_CELL * scale, this.rows * OVERVIEW_CELL * scale);
    if (labels) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const b of this.overview.buildings) {
        if (!b.name || b.type === 'shed') continue;
        const [bx, by] = polygonCentre(b.poly);
        if (!this.isExplored(bx, by)) continue;
        ctx.font = `600 ${Math.max(10, Math.min(14, scale * 5))}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = '#000';
        ctx.fillText(b.name, bx * scale + 1, by * scale + 1);
        ctx.fillStyle = '#e4dfcf';
        ctx.fillText(b.name, bx * scale, by * scale);
      }
      for (const z of this.info.zones) {
        const zx = z.rect[0] + z.rect[2] / 2;
        const zy = z.rect[1] + z.rect[3] / 2;
        if (!this.isExplored(zx, zy)) continue;
        ctx.font = `italic 600 ${Math.max(10, Math.min(13, scale * 4))}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(210, 205, 185, 0.55)';
        ctx.fillText(z.name.toUpperCase(), zx * scale, zy * scale - 14);
      }
    }
    for (const m of markers) {
      const mx = m.x * scale;
      const my = m.y * scale;
      if (m.self && m.angle !== undefined) {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(m.angle);
        ctx.fillStyle = m.color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5, -5.5);
        ctx.lineTo(-2.5, 0);
        ctx.lineTo(-5, 5.5);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = m.color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      }
      if (m.label && labels) {
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#000';
        ctx.fillText(m.label, mx + 1, my - 11);
        ctx.fillStyle = m.color;
        ctx.fillText(m.label, mx, my - 12);
      }
    }
    ctx.restore();
  }
}

function polygonCentre(poly: number[]): [number, number] {
  let x = 0;
  let y = 0;
  const n = poly.length / 2;
  for (let i = 0; i < poly.length; i += 2) {
    x += poly[i];
    y += poly[i + 1];
  }
  return [x / n, y / n];
}

function decodeBase64(b64: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  try {
    const bin = atob(b64);
    for (let i = 0; i < Math.min(size, bin.length); i++) out[i] = bin.charCodeAt(i);
  } catch {
    // Corrupt data: everything stays unexplored.
  }
  return out;
}
