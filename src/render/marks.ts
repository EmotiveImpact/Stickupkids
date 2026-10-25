// What a fight leaves on the floor: blood sprayed past whoever was hit, a
// pool spreading under anyone who goes down, chips of plaster where a shot
// went wide, and splinters round a kicked-in door. Each raid starts clean.

import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene } from './babylon.ts';
import { mulberry32 } from '../sim/sim.ts';
import type { Coords } from './world.ts';

type Kind = 'spray' | 'pool' | 'chips' | 'splinters';

/** Dark, so it reads as blood and not as the red the opposition wear. */
const BLOOD = '#6a0b15';
const COLOURS: Record<Kind, [string, number]> = {
  spray: [BLOOD, 0.92],
  pool: ['#62091a', 0.95],
  chips: ['#555551', 0.75],
  splinters: ['#4a4a47', 0.85],
};
const VARIANTS = 3;
/** The most marks kept; the oldest go first. */
const MAX = 180;

type Draw = (g: CanvasRenderingContext2D, rnd: () => number) => void;

const blob = (g: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, r: number, n: number) => {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * r * 0.6;
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.35 + rnd() * 0.45), 0, Math.PI * 2);
    g.fill();
  }
};

const DRAW: Record<Kind, Draw> = {
  // A blot where it landed, then drops thrown on along the line of the shot (+x).
  spray(g, rnd) {
    blob(g, rnd, 38, 64, 13, 9);
    for (let i = 0; i < 34; i++) {
      const d = 14 + Math.pow(rnd(), 0.8) * 76;
      const a = (rnd() - 0.5) * (0.9 - d / 200);
      const x = 38 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d;
      const r = Math.max(0.8, (5.5 - d / 18) * (0.5 + rnd() * 0.7));
      g.beginPath();
      g.ellipse(x, y, r * (1 + d / 50), r, a, 0, Math.PI * 2);
      g.fill();
    }
  },
  // A soft-edged, lopsided spread.
  pool(g, rnd) {
    g.shadowColor = '#fff';
    g.shadowBlur = 6;
    blob(g, rnd, 64, 64, 34, 14);
    for (let i = 0; i < 5; i++) blob(g, rnd, 64 + (rnd() - 0.5) * 60, 64 + (rnd() - 0.5) * 60, 10 + rnd() * 8, 4);
  },
  chips(g, rnd) {
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.pow(rnd(), 0.7) * 52;
      const x = 64 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d;
      const s = 1.2 + rnd() * 3.2;
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s * rnd(), y - s);
      g.lineTo(x + s, y + s * rnd());
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 0.25;
    blob(g, rnd, 64, 64, 22, 6);
  },
  splinters(g, rnd) {
    for (let i = 0; i < 18; i++) {
      const x = 64 + (rnd() - 0.5) * 100;
      const y = 64 + (rnd() - 0.5) * 70;
      g.save();
      g.translate(x, y);
      g.rotate(rnd() * Math.PI);
      g.fillRect(-(6 + rnd() * 16), -1, 12 + rnd() * 32, 1.5 + rnd() * 2.5);
      g.restore();
    }
    g.globalAlpha = 0.3;
    for (let i = 0; i < 30; i++) g.fillRect(64 + (rnd() - 0.5) * 110, 64 + (rnd() - 0.5) * 80, 2, 2);
  },
};

interface Mark {
  mesh: Mesh;
  /** Pools spread: from this size to `size` over a few seconds. */
  grow?: { t: number; size: number };
}

export class Marks {
  private scene: Scene;
  private co: Coords;
  private mats = new Map<string, StandardMaterial>();
  private marks: Mark[] = [];
  private n = 0;

  constructor(scene: Scene, co: Coords) {
    this.scene = scene;
    this.co = co;
  }

  private material(kind: Kind, v: number): StandardMaterial {
    const key = `${kind}-${v}`;
    let m = this.mats.get(key);
    if (m) return m;
    const t = new DynamicTexture(`mark-${key}`, { width: 128, height: 128 }, this.scene, true);
    const g = t.getContext() as unknown as CanvasRenderingContext2D;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#fff';
    DRAW[kind](g, mulberry32(v * 7919 + kind.length * 104729));
    t.getAlphaFromRGB = true;
    t.update();
    m = new StandardMaterial(`mark-${key}`, this.scene);
    m.opacityTexture = t;
    const [col, alpha] = COLOURS[kind];
    m.emissiveColor = Color3.FromHexString(col);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.disableDepthWrite = true;
    m.alpha = alpha;
    m.zOffset = -1;
    this.mats.set(key, m);
    return m;
  }

  /** Lay a mark at a map point, turned to `angle` (radians, map axes), `size` metres across. */
  private add(kind: Kind, x: number, y: number, size: number, angle: number, grow = false): Mark {
    const v = Math.floor(Math.random() * VARIANTS);
    const mesh = MeshBuilder.CreateGround('mark', { width: 1, height: 1 }, this.scene);
    mesh.material = this.material(kind, v);
    mesh.isPickable = false;
    // Pools under sprays under debris, each a hair above the last so none flicker.
    const layer = kind === 'pool' ? 0 : kind === 'spray' ? 1 : 2;
    mesh.position.set(this.co.X(x), 0.036 + layer * 0.002 + (this.n++ % 50) * 0.00002, this.co.Z(y));
    mesh.rotation.y = angle;
    mesh.scaling.set(grow ? size * 0.2 : size, 1, grow ? size * 0.2 : size);
    const mark: Mark = { mesh, grow: grow ? { t: 0, size } : undefined };
    this.marks.push(mark);
    while (this.marks.length > MAX) this.marks.shift()!.mesh.dispose();
    return mark;
  }

  /** A shot that hit: blood thrown on past whoever it hit. */
  hit(from: { x: number; y: number }, to: { x: number; y: number }) {
    const a = Math.atan2(to.y - from.y, to.x - from.x);
    // The texture's blot sits left of centre, so shift it back onto the body.
    this.add('spray', to.x + Math.cos(a) * 0.22, to.y + Math.sin(a) * 0.22, 1.1 + Math.random() * 0.5, a);
  }

  /** A shot that went wide: chips a little past whoever it missed. */
  miss(from: { x: number; y: number }, to: { x: number; y: number }) {
    const a = Math.atan2(to.y - from.y, to.x - from.x) + (Math.random() - 0.5) * 0.4;
    const d = 0.6 + Math.random() * 0.9;
    this.add('chips', to.x + Math.cos(a) * d, to.y + Math.sin(a) * d, 0.4 + Math.random() * 0.25, Math.random() * Math.PI * 2);
  }

  /** Someone down: a pool spreading under them. */
  down(x: number, y: number) {
    this.add('pool', x, y, 1.5 + Math.random() * 0.5, Math.random() * Math.PI * 2, true);
  }

  /** A door kicked in: splinters across the doorway. */
  door(x: number, y: number) {
    this.add('splinters', x, y, 1.5, Math.random() * Math.PI * 2);
  }

  update(dt: number) {
    for (const m of this.marks) {
      if (!m.grow) continue;
      m.grow.t += dt;
      const k = 1 - Math.pow(1 - Math.min(1, m.grow.t / 5), 2);
      const s = m.grow.size * (0.2 + 0.8 * k);
      m.mesh.scaling.set(s, 1, s);
      if (k >= 1) m.grow = undefined;
    }
  }

  clear() {
    for (const m of this.marks) m.mesh.dispose();
    this.marks = [];
  }
}
