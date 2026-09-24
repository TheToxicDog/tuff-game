// Terrain painting on the 1 m material grid, with conversion to the chunked map format.

import { CHUNK_SIZE } from '../../constants';
import {
  chunkKey,
  decodeTerrainChunk,
  encodeTerrainChunk,
  parseChunkKey,
  TERRAIN_MATERIALS,
  terrainIndex,
  type TerrainLayer,
  type TerrainMaterial,
} from '../map';

export class TerrainPainter {
  readonly cells: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly fill: TerrainMaterial,
  ) {
    this.cells = new Uint8Array(width * height).fill(terrainIndex(fill));
  }

  /** A painter holding a map's existing terrain, so generators can repaint parts of it. */
  static fromLayer(layer: TerrainLayer, width: number, height: number): TerrainPainter {
    const painter = new TerrainPainter(width, height, TERRAIN_MATERIALS[layer.fill] ?? 'grass');
    for (const [key, encoded] of Object.entries(layer.chunks)) {
      const [cx, cy] = parseChunkKey(key);
      const cells = decodeTerrainChunk(encoded);
      for (let y = 0; y < CHUNK_SIZE; y++) {
        const wy = cy * CHUNK_SIZE + y;
        if (wy < 0 || wy >= height) continue;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const wx = cx * CHUNK_SIZE + x;
          if (wx < 0 || wx >= width) continue;
          painter.cells[wy * width + wx] = cells[y * CHUNK_SIZE + x];
        }
      }
    }
    return painter;
  }

  /** The encoded material grid of one chunk. */
  encodeChunk(cx: number, cy: number): string {
    const fill = terrainIndex(this.fill);
    const buf = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x;
        const wy = cy * CHUNK_SIZE + y;
        buf[y * CHUNK_SIZE + x] = wx < this.width && wy < this.height ? this.cells[wy * this.width + wx] : fill;
      }
    }
    return encodeTerrainChunk(buf);
  }

  get(x: number, y: number): number {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return -1;
    return this.cells[cy * this.width + cx];
  }

  is(x: number, y: number, material: TerrainMaterial): boolean {
    return this.get(x, y) === terrainIndex(material);
  }

  set(x: number, y: number, material: TerrainMaterial): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return;
    this.cells[cy * this.width + cx] = terrainIndex(material);
  }

  rect(x: number, y: number, w: number, h: number, material: TerrainMaterial): void {
    const m = terrainIndex(material);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let cy = y0; cy < y1; cy++) this.cells.fill(m, cy * this.width + x0, cy * this.width + x1);
  }

  circle(cx: number, cy: number, r: number, material: TerrainMaterial): void {
    this.each(cx - r, cy - r, r * 2, r * 2, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? material : null));
  }

  /** Paints a thick polyline (e.g. road shoulders). */
  line(points: [number, number][], halfWidth: number, material: TerrainMaterial): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const minX = Math.min(ax, bx) - halfWidth;
      const minY = Math.min(ay, by) - halfWidth;
      const w = Math.abs(bx - ax) + halfWidth * 2;
      const h = Math.abs(by - ay) + halfWidth * 2;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      this.each(minX, minY, w, h, (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const px = ax + dx * t - x;
        const py = ay + dy * t - y;
        return px * px + py * py <= halfWidth * halfWidth ? material : null;
      });
    }
  }

  /** Visits cell centres in a rectangle; the callback returns a material to paint or null. */
  each(x: number, y: number, w: number, h: number, fn: (cx: number, cy: number, current: number) => TerrainMaterial | null): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const i = cy * this.width + cx;
        const m = fn(cx + 0.5, cy + 0.5, this.cells[i]);
        if (m !== null) this.cells[i] = terrainIndex(m);
      }
    }
  }

  toLayer(): TerrainLayer {
    const fill = terrainIndex(this.fill);
    const chunks: Record<string, string> = {};
    const cw = Math.ceil(this.width / CHUNK_SIZE);
    const ch = Math.ceil(this.height / CHUNK_SIZE);
    const buf = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let uniform = true;
        for (let y = 0; y < CHUNK_SIZE; y++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const wx = cx * CHUNK_SIZE + x;
            const wy = cy * CHUNK_SIZE + y;
            const v = wx < this.width && wy < this.height ? this.cells[wy * this.width + wx] : fill;
            buf[y * CHUNK_SIZE + x] = v;
            if (v !== fill) uniform = false;
          }
        }
        if (!uniform) chunks[chunkKey(cx, cy)] = encodeTerrainChunk(buf);
      }
    }
    return { fill, chunks };
  }
}
