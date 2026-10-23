import type { DoorState, Level, Vec } from './level.ts';

export type Mover = 'crew' | 'guard' | 'dog' | 'plan';

/** Mutable map state: tiles plus the live state of every door. */
export class Grid {
  readonly w: number;
  readonly h: number;
  private tiles: string[][];
  private solid: boolean[][];
  readonly doors = new Map<number, DoorState>();

  constructor(level: Level) {
    this.w = level.w;
    this.h = level.h;
    this.tiles = level.tiles;
    this.solid = level.solid;
    for (const d of level.doors) this.doors.set(this.key(d.x, d.y), d.locked ? 'locked' : 'closed');
  }

  key(x: number, y: number): number {
    return y * this.w + x;
  }

  tile(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return '#';
    return this.tiles[y][x];
  }

  door(x: number, y: number): DoorState | undefined {
    return this.doors.get(this.key(x, y));
  }

  setDoor(x: number, y: number, s: DoorState): void {
    this.doors.set(this.key(x, y), s);
  }

  blocksSight(x: number, y: number): boolean {
    const t = this.tile(x, y);
    if (t === '#' || t === 'X') return true;
    if (t === 'D') {
      const s = this.door(x, y);
      return s === 'closed' || s === 'locked';
    }
    return false;
  }

  passable(x: number, y: number, m: Mover): boolean {
    const t = this.tile(x, y);
    if (t === '#' || t === 'X' || t === 'W' || t === '=') return false;
    if (this.solid[y][x]) return false;
    if (t === 'D' && m === 'dog') {
      const s = this.door(x, y);
      return s === 'open' || s === 'broken';
    }
    return true;
  }

  /** Distance along a normalised ray until it hits something that blocks sight. */
  castRay(ox: number, oy: number, dx: number, dy: number, maxDist: number): number {
    let cx = Math.floor(ox);
    let cy = Math.floor(oy);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = dx > 0 ? (cx + 1 - ox) * tdx : dx < 0 ? (ox - cx) * tdx : Infinity;
    let tmy = dy > 0 ? (cy + 1 - oy) * tdy : dy < 0 ? (oy - cy) * tdy : Infinity;
    for (;;) {
      let t: number;
      if (tmx < tmy) {
        t = tmx;
        tmx += tdx;
        cx += stepX;
      } else {
        t = tmy;
        tmy += tdy;
        cy += stepY;
      }
      if (t >= maxDist) return maxDist;
      if (this.blocksSight(cx, cy)) return t;
    }
  }

  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.castRay(ax, ay, dx / d, dy / d, d) >= d - 1e-6;
  }

  /**
   * A* over cells with eight-way moves and no corner cutting.
   * Returns cell centres from the step after the start up to the goal.
   */
  findPath(sx: number, sy: number, tx: number, ty: number, m: Mover): Vec[] | null {
    const startX = Math.floor(sx);
    const startY = Math.floor(sy);
    const goalX = Math.floor(tx);
    const goalY = Math.floor(ty);
    if (!this.passable(goalX, goalY, m)) return null;
    if (startX === goalX && startY === goalY) return [];
    const n = this.w * this.h;
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open: number[] = [];
    const hfn = (x: number, y: number) => {
      const ddx = Math.abs(x - goalX);
      const ddy = Math.abs(y - goalY);
      return Math.max(ddx, ddy) + (Math.SQRT2 - 1) * Math.min(ddx, ddy);
    };
    const s = this.key(startX, startY);
    g[s] = 0;
    f[s] = hfn(startX, startY);
    open.push(s);
    const goal = this.key(goalX, goalY);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.w;
      const cy = (cur - cx) / this.w;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          if (!this.passable(nx, ny, m)) continue;
          if (ox && oy) {
            if (!this.passable(cx + ox, cy, m) || !this.passable(cx, cy + oy, m)) continue;
            // Never cut diagonally through a doorway.
            if (this.tile(cx + ox, cy) === 'D' || this.tile(cx, cy + oy) === 'D') continue;
            if (this.tile(nx, ny) === 'D' || this.tile(cx, cy) === 'D') continue;
          }
          const nk = this.key(nx, ny);
          if (closed[nk]) continue;
          const ng = g[cur] + (ox && oy ? Math.SQRT2 : 1);
          if (ng < g[nk]) {
            g[nk] = ng;
            f[nk] = ng + hfn(nx, ny);
            came[nk] = cur;
            open.push(nk);
          }
        }
      }
    }
    if (came[goal] === -1) return null;
    const out: Vec[] = [];
    for (let k = goal; k !== s; k = came[k]) {
      const x = k % this.w;
      out.push({ x: x + 0.5, y: (k - x) / this.w + 0.5 });
    }
    return out.reverse();
  }

  /** Points of a vision fan, for drawing cones. */
  visionFan(x: number, y: number, facing: number, fov: number, range: number, rays = 36): Vec[] {
    const pts: Vec[] = [];
    for (let i = 0; i <= rays; i++) {
      const a = facing - fov / 2 + (fov * i) / rays;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const d = this.castRay(x, y, dx, dy, range);
      pts.push({ x: x + dx * d, y: y + dy * d });
    }
    return pts;
  }
}
