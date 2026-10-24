// Tags on the estate's outside walls: unreadable scribble in hot pink,
// violet and chalk white, with drips, sprayed on the faces the camera sees.
// Placed from the level grid with a fixed seed, so a job always looks the same.

import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, type Scene } from './babylon.ts';
import type { Level } from '../sim/level.ts';
import { mulberry32 } from '../sim/sim.ts';
import type { Coords } from './world.ts';
import { WALL_H } from './palette.ts';

const INKS = ['#ff2d8a', '#ff2d8a', '#c04dff', '#e9e6e1'];
const WALLS = new Set(['#', 'X']);
const OUTSIDE = new Set(['p', 'r', 'g']);

/** One tag: a looping scrawl along a baseline, outlined dark, with a few drips. */
function drawTag(g: CanvasRenderingContext2D, w: number, h: number, ink: string, rnd: () => number) {
  g.clearRect(0, 0, w, h);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const letters = 3 + Math.floor(rnd() * 4);
  const step = (w * 0.8) / letters;
  const pts: [number, number][] = [];
  let x = w * 0.1;
  for (let i = 0; i < letters; i++) {
    // Each letter is a loop or a stab: up, round and back to the line.
    const top = h * (0.18 + rnd() * 0.2);
    const base = h * (0.62 + rnd() * 0.1);
    pts.push([x, base], [x + step * (0.1 + rnd() * 0.3), top], [x + step * (0.5 + rnd() * 0.3), top + h * 0.1 * rnd()], [x + step * 0.4, base], [x + step, base - h * 0.08 * rnd()]);
    x += step;
  }
  const path = () => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i + 1 < pts.length; i += 2) g.quadraticCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  };
  const width = h * (0.07 + rnd() * 0.05);
  g.strokeStyle = 'rgba(8,8,10,0.9)';
  g.lineWidth = width * 1.7;
  path();
  g.stroke();
  g.strokeStyle = ink;
  g.lineWidth = width;
  path();
  g.stroke();
  // An underline swoosh on some.
  if (rnd() < 0.5) {
    g.lineWidth = width * 0.6;
    g.beginPath();
    g.moveTo(w * 0.12, h * 0.82);
    g.quadraticCurveTo(w * 0.5, h * (0.9 + rnd() * 0.06), w * 0.9, h * 0.76);
    g.stroke();
  }
  // Drips.
  g.lineWidth = width * 0.35;
  for (let i = 0; i < 5; i++) {
    const [dx, dy] = pts[Math.floor(rnd() * pts.length)];
    if (dy < h * 0.5) continue;
    g.beginPath();
    g.moveTo(dx, dy);
    g.lineTo(dx, dy + h * (0.06 + rnd() * 0.2));
    g.stroke();
  }
}

/** Spray a handful of tags on outside walls that face the camera. */
export function sprayTags(scene: Scene, level: Level, co: Coords, seed: number): Mesh[] {
  const rnd = mulberry32(seed);
  // Runs of wall faces with open ground in front (south, towards the camera).
  const runs: { x0: number; x1: number; y: number }[] = [];
  for (let y = 0; y + 1 < level.h; y++) {
    let start = -1;
    for (let x = 0; x <= level.w; x++) {
      const ok = x < level.w && WALLS.has(level.tiles[y][x]) && OUTSIDE.has(level.tiles[y + 1][x]);
      if (ok && start < 0) start = x;
      if (!ok && start >= 0) {
        if (x - start >= 3) runs.push({ x0: start, x1: x, y });
        start = -1;
      }
    }
  }
  // A few, spread out: shuffle, then keep at most one in a run and a cap overall.
  for (let i = runs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [runs[i], runs[j]] = [runs[j], runs[i]];
  }
  const count = Math.min(runs.length, Math.max(3, Math.round((level.w * level.h) / 450)), 14);
  const out: Mesh[] = [];
  for (const run of runs.slice(0, count)) {
    const len = Math.min(run.x1 - run.x0, 2.2 + rnd() * 1.6);
    const hgt = Math.min(WALL_H * 0.75, len * 0.42);
    const cx = run.x0 + (run.x1 - run.x0 - len) * rnd() + len / 2;
    const tex = new DynamicTexture('tag', { width: 512, height: 256 }, scene, true);
    tex.hasAlpha = true;
    drawTag(tex.getContext() as unknown as CanvasRenderingContext2D, 512, 256, INKS[Math.floor(rnd() * INKS.length)], rnd);
    tex.update();
    const m = new StandardMaterial('tagMat', scene);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.specularColor = Color3.Black();
    // A touch of its own glow, so a torch beam or a lamp makes it sing.
    m.emissiveColor = new Color3(0.08, 0.08, 0.08);
    m.zOffset = -2;
    const plane = MeshBuilder.CreatePlane('tag', { width: len, height: hgt }, scene);
    plane.material = m;
    // A plane faces -Z, which is south on the map: towards the camera.
    plane.position.set(co.X(cx), 0.25 + hgt / 2 + rnd() * 0.15, co.Z(run.y + 1) - 0.02);
    plane.isPickable = false;
    out.push(plane);
  }
  return out;
}
