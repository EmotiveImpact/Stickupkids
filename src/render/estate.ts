// A level built in Blender (art/level/build_level.py for the estate,
// build_park.py for Burgess Park): geometry with a baked Cycles lightmap, the
// material table, and a light probe map that lights characters with the same
// light as the walls around them.

import {
  Color3,
  DynamicTexture,
  LoadAssetContainerAsync,
  PBRMaterial,
  Quaternion,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  type AbstractMesh,
  type Material,
  type Scene,
} from './babylon.ts';

interface MatDef {
  tex: string | null;
  tint: string;
  size: number;
  rough: number;
  emissive: [string, number] | null;
}

interface Meta {
  materials: Record<string, MatDef>;
  lights: [string, [number, number, number]][];
  doors: Record<string, { hinge: [number, number, number]; axis: 'h' | 'v' }>;
  cut: number;
  probe: { max: number; perUnit: number };
  /** The street lamps' colour, when the level says. */
  lamp?: string;
}

export interface EstateDoor {
  pivot: TransformNode;
  axis: 'h' | 'v';
  open: number;
}

export interface Estate {
  /** Door pivots keyed "x,y" by map cell. */
  doors: Map<string, EstateDoor>;
  /** Loot holders keyed by loot id; move them to the item's map position. */
  loot: Map<string, TransformNode>;
  probe: Probe;
  /** Light positions from the bake, in world space. */
  lights: { kind: string; pos: Vector3 }[];
  /** Lightmapped meshes. They take character shadows. */
  receivers: AbstractMesh[];
  /** Every mesh the level brought. */
  meshes: AbstractMesh[];
  /** The TV screen, for flicker. */
  tv: PBRMaterial | null;
  materials: Map<string, PBRMaterial>;
  /** The street lamps' colour: sodium on the estate, white LED in the park. */
  lamp: string;
}

/** Lights each lit material can take at once: the shadow light, torches, muzzle flashes. */
export const MAX_LIGHTS = 10;

// A host that will not serve .glb (the claude.ai artifact) gets each model as
// glTF JSON with its buffer embedded; that build defines __MODEL_EXT__.
declare const __MODEL_EXT__: string | undefined;
const MODEL_EXT = typeof __MODEL_EXT__ === 'string' ? __MODEL_EXT__ : '.glb';

/** Load models/<name> as an asset container. */
export function loadModel(path: string, scene: Scene) {
  return LoadAssetContainerAsync(path + MODEL_EXT, scene, MODEL_EXT.endsWith('.json') ? { pluginExtension: '.gltf' } : undefined);
}

export async function loadEstate(scene: Scene, base: string): Promise<Estate> {
  const meta = (await (await fetch(base + 'level-materials.json')).json()) as Meta;
  const [container, probe] = await Promise.all([
    loadModel(base + 'level', scene),
    Probe.load(base + 'level-probe.png', meta.probe.max, meta.probe.perUnit),
  ]);
  container.addAllToScene();

  // glTF is right-handed. The loader mirrors it into Babylon under a root that
  // also turns it half round; keep the mirror and drop the turn, so Blender X
  // and Y land on our X and Z, the same frame as Coords.
  const root = container.rootNodes[0] as TransformNode;
  root.rotationQuaternion = Quaternion.Identity();
  root.computeWorldMatrix(true);

  const lightmap = new Texture(base + 'level-lightmap.png', scene, {
    noMipmap: true,
    invertY: false,
    samplingMode: Texture.BILINEAR_SAMPLINGMODE,
  });
  lightmap.isRGBD = true;
  lightmap.coordinatesIndex = 1;
  lightmap.wrapU = lightmap.wrapV = Texture.CLAMP_ADDRESSMODE;

  const textures = new Map<string, Texture>();
  const albedo = (name: string) => {
    let t = textures.get(name);
    if (!t) {
      t = new Texture(`textures/${name}.jpg`, scene, { invertY: false });
      t.anisotropicFilteringLevel = 8;
      textures.set(name, t);
    }
    return t;
  };

  const materials = new Map<string, PBRMaterial>();
  const material = (name: string, lit: boolean): PBRMaterial => {
    const key = `${name}${lit ? ':lm' : ''}`;
    const hit = materials.get(key);
    if (hit) return hit;
    const def = meta.materials[name] ?? { tex: null, tint: '#808080', size: 1, rough: 0.8, emissive: null };
    const m = new PBRMaterial(key, scene);
    m.metallic = 0;
    m.roughness = def.rough;
    m.albedoColor = Color3.FromHexString(def.tint).toLinearSpace();
    if (def.tex) m.albedoTexture = albedo(def.tex);
    if (def.emissive) {
      m.emissiveColor = Color3.FromHexString(def.emissive[0]).toLinearSpace();
      m.emissiveIntensity = def.emissive[1];
    }
    if (lit) m.lightmapTexture = lightmap;
    // Lit windows: curtains drawn across a lit room, not a flat panel.
    // Dimmer than the bake had them, so the folds show instead of clipping to a flat panel.
    if (name.startsWith('emit_window')) {
      m.emissiveTexture = curtains(scene);
      m.emissiveIntensity *= 0.6;
    }
    if (name === 'glass') {
      m.alpha = 0.4;
      m.roughness = 0.08;
      m.emissiveColor = new Color3(0.01, 0.02, 0.05);
    }
    if (name === 'cap') m.unlit = true;
    // Tree crowns are see-through enough to follow someone under them; the
    // depth pre-pass keeps it to one layer of leaves, not a stack of blobs.
    if (name.startsWith('canopy')) {
      m.alpha = 0.55;
      m.needDepthPrePass = true;
    }
    if (name.startsWith('loot_')) {
      // Loot is not in the bake; a green glow makes it read as something to take.
      const glow: Record<string, [string, number]> = {
        loot_note: ['#3DFFA2', 0.35],
        loot_band: ['#d8f5e8', 0.2],
        loot_wrap: ['#3DFFA2', 0.25],
        loot_bag: ['#1fa36b', 0.18],
      };
      const [hex, k] = glow[name] ?? ['#3DFFA2', 0.2];
      m.emissiveColor = Color3.FromHexString(hex).toLinearSpace();
      m.emissiveIntensity = k;
    }
    m.environmentIntensity = 0;
    m.maxSimultaneousLights = MAX_LIGHTS;
    materials.set(key, m);
    return m;
  };

  const receivers: AbstractMesh[] = [];
  const old = new Set<Material>();
  for (const mesh of container.meshes) {
    if (!mesh.getTotalVertices()) continue;
    const src = mesh.material;
    if (src) old.add(src);
    const name = (src?.name ?? 'default').replace(/\.\d{3}$/, '');
    const lit = mesh.isVerticesDataPresent(VertexBuffer.UV2Kind);
    mesh.material = material(name, lit);
    mesh.isPickable = false;
    if (lit) {
      mesh.receiveShadows = true;
      receivers.push(mesh);
    }
  }
  for (const m of old) m.dispose(false, true);

  const byName = (name: string) => container.transformNodes.find((n) => n.name === name) ?? container.meshes.find((n) => n.name === name);

  // Doors swing about their hinge: hang each leaf from a pivot there.
  const doors = new Map<string, EstateDoor>();
  for (const [name, d] of Object.entries(meta.doors)) {
    const node = byName(name);
    if (!node) continue;
    const pivot = new TransformNode(`${name}-pivot`, scene);
    pivot.position.set(d.hinge[0], d.hinge[1], d.hinge[2]);
    node.setParent(pivot);
    const [, x, y] = name.split('_').map(Number);
    doors.set(`${x},${y}`, { pivot, axis: d.axis, open: 0 });
  }

  const loot = new Map<string, TransformNode>();
  for (const node of [...container.transformNodes, ...container.meshes]) {
    if (!node.name.startsWith('loot_') || node.parent !== root) continue;
    const holder = new TransformNode(`loot-${node.name.slice(5)}`, scene);
    holder.position.copyFrom(node.getAbsolutePosition());
    node.setParent(holder);
    loot.set(node.name.slice(5), holder);
  }

  // Everything else stays put.
  for (const mesh of container.meshes) {
    if (!mesh.parent || mesh.parent === root || (mesh.parent as TransformNode).parent === root) {
      if (![...doors.values()].some((d) => mesh.isDescendantOf(d.pivot)) && ![...loot.values()].some((l) => mesh.isDescendantOf(l))) {
        mesh.freezeWorldMatrix();
      }
    }
  }

  const lights = meta.lights.map(([kind, p]) => ({ kind, pos: new Vector3(p[0], p[2], p[1]) }));
  return { doors, loot, probe, lights, receivers, meshes: container.meshes, tv: materials.get('emit_tv') ?? null, materials, lamp: meta.lamp ?? '#ff9a3e' };
}

let curtainTex: DynamicTexture | null = null;

/** Soft curtain folds, one metre square (window UVs are in metres), brighter towards the top. */
function curtains(scene: Scene) {
  if (curtainTex && curtainTex.getScene() === scene) return curtainTex;
  const N = 256;
  const t = (curtainTex = new DynamicTexture('curtains', { width: N, height: N }, scene, true));
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  const img = g.createImageData(N, N);
  const TAU = Math.PI * 2;
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const rows = 0.82 + 0.18 * Math.cos(TAU * v);
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const fold = 0.5 + 0.5 * (0.6 * Math.sin(TAU * 7 * u) + 0.3 * Math.sin(TAU * 13 * u + 1.3) + 0.1 * Math.sin(TAU * 29 * u + 2.1));
      const k = (0.4 + 0.6 * Math.pow(fold, 1.5)) * rows;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * k);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  t.update(false);
  return t;
}

/**
 * Light at chest height across the map, baked from above. Characters sample it
 * so they sit in the same pools of lamp and TV light as the floor.
 */
export class Probe {
  private readonly rgb: Float32Array;
  readonly w: number;
  readonly h: number;
  private readonly perUnit: number;

  private constructor(rgb: Float32Array, w: number, h: number, perUnit: number) {
    this.rgb = rgb;
    this.w = w;
    this.h = h;
    this.perUnit = perUnit;
  }

  static async load(url: string, max: number, perUnit: number): Promise<Probe> {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let rgb: Float32Array = new Float32Array(c.width * c.height * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
      for (let k = 0; k < 3; k++) rgb[j + k] = Math.pow(px[i + k] / 255, 2.2) * max;
    }
    // The bake is noisy; three box blurs smooth it to about half a metre.
    const r = Math.max(1, Math.round(perUnit * 0.25));
    for (let i = 0; i < 3; i++) rgb = boxBlur(rgb, c.width, c.height, r);
    return new Probe(rgb, c.width, c.height, perUnit);
  }

  /** Linear light at map point (x, y). */
  sample(x: number, y: number, out: Color3): Color3 {
    const fx = Math.min(this.w - 1.001, Math.max(0, x * this.perUnit - 0.5));
    const fy = Math.min(this.h - 1.001, Math.max(0, y * this.perUnit - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (xx: number, yy: number, k: number) => this.rgb[(yy * this.w + xx) * 3 + k];
    const ch = (k: number) =>
      (at(x0, y0, k) * (1 - tx) + at(x0 + 1, y0, k) * tx) * (1 - ty) + (at(x0, y0 + 1, k) * (1 - tx) + at(x0 + 1, y0 + 1, k) * tx) * ty;
    out.set(ch(0), ch(1), ch(2));
    return out;
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= w) continue;
          s += src[(y * w + xx) * 3 + k];
          n++;
        }
        tmp[(y * w + x) * 3 + k] = s / n;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= h) continue;
          s += tmp[(yy * w + x) * 3 + k];
          n++;
        }
        out[(y * w + x) * 3 + k] = s / n;
      }
    }
  }
  return out;
}
