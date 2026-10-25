// Each room its own light: a pool of colour on the floor, as if from a lamp,
// a telly or a grow light. Drawn in the world, so the fog of war hides it
// until the crew see into the room.

import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene } from './babylon.ts';
import type { Level } from '../sim/level.ts';
import type { Coords } from './world.ts';

const MOODS: [RegExp, string | null][] = [
  [/hall|landing|stair|corridor|lobby/i, null],
  [/bed|grow|stash/i, '#ff2f4a'],
  [/living|lounge|front room|sitting/i, '#3d6bff'],
  [/kitchen|work|arch|kiln|garage|unit|shop|lock-?up/i, '#ffae55'],
  [/bath|toilet|wash/i, '#c8f0ff'],
];
const FALLBACK = ['#3d6bff', '#ffae55'];

let pool: DynamicTexture | null = null;
function poolTexture(scene: Scene): DynamicTexture {
  if (pool && pool.getScene() === scene) return pool;
  const t = (pool = new DynamicTexture('roomPool', { width: 128, height: 128 }, scene, true));
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  t.getAlphaFromRGB = true;
  t.update();
  return t;
}

export function lightRooms(scene: Scene, level: Level, co: Coords): Mesh[] {
  const out: Mesh[] = [];
  level.rooms.forEach((r, i) => {
    const hit = MOODS.find(([re]) => re.test(r.name) || re.test(r.id));
    const col = hit ? hit[1] : FALLBACK[i % FALLBACK.length];
    if (!col) return;
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    const m = new StandardMaterial(`room-${r.id}`, scene);
    // A soft wash of the lamp's colour, strongest in the middle of the room.
    const tex = poolTexture(scene);
    m.opacityTexture = tex;
    m.emissiveColor = Color3.FromHexString(col).scale(0.35);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.disableDepthWrite = true;
    m.alpha = 0.55;
    const p = MeshBuilder.CreateGround(`room-${r.id}`, { width: w * 1.15, height: h * 1.15 }, scene);
    p.position.set(co.X(r.x0 + w / 2), 0.03, co.Z(r.y0 + h / 2));
    p.material = m;
    p.isPickable = false;
    out.push(p);
  });
  return out;
}
