// Weather and air: rain over the open ground, haze under the street lamps and
// their smeared reflections on the wet road.

import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Texture,
  Vector3,
  type Scene,
} from './babylon.ts';
import type { Level } from '../sim/level.ts';
import type { Coords } from './world.ts';
import type { Estate } from './estate.ts';
import { Constants } from '@babylonjs/core/Engines/constants';

const LAMP = '#ff9a3e';

export class Atmosphere {
  private readonly rain: ParticleSystem;
  private readonly splash: ParticleSystem;
  private readonly haze: { mesh: Mesh; phase: number }[] = [];

  /** `slope`: how far up the map (in metres) a point one metre off the ground shows on screen. */
  constructor(scene: Scene, co: Coords, level: Level, estate: Estate, layerMask: number, slope: number) {
    // Rain falls on open ground only; the house has its roof off for us, not
    // for the weather. A drop high in the air shows over ground further up the
    // screen, so keep its whole fall, as seen, off the house.
    const house = (x: number, y: number) => x >= 4 && x <= 26 && y >= 7 && y <= 20;
    const indoors = (x: number, y: number, h = 0) => house(x, y) || house(x, y - slope * h * 0.5) || house(x, y - slope * h);
    const x0 = -6;
    const x1 = level.w + 6;
    const y0 = -4;
    const y1 = level.h + 6;
    const spot = (out: Vector3, height: number) => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < 12; i++) {
        x = x0 + Math.random() * (x1 - x0);
        y = y0 + Math.random() * (y1 - y0);
        if (!indoors(x, y, height)) break;
      }
      out.set(co.X(x), height, co.Z(y));
    };

    const rain = (this.rain = new ParticleSystem('rain', 5000, scene));
    rain.particleTexture = streakTexture(scene);
    rain.emitter = Vector3.Zero();
    rain.startPositionFunction = (_m, pos) => spot(pos, 5 + Math.random() * 4);
    rain.startDirectionFunction = (_m, dir) => dir.set(1.2 + Math.random() * 0.4, -15, 0.6);
    rain.minEmitPower = 1;
    rain.maxEmitPower = 1;
    rain.minLifeTime = 0.38;
    rain.maxLifeTime = 0.58;
    rain.emitRate = 6000;
    rain.minSize = 0.02;
    rain.maxSize = 0.028;
    rain.minScaleY = 14;
    rain.maxScaleY = 22;
    rain.color1 = new Color4(0.55, 0.65, 0.85, 0.22);
    rain.color2 = new Color4(0.75, 0.8, 0.95, 0.3);
    rain.colorDead = new Color4(0.6, 0.7, 0.9, 0.0);
    rain.blendMode = ParticleSystem.BLENDMODE_ADD;
    // Straight down the world is straight down the screen with this camera,
    // so plain billboards stretched tall read as streaks.
    rain.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
    rain.layerMask = layerMask;
    rain.preWarmCycles = 30;
    rain.start();

    const splash = (this.splash = new ParticleSystem('splash', 1500, scene));
    splash.particleTexture = dotTexture(scene);
    splash.emitter = Vector3.Zero();
    splash.startPositionFunction = (_m, pos) => spot(pos, 0.05);
    splash.startDirectionFunction = (_m, dir) => dir.set(0, 0.4, 0);
    splash.minLifeTime = 0.08;
    splash.maxLifeTime = 0.14;
    splash.emitRate = 900;
    // A size gradient sets the size outright (min/max are ignored), in metres.
    splash.addSizeGradient(0, 0.02, 0.03);
    splash.addSizeGradient(1, 0.06, 0.09);
    splash.color1 = new Color4(0.6, 0.7, 0.9, 0.12);
    splash.color2 = new Color4(0.8, 0.85, 1.0, 0.18);
    splash.colorDead = new Color4(0.6, 0.7, 0.9, 0);
    splash.blendMode = ParticleSystem.BLENDMODE_ADD;
    splash.layerMask = layerMask;
    splash.start();

    // Haze under the lamps (a soft shaft that always faces us) and their
    // reflections on the wet road.
    const shaft = shaftTexture(scene);
    const streak = streakGlow(scene);
    const hazeMat = new StandardMaterial('hazeMat', scene);
    hazeMat.disableLighting = true;
    hazeMat.diffuseColor = Color3.Black();
    hazeMat.specularColor = Color3.Black();
    hazeMat.emissiveColor = Color3.FromHexString(LAMP).scale(0.11);
    hazeMat.emissiveTexture = shaft;
    hazeMat.alphaMode = Constants.ALPHA_ADD;
    hazeMat.alpha = 0.99;
    hazeMat.disableDepthWrite = true;
    hazeMat.backFaceCulling = false;
    for (const l of estate.lights) {
      if (l.kind !== 'street') continue;
      const top = l.pos;
      const h = top.y + 0.1;
      const cone = MeshBuilder.CreatePlane('haze', { width: 7, height: h }, scene);
      cone.position.set(top.x, h / 2, top.z);
      cone.billboardMode = Mesh.BILLBOARDMODE_Y;
      cone.material = hazeMat;
      cone.isPickable = false;
      cone.layerMask = layerMask;
      this.haze.push({ mesh: cone, phase: Math.random() * 10 });

      // A lamp over the street throws a long smear across the wet tarmac towards us.
      const y = level.h / 2 - top.z;
      if (y < 20 || y > 26) continue;
      const len = Math.min(5.5, 28.2 - y);
      const r = MeshBuilder.CreateGround('reflect', { width: 1.0, height: len }, scene);
      r.position.set(top.x, 0.015, co.Z(y + len / 2 + 0.2));
      const rm = new StandardMaterial('reflectMat', scene);
      rm.disableLighting = true;
      rm.diffuseColor = Color3.Black();
      rm.specularColor = Color3.Black();
      rm.emissiveColor = Color3.FromHexString(LAMP).scale(0.22);
      rm.emissiveTexture = streak;
      rm.alphaMode = Constants.ALPHA_ADD;
      rm.alpha = 0.99;
      rm.disableDepthWrite = true;
      r.material = rm;
      r.isPickable = false;
      r.layerMask = layerMask;
    }
  }

  update(_dt: number, time: number) {
    for (const h of this.haze) h.mesh.visibility = 0.9 + Math.sin(time * 0.7 + h.phase) * 0.06;
  }

  setRain(on: boolean) {
    if (on) {
      this.rain.start();
      this.splash.start();
    } else {
      this.rain.stop();
      this.splash.stop();
    }
  }
}

function canvasTexture(scene: Scene, name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  t.hasAlpha = true;
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, w, h);
  draw(g);
  t.update();
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

function streakTexture(scene: Scene) {
  return canvasTexture(scene, 'rainTex', 8, 64, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.fillStyle = grad;
    g.fillRect(2, 0, 4, 64);
  });
}

let glow: DynamicTexture | null = null;

/** A soft round glow, shared: muzzle flashes and dust. */
export function glowTexture(scene: Scene) {
  if (glow && glow.getScene() === scene) return glow;
  glow = canvasTexture(scene, 'glowTex', 64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,240,210,1)');
    grad.addColorStop(0.25, 'rgba(255,200,120,0.7)');
    grad.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  return glow;
}

/** A soft white dot: splashes and dust. */
export function dotTexture(scene: Scene) {
  return canvasTexture(scene, 'splashTex', 32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  });
}

/** A soft cone of light in damp air: narrow and bright at the lamp, wide and faint by the ground. */
function shaftTexture(scene: Scene) {
  const W = 128;
  const H = 256;
  return canvasTexture(scene, 'hazeTex', W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1);
      const half = 0.04 + 0.42 * t;
      const fall = Math.pow(1 - t, 1.6);
      for (let x = 0; x < W; x++) {
        const u = Math.abs(x / (W - 1) - 0.5) / half;
        const core = Math.exp(-((x / (W - 1) - 0.5) ** 2 + (t * 0.25) ** 2) * 900) * 0.6;
        const k = Math.min(1, Math.exp(-u * u * 2.2) * fall + core);
        const v = Math.round(255 * k);
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** A soft, broken smear: bright near the lamp, rippled, fading towards the viewer. */
function streakGlow(scene: Scene) {
  return canvasTexture(scene, 'reflectTex', 64, 256, (g) => {
    for (let y = 0; y < 256; y++) {
      const along = y / 255;
      const ripple = 0.5 + 0.5 * Math.sin(y * 0.55) * Math.sin(y * 0.13 + 0.7);
      const fade = Math.pow(1 - along, 1.6) * Math.min(1, along * 12) * (0.35 + 0.65 * ripple);
      for (let x = 0; x < 64; x++) {
        const across = Math.abs(x - 31.5) / 32;
        const k = Math.max(0, fade * Math.exp(-across * across * (9 + along * 6)));
        const v = Math.round(255 * k);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  });
}
