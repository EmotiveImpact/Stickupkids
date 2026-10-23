// The Babylon.js view. Reads simulation state each frame; owns no game rules.

import {
  Camera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Effect,
  Engine,
  FreeCamera,
  HemisphericLight,
  ImageProcessingConfiguration,
  Light,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  PointLight,
  PostProcess,
  Scene,
  ShadowGenerator,
  SpotLight,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractMesh,
} from './babylon.ts';
import type { Level, Vec } from '../sim/level.ts';
import { planSegments, type Crew, type Enemy, type Sim, type SimEvent, type Waypoint } from '../sim/sim.ts';
import { PALETTE, WALL_H } from './palette.ts';
import { Coords, mat } from './world.ts';
import { loadEstate, type Estate } from './estate.ts';
import { CHAR_SCALE, CharacterKit, type Character } from './characters.ts';
import { Atmosphere, dotTexture, glowTexture } from './atmosphere.ts';
import { Constants } from '@babylonjs/core/Engines/constants';

const OVERLAY = 0x10000000;
const WORLD = 0x0fffffff;
const TILT = (54 * Math.PI) / 180;
/** Walk and run clip speeds in metres a second at scale 1. */
const WALK = 0.95;
const RUN = 3.4;

Effect.ShadersStore['blueprintFragmentShader'] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float amount;
uniform vec2 screenSize;
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  if (amount <= 0.001) { gl_FragColor = c; return; }
  vec2 px = 1.0 / screenSize;
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float lx = dot(texture2D(textureSampler, vUV + vec2(px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float ly = dot(texture2D(textureSampler, vUV + vec2(0.0, px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float edge = clamp((abs(l - lx) + abs(l - ly)) * 6.0, 0.0, 1.0);
  vec3 deep = vec3(0.035, 0.11, 0.24);
  vec3 wash = vec3(0.118, 0.31, 0.56);
  vec3 bright = vec3(0.62, 0.82, 1.0);
  float k = clamp(pow(l * 2.2, 0.75), 0.0, 1.0);
  vec3 bp = mix(deep, wash, k);
  bp = mix(bp, bright, clamp(k - 0.7, 0.0, 1.0) * 1.5);
  bp = mix(bp, bright, edge * 0.85);
  vec2 g = mod(gl_FragCoord.xy, 28.0);
  float grid = (g.x < 1.0 || g.y < 1.0) ? 1.0 : 0.0;
  bp += vec3(0.05, 0.11, 0.2) * grid;
  gl_FragColor = vec4(mix(c.rgb, bp, amount), 1.0);
}
`;

export type Mode = 'planning' | 'raid';

export interface PlanOverlay {
  plans: Waypoint[][];
  version: number;
  selected: number;
  selectedWp: number | null;
  hover: Vec | null;
}

interface Actor {
  root: TransformNode;
  body: TransformNode;
  light: HemisphericLight;
  char: Character | null;
  ring: Mesh;
  cone: Mesh;
  bag?: Mesh;
  torch?: SpotLight;
  icon?: { plane: Mesh; tex: DynamicTexture; key: string };
  /** Current trim colour, so it is only changed when the state does. */
  tint?: string;
  last: Vec | null;
  speed: number;
}

interface Fx {
  mesh: Mesh;
  t: number;
  life: number;
  kind: 'ring' | 'tracer' | 'flash' | 'popup';
  r?: number;
}

/** Character models in public/models/ai/. A level can name others; until they arrive the kind's model stands in. */
// Models by name; an enemy whose model is not here uses their kind's.
const MODELS = new Set(['crew', 'dealer', 'soldier', 'runner', 'dog', 'gang-leader', 'gang-lookout', 'gang-muscle-a', 'gang-muscle-b', 'gang-runner']);
const modelFor = (e: { kind: string; model?: string }) => (e.model && MODELS.has(e.model) ? e.model : e.kind);

/** Enemies who are held up or down drop their red: grey reads as out of the fight. */
const NEUTRAL = '#aab4c8';

interface Flash {
  light: PointLight;
  t: number;
  power: number;
}

export function createEngine(canvas: HTMLCanvasElement): Engine {
  return new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
}

export class View {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly level: Level;
  readonly co: Coords;
  private readonly assets: string;
  /** Resolves once the level and characters have loaded. */
  readonly ready: Promise<void>;
  private cam: FreeCamera;
  private ocam: FreeCamera;
  private pipeline: DefaultRenderingPipeline;
  private bp: PostProcess;
  private bpAmount = 1;
  private bpTarget = 1;
  private estate: Estate | null = null;
  private readonly kits = new Map<string, CharacterKit>();
  private atmosphere: Atmosphere | null = null;
  private shadowLight: DirectionalLight;
  private shadows: ShadowGenerator;
  private keyLight: DirectionalLight | null = null;
  private tvLight: PointLight | null = null;
  private flashes: Flash[] = [];
  private crew: Actor[] = [];
  private enemies = new Map<string, Actor>();
  private fx: Fx[] = [];
  private pathMesh: Mesh | null = null;
  private markers: TransformNode;
  private pathKey = '';
  private pathT = 0;
  private fog = new Map<string, Mesh>();
  private lockIcons = new Map<string, Mesh>();
  private hoverMesh: Mesh;
  private insets = { left: 250, right: 10, top: 30, bottom: 70 };
  private time = 0;
  private zoom = 1;
  private pan = { x: 0, z: 0 };
  private scale = 1;
  private shake = 0;
  private shaking = false;
  private flashMat: StandardMaterial | null = null;
  private dust: ParticleSystem | null = null;
  private probeColour = new Color3();
  mode: Mode = 'planning';

  /** `assets`: the folder holding the level's bake, e.g. models/estate/. */
  constructor(engine: Engine, level: Level, assets: string) {
    this.assets = assets;
    this.level = level;
    this.co = new Coords(level.w, level.h);
    this.engine = engine;
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = Color4.FromHexString(PALETTE.night + 'ff');
    scene.ambientColor = Color3.Black();

    // Fixed orthographic camera, tilted so wall faces read.
    this.cam = new FreeCamera('cam', Vector3.Zero(), scene);
    this.ocam = new FreeCamera('ocam', Vector3.Zero(), scene);
    for (const c of [this.cam, this.ocam]) {
      c.mode = Camera.ORTHOGRAPHIC_CAMERA;
      c.minZ = 0.1;
      c.maxZ = 400;
      c.inputs.clear();
    }
    this.cam.layerMask = WORLD;
    this.ocam.layerMask = OVERLAY;
    scene.activeCameras = [this.cam, this.ocam];
    scene.cameraToUseForPointers = this.cam;

    // The level's light is baked. This light only carries character shadows
    // onto the baked surfaces, darkening the lightmap where it is blocked.
    const sl = (this.shadowLight = new DirectionalLight('shadow', new Vector3(0.22, -1, 0.3), scene));
    sl.lightmapMode = Light.LIGHTMAP_SHADOWSONLY;
    sl.diffuse = Color3.Black();
    sl.specular = Color3.Black();
    sl.position = new Vector3(-6, 30, -9);
    sl.shadowMinZ = 1;
    sl.shadowMaxZ = 60;
    sl.autoCalcShadowZBounds = false;
    const sg = (this.shadows = new ShadowGenerator(2048, sl));
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    sg.darkness = 0.3;
    sg.bias = 0.0015;
    sg.normalBias = 0.01;

    // Post: HDR, ACES, bloom on the lamps and screens, a little grain.
    const pp = (this.pipeline = new DefaultRenderingPipeline('pp', true, scene, [this.cam]));
    pp.samples = 4;
    pp.imageProcessingEnabled = true;
    const ip = pp.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.exposure = 3.2;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.4;
    ip.vignetteColor = new Color4(0.0, 0.01, 0.04, 0);
    pp.bloomEnabled = true;
    pp.bloomThreshold = 0.8;
    pp.bloomWeight = 0.5;
    pp.bloomKernel = 64;
    pp.bloomScale = 0.5;
    pp.chromaticAberrationEnabled = true;
    pp.chromaticAberration.aberrationAmount = 10;
    pp.chromaticAberration.radialIntensity = 0.8;
    pp.grainEnabled = true;
    pp.grain.intensity = 7;
    pp.grain.animated = true;
    pp.sharpenEnabled = true;
    pp.sharpen.edgeAmount = 0.2;

    this.bp = new PostProcess('blueprint', 'blueprint', ['amount', 'screenSize'], null, 1, this.cam);
    this.bp.onApply = (e) => {
      e.setFloat('amount', this.bpAmount);
      e.setFloat2('screenSize', this.bp.width, this.bp.height);
    };

    this.markers = new TransformNode('markers', scene);
    this.hoverMesh = MeshBuilder.CreateGround('hover', { width: 0.94, height: 0.94 }, scene);
    this.hoverMesh.material = mat(scene, '#ffffff', { emissive: '#ffffff', alpha: 0.12, unlit: true });
    this.toOverlay(this.hoverMesh);
    this.hoverMesh.position.y = 0.04;

    this.buildStaticOverlay();
    this.resize();
    this.ready = this.load();
  }

  private async load() {
    const scene = this.scene;
    // One rigged model per kind, from the AI character pipeline (art in /mnt/project-files/ai-models).
    // Backup always comes as soldiers.
    const kinds = [...new Set(['crew', 'soldier', ...this.level.enemies.map(modelFor)])];
    const [estate, ...kits] = await Promise.all([loadEstate(scene, this.assets), ...kinds.map((k) => CharacterKit.load(scene, `models/ai/${k}`))]);
    this.estate = estate;
    kinds.forEach((k, i) => this.kits.set(k, kits[i]));
    this.shadowLight.includedOnlyMeshes = estate.receivers;

    // A soft moon key so characters keep their shape between pools of light.
    const key = (this.keyLight = new DirectionalLight('key', new Vector3(0.35, -0.85, 0.55), scene));
    key.diffuse = Color3.FromHexString('#8fa8ff');
    key.specular = Color3.FromHexString('#3a4a80');
    key.intensity = 1.0;

    // The TV breathes a little on top of its baked light.
    const tv = estate.lights.find((l) => l.kind === 'tv');
    if (tv) {
      const tl = (this.tvLight = new PointLight('tvFlicker', tv.pos.add(new Vector3(0.6, 0, 0)), scene));
      tl.diffuse = Color3.FromHexString('#6c9cff');
      tl.specular = Color3.Black();
      tl.range = 5;
      tl.intensity = 0;
      tl.includedOnlyMeshes = estate.receivers;
    }
    // Muzzle flashes come from a small pool so lights never change count.
    for (let i = 0; i < 3; i++) {
      const l = new PointLight(`flash${i}`, new Vector3(0, -50, 0), scene);
      l.diffuse = Color3.FromHexString('#ffd9a0');
      l.specular = l.diffuse.scale(0.5);
      l.range = 7;
      l.intensity = 0;
      this.flashes.push({ light: l, t: 1, power: 0 });
    }

    const fm = (this.flashMat = new StandardMaterial('muzzle', scene));
    fm.disableLighting = true;
    fm.diffuseColor = Color3.Black();
    fm.emissiveColor = Color3.White();
    fm.diffuseTexture = glowTexture(scene);
    fm.useAlphaFromDiffuseTexture = true;
    fm.alphaMode = Constants.ALPHA_ADD;
    fm.alpha = 0.99;
    fm.disableDepthWrite = true;
    fm.backFaceCulling = false;
    const dust = (this.dust = new ParticleSystem('dust', 200, scene));
    dust.particleTexture = dotTexture(scene);
    dust.emitter = Vector3.Zero();
    dust.minEmitBox = new Vector3(-0.4, 0.1, -0.4);
    dust.maxEmitBox = new Vector3(0.4, 1.4, 0.4);
    dust.direction1 = new Vector3(-1, 0.2, -1);
    dust.direction2 = new Vector3(1, 0.6, 1);
    dust.minEmitPower = 0.3;
    dust.maxEmitPower = 1.2;
    dust.minLifeTime = 0.6;
    dust.maxLifeTime = 1.4;
    dust.addSizeGradient(0, 0.15, 0.35);
    dust.addSizeGradient(1, 0.6, 1.1);
    dust.color1 = new Color4(0.55, 0.55, 0.62, 0.35);
    dust.color2 = new Color4(0.45, 0.45, 0.55, 0.25);
    dust.colorDead = new Color4(0.4, 0.4, 0.5, 0);
    dust.gravity = new Vector3(0, -0.4, 0);
    dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    dust.emitRate = 0;
    dust.manualEmitCount = 0;
    dust.start();

    for (const def of this.crewColours()) this.crew.push(this.makeCrewActor(def));
    for (const e of this.level.enemies) this.enemies.set(e.id, this.makeEnemyActor(e.kind, modelFor(e)));
    this.refreshKey();
    this.atmosphere = new Atmosphere(scene, this.co, this.level, estate, WORLD, 1 / Math.tan(TILT));
    this.atmosphere.setRain(this.mode === 'raid');
  }

  /** Drop the scene so another level can take the engine. */
  dispose() {
    this.atmosphere = null;
    this.scene.dispose();
  }

  private refreshKey() {
    if (!this.keyLight) return;
    const meshes: AbstractMesh[] = [];
    for (const a of [...this.crew, ...this.enemies.values()]) meshes.push(...(a.char?.meshes ?? a.body.getChildMeshes()));
    this.keyLight.includedOnlyMeshes = meshes;
  }

  private crewColours() {
    return ['#22E3FF', '#FF2D9B', '#A6FF2E', '#FFB020'];
  }

  private toOverlay(m: AbstractMesh) {
    m.layerMask = OVERLAY;
    m.isPickable = false;
    for (const c of m.getChildMeshes()) {
      c.layerMask = OVERLAY;
      c.isPickable = false;
    }
  }

  setInsets(i: Partial<View['insets']>) {
    Object.assign(this.insets, i);
    this.resize();
  }

  resize() {
    this.engine.resize();
    const sw = this.engine.getRenderWidth();
    const sh = this.engine.getRenderHeight();
    const dpr = sw / Math.max(1, this.engine.getRenderingCanvas()!.clientWidth);
    const L = this.insets.left * dpr;
    const R = this.insets.right * dpr;
    const T = this.insets.top * dpr;
    const B = this.insets.bottom * dpr;
    const uw = Math.max(100, sw - L - R);
    const uh = Math.max(100, sh - T - B);
    const viewW = this.level.w + 1;
    const viewH = this.level.h * Math.sin(TILT) + WALL_H * Math.cos(TILT) + 0.5;
    const scale = (this.scale = Math.min(uw / viewW, uh / viewH) * this.zoom);
    const dx = L + uw / 2 - sw / 2;
    const dy = T + uh / 2 - sh / 2;
    for (const c of [this.cam, this.ocam]) {
      c.orthoLeft = (-sw / 2 - dx) / scale;
      c.orthoRight = (sw / 2 - dx) / scale;
      c.orthoTop = (sh / 2 + dy) / scale;
      c.orthoBottom = (-sh / 2 + dy) / scale;
    }
    this.placeCamera(0, 0);
  }

  private placeCamera(jx: number, jz: number) {
    const target = new Vector3(this.pan.x + jx, 0, this.pan.z + jz);
    for (const c of [this.cam, this.ocam]) {
      const d = 60;
      c.position.set(target.x, Math.sin(TILT) * d, target.z - Math.cos(TILT) * d);
      c.setTarget(target);
    }
  }

  /** Zoom by a factor, keeping the map point under the cursor still. */
  zoomAt(clientX: number, clientY: number, factor: number) {
    const before = this.groundAt(clientX, clientY);
    this.zoom = Math.min(3.2, Math.max(1, this.zoom * factor));
    this.resize();
    const after = this.groundAt(clientX, clientY);
    if (before && after) {
      this.pan.x += before.x - after.x;
      this.pan.z += before.z - after.z;
    }
    this.clampPan();
    this.resize();
  }

  /** Pan by a screen distance in CSS pixels. */
  panBy(dxPx: number, dyPx: number) {
    const dpr = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderingCanvas()!.clientWidth);
    this.pan.x -= (dxPx * dpr) / this.scale;
    this.pan.z += (dyPx * dpr) / (this.scale * Math.sin(TILT));
    this.clampPan();
    this.resize();
  }

  private clampPan() {
    const k = 1 - 1 / this.zoom;
    const mx = (this.level.w / 2) * k + 1;
    const mz = (this.level.h / 2) * k + 1;
    if (this.zoom <= 1.001) this.pan = { x: 0, z: 0 };
    this.pan.x = Math.max(-mx, Math.min(mx, this.pan.x));
    this.pan.z = Math.max(-mz, Math.min(mz, this.pan.z));
  }

  setMode(m: Mode) {
    this.mode = m;
    this.atmosphere?.setRain(m === 'raid');
    this.bpTarget = m === 'planning' ? 1 : 0;
    this.pathKey = '';
  }

  /** A light blueprint wash while the raid is paused. */
  setPaused(p: boolean) {
    if (this.mode === 'raid') this.bpTarget = p ? 0.35 : 0;
  }

  /** CSS pixel position of a map point at ground level. */
  toScreen(x: number, y: number): Vec {
    const p = Vector3.Project(
      new Vector3(this.co.X(x), 0, this.co.Z(y)),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.cam.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
    );
    const k = this.engine.getRenderingCanvas()!.clientWidth / this.engine.getRenderWidth();
    return { x: p.x * k, y: p.y * k };
  }

  /** World point on the ground plane under a screen point. */
  private groundAt(clientX: number, clientY: number): Vector3 | null {
    const rect = this.engine.getRenderingCanvas()!.getBoundingClientRect();
    const ray = this.scene.createPickingRay(clientX - rect.left, clientY - rect.top, Matrix.Identity(), this.cam);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    return ray.origin.add(ray.direction.scale(t));
  }

  /** Map coordinates under a screen point, or null if off the map. */
  pick(clientX: number, clientY: number): Vec | null {
    const p = this.groundAt(clientX, clientY);
    if (!p) return null;
    const x = p.x + this.level.w / 2;
    const y = this.level.h / 2 - p.z;
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return null;
    return { x, y };
  }

  // ------------------------------------------------------------ actors

  private makeCrewActor(color: string): Actor {
    const scene = this.scene;
    const char = this.kits.get('crew')!.spawn(scene, 'crew', { slot: color });
    const { root, body } = char;
    for (const m of char.meshes) this.shadows.addShadowCaster(m, false);
    const bag = MeshBuilder.CreateCapsule('bag', { height: 0.62, radius: 0.17, orientation: new Vector3(1, 0, 0) }, scene);
    bag.position.set(0, 1.12, -0.24);
    const bm = new PBRMaterial('bagMat', scene);
    bm.albedoColor = Color3.FromHexString('#14171e').toLinearSpace();
    bm.emissiveColor = Color3.FromHexString(PALETTE.loot).toLinearSpace();
    bm.emissiveIntensity = 0.12;
    bm.metallic = 0;
    bm.roughness = 0.7;
    bm.environmentIntensity = 0;
    bag.material = bm;
    bag.parent = body;
    bag.setEnabled(false);
    char.meshes.push(bag);
    this.shadows.addShadowCaster(bag, false);
    // A head torch, aimed where they look.
    const torch = new SpotLight('torch', new Vector3(0, 1.55, 0.1), new Vector3(0, -0.3, 1), (62 * Math.PI) / 180, 2, scene);
    torch.parent = body;
    torch.diffuse = Color3.FromHexString('#e8efff');
    torch.specular = torch.diffuse.scale(0.4);
    torch.range = 10;
    torch.intensity = 0;
    const ring = MeshBuilder.CreateTorus('ring', { diameter: 0.6 / CHAR_SCALE, thickness: 0.035 / CHAR_SCALE, tessellation: 32 }, scene);
    ring.material = mat(scene, color, { emissive: color, unlit: true });
    ring.parent = root;
    ring.position.y = 0.04;
    this.toOverlay(ring);
    const cone = this.makeCone(color, 0.18);
    return { root, body, light: char.light, char, ring, cone, bag, torch, last: null, speed: 0 };
  }

  private makeEnemyActor(kind: string, model = kind): Actor {
    const scene = this.scene;
    const char = this.kits.get(model)!.spawn(scene, kind, { slot: PALETTE.enemy });
    const { root, body, light } = char;
    for (const m of char.meshes) this.shadows.addShadowCaster(m, false);
    const s = CHAR_SCALE;
    const ring = MeshBuilder.CreateTorus('ring', { diameter: (kind === 'dog' ? 0.66 : 0.6) / s, thickness: 0.035 / s, tessellation: 32 }, scene);
    ring.material = mat(scene, PALETTE.enemy, { emissive: PALETTE.enemy, unlit: true });
    ring.parent = root;
    ring.position.y = 0.04;
    this.toOverlay(ring);
    const cone = this.makeCone(PALETTE.enemy, 0.2);
    const tex = new DynamicTexture('icon', { width: 128, height: 128 }, scene, true);
    tex.hasAlpha = true;
    const plane = MeshBuilder.CreatePlane('icon', { size: 0.55 / s }, scene);
    const im = new StandardMaterial('iconMat', scene);
    im.diffuseTexture = tex;
    im.emissiveTexture = tex;
    im.useAlphaFromDiffuseTexture = true;
    im.disableLighting = true;
    im.backFaceCulling = false;
    plane.material = im;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = root;
    plane.position.y = 2.1 / s;
    this.toOverlay(plane);
    return { root, body, light, char, ring, cone, icon: { plane, tex, key: '' }, last: null, speed: 0 };
  }

  /** Light an actor with the baked light where it stands. */
  private lightActor(a: Actor, x: number, y: number) {
    const c = this.estate!.probe.sample(x, y, this.probeColour);
    // A touch brighter than the floor so people read against it.
    a.light.diffuse.copyFrom(c).scaleInPlace(1.7);
    a.light.groundColor.copyFrom(c).scaleInPlace(0.45);
  }

  /** Smoothed ground speed in map units a second. */
  private trackSpeed(a: Actor, x: number, y: number, dt: number) {
    if (a.last && dt > 0) {
      const v = Math.hypot(x - a.last.x, y - a.last.y) / dt;
      a.speed += (Math.min(v, 8) - a.speed) * Math.min(1, dt * 10);
    }
    a.last = { x, y };
  }

  private animate(a: Actor, pose: 'move' | 'idle' | 'crouch' | 'down' | 'hands' | 'aim') {
    const c = a.char;
    if (!c) return;
    if (pose === 'down') {
      if (c.has('Down')) c.play('Down', 1, false);
      else c.freeze();
      return;
    }
    if (pose === 'hands' && c.has('HandsUp')) c.play('HandsUp');
    else if (pose === 'crouch' || pose === 'hands') c.play(a.speed > 0.15 && c.has('CrouchWalk') ? 'CrouchWalk' : 'CrouchIdle');
    else if (pose !== 'idle' && a.speed > 0.15) {
      if (a.speed < 1.9) c.play('Walk', Math.max(0.6, a.speed / (WALK * CHAR_SCALE)));
      else c.play('Run', Math.max(0.6, a.speed / (RUN * CHAR_SCALE)));
    } else if (pose === 'aim') c.play(c.has('Aim') ? 'Aim' : c.has('Bark') ? 'Bark' : 'Idle');
    else c.play('Idle');
  }

  /** Lie a body down: the Down clip if the model has one, else tip it over. */
  private layDown(a: Actor, dog: boolean) {
    if (a.char?.has('Down')) {
      a.body.rotation.x = 0;
      a.body.position.y = 0;
    } else {
      a.body.rotation.x = -Math.PI / 2;
      a.body.position.y = dog ? 0.1 : 0.14;
    }
    this.animate(a, 'down');
  }

  /** Words that rise and fade over a spot on the map: HANDS UP, DOWN. */
  private popup(x: number, y: number, text: string, colour: string) {
    const tex = new DynamicTexture('popup', { width: 512, height: 128 }, this.scene, true);
    tex.hasAlpha = true;
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.clearRect(0, 0, 512, 128);
    g.font = '700 92px Rajdhani, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 16;
    g.strokeStyle = 'rgba(8,12,24,0.9)';
    g.strokeText(text, 256, 68);
    g.fillStyle = colour;
    g.fillText(text, 256, 68);
    tex.update();
    const m = new StandardMaterial('popupMat', this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane('popup', { width: 3.6, height: 0.9 }, this.scene);
    plane.material = m;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position.set(this.co.X(x), 2.5, this.co.Z(y));
    plane.isPickable = false;
    this.toOverlay(plane);
    this.fx.push({ mesh: plane, t: 0, life: 1.8, kind: 'popup' });
  }

  private makeCone(color: string, alpha: number): Mesh {
    const rays = 36;
    const m = new Mesh('cone', this.scene);
    const vd = new VertexData();
    vd.positions = new Array((rays + 2) * 3).fill(0);
    const idx: number[] = [];
    for (let i = 0; i < rays; i++) idx.push(0, i + 2, i + 1);
    vd.indices = idx;
    vd.applyToMesh(m, true);
    const cm = new StandardMaterial('coneMat', this.scene);
    cm.emissiveColor = Color3.FromHexString(color);
    cm.diffuseColor = Color3.Black();
    cm.disableLighting = true;
    cm.alpha = alpha;
    cm.backFaceCulling = false;
    cm.disableDepthWrite = true;
    m.material = cm;
    this.toOverlay(m);
    return m;
  }

  private setCone(m: Mesh, pts: Vec[], ox: number, oy: number, y: number) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    pos[0] = this.co.X(ox);
    pos[1] = y;
    pos[2] = this.co.Z(oy);
    for (let i = 0; i < pts.length && i + 1 < pos.length / 3; i++) {
      pos[(i + 1) * 3] = this.co.X(pts[i].x);
      pos[(i + 1) * 3 + 1] = y;
      pos[(i + 1) * 3 + 2] = this.co.Z(pts[i].y);
    }
    m.updateVerticesData(VertexBuffer.PositionKind, pos);
    m.refreshBoundingInfo();
  }

  // ----------------------------------------------------------- overlay

  private iconPlane(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, px = 256): Mesh {
    const tex = new DynamicTexture('ico', { width: px, height: px }, this.scene, true);
    tex.hasAlpha = true;
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.clearRect(0, 0, px, px);
    draw(g, px);
    tex.update();
    const p = MeshBuilder.CreatePlane('ico', { size }, this.scene);
    const m = new StandardMaterial('icoMat', this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    p.material = m;
    this.toOverlay(p);
    return p;
  }

  private buildStaticOverlay() {
    const lv = this.level;
    // Fog of war over unscouted rooms.
    for (const id of lv.unscouted) {
      const r = lv.rooms.find((rr) => rr.id === id)!;
      const w = r.x1 - r.x0 + 1;
      const h = r.y1 - r.y0 + 1;
      const tex = new DynamicTexture('fog', { width: w * 64, height: h * 64 }, this.scene, true);
      tex.hasAlpha = true;
      const g = tex.getContext() as unknown as CanvasRenderingContext2D;
      g.fillStyle = 'rgba(5,10,24,0.94)';
      g.fillRect(0, 0, w * 64, h * 64);
      g.setLineDash([18, 12]);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 5;
      g.strokeRect(6, 6, w * 64 - 12, h * 64 - 12);
      g.fillStyle = 'rgba(160,190,255,0.75)';
      g.font = '700 120px Rajdhani, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', (w * 64) / 2, (h * 64) / 2 + 6);
      tex.update();
      const p = MeshBuilder.CreateGround('fog', { width: w + 0.4, height: h + 0.4 }, this.scene);
      p.position.set(this.co.X(r.x0 + w / 2), 0.08, this.co.Z(r.y0 + h / 2));
      const m = new StandardMaterial('fogMat', this.scene);
      m.diffuseTexture = tex;
      m.emissiveTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      m.disableLighting = true;
      m.disableDepthWrite = true;
      p.material = m;
      this.toOverlay(p);
      this.fog.set(id, p);
    }
    // Getaway zone.
    const ex = lv.exit;
    const ew = ex.x1 - ex.x0 + 1;
    const eh = ex.y1 - ex.y0 + 1;
    const tex = new DynamicTexture('exit', { width: ew * 64, height: eh * 64 }, this.scene, true);
    tex.hasAlpha = true;
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.fillStyle = 'rgba(61,255,162,0.10)';
    g.fillRect(0, 0, ew * 64, eh * 64);
    g.setLineDash([16, 10]);
    g.strokeStyle = PALETTE.loot;
    g.lineWidth = 5;
    g.strokeRect(4, 4, ew * 64 - 8, eh * 64 - 8);
    g.fillStyle = PALETTE.loot;
    g.font = '700 44px Rajdhani, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GETAWAY', (ew * 64) / 2, (eh * 64) / 2 + 2);
    tex.update();
    const ez = MeshBuilder.CreateGround('exit', { width: ew, height: eh }, this.scene);
    ez.position.set(this.co.X(ex.x0 + ew / 2), 0.03, this.co.Z(ex.y0 + eh / 2));
    const em = new StandardMaterial('exitMat', this.scene);
    em.diffuseTexture = tex;
    em.emissiveTexture = tex;
    em.useAlphaFromDiffuseTexture = true;
    em.disableLighting = true;
    em.disableDepthWrite = true;
    ez.material = em;
    this.toOverlay(ez);

    // Lock icons on locked doors (planning only).
    for (const d of lv.doors) {
      if (!d.locked) continue;
      const p = this.iconPlane(0.7, (g2, s) => drawLock(g2, s));
      p.rotation.x = Math.PI / 2;
      p.position.set(this.co.X(d.x + 0.5), 0.1, this.co.Z(d.y + 0.5));
      this.lockIcons.set(`${d.x},${d.y}`, p);
    }
    // Loot icons for known loot (planning only).
    for (const l of lv.loot) {
      const room = lv.rooms.find((r) => Math.floor(l.x) >= r.x0 && Math.floor(l.x) <= r.x1 && Math.floor(l.y) >= r.y0 && Math.floor(l.y) <= r.y1);
      if (room && lv.unscouted.includes(room.id)) continue;
      const p = this.iconPlane(0.8, (g2, s) => {
        g2.fillStyle = 'rgba(8,30,22,0.85)';
        g2.strokeStyle = PALETTE.loot;
        g2.lineWidth = s * 0.06;
        g2.beginPath();
        g2.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
        g2.fill();
        g2.stroke();
        g2.fillStyle = PALETTE.loot;
        g2.font = `700 ${s * 0.55}px Rajdhani, sans-serif`;
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.fillText('£', s / 2, s / 2 + s * 0.03);
      });
      p.billboardMode = Mesh.BILLBOARDMODE_ALL;
      p.position.set(this.co.X(l.x), 1.3, this.co.Z(l.y));
      p.metadata = { planningOnly: true, loot: l.id };
      this.lockIcons.set(`loot-${l.id}`, p);
    }
  }

  private buildPaths(sim: Sim, plan: PlanOverlay | null) {
    this.pathMesh?.dispose();
    this.pathMesh = null;
    this.markers.getChildMeshes().forEach((m) => m.dispose());
    const colours = this.crewColours();
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const dash = (a: Vec, b: Vec, col: Color3, phase: { d: number }, width: number) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-4) return;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      let t = 0;
      while (t < len) {
        const on = phase.d % 0.42 < 0.26;
        const step = Math.min(len - t, on ? 0.26 - (phase.d % 0.42) : 0.42 - (phase.d % 0.42));
        if (on) {
          const x0 = a.x + ux * t;
          const y0 = a.y + uy * t;
          const x1 = a.x + ux * (t + step);
          const y1 = a.y + uy * (t + step);
          const nx = -uy * width;
          const ny = ux * width;
          const base = positions.length / 3;
          for (const [px, py] of [[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny]]) {
            positions.push(this.co.X(px), 0.06, this.co.Z(py));
            colors.push(col.r, col.g, col.b, 1);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        t += step + 1e-6;
        phase.d += step + 1e-6;
      }
    };

    const crewList = sim.crew;
    crewList.forEach((c, i) => {
      if (c.state === 'down' || c.state === 'escaped') return;
      const col = Color3.FromHexString(colours[i]);
      const phase = { d: 0 };
      let wps: Waypoint[];
      let firstLeg: Vec[] = [];
      let startIdx = 0;
      if (this.mode === 'planning' && plan) {
        wps = plan.plans[i];
      } else {
        wps = c.plan;
        startIdx = c.wp;
        firstLeg = [{ x: c.x, y: c.y }, ...c.route];
      }
      const pts: Vec[] = [];
      if (this.mode === 'planning') {
        for (const seg of planSegments(sim.grid, wps)) pts.push(...seg);
      } else {
        pts.push(...firstLeg);
        if (startIdx < wps.length) {
          for (const seg of planSegments(sim.grid, wps.slice(startIdx))) pts.push(...seg.slice(1));
        }
      }
      for (let k = 1; k < pts.length; k++) dash(pts[k - 1], pts[k], col, phase, 0.055);
      // Waypoint dots and go-code diamonds.
      wps.forEach((w, k) => {
        if (this.mode === 'raid' && k < startIdx) return;
        const sel = plan && this.mode === 'planning' && plan.selected === i + 1 && plan.selectedWp === k;
        if (w.hold) {
          const d = this.iconPlane(0.78, (g, s) => drawDiamond(g, s, colours[i], w.hold!, !!sel));
          d.rotation.x = Math.PI / 2;
          d.position.set(this.co.X(w.x), 0.12, this.co.Z(w.y));
          d.parent = this.markers;
        } else if (k > 0) {
          const dot = MeshBuilder.CreateDisc('wp', { radius: sel ? 0.19 : 0.13, tessellation: 20 }, this.scene);
          dot.rotation.x = Math.PI / 2;
          dot.position.set(this.co.X(w.x), 0.09, this.co.Z(w.y));
          dot.material = mat(this.scene, colours[i], { emissive: colours[i], unlit: true });
          dot.parent = this.markers;
          this.toOverlay(dot);
          if (sel) {
            const halo = MeshBuilder.CreateTorus('halo', { diameter: 0.55, thickness: 0.04, tessellation: 24 }, this.scene);
            halo.position.set(this.co.X(w.x), 0.09, this.co.Z(w.y));
            halo.material = mat(this.scene, '#ffffff', { emissive: '#ffffff', unlit: true });
            halo.parent = this.markers;
            this.toOverlay(halo);
          }
        }
        if (w.kick && k < wps.length - 1) {
          const kk = this.iconPlane(0.6, (g, s) => drawKick(g, s, colours[i]));
          kk.rotation.x = Math.PI / 2;
          kk.position.set(this.co.X(w.x + 0.45), 0.13, this.co.Z(w.y - 0.45));
          kk.parent = this.markers;
        }
      });
    });
    if (positions.length) {
      const m = new Mesh('paths', this.scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.colors = colors;
      vd.indices = indices;
      vd.applyToMesh(m);
      const pm = new StandardMaterial('pathMat', this.scene);
      // Unlit white emissive, tinted per vertex by the crew colour.
      pm.disableLighting = true;
      pm.emissiveColor = Color3.White();
      pm.diffuseColor = Color3.Black();
      pm.backFaceCulling = false;
      pm.disableDepthWrite = true;
      m.material = pm;
      m.useVertexColors = true;
      this.toOverlay(m);
      this.pathMesh = m;
    }
    this.markers.getChildMeshes().forEach((m) => this.toOverlay(m));
  }

  // -------------------------------------------------------------- frame

  handleEvents(events: SimEvent[]) {
    for (const ev of events) {
      if (ev.type === 'door' && ev.state === 'broken') {
        this.shake = Math.max(this.shake, 0.14);
        if (this.dust) {
          (this.dust.emitter as Vector3).set(this.co.X(ev.x + 0.5), 0, this.co.Z(ev.y + 0.5));
          this.dust.manualEmitCount = 45;
        }
      }
      if (ev.type === 'surrender') {
        const e = this.lastSim?.enemies.find((q) => q.id === ev.id);
        if (e) this.popup(e.x, e.y, 'HANDS UP', '#ffffff');
      } else if (ev.type === 'down') {
        const sim = this.lastSim;
        if (ev.crew) {
          const c = sim?.crew.find((q) => String(q.def.slot) === ev.id);
          if (c) this.popup(c.x, c.y, `${c.def.name.toUpperCase()} DOWN`, this.crewColours()[c.def.slot - 1]);
        } else {
          const e = sim?.enemies.find((q) => q.id === ev.id);
          if (e) this.popup(e.x, e.y, 'DOWN', '#ffffff');
        }
      }
      if (ev.type === 'noise' && ev.r >= 2.5) {
        const ring = MeshBuilder.CreateTorus('noise', { diameter: 2, thickness: 0.04, tessellation: 48 }, this.scene);
        const enemyNoise = ev.label === 'Barking' || ev.label === 'Shouting';
        ring.material = mat(this.scene, '#ffffff', { emissive: enemyNoise ? PALETTE.enemy : '#d8e6ff', alpha: 0.6, unlit: true });
        ring.position.set(this.co.X(ev.x), 0.07, this.co.Z(ev.y));
        this.toOverlay(ring);
        this.fx.push({ mesh: ring, t: 0, life: 0.7, kind: 'ring', r: ev.r });
      } else if (ev.type === 'shot') {
        const a = new Vector3(this.co.X(ev.from.x), 1.25, this.co.Z(ev.from.y));
        const b = new Vector3(this.co.X(ev.to.x), 1.1, this.co.Z(ev.to.y));
        const len = Vector3.Distance(a, b);
        const t = MeshBuilder.CreateBox('tracer', { width: 0.04, height: 0.04, depth: len }, this.scene);
        t.position = a.add(b).scale(0.5);
        t.lookAt(b);
        t.material = mat(this.scene, '#ffffff', { emissive: ev.byCrew ? '#fff6c8' : PALETTE.enemy, unlit: true });
        this.toOverlay(t);
        this.fx.push({ mesh: t, t: 0, life: 0.08, kind: 'tracer' });
        this.shake = Math.max(this.shake, ev.byCrew ? 0.05 : 0.07);
        if (this.flashMat) {
          const dir = b.subtract(a).normalize();
          const m = MeshBuilder.CreatePlane('muzzle', { size: 0.7 }, this.scene);
          m.material = this.flashMat;
          m.billboardMode = Mesh.BILLBOARDMODE_ALL;
          m.position = a.add(dir.scale(0.55));
          m.isPickable = false;
          m.layerMask = WORLD;
          m.scaling.setAll(0.7 + Math.random() * 0.6);
          this.fx.push({ mesh: m, t: 0, life: 0.06, kind: 'flash' });
        }
        // Light the room for a frame or two.
        const f = this.flashes.reduce((p, q) => (q.t > p.t ? q : p), this.flashes[0]);
        if (f) {
          f.t = 0;
          f.power = 9;
          f.light.position.copyFrom(a.add(b.subtract(a).normalize().scale(0.6)));
          f.light.diffuse = Color3.FromHexString(ev.byCrew ? '#ffd9a0' : '#ffb08a');
        }
      }
    }
  }

  frame(dt: number, sim: Sim, plan: PlanOverlay | null) {
    this.time += dt;
    // Blueprint wash eases in and out.
    this.bpAmount += (this.bpTarget - this.bpAmount) * Math.min(1, dt * 5);
    if (Math.abs(this.bpTarget - this.bpAmount) < 0.002) this.bpAmount = this.bpTarget;
    const est = this.estate;
    if (!est) {
      this.scene.render();
      return;
    }
    const flicker = 1 + Math.sin(this.time * 9) * 0.12 + Math.sin(this.time * 23.7) * 0.08 + (Math.sin(this.time * 2.1) > 0.97 ? -0.3 : 0);
    if (this.tvLight) this.tvLight.intensity = Math.max(0, flicker - 0.75) * 1.2;
    if (est.tv) est.tv.emissiveIntensity = 6 * flicker;
    for (const f of this.flashes) {
      f.t += dt;
      f.light.intensity = f.t < 0.07 ? f.power * (1 - f.t / 0.07) : 0;
    }
    this.atmosphere?.update(dt, this.time);
    if (this.shake > 0.002) {
      this.shake *= Math.exp(-dt * 14);
      this.placeCamera((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake);
      this.shaking = true;
    } else if (this.shaking) {
      this.shaking = false;
      this.placeCamera(0, 0);
    }

    const planning = this.mode === 'planning';
    for (const [key, icon] of this.lockIcons) {
      if (key.startsWith('loot-')) {
        const item = sim.loot.find((l) => `loot-${l.def.id}` === key);
        icon.setEnabled(planning && item?.state === 'placed');
        if (icon.isEnabled()) icon.position.y = 1.3 + Math.sin(this.time * 2.5) * 0.06;
      } else {
        const [x, y] = key.split(',').map(Number);
        const st = sim.grid.door(x, y);
        icon.setEnabled(st === 'locked');
      }
    }

    // Crew.
    sim.crew.forEach((c, i) => this.updateCrew(this.crew[i], c, plan, i, dt));
    // Enemies (backup can spawn mid-raid).
    for (const e of sim.enemies) {
      let a = this.enemies.get(e.id);
      if (!a) {
        a = this.makeEnemyActor(e.kind);
        this.enemies.set(e.id, a);
        this.refreshKey();
      }
      this.updateEnemy(a, e, sim, dt);
    }
    // Doors swing; a kicked door slams right back.
    for (const [key, d] of est.doors) {
      const [x, y] = key.split(',').map(Number);
      const st = sim.grid.door(x, y);
      const target = st === 'open' ? 1 : st === 'broken' ? 1.12 : 0;
      d.open += (target - d.open) * Math.min(1, dt * (st === 'broken' ? 18 : 10));
      d.pivot.rotation.y = -d.open * (Math.PI / 2) * 0.95;
    }
    // Loot.
    for (const item of sim.loot) {
      const node = est.loot.get(item.def.id);
      if (!node) continue;
      node.setEnabled(item.state === 'placed');
      node.position.x = this.co.X(item.x);
      node.position.z = this.co.Z(item.y);
    }
    // Fog lifts once a room is seen.
    for (const [id, f] of this.fog) {
      const target = sim.revealed.has(id) ? 0 : 1;
      const v = (f.visibility += (target - f.visibility) * Math.min(1, dt * 4));
      f.setEnabled(v > 0.02);
    }
    // Paths.
    this.pathT -= dt;
    const key = planning ? `p${plan?.version}:${plan?.selected}:${plan?.selectedWp}` : `r`;
    if (key !== this.pathKey || (!planning && this.pathT <= 0)) {
      this.pathKey = key;
      this.pathT = 0.2;
      this.buildPaths(sim, plan);
    }
    // Hover highlight.
    if (planning && plan?.hover) {
      this.hoverMesh.setEnabled(true);
      this.hoverMesh.position.x = this.co.X(Math.floor(plan.hover.x) + 0.5);
      this.hoverMesh.position.z = this.co.Z(Math.floor(plan.hover.y) + 0.5);
      (this.hoverMesh.material as StandardMaterial).emissiveColor = Color3.FromHexString(this.crewColours()[plan.selected - 1]);
    } else this.hoverMesh.setEnabled(false);
    // Effects.
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.mesh.dispose(false, f.kind === 'popup');
        return false;
      }
      if (f.kind === 'ring') {
        const s = 0.2 + k * (f.r ?? 4);
        f.mesh.scaling.set(s, 1, s);
        f.mesh.visibility = 1 - k;
      } else if (f.kind === 'flash') f.mesh.visibility = 1 - k * 0.6;
      else if (f.kind === 'popup') {
        f.mesh.position.y += dt * 0.5;
        f.mesh.visibility = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      }
      return true;
    });
    this.scene.render();
  }

  private updateCrew(a: Actor, c: Crew, plan: PlanOverlay | null, i: number, dt: number) {
    const visible = c.state !== 'escaped';
    a.root.setEnabled(visible);
    a.light.setEnabled(visible);
    a.cone.setEnabled(visible && c.state !== 'down');
    if (a.torch) a.torch.intensity = visible && c.state !== 'down' && this.mode === 'raid' ? 6 : 0;
    if (!visible) return;
    a.root.position.set(this.co.X(c.x), 0, this.co.Z(c.y));
    this.trackSpeed(a, c.x, c.y, dt);
    this.lightActor(a, c.x, c.y);
    a.body.rotation.y = this.co.rotY(c.facing);
    a.char?.update(dt);
    if (c.state === 'down') {
      a.ring.visibility = 0.35;
      this.layDown(a, false);
      return;
    }
    a.body.rotation.x = 0;
    a.body.position.y = 0;
    a.ring.visibility = 1;
    this.animate(a, c.state === 'pick' || c.state === 'loot' ? 'crouch' : c.state === 'fight' ? 'aim' : c.state === 'moving' ? 'move' : 'idle');
    const sel = plan && plan.selected === i + 1;
    a.ring.scaling.setAll(sel ? 1.25 : 1);
    a.bag!.setEnabled(c.carrying.length > 0);
    const sim = this.lastSim;
    if (sim) this.setCone(a.cone, sim.grid.visionFan(c.x, c.y, c.facing, c.fov, c.range, 36), c.x, c.y, 0.05);
  }

  private lastSim: Sim | null = null;
  bind(sim: Sim) {
    this.lastSim = sim;
  }

  private updateEnemy(a: Actor, e: Enemy, sim: Sim, dt: number) {
    const planning = this.mode === 'planning';
    let visible: boolean;
    if (e.state === 'gone') visible = false;
    else if (planning) visible = e.known;
    else visible = e.seen || (e.known && (e.state === 'down' || e.state === 'subdued'));
    a.root.setEnabled(visible);
    a.light.setEnabled(visible);
    a.cone.setEnabled(visible && e.state !== 'down' && e.state !== 'subdued');
    if (!visible) return;
    a.root.position.set(this.co.X(e.x), 0, this.co.Z(e.y));
    this.trackSpeed(a, e.x, e.y, dt);
    this.lightActor(a, e.x, e.y);
    a.body.rotation.y = this.co.rotY(e.facing);
    a.body.rotation.x = 0;
    a.body.position.y = 0;
    a.char?.update(dt);
    const tint = e.state === 'down' || e.state === 'subdued' ? NEUTRAL : PALETTE.enemy;
    if (a.tint !== tint) {
      a.tint = tint;
      a.char?.setTint(tint);
      a.ring.material = mat(this.scene, tint, { emissive: tint, unlit: true });
    }
    if (e.state === 'down') {
      a.ring.visibility = 0.3;
      this.layDown(a, e.kind === 'dog');
    } else if (e.state === 'subdued') {
      a.ring.visibility = 0.45;
      this.animate(a, 'hands');
    } else {
      a.ring.visibility = 1;
      this.animate(a, e.state === 'hostile' ? 'aim' : 'move');
      const fan = sim.grid.visionFan(e.x, e.y, e.facing, e.fov, e.range, 36);
      this.setCone(a.cone, fan, e.x, e.y, 0.05);
      (a.cone.material as StandardMaterial).alpha = e.state === 'hostile' ? 0.32 : e.state === 'suspicious' ? 0.26 : 0.18;
    }
    // Status icon above the head.
    if (a.icon) {
      let key = '';
      if (e.state === 'hostile') key = '!';
      else if (e.state === 'fleeing') key = 'run';
      else if (e.state === 'subdued') key = 'hands';
      else if (e.state === 'suspicious') key = `?${Math.round(e.alert * 10)}`;
      else if (e.surrender > 0.02) key = `s${Math.round(e.surrender * 10)}`;
      else if (e.alert > 0.05) key = `?${Math.round(e.alert * 10)}`;
      if (key !== a.icon.key) {
        a.icon.key = key;
        const g = a.icon.tex.getContext() as unknown as CanvasRenderingContext2D;
        g.clearRect(0, 0, 128, 128);
        if (key) drawStatus(g, 128, key, e);
        a.icon.tex.update();
      }
      a.icon.plane.setEnabled(!!key && e.state !== 'down');
    }
  }
}

// --------------------------------------------------------------- icons

function drawLock(g: CanvasRenderingContext2D, s: number) {
  g.fillStyle = 'rgba(10,18,36,0.85)';
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = s * 0.05;
  g.stroke();
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.arc(s / 2, s * 0.42, s * 0.12, Math.PI, 0);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(s * 0.33, s * 0.42, s * 0.34, s * 0.26);
}

function drawDiamond(g: CanvasRenderingContext2D, s: number, color: string, code: string, sel: boolean) {
  g.save();
  g.translate(s / 2, s / 2);
  g.rotate(Math.PI / 4);
  g.fillStyle = 'rgba(8,16,34,0.92)';
  g.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
  g.strokeStyle = sel ? '#ffffff' : color;
  g.lineWidth = s * 0.06;
  g.strokeRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
  g.restore();
  g.fillStyle = '#ffffff';
  g.font = `700 ${s * 0.42}px Rajdhani, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(code, s / 2, s / 2 + s * 0.03);
}

function drawKick(g: CanvasRenderingContext2D, s: number, color: string) {
  g.fillStyle = 'rgba(8,16,34,0.9)';
  g.strokeStyle = color;
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.roundRect(s * 0.08, s * 0.25, s * 0.84, s * 0.5, s * 0.08);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `700 ${s * 0.3}px Rajdhani, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('KICK', s / 2, s / 2 + s * 0.02);
}

function drawStatus(g: CanvasRenderingContext2D, s: number, key: string, e: Enemy) {
  const red = PALETTE.enemy;
  g.lineCap = 'round';
  if (key === '!' || key === 'run') {
    g.fillStyle = red;
    g.beginPath();
    g.moveTo(s / 2, s * 0.08);
    g.lineTo(s * 0.92, s * 0.86);
    g.lineTo(s * 0.08, s * 0.86);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `700 ${s * 0.55}px Rajdhani, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(key === 'run' ? '»' : '!', s / 2, s * 0.6);
    return;
  }
  if (key === 'hands') {
    // A "held" tag: they have given up and stay put.
    g.fillStyle = 'rgba(10,18,36,0.9)';
    g.strokeStyle = '#ffffff';
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.roundRect(s * 0.06, s * 0.28, s * 0.88, s * 0.44, s * 0.22);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = `700 ${s * 0.3}px Rajdhani, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('HELD', s / 2, s / 2 + s * 0.02);
    return;
  }
  // Progress arc: red for their alertness, white for our intimidation.
  const surrender = key.startsWith('s');
  const v = surrender ? e.surrender : e.alert;
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = s * 0.1;
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = surrender ? '#ffffff' : red;
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, v));
  g.stroke();
  g.fillStyle = surrender ? '#ffffff' : red;
  g.font = `700 ${s * 0.5}px Rajdhani, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(surrender ? '✋' : '?', s / 2, s / 2 + s * 0.03);
}
