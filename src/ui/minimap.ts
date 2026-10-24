// The overview map: the ground in
// greys, lamps, loot, the crew, any of the opposition the crew
// know about, and a frame round the part of the map in view. Click or drag
// on it to move the camera.

import type { Level } from '../sim/level.ts';
import type { Sim } from '../sim/sim.ts';

const GROUND: Record<string, string> = {
  g: '#121212',
  p: '#3a3a38',
  r: '#202020',
  X: '#2c2c2b',
  '=': '#8a8a86',
  '#': '#cfceca',
  '.': '#1b1b1b',
  D: '#cfceca',
  O: '#1b1b1b',
  b: '#161616',
  w: '#0a0a0a',
};

type Rect = { x0: number; y0: number; x1: number; y1: number };

export class Minimap {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  private level: Level | null = null;
  private k = 1;

  constructor(root: HTMLElement, onPick: (x: number, y: number) => void) {
    this.el = root.appendChild(document.createElement('div'));
    this.el.className = 'minimap panel hidden';
    this.canvas = this.el.appendChild(document.createElement('canvas'));
    let down = false;
    const pick = (e: PointerEvent) => {
      if (!this.level) return;
      const r = this.canvas.getBoundingClientRect();
      onPick(((e.clientX - r.left) / r.width) * this.level.w, ((e.clientY - r.top) / r.height) * this.level.h);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      down = true;
      this.canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => down && pick(e));
    this.canvas.addEventListener('pointerup', () => (down = false));
  }

  /** Show the map for a level, or hide it (null). */
  setLevel(level: Level | null) {
    this.level = level;
    this.el.classList.toggle('hidden', !level);
    if (!level) return;
    const width = 232;
    this.k = width / level.w;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(level.h * this.k * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${Math.round(level.h * this.k)}px`;
    // The ground, one pixel a cell, scaled up when drawn.
    const base = (this.base = document.createElement('canvas'));
    base.width = level.w;
    base.height = level.h;
    const g = base.getContext('2d')!;
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        g.fillStyle = level.solid[y][x] ? '#2a2a29' : (GROUND[level.tiles[y][x]] ?? GROUND.g);
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  /** Out of the way on the job board and the results. */
  show(on: boolean) {
    this.el.classList.toggle('off', !on);
  }

  draw(sim: Sim, view: Rect | null, colours: string[]) {
    const lv = this.level;
    if (!lv || !this.base || this.el.classList.contains('off')) return;
    const g = this.canvas.getContext('2d')!;
    const s = this.canvas.width / lv.w;
    // Markers keep a set size on screen: a small level would otherwise blow them up to blobs.
    const u = Math.min(s, (2.2 * this.canvas.width) / 232);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0, this.canvas.width, this.canvas.height);
    // Lamp pools.
    for (const l of lv.lights) {
      if (l.kind !== 'street') continue;
      const r = 5.5 * s;
      const grad = g.createRadialGradient(l.x * s, l.y * s, 0, l.x * s, l.y * s, r);
      grad.addColorStop(0, 'rgba(255,170,90,0.3)');
      grad.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = grad;
      g.fillRect(l.x * s - r, l.y * s - r, r * 2, r * 2);
    }
    // The getaway.
    const ex = lv.exit;
    g.strokeStyle = '#f2f1ee';
    g.lineWidth = Math.max(1, u * 0.6);
    g.strokeRect(ex.x0 * s, ex.y0 * s, (ex.x1 - ex.x0 + 1) * s, (ex.y1 - ex.y0 + 1) * s);
    // Loot still out there.
    g.fillStyle = '#ff7a1a';
    for (const l of sim.loot) {
      if (l.state !== 'placed') continue;
      g.fillRect(l.x * s - 2.5 * u, l.y * s - 2.5 * u, 5 * u, 5 * u);
    }
    const dot = (x: number, y: number, r: number, fill: string, ring = false) => {
      g.beginPath();
      g.arc(x * s, y * s, r * u, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      if (ring) {
        g.lineWidth = Math.max(1, u * 0.5);
        g.strokeStyle = '#070707';
        g.stroke();
      }
    };
    for (const e of sim.enemies) {
      if (!e.known || e.state === 'gone') continue;
      dot(e.x, e.y, 2.2, e.state === 'down' || e.state === 'subdued' ? '#5e5d59' : e.kind === 'civilian' ? '#e4ecff' : '#ff3b4e', true);
    }
    sim.crew.forEach((c, i) => {
      if (c.state === 'escaped') return;
      dot(c.x, c.y, 2.8, c.state === 'down' ? '#5e5d59' : colours[i], true);
    });
    if (view) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = Math.max(1, u * 0.5);
      const x0 = Math.max(0, view.x0) * s;
      const y0 = Math.max(0, view.y0) * s;
      const x1 = Math.min(lv.w, view.x1) * s;
      const y1 = Math.min(lv.h, view.y1) * s;
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
}
