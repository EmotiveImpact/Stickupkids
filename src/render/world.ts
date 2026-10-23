// Builds the static scene for a level: ground, walls, doors, props, lights.
// Placeholder low-poly geometry made from Babylon primitives.

import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AbstractMesh,
} from './babylon.ts';
import type { Level, PropDef } from '../sim/level.ts';
import { PALETTE, WALL_H } from './palette.ts';

export class Coords {
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  X(x: number): number {
    return x - this.w / 2;
  }
  Z(y: number): number {
    return this.h / 2 - y;
  }
  /** Map facing (radians, y down) to a Babylon Y rotation. */
  rotY(facing: number): number {
    return Math.atan2(Math.cos(facing), -Math.sin(facing));
  }
}

const matCache = new Map<string, StandardMaterial>();

export function mat(
  scene: Scene,
  hex: string,
  opts: { emissive?: string; alpha?: number; spec?: number; unlit?: boolean } = {},
): StandardMaterial {
  const key = `${hex}|${opts.emissive ?? ''}|${opts.alpha ?? 1}|${opts.spec ?? 0}|${opts.unlit ? 1 : 0}`;
  const hit = matCache.get(key);
  if (hit && hit.getScene() === scene) return hit;
  const m = new StandardMaterial(`m${matCache.size}`, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(opts.spec ?? 0.04, opts.spec ?? 0.04, opts.spec ?? 0.05);
  if (opts.emissive) m.emissiveColor = Color3.FromHexString(opts.emissive);
  if (opts.alpha !== undefined && opts.alpha < 1) m.alpha = opts.alpha;
  if (opts.unlit) m.disableLighting = true;
  m.maxSimultaneousLights = 10;
  matCache.set(key, m);
  return m;
}

export interface World {
  doors: Map<string, { pivot: TransformNode; leaf: Mesh; axis: 'h' | 'v'; open: number }>;
  loot: Map<string, TransformNode>;
  tvLight: PointLight | null;
  ground: Mesh;
  casters: AbstractMesh[];
}

const PX = 64;

function drawGround(level: Level): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = level.w * PX;
  c.height = level.h * PX;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const roomAt = (x: number, y: number) => level.rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const t = level.tiles[y][x];
      const px = x * PX;
      const py = y * PX;
      if (t === 'g') {
        g.fillStyle = '#16302c';
        g.fillRect(px, py, PX, PX);
        for (let i = 0; i < 14; i++) {
          g.fillStyle = rnd() > 0.5 ? '#1b3a33' : '#122823';
          g.fillRect(px + rnd() * PX, py + rnd() * PX, 3, 6);
        }
      } else if (t === 'p' || t === '=' || t === 'X') {
        g.fillStyle = '#2b303c';
        g.fillRect(px, py, PX, PX);
        g.strokeStyle = '#20242e';
        g.lineWidth = 2;
        g.strokeRect(px + 1, py + 1, PX - 2, PX - 2);
      } else if (t === 'r') {
        g.fillStyle = '#15171e';
        g.fillRect(px, py, PX, PX);
        for (let i = 0; i < 10; i++) {
          g.fillStyle = '#1c1f28';
          g.fillRect(px + rnd() * PX, py + rnd() * PX, 2, 2);
        }
      } else {
        const room = roomAt(x, y);
        const floor = room?.floor ?? 'boards';
        if (floor === 'carpet') {
          g.fillStyle = room?.id === 'stash' ? '#251d33' : '#2a2140';
          g.fillRect(px, py, PX, PX);
        } else if (floor === 'tiles') {
          g.fillStyle = (x + y) % 2 ? '#273242' : '#1f2836';
          g.fillRect(px, py, PX, PX);
        } else {
          g.fillStyle = '#2a2a33';
          g.fillRect(px, py, PX, PX);
          g.strokeStyle = '#212129';
          g.lineWidth = 2;
          for (let i = 0; i < 4; i++) {
            g.beginPath();
            g.moveTo(px, py + i * 16 + 8);
            g.lineTo(px + PX, py + i * 16 + 8);
            g.stroke();
          }
        }
      }
    }
  }
  // Kerb and road markings.
  g.fillStyle = '#3a4050';
  g.fillRect(0, 24 * PX - 6, level.w * PX, 6);
  g.fillStyle = '#c9c9b8';
  for (let x = 0; x < level.w * PX; x += 160) g.fillRect(x + 20, 25 * PX + PX - 6, 90, 6);
  // Rug in the living room.
  g.fillStyle = '#3a2f55';
  g.fillRect(6 * PX + 10, 15 * PX + 6, 2 * PX - 20, 3 * PX - 12);
  g.strokeStyle = '#4b3f6b';
  g.lineWidth = 4;
  g.strokeRect(6 * PX + 16, 15 * PX + 12, 2 * PX - 32, 3 * PX - 24);
  // Front path.
  g.fillStyle = '#343a48';
  g.fillRect(12 * PX, 20 * PX, 2 * PX, 2 * PX);
  // Garden path to the back door.
  g.fillStyle = '#28303a';
  for (let y = 2; y < 7; y++) g.fillRect(19 * PX + 10, y * PX + 6, PX - 20, PX - 12);
  return c;
}

export function buildWorld(scene: Scene, level: Level, co: Coords, shadows: ShadowGenerator): World {
  const casters: AbstractMesh[] = [];

  // Ground with a painted texture.
  const ground = MeshBuilder.CreateGround('ground', { width: level.w, height: level.h }, scene);
  const tex = new DynamicTexture('groundTex', { width: level.w * PX, height: level.h * PX }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.drawImage(drawGround(level), 0, 0);
  tex.update(false);
  tex.anisotropicFilteringLevel = 8;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const gm = new StandardMaterial('groundMat', scene);
  gm.diffuseTexture = tex;
  gm.specularColor = new Color3(0.05, 0.05, 0.07);
  gm.maxSimultaneousLights = 10;
  ground.material = gm;
  ground.receiveShadows = true;

  // Outer ground beyond the map so the edges fade into the night.
  const outer = MeshBuilder.CreateGround('outer', { width: level.w + 60, height: level.h + 60 }, scene);
  outer.position.y = -0.02;
  outer.material = mat(scene, '#0c111c');
  outer.isPickable = false;

  // Walls, windows, fences and neighbouring houses, merged by material.
  const brick: Mesh[] = [];
  const plaster: Mesh[] = [];
  const fences: Mesh[] = [];
  const neighbours: Mesh[] = [];
  const glass: Mesh[] = [];
  const isShell = (x: number, y: number) => x === 4 || x === 25 || y === 7 || y === 19;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, top: string, side: string) => {
    const b = MeshBuilder.CreateBox('b', {
      width: w,
      height: h,
      depth: d,
      faceColors: [0, 1, 2, 3, 4, 5].map((i) => {
        const c = Color3.FromHexString(i === 4 ? top : side);
        return c.toColor4(1);
      }),
    }, scene);
    b.position.set(x, y, z);
    return b;
  };
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const t = level.tiles[y][x];
      const X = co.X(x + 0.5);
      const Z = co.Z(y + 0.5);
      if (t === '#') {
        const shell = isShell(x, y) && x >= 4 && x <= 25 && y >= 7 && y <= 19;
        const b = box(1, WALL_H, 1, X, WALL_H / 2, Z, shell ? PALETTE.brickTop : PALETTE.plasterTop, shell ? PALETTE.brick : PALETTE.plaster);
        (shell ? brick : plaster).push(b);
      } else if (t === 'W') {
        brick.push(box(1, 0.5, 1, X, 0.25, Z, PALETTE.brickTop, PALETTE.brick));
        brick.push(box(1, 0.2, 1, X, WALL_H - 0.1, Z, PALETTE.brickTop, PALETTE.brick));
        const vertical = level.tiles[y][x - 1] === '#' || level.tiles[y][x + 1] === '#' || level.tiles[y][x - 1] === 'W' || level.tiles[y][x + 1] === 'W';
        const pane = MeshBuilder.CreateBox('pane', { width: vertical ? 1 : 0.08, height: 0.8, depth: vertical ? 0.08 : 1 }, scene);
        pane.position.set(X, 0.9, Z);
        glass.push(pane);
      } else if (t === '=') {
        const front = y === 21 || y === 20;
        const hgt = front ? 0.55 : 0.95;
        fences.push(box(1, hgt, front ? 0.5 : 0.25, X, hgt / 2, Z, front ? PALETTE.brickTop : '#3a3446', front ? PALETTE.brick : PALETTE.fence));
      } else if (t === 'X') {
        neighbours.push(box(1, 2.6, 1, X, 1.3, Z, PALETTE.roof, PALETTE.neighbour));
      }
    }
  }
  const merge = (list: Mesh[], name: string, cast: boolean) => {
    if (!list.length) return null;
    const m = Mesh.MergeMeshes(list, true, true)!;
    m.name = name;
    m.material = mat(scene, '#ffffff');
    m.receiveShadows = true;
    if (cast) casters.push(m);
    m.freezeWorldMatrix();
    return m;
  };
  merge(brick, 'brick', true);
  merge(plaster, 'plaster', true);
  merge(fences, 'fences', true);
  merge(neighbours, 'neighbours', true);
  const g = Mesh.MergeMeshes(glass, true, true);
  if (g) g.material = mat(scene, '#6f9be8', { emissive: '#1d3566', alpha: 0.35 });

  // Lit windows on the neighbours' walls facing the street for life.
  for (const [x, y] of [
    [1, 19], [2, 19], [29, 19], [1, 7], [29, 7],
  ]) {
    const p = MeshBuilder.CreatePlane('lit', { width: 0.6, height: 0.6 }, scene);
    p.position.set(co.X(x + 0.5), 1.4, co.Z(y + 1) - 0.01);
    p.material = mat(scene, '#000000', { emissive: '#ffb45a', unlit: true });
  }

  // Doors on hinges.
  const doors: World['doors'] = new Map();
  for (const d of level.doors) {
    const pivot = new TransformNode(`door-${d.x}-${d.y}`, scene);
    const leaf = MeshBuilder.CreateBox('leaf', { width: 0.94, height: 1.35, depth: 0.08 }, scene);
    leaf.material = mat(scene, PALETTE.door);
    leaf.parent = pivot;
    const handle = MeshBuilder.CreateBox('handle', { width: 0.06, height: 0.06, depth: 0.14 }, scene);
    handle.material = mat(scene, '#8a8fa3', { spec: 0.4 });
    handle.parent = leaf;
    handle.position.set(0.36, 0, 0);
    if (d.axis === 'h') {
      pivot.position.set(co.X(d.x), 0, co.Z(d.y + 0.5));
      leaf.position.set(0.47, 0.675, 0);
    } else {
      pivot.position.set(co.X(d.x + 0.5), 0, co.Z(d.y));
      pivot.rotation.y = Math.PI / 2;
      leaf.position.set(0.47, 0.675, 0);
    }
    casters.push(leaf);
    doors.set(`${d.x},${d.y}`, { pivot, leaf, axis: d.axis, open: 0 });
  }

  // Props.
  let tvLight: PointLight | null = null;
  for (const p of level.props) buildProp(scene, co, p, casters);

  // The getaway van.
  {
    const v = level.van;
    const cx = co.X((v.x0 + v.x1 + 1) / 2);
    const cz = co.Z((v.y0 + v.y1 + 1) / 2);
    const body = MeshBuilder.CreateBox('van', { width: 4.4, height: 1.1, depth: 1.7 }, scene);
    body.position.set(cx, 0.75, cz);
    body.material = mat(scene, '#101219', { spec: 0.5 });
    const cab = MeshBuilder.CreateBox('vanCab', { width: 3.4, height: 0.55, depth: 1.6 }, scene);
    cab.position.set(cx - 0.4, 1.55, cz);
    cab.material = mat(scene, '#0d0f15', { spec: 0.6 });
    const glassV = MeshBuilder.CreateBox('vanGlass', { width: 0.06, height: 0.42, depth: 1.4 }, scene);
    glassV.position.set(cx + 1.31, 1.5, cz);
    glassV.material = mat(scene, '#1d2b45', { emissive: '#0d1830', spec: 0.8 });
    for (const dz of [-0.6, 0.6]) {
      const hl = MeshBuilder.CreateBox('hl', { width: 0.05, height: 0.16, depth: 0.3 }, scene);
      hl.position.set(cx + 2.21, 0.85, cz + dz);
      hl.material = mat(scene, '#ffffff', { emissive: '#fff4d6', unlit: true });
      for (const dx of [-1.4, 1.4]) {
        const wheel = MeshBuilder.CreateCylinder('wh', { diameter: 0.6, height: 0.25 }, scene);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(cx + dx, 0.3, cz + dz * 1.45);
        wheel.material = mat(scene, '#07080b');
      }
    }
    casters.push(body, cab);
  }

  // Loot props: stacks of cash, a bag, wrapped product. Bright green.
  const loot: World['loot'] = new Map();
  for (const l of level.loot) {
    const node = new TransformNode(`loot-${l.id}`, scene);
    node.position.set(co.X(l.x), 0, co.Z(l.y));
    const glow = mat(scene, '#1d6b4b', { emissive: PALETTE.loot });
    const onTable = l.id === 'cash' ? 0.42 : l.id === 'product' ? 0.92 : 0;
    if (l.heavy) {
      const bag = MeshBuilder.CreateCapsule('bag', { height: 0.8, radius: 0.22, orientation: new Vector3(1, 0, 0) }, scene);
      bag.position.y = 0.22;
      bag.material = mat(scene, '#0f2a20', { emissive: '#1fa36b' });
      bag.parent = node;
      const strap = MeshBuilder.CreateTorus('strap', { diameter: 0.3, thickness: 0.04 }, scene);
      strap.rotation.z = Math.PI / 2;
      strap.position.y = 0.4;
      strap.material = glow;
      strap.parent = node;
    } else {
      for (let i = 0; i < 5; i++) {
        const b = MeshBuilder.CreateBox('stack', { width: 0.22, height: 0.08, depth: 0.12 }, scene);
        b.position.set(((i % 3) - 1) * 0.25, onTable + 0.04 + Math.floor(i / 3) * 0.09, (i % 2) * 0.15 - 0.07);
        b.rotation.y = i * 0.4;
        b.material = glow;
        b.parent = node;
      }
    }
    loot.set(l.id, node);
  }

  // Lights placed by the level.
  for (const l of level.lights) {
    const pos = new Vector3(co.X(l.x), 0, co.Z(l.y));
    if (l.kind === 'street') {
      const pl = new PointLight('street', pos.add(new Vector3(0, 3.2, 0)), scene);
      pl.diffuse = Color3.FromHexString(PALETTE.street);
      pl.specular = pl.diffuse.scale(0.3);
      pl.intensity = 1.6;
      pl.range = 11;
    } else if (l.kind === 'tv') {
      tvLight = new PointLight('tv', pos.add(new Vector3(0.4, 0.9, 0)), scene);
      tvLight.diffuse = Color3.FromHexString('#7aa8ff');
      tvLight.intensity = 1.3;
      tvLight.range = 6;
    } else if (l.kind === 'fridge') {
      const pl = new PointLight('fridge', pos.add(new Vector3(-0.3, 1.0, 0)), scene);
      pl.diffuse = Color3.FromHexString('#dff2ff');
      pl.intensity = 1.1;
      pl.range = 5;
    } else if (l.kind === 'ceiling') {
      const pl = new PointLight('ceiling', pos.add(new Vector3(0, 2.6, 0)), scene);
      pl.diffuse = Color3.FromHexString('#c9b8ff');
      pl.intensity = 0.55;
      pl.range = 7;
    } else if (l.kind === 'van') {
      const pl = new PointLight('van', pos.add(new Vector3(3.2, 0.8, 0)), scene);
      pl.diffuse = Color3.FromHexString('#fff1d0');
      pl.intensity = 0.9;
      pl.range = 6;
    }
  }

  for (const m of casters) shadows.addShadowCaster(m, false);
  return { doors, loot, tvLight, ground, casters };
}

function buildProp(scene: Scene, co: Coords, p: PropDef, casters: AbstractMesh[]): void {
  const root = new TransformNode(`prop-${p.kind}`, scene);
  root.position.set(co.X(p.x + p.w / 2), 0, co.Z(p.y + p.h / 2));
  // Built in world orientation: W along x, D along z. The front faces (fx, fz).
  const W = p.w;
  const D = p.h;
  const f = p.facing ?? Math.PI / 2;
  const fx = Math.round(Math.cos(f));
  const fz = Math.round(-Math.sin(f));
  const alongX = Math.abs(fx) > 0;
  const add = (m: Mesh, cast = true) => {
    m.parent = root;
    m.receiveShadows = true;
    if (cast) casters.push(m);
    return m;
  };
  const b = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string, o: Parameters<typeof mat>[2] = {}) => {
    const m = MeshBuilder.CreateBox(p.kind, { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z);
    m.material = mat(scene, hex, o);
    return add(m);
  };
  /** A slab across the prop, `back` units behind its centre. */
  const panel = (thick: number, len: number, h: number, y: number, back: number, hex: string, o: Parameters<typeof mat>[2] = {}) =>
    b(alongX ? thick : len, h, alongX ? len : thick, -fx * back, y, -fz * back, hex, o);
  const span = alongX ? D : W;
  switch (p.kind) {
    case 'tv': {
      b(W * 0.9, 0.45, D * 0.9, 0, 0.225, 0, PALETTE.charcoal);
      panel(0.06, 1.7, 0.62, 0.85, 0, '#0b0d12');
      panel(0.02, 1.6, 0.54, 0.85, -0.04, '#9cc3ff', { emissive: '#6f9cff', unlit: true });
      break;
    }
    case 'sofa': {
      b(W * 0.9, 0.42, D * 0.95, 0, 0.21, 0, PALETTE.fabric);
      panel(0.25, span * 0.95, 0.75, 0.375, 0.33, PALETTE.fabric);
      for (const s of [-1, 1]) {
        const o = s * (span * 0.475 - 0.1);
        b(alongX ? 0.9 : 0.2, 0.55, alongX ? 0.2 : 0.9, alongX ? 0 : o, 0.275, alongX ? o : 0, '#24212e');
      }
      break;
    }
    case 'armchair': {
      b(0.85, 0.42, 0.85, 0, 0.21, 0, PALETTE.fabric);
      panel(0.2, 0.85, 0.75, 0.375, 0.33, PALETTE.fabric);
      break;
    }
    case 'coffeeTable': {
      b(0.8, 0.06, 0.9, 0, 0.38, 0, '#1e1c27', { spec: 0.3 });
      for (const [dx, dz] of [[-0.35, -0.4], [0.35, -0.4], [-0.35, 0.4], [0.35, 0.4]]) b(0.05, 0.36, 0.05, dx, 0.18, dz, '#16151c');
      break;
    }
    case 'stairs': {
      for (let i = 0; i < 6; i++) b(W, 0.2 + i * 0.22, D / 6, 0, (0.2 + i * 0.22) / 2, -D / 2 + (i + 0.5) * (D / 6), i % 2 ? '#34333f' : '#2d2c37');
      break;
    }
    case 'counter': {
      b(W, 0.88, D * 0.9, 0, 0.44, 0, '#2a2f3c');
      b(W, 0.05, D * 0.95, 0, 0.9, 0, '#5d6478', { spec: 0.3 });
      b(0.5, 0.02, 0.4, -W / 2 + 0.6, 0.93, 0, '#1a1d24', { spec: 0.6 });
      break;
    }
    case 'fridge': {
      b(0.8, 1.45, 0.75, 0, 0.725, 0, '#c7d0e0', { spec: 0.4 });
      panel(0.05, 0.62, 1.2, 0.75, -0.42, '#e9f6ff', { emissive: '#bfe3ff', unlit: true });
      break;
    }
    case 'table': {
      b(W * 0.9, 0.07, D * 0.85, 0, 0.75, 0, '#2c2a36', { spec: 0.25 });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(0.07, 0.72, 0.07, dx * (W * 0.42), 0.36, dz * (D * 0.38), '#1b1a22');
      for (let i = 0; i < 3; i++) {
        for (const dz of [-1, 1]) b(0.4, 0.45, 0.4, (i - 1) * 0.9, 0.225, dz * (D * 0.5 + 0.1), '#24222d');
      }
      break;
    }
    case 'cabinet': {
      b(W * 0.95, 0.8, D * 0.5, 0, 0.4, 0, '#24222e');
      break;
    }
    case 'bed': {
      b(W * 0.95, 0.35, D * 0.95, 0, 0.175, 0, '#1d1b26');
      b(W * 0.9, 0.18, D * 0.75, 0, 0.44, -D * 0.08, '#56607a');
      b(W * 0.7, 0.14, 0.4, 0, 0.5, D * 0.38, '#8a93ab');
      break;
    }
    case 'shelves': {
      panel(0.4, span * 0.95, 1.4, 0.7, 0.25, '#22202b');
      for (let i = 0; i < 4; i++) b(0.25, 0.2, 0.25, alongX ? 0 : -0.6 + i * 0.4, 1.0 + (i % 2) * 0.3, alongX ? -0.6 + i * 0.4 : 0.25 * fz * -1, '#4b4f66');
      break;
    }
    case 'shed': {
      b(W * 0.95, 1.5, D * 0.9, 0, 0.75, 0, '#252330');
      b(W, 0.1, D, 0, 1.55, 0, '#1b1a22');
      break;
    }
    case 'gardenTable': {
      const t = MeshBuilder.CreateCylinder('gt', { diameter: 1.0, height: 0.05 }, scene);
      t.position.y = 0.72;
      t.material = mat(scene, '#34364a');
      add(t);
      const leg = MeshBuilder.CreateCylinder('gl', { diameter: 0.08, height: 0.7 }, scene);
      leg.position.y = 0.35;
      leg.material = mat(scene, '#1b1a22');
      add(leg);
      for (const a of [0, 2.1, 4.2]) b(0.4, 0.45, 0.4, Math.cos(a) * 0.8, 0.225, Math.sin(a) * 0.8, '#2c2e3e');
      break;
    }
    case 'bins': {
      for (let i = 0; i < D; i++) {
        b(0.7, 1.0, 0.7, 0, 0.5, D / 2 - i - 0.5, i % 2 ? '#1f3b37' : '#232836');
        b(0.74, 0.06, 0.74, 0, 1.03, D / 2 - i - 0.5, '#121418');
      }
      break;
    }
    case 'tree': {
      const tr = MeshBuilder.CreateCylinder('trunk', { diameter: 0.25, height: 1.6 }, scene);
      tr.position.y = 0.8;
      tr.material = mat(scene, '#1e1b26');
      add(tr);
      const leaves = MeshBuilder.CreateIcoSphere('leaves', { radius: 1.2, subdivisions: 1 }, scene);
      leaves.position.y = 2.1;
      leaves.material = mat(scene, '#123a33');
      add(leaves);
      break;
    }
    case 'hedge': {
      b(W, 0.8, D * 0.8, 0, 0.4, 0, '#14352d');
      break;
    }
    case 'lamp': {
      const pole = MeshBuilder.CreateCylinder('pole', { diameter: 0.12, height: 3.2 }, scene);
      pole.position.y = 1.6;
      pole.material = mat(scene, '#1c1f28');
      add(pole);
      const head = MeshBuilder.CreateBox('lampHead', { width: 0.45, height: 0.14, depth: 0.25 }, scene);
      head.position.y = 3.2;
      head.material = mat(scene, '#ffcf8f', { emissive: '#ffb050', unlit: true });
      add(head, false);
      break;
    }
    case 'car': {
      b(W * 0.95, 0.65, D * 0.8, 0, 0.5, 0, '#283048', { spec: 0.5 });
      b(W * 0.5, 0.45, D * 0.72, -0.1, 1.05, 0, '#1a2033', { spec: 0.7 });
      break;
    }
    default:
      b(W, 0.5, D, 0, 0.25, 0, PALETTE.charcoal);
  }
  root.computeWorldMatrix(true);
  root.getChildMeshes().forEach((m) => m.freezeWorldMatrix());
}
