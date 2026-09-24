// Uniform-grid spatial hash for moving entities (players, zombies, items).

const KEY_OFFSET = 32768;

function key(cx: number, cy: number): number {
  return cx + KEY_OFFSET + (cy + KEY_OFFSET) * 65536;
}

export class SpatialHash {
  private readonly cells = new Map<number, Set<number>>();
  private readonly entityCell = new Map<number, number>();

  constructor(readonly cellSize: number) {}

  get size(): number {
    return this.entityCell.size;
  }

  /** Inserts or moves an entity. */
  set(id: number, x: number, y: number): void {
    const k = key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    const current = this.entityCell.get(id);
    if (current === k) return;
    if (current !== undefined) this.cells.get(current)?.delete(id);
    let set = this.cells.get(k);
    if (!set) {
      set = new Set();
      this.cells.set(k, set);
    }
    set.add(id);
    this.entityCell.set(id, k);
  }

  delete(id: number): void {
    const current = this.entityCell.get(id);
    if (current === undefined) return;
    const set = this.cells.get(current);
    if (set) {
      set.delete(id);
      if (set.size === 0) this.cells.delete(current);
    }
    this.entityCell.delete(id);
  }

  has(id: number): boolean {
    return this.entityCell.has(id);
  }

  /** Entities in every cell overlapping the square around (x, y). Callers filter by distance. */
  query(x: number, y: number, radius: number, out: number[] = []): number[] {
    const s = this.cellSize;
    const x0 = Math.floor((x - radius) / s);
    const x1 = Math.floor((x + radius) / s);
    const y0 = Math.floor((y - radius) / s);
    const y1 = Math.floor((y + radius) / s);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(key(cx, cy));
        if (!set) continue;
        for (const id of set) out.push(id);
      }
    }
    return out;
  }
}
