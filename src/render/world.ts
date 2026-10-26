// Map-to-world coordinates and a small cache of flat materials for overlays.
// The level itself is loaded from the Blender bake (estate.ts).

import { Color3, StandardMaterial, type Scene } from './babylon.ts';

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
