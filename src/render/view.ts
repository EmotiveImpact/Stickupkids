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
  MirrorTexture,
  RenderTargetTexture,
  Texture,
  ParticleSystem,
  PBRMaterial,
  Plane,
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
  type DepthRenderer,
} from './babylon.ts';
import type { Level, Vec } from '../sim/level.ts';
import { BARRICADE_TIME, CALL_TIME, TALK_TIME, planSegments, type Crew, type Enemy, type Sim, type SimEvent, type Waypoint } from '../sim/sim.ts';
import { PALETTE, WALL_H } from './palette.ts';
import { Coords, mat } from './world.ts';
import { loadEstate, type Estate } from './estate.ts';
import { CHAR_SCALE, CharacterKit, type Character, type Weapon } from './characters.ts';
import { Atmosphere, dotTexture, glowTexture } from './atmosphere.ts';
import { sprayTags } from './graffiti.ts';
import { lightRooms } from './roomLight.ts';
import { Constants } from '@babylonjs/core/Engines/constants';

const OVERLAY = 0x10000000;
const WORLD = 0x0fffffff;
const TILT = (54 * Math.PI) / 180;
/**
 * How much each wet surface mirrors, as a multiple of a dry dielectric's
 * reflection (about 4% looking down at this angle): roads and paving
 * shine like the deck's street shots, hard floors indoors a little.
 */
const WET: Record<string, number> = {
  tarmac: 9,
  tarmac_alley: 8,
  road: 9,
  paint_road: 7,
  paint_yellow: 7,
  paving: 7,
  path: 6,
  path_edge: 5,
  patio: 6,
  concrete: 6,
  kerb: 5,
  coping: 4,
  kiln_floor: 4,
  track: 5,
  tiles: 5,
  lino: 4,
  boards: 3,
};
/** Walk and run clip speeds in metres a second at scale 1. */
const WALK = 0.95;
const RUN = 3.4;

Effect.ShadersStore['blueprintFragmentShader'] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float amount;
uniform vec2 screenSize;
uniform sampler2D depthSampler;
uniform float depthRange;
// The raid: crew torches light the night, and the paint-like smear.
uniform sampler2D torchSampler;
uniform float dark;
uniform float paint;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// The deck's grade: a cold, wet night. Blues and violets wash out to a dark
// teal-grey; sodium and orange keep their colour; blacks sit just off black.
// In the raid it goes further, to near black and white: only red (the
// opposition, tail lights) keeps its colour, sodium keeps a little.
vec3 grade(vec3 c) {
  float l = luma(c);
  float warm = smoothstep(0.03, 0.22, c.r - c.b) * smoothstep(-0.05, 0.12, c.r - c.g);
  float red = smoothstep(0.5, 0.25, c.g / max(c.r, 0.0001)) * smoothstep(0.05, 0.2, c.r - c.b);
  // Strongly coloured light (a room's lamp, a telly, a tag) keeps some colour; drab surfaces go grey.
  float vivid = smoothstep(0.22, 0.5, max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)));
  float sat = mix(mix(0.3, 0.92, warm), max(mix(mix(0.08, 0.45, warm), 1.0, red), vivid * 0.75), dark);
  vec3 g = mix(vec3(l), c, sat);
  vec3 teal = vec3(0.78, 0.97, 0.95);
  g *= mix(teal, vec3(1.0), clamp(smoothstep(0.3, 0.85, l) + warm * 0.7 + dark * 0.5, 0.0, 1.0));
  // A soft S: deeper shadows, mids held, highlights left to bloom.
  g = g * g * (3.0 - 2.0 * g) * 0.35 + g * 0.65;
  // Crushed blacks for the raid.
  g = max(g - 0.025 * dark, 0.0) * (1.0 + 0.04 * dark);
  return max(g - 0.006, 0.0) + vec3(0.004, 0.008, 0.009) * (1.0 - dark * 0.7);
}
// A small Kuwahara filter: each pixel takes the calmest of the four squares
// round it, which flattens texture into brush-like strokes and keeps edges.
vec3 kuwahara(vec2 uv, float r) {
  vec2 px = r / screenSize;
  vec3 m0 = vec3(0.0); vec3 m1 = vec3(0.0); vec3 m2 = vec3(0.0); vec3 m3 = vec3(0.0);
  vec3 s0 = vec3(0.0); vec3 s1 = vec3(0.0); vec3 s2 = vec3(0.0); vec3 s3 = vec3(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec3 c = texture2D(textureSampler, uv + vec2(float(i), float(j)) * px).rgb;
      vec3 c2 = c * c;
      if (i <= 0 && j <= 0) { m0 += c; s0 += c2; }
      if (i >= 0 && j <= 0) { m1 += c; s1 += c2; }
      if (i <= 0 && j >= 0) { m2 += c; s2 += c2; }
      if (i >= 0 && j >= 0) { m3 += c; s3 += c2; }
    }
  }
  m0 /= 9.0; m1 /= 9.0; m2 /= 9.0; m3 /= 9.0;
  vec3 v0 = s0 / 9.0 - m0 * m0; vec3 v1 = s1 / 9.0 - m1 * m1;
  vec3 v2 = s2 / 9.0 - m2 * m2; vec3 v3 = s3 / 9.0 - m3 * m3;
  float e0 = v0.r + v0.g + v0.b; float e1 = v1.r + v1.g + v1.b;
  float e2 = v2.r + v2.g + v2.b; float e3 = v3.r + v3.g + v3.b;
  vec3 best = m0; float e = e0;
  if (e1 < e) { best = m1; e = e1; }
  if (e2 < e) { best = m2; e = e2; }
  if (e3 < e) { best = m3; }
  return best;
}
// How much torchlight falls here, softened so the beams have no hard rims.
float torchAt(vec2 uv) {
  vec2 o = 5.0 / screenSize;
  float t = texture2D(torchSampler, uv).r * 0.4;
  t += texture2D(torchSampler, uv + vec2(o.x, o.y)).r * 0.15;
  t += texture2D(torchSampler, uv + vec2(-o.x, o.y)).r * 0.15;
  t += texture2D(torchSampler, uv + vec2(o.x, -o.y)).r * 0.15;
  t += texture2D(torchSampler, uv + vec2(-o.x, -o.y)).r * 0.15;
  return t;
}
// Depth in metres from the camera, from the depth renderer's linear depth.
float depthAt(vec2 uv) { return texture2D(depthSampler, uv).r * depthRange; }
void main(void) {
  vec3 src = clamp(texture2D(textureSampler, vUV).rgb, 0.0, 1.0);
  if (paint > 0.001) src = mix(src, kuwahara(vUV, 1.5), paint);
  vec3 col = grade(src);
  if (dark > 0.001) {
    // Outside the torch beams the night takes over; lamps, lit windows and
    // screens hold their own.
    // The mask: 0 never seen, about 0.3 seen before, up to 1 in a beam now.
    float m = torchAt(vUV);
    float known = smoothstep(0.04, 0.24, m);
    float t = smoothstep(0.3, 0.9, m);
    // Lamps, lit windows and screens hold their own, but only where the crew have looked.
    float own = smoothstep(0.1, 0.42, luma(col)) * known;
    float keep = max(max(known * 0.32, t), own);
    col *= mix(1.0, mix(0.045, 1.0, keep) * (1.0 + 0.9 * t), dark);
    // The beam itself, a cold white wash on whatever it falls on.
    col += vec3(0.82, 0.88, 1.0) * t * 0.06 * dark;
  }
  if (amount <= 0.001) { gl_FragColor = vec4(col, 1.0); return; }
  // The plan: the real scene, lifted and cooled to a monochrome you can read,
  // with the building drawn in white lines where the geometry steps (walls,
  // doors, kerbs, furniture), not where a texture happens to be busy.
  vec2 px = 1.0 / screenSize;
  float d = depthAt(vUV);
  float dl = depthAt(vUV - vec2(px.x, 0.0));
  float dr = depthAt(vUV + vec2(px.x, 0.0));
  float du = depthAt(vUV - vec2(0.0, px.y));
  float dd = depthAt(vUV + vec2(0.0, px.y));
  // Second differences ignore the steady slope of the floor under a tilted camera.
  float step2 = max(abs(dl + dr - 2.0 * d), abs(du + dd - 2.0 * d));
  // Big steps are walls and roofs; small ones are furniture and kerbs, drawn softer.
  float edge = smoothstep(0.05, 0.22, step2) * mix(0.55, 1.0, smoothstep(0.3, 1.2, step2));
  vec3 raw = clamp(texture2D(textureSampler, vUV).rgb, 0.0, 1.0);
  float l = luma(raw);
  // Lift the dark end hard so rooms read even where no lamp reaches.
  float lit = clamp(pow(l, 0.5) * 0.62 + 0.05, 0.0, 0.62);
  vec3 tone = mix(vec3(lit) * vec3(0.93, 0.97, 1.0), raw * 1.6, 0.18);
  vec3 bright = vec3(0.95, 0.945, 0.93);
  vec3 bp = mix(tone, bright, edge * 0.92);
  vec2 g = mod(gl_FragCoord.xy, 32.0);
  float grid = (g.x < 1.0 || g.y < 1.0) ? 1.0 : 0.0;
  bp += vec3(0.03) * grid * (1.0 - edge);
  gl_FragColor = vec4(mix(col, bp, amount), 1.0);
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
  /** A thin circle at the edge of how far they can see. */
  reach?: Mesh;
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
const MODELS = new Set(['dealer', 'soldier', 'runner', 'dog', 'gang-leader', 'gang-lookout', 'gang-muscle-a', 'gang-muscle-b', 'gang-runner']);
const modelFor = (e: { kind: string; model?: string }) => (e.model && MODELS.has(e.model) ? e.model : e.kind);
/** Each crew member's own model, by slot (Meshy, readied by scripts/import-meshy-crew.mjs). */
const CREW_MODELS = ['crew-dex', 'crew-kemi', 'crew-jojo', 'crew-taz'];
/** How fast the Meshy clips cover the ground at 1x, in metres a second. */
const MESHY_SPEEDS = { Walk: 0.34, Run: 1.83, CrouchWalk: 1.36, PistolWalk: 0.81, PistolRun: 6.13 };
/** What each of the crew carries: Dex the long gun, the rest handguns. */
const CREW_WEAPONS: Weapon[] = ['rifle', 'pistol', 'pistol', 'pistol'];

/** Enemies who are held up or down drop their red: grey reads as out of the fight. */
const NEUTRAL = '#aab4c8';
/** The deck's one accent: go codes and loot. */
const ACCENT = '#FF7A1A';
/** Enemies are red; civilians are never red. */
const colourOf = (kind: string) => (kind === 'civilian' ? PALETTE.civilian : PALETTE.enemy);

interface Flash {
  light: PointLight;
  t: number;
  power: number;
}

/** They Slid: the planks on a braced door, and the marker over it. */
interface Brace {
  planks: TransformNode;
  icon: Mesh;
  tex: DynamicTexture;
  key: string;
}

/** Ride Out: where a target last posted from, and how long ago. */
interface Pin {
  tag: Mesh;
  tex: DynamicTexture;
  ring: Mesh;
  key: string;
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
  private depth: DepthRenderer;
  private bpAmount = 1;
  /** Torchlight: what the crew's beams light, drawn white on black, and how far the night has fallen (0 to 1). */
  private torchMask: RenderTargetTexture;
  private torchMat: StandardMaterial;
  private darkAmount = 0;
  /** Fog of war: one pixel a cell, lit where the crew have seen, drawn into the torch mask as a dim floor. */
  private seenTex!: DynamicTexture;
  private seenGrid: Uint8Array = new Uint8Array(0);
  private seenDirty = false;
  private seenT = 0;
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
  private braces = new Map<string, Brace>();
  private pins = new Map<string, Pin>();
  /** They Slid: where the waves will come from, until they have. */
  private waveMarks: { mesh: Mesh; tex: DynamicTexture; north: boolean; waves: number[]; key: string }[] = [];
  private hoverMesh: Mesh;
  private readonly flatIP = (() => {
    const ip = new ImageProcessingConfiguration();
    ip.isEnabled = false;
    ip.applyByPostProcess = false;
    return ip;
  })();
  private insets = { left: 250, right: 10, top: 30, bottom: 70 };
  private time = 0;
  private zoom = 1;
  private pan = { x: 0, z: 0 };
  private scale = 1;
  /** CSS pixels per metre with the whole level in view. */
  private fitScale = 1;
  private shake = 0;
  private shaking = false;
  private flashMat: StandardMaterial | null = null;
  private dust: ParticleSystem | null = null;
  private probeColour = new Color3();
  mode: Mode = 'planning';
  /** Replays show everyone and lift the fog: the watcher sees what the crew could not. */
  private reveal = false;

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

    // Depth for the plan's line drawing; only rendered while the plan shows.
    const depth = (this.depth = scene.enableDepthRenderer(this.cam, false, true));
    // The torch mask: crew beams and a pool round each of them, white on black, at half size.
    const torch = (this.torchMask = new RenderTargetTexture('torchMask', { ratio: 0.5 }, scene, false));
    torch.activeCamera = this.cam;
    torch.clearColor = new Color4(0, 0, 0, 1);
    torch.renderList = [];
    scene.customRenderTargets.push(torch);
    const tm = (this.torchMat = new StandardMaterial('torchMaskMat', scene));
    tm.emissiveColor = Color3.White();
    tm.diffuseColor = Color3.Black();
    tm.specularColor = Color3.Black();
    tm.disableLighting = true;
    tm.backFaceCulling = false;
    tm.disableDepthWrite = true;
    // Screen blending, so overlapping beams add up without blowing out.
    tm.alpha = 0.999;
    tm.alphaMode = Constants.ALPHA_SCREENMODE;
    this.makeSeenFloor();
    this.bp = new PostProcess('blueprint', 'blueprint', ['amount', 'screenSize', 'depthRange', 'dark', 'paint'], ['depthSampler', 'torchSampler'], 1, this.cam);
    this.bp.onApply = (e) => {
      e.setTexture('torchSampler', torch);
      e.setFloat('dark', this.darkAmount);
      e.setFloat('paint', this.darkAmount * 0.8);
      e.setFloat('amount', this.bpAmount);
      e.setFloat2('screenSize', this.bp.width, this.bp.height);
      e.setTexture('depthSampler', depth.getDepthMap());
      e.setFloat('depthRange', this.cam.maxZ);
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
    // Backup comes as soldiers, in the models the level names for it; waves likewise.
    const lv = this.level;
    const later = [...(lv.backup.models ?? []), ...(lv.waves ?? []).flatMap((w) => w.enemies.map(modelFor))].filter((m) => MODELS.has(m));
    const kinds = [...new Set([...CREW_MODELS, 'soldier', ...lv.enemies.map(modelFor), ...later])];
    const [estate, ...kits] = await Promise.all([
      loadEstate(scene, this.assets),
      ...kinds.map((k) => CharacterKit.load(scene, `models/ai/${k}`, CREW_MODELS.includes(k) ? MESHY_SPEEDS : {})),
    ]);
    this.estate = estate;
    kinds.forEach((k, i) => this.kits.set(k, kits[i]));
    // A bake shared between jobs holds loot this job does not have.
    for (const [id, node] of estate.loot) if (!lv.loot.some((l) => l.id === id)) node.setEnabled(false);
    this.shadowLight.includedOnlyMeshes = estate.receivers;
    this.wetGround(estate);
    sprayTags(scene, lv, this.co, lv.w * 7919 + lv.h);
    lightRooms(scene, lv, this.co);

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

    this.crewColours().forEach((colour, i) => this.crew.push(this.makeCrewActor(CREW_MODELS[i], colour, CREW_WEAPONS[i])));
    for (const e of this.level.enemies) this.enemies.set(e.id, this.makeEnemyActor(e.kind, modelFor(e)));
    this.refreshKey();
    this.atmosphere = new Atmosphere(scene, this.co, this.level, estate, WORLD, 1 / Math.tan(TILT));
    this.atmosphere.setRain(this.mode === 'raid');
  }

  /**
   * Rain on the ground: the outdoor surfaces and the hard floors mirror the
   * lamps, lit windows and people above them, softly, the way wet paving does.
   */
  private wetGround(estate: Estate) {
    const wet = new Set<PBRMaterial>();
    for (const [key, m] of estate.materials) {
      const name = key.replace(/:lm$/, '');
      const k = WET[name];
      if (k === undefined) continue;
      m.roughness = Math.min(m.roughness ?? 1, 0.18);
      m.environmentIntensity = k;
      wet.add(m);
    }
    if (!wet.size) return;
    const mirror = new MirrorTexture('wet', { ratio: 0.5 }, this.scene, true);
    mirror.mirrorPlane = new Plane(0, -1, 0, 0.02);
    mirror.adaptiveBlurKernel = 20;
    mirror.activeCamera = this.cam;
    // Everything in the world layer bar the wet floors themselves, which would only fight the plane.
    mirror.renderListPredicate = (m) => (m.layerMask & WORLD) !== 0 && !(m.material instanceof PBRMaterial && wet.has(m.material));
    for (const m of wet) m.reflectionTexture = mirror;
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
    for (const c of [m, ...m.getChildMeshes()]) {
      c.layerMask = OVERLAY;
      c.isPickable = false;
      // The overlay camera has no post-process, so its materials must not hand
      // their colour over in linear space for one to finish: that turned the
      // orange markers red and every crew colour darker.
      if (c.material instanceof StandardMaterial) c.material.imageProcessingConfiguration = this.flatIP;
    }
  }

  /** The margins the HUD takes on each side, in CSS pixels. */
  getInsets(): View['insets'] {
    return { ...this.insets };
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
    const fit = Math.min(uw / viewW, uh / viewH);
    this.fitScale = fit / dpr;
    const scale = (this.scale = fit * this.zoom);
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
    if (this.big) {
      // Character shadows only where the camera is looking, at full sharpness.
      const sl = this.shadowLight;
      sl.position.copyFrom(target.subtract(sl.direction.normalizeToNew().scale(30)));
      sl.shadowFrustumSize = Math.min(120, Math.max(30, (this.engine.getRenderWidth() / this.scale) * 1.3));
    }
  }

  /** A level too big to play with all of it in view. */
  get big(): boolean {
    return this.level.w > 60 || this.level.h > 60;
  }

  /** Closest zoom: near enough to read a person, however big the level. */
  private get maxZoom(): number {
    return Math.max(3.2, 52 / this.fitScale);
  }

  /** How far in the camera is: 1 shows the whole level. */
  get zoomLevel(): number {
    return this.zoom;
  }

  /** Centre on a map point, closing in first when the whole level is in view. */
  lookAt(x: number, y: number) {
    this.focus(x, y, this.zoom < 1.5 ? 2 * this.fitScale : undefined);
  }

  /** Centre the view on a map point, optionally at a zoom given in CSS pixels per metre. */
  focus(x: number, y: number, pxPerMetre?: number) {
    if (pxPerMetre) this.zoom = Math.min(this.maxZoom, Math.max(1, pxPerMetre / this.fitScale));
    this.resize();
    this.pan = { x: this.co.X(x), z: this.co.Z(y) };
    this.clampPan();
    this.resize();
  }

  /**
   * Frame a replay shot: centre on a point at a zoom in CSS pixels a metre,
   * never so far out, or so near an edge, that the frame shows past the level.
   */
  /** Where the camera looks now, in map metres, and its zoom in CSS pixels a metre. */
  shot(): { x: number; y: number; ppm: number } {
    return { x: this.pan.x + this.level.w / 2, y: this.level.h / 2 - this.pan.z, ppm: this.ppm };
  }

  frameShot(x: number, y: number, pxPerMetre: number) {
    this.zoom = Math.min(this.maxZoom, Math.max(this.fillZoom(), pxPerMetre / this.fitScale));
    this.resize();
    this.pan = { x: this.co.X(x), z: this.co.Z(y) };
    const c = this.cam;
    const hx = (c.orthoRight! - c.orthoLeft!) / 2;
    const hz = (c.orthoTop! - c.orthoBottom!) / 2 / Math.sin(TILT);
    const mx = Math.max(0, this.level.w / 2 - hx);
    const mz = Math.max(0, this.level.h / 2 - hz);
    this.pan.x = Math.max(-mx, Math.min(mx, this.pan.x));
    this.pan.z = Math.max(-mz, Math.min(mz, this.pan.z));
    this.resize();
  }

  /** The zoom at which the level fills the view both ways, not just one. */
  private fillZoom(): number {
    const sw = this.engine.getRenderWidth();
    const sh = this.engine.getRenderHeight();
    const dpr = sw / Math.max(1, this.engine.getRenderingCanvas()!.clientWidth);
    const i = this.insets;
    const uw = Math.max(100, sw - (i.left + i.right) * dpr);
    const uh = Math.max(100, sh - (i.top + i.bottom) * dpr);
    const kw = uw / (this.level.w + 1);
    const kh = uh / (this.level.h * Math.sin(TILT) + WALL_H * Math.cos(TILT) + 0.5);
    return Math.max(kw, kh) / Math.min(kw, kh);
  }

  /** The stretch of map in view, in map coordinates. */
  visibleRect(): { x0: number; y0: number; x1: number; y1: number } | null {
    const i = this.insets;
    const a = this.groundAt(i.left, i.top);
    const b = this.groundAt(innerWidth - i.right, innerHeight - i.bottom);
    if (!a || !b) return null;
    return { x0: a.x + this.level.w / 2, y0: this.level.h / 2 - a.z, x1: b.x + this.level.w / 2, y1: this.level.h / 2 - b.z };
  }

  /** Zoom by a factor, keeping the map point under the cursor still. */
  zoomAt(clientX: number, clientY: number, factor: number) {
    const before = this.groundAt(clientX, clientY);
    this.zoom = Math.min(this.maxZoom, Math.max(1, this.zoom * factor));
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
    // Each raid starts with the inside of the place unseen.
    if (m !== this.mode) this.forgetSeen();
    this.mode = m;
    this.atmosphere?.setRain(m === 'raid');
    this.bpTarget = m === 'planning' ? 1 : 0;
    this.pathKey = '';
  }

  setReveal(on: boolean) {
    this.reveal = on;
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

  private makeCrewActor(model: string, color: string, weapon: Weapon): Actor {
    const scene = this.scene;
    const char = this.kits.get(model)!.spawn(scene, 'crew', { slot: color, weapon });
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
    const ring = MeshBuilder.CreateTorus('ring', { diameter: 0.6 / CHAR_SCALE, thickness: 0.022 / CHAR_SCALE, tessellation: 32 }, scene);
    ring.material = mat(scene, color, { emissive: color, unlit: true });
    ring.parent = root;
    ring.position.y = 0.04;
    this.toOverlay(ring);
    // Torch light, not team colour: the crew colour lives on the ring and the route.
    const cone = this.makeCone('#eef3ff', 0.1);
    // A pool of light round them, seen only by the torch mask.
    const pool = MeshBuilder.CreateDisc('pool', { radius: 2.4 / CHAR_SCALE, tessellation: 32 }, scene);
    const pp = pool.getVerticesData(VertexBuffer.PositionKind)!;
    const pc: number[] = [];
    for (let i = 0; i < pp.length; i += 3) {
      const f = Math.hypot(pp[i], pp[i + 1]) < 1e-4 ? 1 : 0;
      pc.push(f, f, f, 1);
    }
    pool.setVerticesData(VertexBuffer.ColorKind, pc);
    pool.rotation.x = Math.PI / 2;
    pool.position.y = 0.03;
    pool.parent = root;
    pool.layerMask = 0;
    for (const m of [cone, pool]) {
      this.torchMask.renderList!.push(m);
      this.torchMask.setMaterialForRendering(m, this.torchMat);
    }
    const circle: Vector3[] = [];
    for (let k = 0; k <= 96; k++) circle.push(new Vector3(Math.cos((k / 96) * Math.PI * 2), 0.05, Math.sin((k / 96) * Math.PI * 2)));
    const reach = MeshBuilder.CreateLines('reach', { points: circle }, scene);
    reach.color = Color3.FromHexString('#f2f1ee');
    reach.alpha = 0.28;
    reach.parent = root;
    reach.isPickable = false;
    this.toOverlay(reach);
    return { root, body, light: char.light, char, ring, cone, reach, bag, torch, last: null, speed: 0 };
  }

  private makeEnemyActor(kind: string, model = kind): Actor {
    const scene = this.scene;
    const col = colourOf(kind);
    const char = (this.kits.get(model) ?? this.kits.get(kind) ?? this.kits.get('soldier')!).spawn(scene, kind, { slot: col });
    const { root, body, light } = char;
    for (const m of char.meshes) this.shadows.addShadowCaster(m, false);
    const s = CHAR_SCALE;
    const ring = MeshBuilder.CreateTorus('ring', { diameter: (kind === 'dog' ? 0.7 : 0.64) / s, thickness: 0.06 / s, tessellation: 32 }, scene);
    ring.material = mat(scene, col, { emissive: col, unlit: true });
    ring.parent = root;
    ring.position.y = 0.04;
    this.toOverlay(ring);
    const cone = this.makeCone(col, 0.2);
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
      // Walk or run, whichever clip's own pace is nearer, played at the pace they are going.
      const walk = (c.natural('Walk') ?? WALK) * CHAR_SCALE;
      const run = (c.natural('Run') ?? RUN) * CHAR_SCALE;
      if (a.speed < Math.sqrt(walk * run)) c.play('Walk', Math.max(0.6, a.speed / walk));
      else c.play('Run', Math.max(0.6, a.speed / run));
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

  /** Words that rise and fade over a spot on the map: HANDS UP, DOWN, and what people shout. */
  private popup(x: number, y: number, text: string, colour: string, height = 2.5) {
    // A black chip with a hairline, the words spaced out in Inter, as on the HUD.
    const font = '500 56px Inter, sans-serif';
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = font;
    const tw = probe.measureText(text.toUpperCase()).width + text.length * 7;
    const w = Math.max(256, Math.ceil((tw + 72) / 64) * 64);
    const tex = new DynamicTexture('popup', { width: w, height: 128 }, this.scene, true);
    tex.hasAlpha = true;
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.clearRect(0, 0, w, 128);
    const cw = tw + 56;
    g.fillStyle = 'rgba(7,7,7,0.86)';
    g.fillRect((w - cw) / 2, 20, cw, 88);
    g.strokeStyle = 'rgba(242,241,238,0.22)';
    g.lineWidth = 3;
    g.strokeRect((w - cw) / 2, 20, cw, 88);
    g.fillStyle = colour;
    g.fillRect((w - cw) / 2, 20, 6, 88);
    g.font = font;
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '7px';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = colour;
    g.fillText(text.toUpperCase(), w / 2 + 6, 66);
    tex.update();
    const m = new StandardMaterial('popupMat', this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane('popup', { width: (2.6 * w) / 512, height: 0.65 }, this.scene);
    plane.material = m;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position.set(this.co.X(x), height, this.co.Z(y));
    plane.isPickable = false;
    this.toOverlay(plane);
    this.fx.push({ mesh: plane, t: 0, life: 1.8, kind: 'popup' });
  }

  /** A ring that spreads from a spot: a new post going up. */
  private ping(x: number, y: number, colour: string, r: number) {
    const ring = MeshBuilder.CreateTorus('ping', { diameter: 2, thickness: 0.05, tessellation: 48 }, this.scene);
    ring.material = mat(this.scene, '#ffffff', { emissive: colour, alpha: 0.7, unlit: true });
    ring.position.set(this.co.X(x), 0.08, this.co.Z(y));
    this.toOverlay(ring);
    this.fx.push({ mesh: ring, t: 0, life: 1.1, kind: 'ring', r });
  }

  // ------------------------------------------------------- fog of war

  /** Inside a building: hidden until someone sees it. Streets, gardens and walls are known from the start. */
  private hiddenCell(x: number, y: number): boolean {
    const t = this.level.tiles[y][x];
    return t === '.' || t === 'D' || t === 'O' || t === 'W';
  }

  private makeSeenFloor() {
    const { w, h } = this.level;
    const tex = (this.seenTex = new DynamicTexture('seen', { width: w, height: h }, this.scene, false, Texture.BILINEAR_SAMPLINGMODE));
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.seenGrid = new Uint8Array(w * h);
    const floor = MeshBuilder.CreateGround('seenFloor', { width: w, height: h }, this.scene);
    floor.position.y = 0.02;
    floor.layerMask = 0;
    floor.isPickable = false;
    const m = new StandardMaterial('seenMat', this.scene);
    m.emissiveTexture = tex;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.disableDepthWrite = true;
    m.alpha = 0.999;
    m.alphaMode = Constants.ALPHA_SCREENMODE;
    floor.material = m;
    this.torchMask.renderList!.push(floor);
    this.forgetSeen();
  }

  /** Back to knowing only the outside. */
  private forgetSeen() {
    const { w, h } = this.level;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.seenGrid[y * w + x] = this.hiddenCell(x, y) ? 0 : 1;
    this.seenDirty = true;
  }

  /** Remember every cell inside a vision fan, and a little round the person. */
  private markSeen(fan: Vec[], ox: number, oy: number) {
    const { w, h } = this.level;
    const poly = [{ x: ox, y: oy }, ...fan];
    let x0 = ox, x1 = ox, y0 = oy, y1 = oy;
    for (const p of poly) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const near = 1.6;
    for (let y = Math.max(0, Math.floor(Math.min(y0, oy - near))); y <= Math.min(h - 1, Math.floor(Math.max(y1, oy + near))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(x0, ox - near))); x <= Math.min(w - 1, Math.floor(Math.max(x1, ox + near))); x++) {
        const k = y * w + x;
        if (this.seenGrid[k]) continue;
        const cx = x + 0.5;
        const cy = y + 0.5;
        let inside = Math.hypot(cx - ox, cy - oy) < near;
        for (let i = 0, j = poly.length - 1; !inside && i < poly.length; j = i++) {
          const a = poly[i];
          const b = poly[j];
          if (a.y > cy !== b.y > cy && cx < ((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
        if (inside) {
          this.seenGrid[k] = 1;
          this.seenDirty = true;
        }
      }
    }
  }

  /** Push the seen grid to its texture: seen cells a dim grey (155 is about 0.3 once the texture is read as sRGB), unseen black. */
  private flushSeen() {
    if (!this.seenDirty) return;
    this.seenDirty = false;
    const { w, h } = this.level;
    const g = this.seenTex.getContext() as unknown as CanvasRenderingContext2D;
    const img = g.createImageData(w, h);
    for (let k = 0; k < w * h; k++) {
      const v = this.seenGrid[k] ? 155 : 0;
      img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.seenTex.update(true);
  }

  private makeCone(color: string, alpha: number): Mesh {
    const rays = 36;
    const m = new Mesh('cone', this.scene);
    const vd = new VertexData();
    vd.positions = new Array((rays + 2) * 3).fill(0);
    const idx: number[] = [];
    for (let i = 0; i < rays; i++) idx.push(0, i + 2, i + 1);
    vd.indices = idx;
    vd.colors = new Array((rays + 2) * 4).fill(1);
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

  private setCone(m: Mesh, pts: Vec[], ox: number, oy: number, y: number, range = 8) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    // Fades with distance, like a beam.
    const col = m.getVerticesData(VertexBuffer.ColorKind)!;
    for (let i = 0; i < pts.length && i + 1 < pos.length / 3; i++) {
      const f = Math.max(0, 1 - Math.hypot(pts[i].x - ox, pts[i].y - oy) / range);
      col.fill(f, (i + 1) * 4, (i + 1) * 4 + 3);
    }
    m.updateVerticesData(VertexBuffer.ColorKind, col);
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
      g.fillStyle = 'rgba(7,7,7,0.94)';
      g.fillRect(0, 0, w * 64, h * 64);
      g.setLineDash([18, 12]);
      g.strokeStyle = 'rgba(242,241,238,0.7)';
      g.lineWidth = 4;
      g.strokeRect(6, 6, w * 64 - 12, h * 64 - 12);
      g.fillStyle = 'rgba(242,241,238,0.55)';
      g.font = '300 120px Inter, sans-serif';
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
    // Getaway zone. Nobody is getting away from their own trap.
    if (lv.mode !== 'slid') this.buildExit();

    this.buildBraces();
    this.buildPins();
    this.buildWaveMarks();

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
        g2.fillStyle = 'rgba(7,7,7,0.88)';
        g2.strokeStyle = PALETTE.loot;
        g2.lineWidth = s * 0.06;
        g2.beginPath();
        g2.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
        g2.fill();
        g2.stroke();
        g2.fillStyle = PALETTE.loot;
        g2.font = `400 ${s * 0.5}px Inter, sans-serif`;
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

  private buildExit() {
    const lv = this.level;
    const ex = lv.exit;
    const ew = ex.x1 - ex.x0 + 1;
    const eh = ex.y1 - ex.y0 + 1;
    const tex = new DynamicTexture('exit', { width: ew * 64, height: eh * 64 }, this.scene, true);
    tex.hasAlpha = true;
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.fillStyle = 'rgba(242,241,238,0.06)';
    g.fillRect(0, 0, ew * 64, eh * 64);
    g.setLineDash([16, 10]);
    g.strokeStyle = 'rgba(242,241,238,0.8)';
    g.lineWidth = 4;
    g.strokeRect(4, 4, ew * 64 - 8, eh * 64 - 8);
    g.fillStyle = '#f2f1ee';
    g.font = '500 34px Inter, sans-serif';
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
  }

  /** They Slid: planks for every door that can be braced, shown once it is, and a marker over it. */
  private buildBraces() {
    const lv = this.level;
    if (!lv.barricades) return;
    const board = mat(this.scene, '#1b2130', { emissive: '#141a26', spec: 0.02 });
    const strap = mat(this.scene, '#596273', { emissive: '#2c3240', spec: 0.3 });
    for (const d of lv.doors) {
      const planks = new TransformNode('brace', this.scene);
      planks.position.set(this.co.X(d.x + 0.5), 0, this.co.Z(d.y + 0.5));
      // Planks run along the wall the door sits in.
      planks.rotation.y = d.axis === 'h' ? 0 : Math.PI / 2;
      for (const side of [-0.13, 0.13]) {
        [
          [0.36, 0.07],
          [0.8, -0.05],
          [1.22, 0.09],
        ].forEach(([h, tilt], k) => {
          const b = MeshBuilder.CreateBox('plank', { width: 1.18, height: 0.15, depth: 0.05 }, this.scene);
          b.position.set(k === 1 ? 0.03 : -0.02, h, side);
          b.rotation.z = tilt;
          b.material = board;
          b.parent = planks;
          this.shadows.addShadowCaster(b, false);
        });
        const brace = MeshBuilder.CreateBox('plank', { width: 1.32, height: 0.12, depth: 0.04 }, this.scene);
        brace.position.set(0, 0.78, side * 1.3);
        brace.rotation.z = 0.82;
        brace.material = board;
        brace.parent = planks;
        for (const x of [-0.42, 0.42]) {
          const s2 = MeshBuilder.CreateBox('strap', { width: 0.06, height: 1.2, depth: 0.03 }, this.scene);
          s2.position.set(x, 0.78, side * 1.45);
          s2.material = strap;
          s2.parent = planks;
        }
      }
      for (const m of planks.getChildMeshes()) {
        m.layerMask = WORLD;
        m.isPickable = false;
      }
      planks.setEnabled(false);
      const tex = new DynamicTexture('brace', { width: 256, height: 256 }, this.scene, true);
      tex.hasAlpha = true;
      const icon = MeshBuilder.CreatePlane('braceIcon', { size: 0.95 }, this.scene);
      const im = new StandardMaterial('braceMat', this.scene);
      im.diffuseTexture = tex;
      im.emissiveTexture = tex;
      im.useAlphaFromDiffuseTexture = true;
      im.disableLighting = true;
      im.backFaceCulling = false;
      im.disableDepthWrite = true;
      icon.material = im;
      icon.billboardMode = Mesh.BILLBOARDMODE_ALL;
      icon.position.set(this.co.X(d.x + 0.5), 2.05, this.co.Z(d.y + 0.5));
      this.toOverlay(icon);
      icon.setEnabled(false);
      this.braces.set(`${d.x},${d.y}`, { planks, icon, tex, key: '' });
    }
  }

  /** Ride Out: a tag where each target last posted from. */
  private buildPins() {
    for (const e of this.level.enemies) {
      if (!e.target) continue;
      const tex = new DynamicTexture('pin', { width: 512, height: 256 }, this.scene, true);
      tex.hasAlpha = true;
      const tag = MeshBuilder.CreatePlane('pin', { width: 2.6, height: 1.3 }, this.scene);
      const m = new StandardMaterial('pinMat', this.scene);
      m.diffuseTexture = tex;
      m.emissiveTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      m.disableLighting = true;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      tag.material = m;
      tag.billboardMode = Mesh.BILLBOARDMODE_ALL;
      this.toOverlay(tag);
      const ring = MeshBuilder.CreateTorus('pinRing', { diameter: 1.5, thickness: 0.05, tessellation: 40 }, this.scene);
      ring.material = mat(this.scene, PALETTE.enemy, { emissive: PALETTE.enemy, alpha: 0.75, unlit: true });
      this.toOverlay(ring);
      tag.setEnabled(false);
      ring.setEnabled(false);
      this.pins.set(e.id, { tag, tex, ring, key: '' });
    }
  }

  /** They Slid: an arrow at each end the waves come in from, with which wave and when. */
  private buildWaveMarks() {
    const lv = this.level;
    const ends = new Map<string, { pts: Vec[]; waves: number[] }>();
    (lv.waves ?? []).forEach((w, n) => {
      for (const e of w.enemies) {
        const k = e.y < lv.h / 2 ? 'n' : 's';
        const end = ends.get(k) ?? { pts: [], waves: [] };
        end.pts.push({ x: e.x, y: e.y });
        if (!end.waves.includes(n)) end.waves.push(n);
        ends.set(k, end);
      }
    });
    for (const [k, end] of ends) {
      const x = end.pts.reduce((a, p) => a + p.x, 0) / end.pts.length;
      const y = end.pts.reduce((a, p) => a + p.y, 0) / end.pts.length;
      const tex = new DynamicTexture('wave', { width: 512, height: 512 }, this.scene, true);
      tex.hasAlpha = true;
      const mesh = MeshBuilder.CreatePlane('wave', { size: 1 }, this.scene);
      const m = new StandardMaterial('waveMat', this.scene);
      m.diffuseTexture = tex;
      m.emissiveTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      m.disableLighting = true;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      mesh.material = m;
      mesh.rotation.x = Math.PI / 2;
      // A little way in from where they appear, so it sits on the map.
      mesh.position.set(this.co.X(x), 0.14, this.co.Z(y + (k === 'n' ? 3.5 : -2.5)));
      this.toOverlay(mesh);
      this.waveMarks.push({ mesh, tex, north: k === 'n', waves: end.waves, key: '' });
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
        const on = phase.d % 0.26 < 0.08;
        const step = Math.min(len - t, on ? 0.08 - (phase.d % 0.26) : 0.26 - (phase.d % 0.26));
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
      for (let k = 1; k < pts.length; k++) dash(pts[k - 1], pts[k], col, phase, 0.034);
      // Waypoint dots and go-code circles.
      wps.forEach((w, k) => {
        if (this.mode === 'raid' && k < startIdx) return;
        const sel = plan && plan.selected === i + 1 && plan.selectedWp === k;
        if (w.hold) {
          const d = this.iconPlane(0.72, (g, s) => drawCode(g, s, w.hold!, !!sel), 128);
          d.rotation.x = Math.PI / 2;
          d.position.set(this.co.X(w.x), 0.12, this.co.Z(w.y));
          d.parent = this.markers;
        } else if (k > 0) {
          const dot = MeshBuilder.CreateDisc('wp', { radius: sel ? 0.15 : 0.09, tessellation: 20 }, this.scene);
          dot.rotation.x = Math.PI / 2;
          dot.position.set(this.co.X(w.x), 0.09, this.co.Z(w.y));
          dot.material = mat(this.scene, colours[i], { emissive: colours[i], unlit: true });
          dot.parent = this.markers;
          this.toOverlay(dot);
        }
        if (sel && k > 0) {
          const halo = MeshBuilder.CreateTorus('halo', { diameter: w.hold ? 0.78 : 0.42, thickness: 0.025, tessellation: 24 }, this.scene);
          halo.position.set(this.co.X(w.x), 0.09, this.co.Z(w.y));
          halo.material = mat(this.scene, '#ffffff', { emissive: '#ffffff', unlit: true });
          halo.parent = this.markers;
          this.toOverlay(halo);
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
      if (ev.type === 'caught') {
        const e = this.lastSim?.enemies.find((q) => q.id === ev.id);
        if (e && e.state !== 'down') this.popup(e.x, e.y, 'CAUGHT', '#ffffff');
      } else if (ev.type === 'post') {
        const e = this.lastSim?.enemies.find((q) => q.id === ev.id);
        if (e?.post) this.ping(e.post.x, e.post.y, PALETTE.enemy, 3);
      }
      if (ev.type === 'noise' && ev.label === 'Ramming') {
        this.shake = Math.max(this.shake, 0.06);
        if (this.dust) {
          (this.dust.emitter as Vector3).set(this.co.X(ev.x), 0, this.co.Z(ev.y));
          this.dust.manualEmitCount = 14;
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
          if (e) this.popup(e.x, e.y, e.kind === 'civilian' ? 'HURT' : 'DOWN', '#ffffff');
        }
      } else if (ev.type === 'say') {
        const e = ev.slot ? null : this.lastSim?.enemies.find((q) => q.id === ev.id);
        const col = ev.slot ? this.crewColours()[ev.slot - 1] : colourOf(e?.kind ?? 'enemy');
        // A little north of the head, so it clears HANDS UP and DOWN.
        this.popup(ev.x, ev.y - 1.1, ev.text, col, 3.2);
      }
      if (ev.type === 'noise' && ev.r >= 2.5) {
        const ring = MeshBuilder.CreateTorus('noise', { diameter: 2, thickness: 0.04, tessellation: 48 }, this.scene);
        const enemyNoise = ev.label === 'Barking' || ev.label === 'Shouting' || ev.label === 'Ramming';
        ring.material = mat(this.scene, '#ffffff', { emissive: enemyNoise ? PALETTE.enemy : '#ecebe7', alpha: 0.6, unlit: true });
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
    this.depth.enabled = this.bpAmount > 0 || this.bpTarget > 0;
    // Film grain and fringing belong to the night, not the plan.
    this.pipeline.grain.intensity = 7 * (1 - this.bpAmount);
    this.pipeline.chromaticAberration.aberrationAmount = 10 * (1 - this.bpAmount);
    // Night falls when the raid starts and lifts for the plan.
    this.darkAmount += ((this.mode === 'raid' ? 1 : 0) - this.darkAmount) * Math.min(1, dt * 3);
    if (this.darkAmount < 0.002) this.darkAmount = 0;
    this.torchMask.refreshRate = this.darkAmount > 0 ? 1 : 0;
    // What the crew have seen, gathered a few times a second.
    this.seenT -= dt;
    if (this.seenT < -0.12) this.seenT = 0.12;
    this.flushSeen();
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
    if (this.big && this.atmosphere) {
      const r = this.visibleRect();
      if (r) this.atmosphere.setArea(r);
    }
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
    this.updateBraces(sim, planning);
    this.updatePins(sim);
    this.updateWaveMarks(sim);

    // Crew.
    sim.crew.forEach((c, i) => this.updateCrew(this.crew[i], c, plan, i, dt));
    // Enemies (backup can spawn mid-raid).
    for (const e of sim.enemies) {
      let a = this.enemies.get(e.id);
      if (!a) {
        a = this.makeEnemyActor(e.kind, modelFor(e.def));
        this.enemies.set(e.id, a);
        this.refreshKey();
      }
      this.updateEnemy(a, e, sim, dt);
    }
    // Backup from an earlier raid is not in this one (a replay, or planning again).
    if (this.enemies.size > sim.enemies.length) {
      const here = new Set(sim.enemies.map((e) => e.id));
      for (const [id, a] of this.enemies) {
        if (here.has(id)) continue;
        a.root.setEnabled(false);
        a.light.setEnabled(false);
        a.cone.setEnabled(false);
      }
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
      const target = this.reveal || sim.revealed.has(id) ? 0 : 1;
      const v = (f.visibility += (target - f.visibility) * Math.min(1, dt * 4));
      f.setEnabled(v > 0.02);
    }
    // Paths.
    this.pathT -= dt;
    const key = `${planning ? 'p' : 'r'}${plan?.version}:${plan?.selected}:${plan?.selectedWp}`;
    if (key !== this.pathKey || (!planning && this.pathT <= 0)) {
      this.pathKey = key;
      this.pathT = 0.2;
      this.buildPaths(sim, plan);
    }
    // Hover highlight.
    if (plan?.hover) {
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

  /** Planks up on braced doors; while one is rammed, how near it is to going. */
  private updateBraces(sim: Sim, planning: boolean) {
    for (const [key, b] of this.braces) {
      const [x, y] = key.split(',').map(Number);
      const braced = sim.grid.door(x, y) === 'barricaded';
      b.planks.setEnabled(braced);
      let k = '';
      if (braced) {
        const left = sim.enemies.reduce((t, e) => (e.breach && e.breach.x === x && e.breach.y === y ? Math.min(t, e.breach.t) : t), Infinity);
        if (left < Infinity) k = `r${Math.round((1 - left / BARRICADE_TIME) * 24)}`;
        else if (planning) k = 'b';
      }
      if (k !== b.key) {
        b.key = k;
        const g = b.tex.getContext() as unknown as CanvasRenderingContext2D;
        g.clearRect(0, 0, 256, 256);
        if (k) drawBrace(g, 256, k === 'b' ? null : Number(k.slice(1)) / 24);
        b.tex.update();
      }
      b.icon.setEnabled(!!k);
    }
  }

  /** CSS pixels a metre takes on screen just now. */
  private get ppm(): number {
    return this.fitScale * this.zoom;
  }

  /** Labels on the map are kept smaller on a phone. */
  private get narrow(): boolean {
    return (this.engine.getRenderingCanvas()?.clientWidth ?? 1600) < 900;
  }

  private updateWaveMarks(sim: Sim) {
    const waves = this.level.waves ?? [];
    const k = Math.min(14, Math.max(2.2, (this.narrow ? 150 : 210) / this.ppm));
    for (const w of this.waveMarks) {
      const next = w.waves.filter((n) => sim.waves <= n);
      w.mesh.setEnabled(next.length > 0);
      if (!next.length) continue;
      const key = next.join(',');
      if (key !== w.key) {
        w.key = key;
        const g = w.tex.getContext() as unknown as CanvasRenderingContext2D;
        g.clearRect(0, 0, 512, 512);
        drawWave(g, 512, next.map((n) => ({ n: n + 1, t: waves[n].t })), w.north);
        w.tex.update();
      }
      w.mesh.scaling.set(k, k, 1);
      w.mesh.visibility = 0.82 + Math.sin(this.time * 3) * 0.18;
    }
  }

  /** Story pins: where each target last posted, until someone has eyes on them. */
  private updatePins(sim: Sim) {
    for (const [id, p] of this.pins) {
      const e = sim.enemies.find((q) => q.id === id);
      const post = e?.post;
      const show = !!e && !!post && !e.caught && !e.seen && e.state !== 'down' && e.state !== 'gone' && e.state !== 'subdued';
      p.tag.setEnabled(show);
      p.ring.setEnabled(show);
      if (!show) continue;
      const age = ageLabel(sim.time - post!.t);
      const key = `${post!.x},${post!.y}:${age}`;
      if (key !== p.key) {
        p.key = key;
        const g = p.tex.getContext() as unknown as CanvasRenderingContext2D;
        g.clearRect(0, 0, 512, 256);
        drawPin(g, e!.def.name, age);
        p.tex.update();
        p.ring.position.set(this.co.X(post!.x), 0.07, this.co.Z(post!.y));
      }
      // The same size on screen however far out the camera is.
      const k = Math.min(12, Math.max(0.8, (this.narrow ? 130 : 190) / (2.6 * this.ppm)));
      p.tag.scaling.setAll(k);
      p.tag.position.set(this.co.X(post!.x), 0.2 + 0.9 * k, this.co.Z(post!.y));
      const r = Math.max(1, 56 / (1.5 * this.ppm)) * (1 + Math.sin(this.time * 3) * 0.12);
      p.ring.scaling.set(r, 1, r);
    }
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
      a.reach?.setEnabled(false);
      this.layDown(a, false);
      return;
    }
    a.body.rotation.x = 0;
    a.body.position.y = 0;
    a.ring.visibility = 1;
    this.animate(a, c.state === 'pick' || c.state === 'loot' ? 'crouch' : c.state === 'fight' ? 'aim' : c.state === 'moving' ? 'move' : 'idle');
    const sel = plan && plan.selected === i + 1;
    a.ring.scaling.setAll(sel ? 1.25 : 1);
    if (a.reach) {
      // Only for whoever is picked: four at once swamp the map.
      a.reach.setEnabled(!!sel);
      a.reach.scaling.setAll(c.range / CHAR_SCALE);
    }
    a.bag!.setEnabled(c.carrying.length > 0);
    const sim = this.lastSim;
    if (sim) {
      const fan = sim.grid.visionFan(c.x, c.y, c.facing, c.fov, c.range, 36);
      this.setCone(a.cone, fan, c.x, c.y, 0.05, c.range);
      if (this.mode === 'raid' && this.seenT <= 0) this.markSeen(fan, c.x, c.y);
    }
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
    else visible = this.reveal || e.seen || (e.known && (e.state === 'down' || e.state === 'subdued'));
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
    const tint = e.state === 'down' || e.state === 'subdued' ? NEUTRAL : colourOf(e.kind);
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
      // His men have their guns up while the boss talks.
      this.animate(a, e.state === 'hostile' || (e.state === 'standoff' && e.leader) ? 'aim' : 'move');
      const fan = sim.grid.visionFan(e.x, e.y, e.facing, e.fov, e.range, 36);
      this.setCone(a.cone, fan, e.x, e.y, 0.05, e.range);
      (a.cone.material as StandardMaterial).alpha = e.state === 'hostile' ? 0.24 : e.state === 'calm' ? 0.12 : 0.19;
    }
    // Status icon above the head.
    if (a.icon) {
      let key = '';
      // Planning: a pin over everyone the crew know about, so the plan is made against where they stand.
      if (planning) key = e.kind === 'civilian' ? 'pin-civ' : e.kind === 'dog' ? 'pin-dog' : 'pin';
      else if (e.state === 'hostile') key = '!';
      else if (e.state === 'fleeing') key = 'run';
      else if (e.state === 'standoff') key = e.leader ? 'wait' : `t${Math.round((e.talkT / TALK_TIME) * 20)}`;
      else if (e.state === 'calling') key = `c${Math.round((e.callT / CALL_TIME) * 20)}`;
      else if (e.state === 'subdued') key = 'hands';
      else if (e.state === 'suspicious') key = `?${Math.round(e.alert * 10)}`;
      else if (e.surrender > 0.02) key = `s${Math.round(e.surrender * 10)}`;
      else if (e.alert > 0.05) key = `?${Math.round(e.alert * 10)}`;
      else if (this.level.mode === 'rideout' && e.def.target && !e.caught) key = 'target';
      if (key !== a.icon.key) {
        a.icon.key = key;
        const g = a.icon.tex.getContext() as unknown as CanvasRenderingContext2D;
        g.clearRect(0, 0, 128, 128);
        if (key) drawStatus(g, 128, key, e);
        a.icon.tex.update();
      }
      a.icon.plane.setEnabled(!!key && e.state !== 'down');
      a.icon.plane.scaling.setAll(planning ? 1.5 : 1);
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

/** A go code on the map: an orange circle with its letter, as in the deck. */
function drawCode(g: CanvasRenderingContext2D, s: number, code: string, sel: boolean) {
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
  g.fillStyle = sel ? ACCENT : 'rgba(7,7,7,0.92)';
  g.fill();
  // Drawn heavy: the marker is only twenty-odd pixels on screen, and thin strokes vanish when the texture shrinks.
  g.strokeStyle = ACCENT;
  g.lineWidth = s * 0.1;
  g.stroke();
  g.fillStyle = sel ? '#070707' : ACCENT;
  g.font = `600 ${s * 0.5}px Inter, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(code, s / 2, s / 2 + s * 0.02);
}

function drawKick(g: CanvasRenderingContext2D, s: number, color: string) {
  g.fillStyle = 'rgba(7,7,7,0.9)';
  g.strokeStyle = color;
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.roundRect(s * 0.08, s * 0.25, s * 0.84, s * 0.5, s * 0.08);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `500 ${s * 0.24}px Inter, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('KICK', s / 2, s / 2 + s * 0.02);
}

function drawStatus(g: CanvasRenderingContext2D, s: number, key: string, e: Enemy) {
  const red = PALETTE.enemy;
  g.lineCap = 'round';
  if (key.startsWith('t') || key.startsWith('c')) {
    // The boss talking, or a civilian on the phone: a bubble, and an arc for the time left.
    const talk = key.startsWith('t');
    const col = talk ? red : PALETTE.civilian;
    const v = talk ? e.talkT / TALK_TIME : e.callT / CALL_TIME;
    g.fillStyle = 'rgba(10,18,36,0.9)';
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = s * 0.09;
    g.stroke();
    g.strokeStyle = col;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, v));
    g.stroke();
    g.fillStyle = col;
    g.font = `600 ${s * 0.36}px Inter, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(talk ? '...' : '999', s / 2, s / 2 + (talk ? -s * 0.06 : s * 0.02));
    return;
  }
  if (key === '!' || key === 'run' || key === 'wait') {
    g.fillStyle = red;
    g.beginPath();
    g.moveTo(s / 2, s * 0.08);
    g.lineTo(s * 0.92, s * 0.86);
    g.lineTo(s * 0.08, s * 0.86);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `600 ${s * 0.55}px Inter, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(key === 'run' ? '»' : key === 'wait' ? '…' : '!', s / 2, s * 0.6);
    return;
  }
  if (key.startsWith('pin')) {
    // A map pin pointing down at them: red for the opposition, pale for a civilian.
    const civ = key === 'pin-civ';
    const c = s / 2;
    const cy = s * 0.36;
    const r = s * 0.28;
    g.beginPath();
    g.arc(c, cy, r, Math.PI * 0.8, Math.PI * 0.2);
    g.lineTo(c, s * 0.94);
    g.closePath();
    g.fillStyle = civ ? PALETTE.civilian : red;
    g.fill();
    g.strokeStyle = 'rgba(7,7,7,0.9)';
    g.lineWidth = s * 0.05;
    g.stroke();
    g.fillStyle = civ ? '#070707' : '#ffffff';
    if (key === 'pin-dog') {
      g.beginPath();
      g.ellipse(c, cy + s * 0.07, s * 0.085, s * 0.07, 0, 0, Math.PI * 2);
      g.fill();
      for (const [dx, dy] of [[-0.11, -0.03], [-0.04, -0.1], [0.04, -0.1], [0.11, -0.03]]) {
        g.beginPath();
        g.arc(c + dx * s, cy + dy * s, s * 0.035, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      g.beginPath();
      g.arc(c, cy - s * 0.07, s * 0.075, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(c, cy + s * 0.13, s * 0.15, s * 0.11, 0, Math.PI, 0);
      g.fill();
    }
    return;
  }
  if (key === 'target') {
    // Who the crew came for: a reticle.
    const c = s / 2;
    g.strokeStyle = 'rgba(10,18,36,0.85)';
    g.lineWidth = s * 0.14;
    g.beginPath();
    g.arc(c, c, s * 0.28, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = red;
    g.lineWidth = s * 0.07;
    g.stroke();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      g.beginPath();
      g.moveTo(c + dx * s * 0.16, c + dy * s * 0.16);
      g.lineTo(c + dx * s * 0.42, c + dy * s * 0.42);
      g.stroke();
    }
    g.fillStyle = red;
    g.beginPath();
    g.arc(c, c, s * 0.05, 0, Math.PI * 2);
    g.fill();
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
    g.font = `600 ${s * 0.25}px Inter, sans-serif`;
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
  g.font = `600 ${s * 0.5}px Inter, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(surrender ? '✋' : '?', s / 2, s / 2 + s * 0.03);
}

function ageLabel(s: number): string {
  if (s < 10) return 'JUST NOW';
  if (s < 60) return `${Math.floor(s / 10) * 10}S AGO`;
  return `${Math.floor(s / 60)} MIN AGO`;
}

/** A story pin: who posted, and how long ago, over a pointer to the spot. */
function drawPin(g: CanvasRenderingContext2D, name: string, age: string) {
  const red = PALETTE.enemy;
  g.fillStyle = 'rgba(10,14,26,0.92)';
  g.strokeStyle = red;
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(16, 14, 480, 150, 22);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(226, 164);
  g.lineTo(256, 210);
  g.lineTo(286, 164);
  g.closePath();
  g.fillStyle = red;
  g.fill();
  // A phone, for where the intel came from.
  g.strokeStyle = red;
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(44, 44, 54, 92, 10);
  g.stroke();
  g.beginPath();
  g.arc(71, 50, 0.5, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = red;
  g.beginPath();
  g.arc(71, 118, 6, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '600 54px Inter, sans-serif';
  g.fillText(name.toUpperCase(), 122, 66, 360);
  g.fillStyle = red;
  g.font = '600 44px Inter, sans-serif';
  g.fillText(`POSTED ${age}`, 122, 120, 360);
}

/** A braced door: planks in a ring, with a red arc while they ram it. */
function drawBrace(g: CanvasRenderingContext2D, s: number, rammed: number | null) {
  const c = s / 2;
  g.fillStyle = 'rgba(10,18,36,0.88)';
  g.beginPath();
  g.arc(c, c, s * 0.4, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'round';
  if (rammed === null) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = s * 0.04;
    g.stroke();
  } else {
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = s * 0.08;
    g.stroke();
    g.strokeStyle = PALETTE.enemy;
    g.beginPath();
    g.arc(c, c, s * 0.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, rammed));
    g.stroke();
  }
  // A doorway with two boards nailed across it.
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = s * 0.03;
  g.strokeRect(c - s * 0.15, c - s * 0.22, s * 0.3, s * 0.44);
  g.strokeStyle = '#ffffff';
  g.lineWidth = s * 0.075;
  g.lineCap = 'round';
  for (const d of [1, -1]) {
    g.beginPath();
    g.moveTo(c - s * 0.2, c - d * s * 0.17);
    g.lineTo(c + s * 0.2, c + d * s * 0.17);
    g.stroke();
  }
}

/** Where waves come in: arrows the way they will move, the next wave and when, and any after it from the same side. */
function drawWave(g: CanvasRenderingContext2D, s: number, waves: { n: number; t: number }[], fromNorth: boolean) {
  const red = PALETTE.enemy;
  const c = s / 2;
  const when = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  // Arrows on the side they come from, pointing in.
  g.save();
  g.translate(c, fromNorth ? s * 0.16 : s * 0.84);
  if (!fromNorth) g.rotate(Math.PI);
  g.fillStyle = red;
  for (const y of [-0.12, 0.02]) {
    g.beginPath();
    g.moveTo(-s * 0.17, y * s);
    g.lineTo(0, (y + 0.09) * s);
    g.lineTo(s * 0.17, y * s);
    g.lineTo(s * 0.17, (y + 0.055) * s);
    g.lineTo(0, (y + 0.145) * s);
    g.lineTo(-s * 0.17, (y + 0.055) * s);
    g.closePath();
    g.fill();
  }
  g.restore();
  // The panel: which wave, when, and what follows it.
  const h = waves[1] ? s * 0.3 : s * 0.2;
  const top = fromNorth ? s * 0.36 : s * 0.64 - h;
  g.fillStyle = 'rgba(10,14,26,0.92)';
  g.strokeStyle = red;
  g.lineWidth = s * 0.012;
  g.beginPath();
  g.roundRect(s * 0.08, top, s * 0.84, h, s * 0.04);
  g.fill();
  g.stroke();
  g.textBaseline = 'middle';
  g.font = `600 ${s * 0.1}px Inter, sans-serif`;
  const label = `WAVE ${waves[0].n}`;
  const time = when(waves[0].t);
  const gap = s * 0.05;
  const lw = g.measureText(label).width;
  const tw = g.measureText(time).width;
  const x0 = c - (lw + gap + tw) / 2;
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  g.fillText(label, x0, top + s * 0.105);
  g.fillStyle = red;
  g.fillText(time, x0 + lw + gap, top + s * 0.105);
  if (waves[1]) {
    g.textAlign = 'center';
    g.fillStyle = '#cfe0ff';
    g.font = `500 ${s * 0.06}px Inter, sans-serif`;
    g.fillText(`THEN WAVE ${waves[1].n} AT ${when(waves[1].t)}`, c, top + s * 0.225);
  }
}
