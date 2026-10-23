// The Babylon.js view. Reads simulation state each frame; owns no game rules.

import {
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Effect,
  Engine,
  FreeCamera,
  GlowLayer,
  Matrix,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PostProcess,
  Scene,
  ShadowGenerator,
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
import { buildWorld, Coords, mat, type World } from './world.ts';

const OVERLAY = 0x10000000;
const WORLD = 0x0fffffff;
const ACTOR_SCALE = 1.7;

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
  ring: Mesh;
  cone: Mesh;
  bag?: Mesh;
  arms?: Mesh[];
  icon?: { plane: Mesh; tex: DynamicTexture; key: string };
}

interface Fx {
  mesh: Mesh;
  t: number;
  life: number;
  kind: 'ring' | 'tracer' | 'flash';
  r?: number;
}

export class View {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly level: Level;
  readonly co: Coords;
  private cam: FreeCamera;
  private ocam: FreeCamera;
  private bp: PostProcess;
  private bpAmount = 1;
  private bpTarget = 1;
  private world: World;
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
  mode: Mode = 'planning';

  constructor(canvas: HTMLCanvasElement, level: Level) {
    this.level = level;
    this.co = new Coords(level.w, level.h);
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = Color4.FromHexString(PALETTE.night + 'ff');
    scene.ambientColor = new Color3(0.05, 0.07, 0.12);
    scene.imageProcessingConfiguration.contrast = 1.25;
    scene.imageProcessingConfiguration.exposure = 1.35;
    scene.imageProcessingConfiguration.vignetteEnabled = true;
    scene.imageProcessingConfiguration.vignetteWeight = 1.6;
    scene.imageProcessingConfiguration.vignetteColor = new Color4(0.02, 0.03, 0.08, 0);

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

    // Night lighting: cool moon, dim sky fill. Streetlights come from the level.
    const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), scene);
    hemi.diffuse = Color3.FromHexString(PALETTE.moon).scale(0.55);
    hemi.groundColor = Color3.FromHexString('#0b1220');
    hemi.specular = Color3.Black();
    hemi.intensity = 1.05;
    const moon = new DirectionalLight('moon', new Vector3(0.45, -1, 0.55), scene);
    moon.position = new Vector3(-20, 40, -25);
    moon.diffuse = Color3.FromHexString('#7f9fff');
    moon.specular = Color3.FromHexString('#3a6fd8');
    moon.intensity = 0.85;
    const shadows = new ShadowGenerator(2048, moon);
    shadows.usePercentageCloserFiltering = true;
    shadows.darkness = 0.35;
    shadows.bias = 0.002;

    this.world = buildWorld(scene, level, this.co, shadows);

    const glow = new GlowLayer('glow', scene, { camera: this.cam, mainTextureSamples: 2 });
    glow.intensity = 0.55;

    this.bp = new PostProcess('blueprint', 'blueprint', ['amount', 'screenSize'], null, 1, this.cam);
    this.bp.onApply = (e) => {
      e.setFloat('amount', this.bpAmount);
      e.setFloat2('screenSize', this.bp.width, this.bp.height);
    };

    for (const def of this.crewColours()) this.crew.push(this.makeCrewActor(def, shadows));
    for (const e of level.enemies) this.enemies.set(e.id, this.makeEnemyActor(e.kind, shadows));
    this.shadowGen = shadows;

    this.markers = new TransformNode('markers', scene);
    this.hoverMesh = MeshBuilder.CreateGround('hover', { width: 0.94, height: 0.94 }, scene);
    this.hoverMesh.material = mat(scene, '#ffffff', { emissive: '#ffffff', alpha: 0.12, unlit: true });
    this.toOverlay(this.hoverMesh);
    this.hoverMesh.position.y = 0.04;

    this.buildStaticOverlay();
    this.resize();
  }

  private shadowGen: ShadowGenerator;

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
    const tilt = (54 * Math.PI) / 180;
    const viewW = this.level.w + 1;
    const viewH = this.level.h * Math.sin(tilt) + WALL_H * Math.cos(tilt) + 0.5;
    const scale = Math.min(uw / viewW, uh / viewH);
    const dx = L + uw / 2 - sw / 2;
    const dy = T + uh / 2 - sh / 2;
    for (const c of [this.cam, this.ocam]) {
      c.orthoLeft = (-sw / 2 - dx) / scale;
      c.orthoRight = (sw / 2 - dx) / scale;
      c.orthoTop = (sh / 2 + dy) / scale;
      c.orthoBottom = (-sh / 2 + dy) / scale;
      const d = 60;
      c.position.set(0, Math.sin(tilt) * d, -Math.cos(tilt) * d);
      c.setTarget(new Vector3(0, 0, 0));
    }
  }

  setMode(m: Mode) {
    this.mode = m;
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

  /** Map coordinates under a screen point, or null if off the map. */
  pick(clientX: number, clientY: number): Vec | null {
    const rect = this.engine.getRenderingCanvas()!.getBoundingClientRect();
    const res = this.scene.pick(clientX - rect.left, clientY - rect.top, (m) => m === this.world.ground, false, this.cam);
    if (!res?.hit || !res.pickedPoint) return null;
    const x = res.pickedPoint.x + this.level.w / 2;
    const y = this.level.h / 2 - res.pickedPoint.z;
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return null;
    return { x, y };
  }

  // ------------------------------------------------------------ actors

  private makeCrewActor(color: string, shadows: ShadowGenerator): Actor {
    const scene = this.scene;
    const root = new TransformNode('crew', scene);
    root.scaling.setAll(ACTOR_SCALE);
    const body = new TransformNode('crewBody', scene);
    body.parent = root;
    const suit = mat(scene, '#1d1e26');
    const legs = MeshBuilder.CreateCylinder('legs', { diameterTop: 0.34, diameterBottom: 0.28, height: 0.5, tessellation: 8 }, scene);
    legs.position.y = 0.25;
    legs.material = suit;
    const torso = MeshBuilder.CreateCylinder('torso', { diameterTop: 0.5, diameterBottom: 0.44, height: 0.48, tessellation: 8 }, scene);
    torso.position.y = 0.72;
    torso.material = mat(scene, '#24252e');
    const head = MeshBuilder.CreateSphere('head', { diameter: 0.32, segments: 8 }, scene);
    head.position.y = 1.1;
    head.material = mat(scene, '#121217');
    const band = MeshBuilder.CreateTorus('mask', { diameter: 0.3, thickness: 0.07, tessellation: 12 }, scene);
    band.position.y = 1.12;
    band.material = mat(scene, color, { emissive: color });
    const gun = MeshBuilder.CreateBox('gun', { width: 0.07, height: 0.09, depth: 0.42 }, scene);
    gun.position.set(0.14, 0.72, 0.3);
    gun.material = mat(scene, '#0b0b0f');
    const bag = MeshBuilder.CreateBox('bag', { width: 0.36, height: 0.36, depth: 0.22 }, scene);
    bag.position.set(0, 0.78, -0.3);
    bag.material = mat(scene, '#0f2a20', { emissive: '#1fa36b' });
    bag.setEnabled(false);
    for (const m of [legs, torso, head, band, gun, bag]) {
      m.parent = body;
      shadows.addShadowCaster(m, false);
    }
    const ring = MeshBuilder.CreateTorus('ring', { diameter: 0.6, thickness: 0.035, tessellation: 32 }, scene);
    ring.material = mat(scene, color, { emissive: color, unlit: true });
    ring.parent = root;
    ring.position.y = 0.04;
    this.toOverlay(ring);
    const cone = this.makeCone(color, 0.18);
    return { root, body, ring, cone, bag };
  }

  private makeEnemyActor(kind: string, shadows: ShadowGenerator): Actor {
    const scene = this.scene;
    const root = new TransformNode('enemy', scene);
    root.scaling.setAll(ACTOR_SCALE);
    const body = new TransformNode('enemyBody', scene);
    body.parent = root;
    const parts: Mesh[] = [];
    let arms: Mesh[] | undefined;
    if (kind === 'dog') {
      const m = mat(scene, '#1a1a20');
      const torso = MeshBuilder.CreateBox('dog', { width: 0.32, height: 0.3, depth: 0.72 }, scene);
      torso.position.y = 0.42;
      const head = MeshBuilder.CreateBox('dogHead', { width: 0.24, height: 0.24, depth: 0.3 }, scene);
      head.position.set(0, 0.6, 0.44);
      parts.push(torso, head);
      for (const [dx, dz] of [[-0.11, -0.26], [0.11, -0.26], [-0.11, 0.26], [0.11, 0.26]]) {
        const leg = MeshBuilder.CreateBox('leg', { width: 0.08, height: 0.3, depth: 0.08 }, scene);
        leg.position.set(dx, 0.15, dz);
        parts.push(leg);
      }
      const collar = MeshBuilder.CreateBox('collar', { width: 0.26, height: 0.06, depth: 0.08 }, scene);
      collar.position.set(0, 0.55, 0.32);
      collar.material = mat(scene, PALETTE.enemy, { emissive: '#801020' });
      parts.forEach((p) => (p.material = m));
      parts.push(collar);
    } else {
      const suit = kind === 'dealer' ? '#5b5f6e' : kind === 'runner' ? '#6a6f82' : '#2a2c36';
      const legs = MeshBuilder.CreateCylinder('legs', { diameterTop: 0.34, diameterBottom: 0.28, height: 0.5, tessellation: 8 }, scene);
      legs.position.y = 0.25;
      legs.material = mat(scene, '#1a1b22');
      const torso = MeshBuilder.CreateCylinder('torso', { diameterTop: 0.5, diameterBottom: 0.44, height: 0.48, tessellation: 8 }, scene);
      torso.position.y = 0.72;
      torso.material = mat(scene, suit);
      const head = MeshBuilder.CreateSphere('head', { diameter: 0.3, segments: 8 }, scene);
      head.position.y = 1.1;
      head.material = mat(scene, '#2f2833');
      parts.push(legs, torso, head);
      if (kind !== 'runner') {
        const gun = MeshBuilder.CreateBox('gun', { width: 0.07, height: 0.09, depth: 0.36 }, scene);
        gun.position.set(0.14, 0.72, 0.28);
        gun.material = mat(scene, '#0b0b0f');
        parts.push(gun);
      }
      arms = [-1, 1].map((s) => {
        const a = MeshBuilder.CreateCylinder('arm', { diameter: 0.09, height: 0.45 }, scene);
        a.position.set(s * 0.2, 1.15, 0);
        a.rotation.z = s * -0.25;
        a.material = mat(scene, suit);
        a.setEnabled(false);
        return a;
      });
      parts.push(...arms);
    }
    for (const p of parts) {
      p.parent = body;
      shadows.addShadowCaster(p, false);
    }
    const ring = MeshBuilder.CreateTorus('ring', { diameter: kind === 'dog' ? 0.66 : 0.6, thickness: 0.035, tessellation: 32 }, scene);
    ring.material = mat(scene, PALETTE.enemy, { emissive: PALETTE.enemy, unlit: true });
    ring.parent = root;
    ring.position.y = 0.04;
    this.toOverlay(ring);
    const cone = this.makeCone(PALETTE.enemy, 0.2);
    const tex = new DynamicTexture('icon', { width: 128, height: 128 }, scene, true);
    tex.hasAlpha = true;
    const plane = MeshBuilder.CreatePlane('icon', { size: 0.55 }, scene);
    const im = new StandardMaterial('iconMat', scene);
    im.diffuseTexture = tex;
    im.emissiveTexture = tex;
    im.useAlphaFromDiffuseTexture = true;
    im.disableLighting = true;
    im.backFaceCulling = false;
    plane.material = im;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = root;
    plane.position.y = 1.5;
    this.toOverlay(plane);
    return { root, body, ring, cone, arms, icon: { plane, tex, key: '' } };
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
      if (ev.type === 'noise' && ev.r >= 2.5) {
        const ring = MeshBuilder.CreateTorus('noise', { diameter: 2, thickness: 0.04, tessellation: 48 }, this.scene);
        const enemyNoise = ev.label === 'Barking' || ev.label === 'Shouting';
        ring.material = mat(this.scene, '#ffffff', { emissive: enemyNoise ? PALETTE.enemy : '#d8e6ff', alpha: 0.6, unlit: true });
        ring.position.set(this.co.X(ev.x), 0.07, this.co.Z(ev.y));
        this.toOverlay(ring);
        this.fx.push({ mesh: ring, t: 0, life: 0.7, kind: 'ring', r: ev.r });
      } else if (ev.type === 'shot') {
        const a = new Vector3(this.co.X(ev.from.x), 0.75, this.co.Z(ev.from.y));
        const b = new Vector3(this.co.X(ev.to.x), 0.75, this.co.Z(ev.to.y));
        const len = Vector3.Distance(a, b);
        const t = MeshBuilder.CreateBox('tracer', { width: 0.05, height: 0.05, depth: len }, this.scene);
        t.position = a.add(b).scale(0.5);
        t.lookAt(b);
        t.material = mat(this.scene, '#ffffff', { emissive: ev.byCrew ? '#fff6c8' : PALETTE.enemy, unlit: true });
        this.toOverlay(t);
        this.fx.push({ mesh: t, t: 0, life: 0.08, kind: 'tracer' });
      }
    }
  }

  frame(dt: number, sim: Sim, plan: PlanOverlay | null) {
    this.time += dt;
    // Blueprint wash eases in and out.
    this.bpAmount += (this.bpTarget - this.bpAmount) * Math.min(1, dt * 5);
    if (Math.abs(this.bpTarget - this.bpAmount) < 0.002) this.bpAmount = this.bpTarget;
    if (this.world.tvLight) this.world.tvLight.intensity = 1.1 + Math.sin(this.time * 9) * 0.15 + Math.sin(this.time * 23) * 0.1;

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
    sim.crew.forEach((c, i) => this.updateCrew(this.crew[i], c, plan, i));
    // Enemies (backup can spawn mid-raid).
    for (const e of sim.enemies) {
      let a = this.enemies.get(e.id);
      if (!a) {
        a = this.makeEnemyActor(e.kind, this.shadowGen);
        this.enemies.set(e.id, a);
      }
      this.updateEnemy(a, e, sim);
    }
    // Doors swing.
    for (const [key, d] of this.world.doors) {
      const [x, y] = key.split(',').map(Number);
      const st = sim.grid.door(x, y);
      const target = st === 'open' ? 1 : st === 'broken' ? 2 : 0;
      if (target === 2) {
        d.pivot.rotation.x = 0;
        d.leaf.rotation.x = Math.PI / 2;
        d.leaf.position.y = 0.06;
        d.leaf.position.z = d.axis === 'h' ? 0.7 : -0.7;
      } else {
        d.open += (target - d.open) * Math.min(1, dt * 10);
        d.leaf.rotation.y = 0;
        const baseY = d.axis === 'h' ? 0 : Math.PI / 2;
        d.pivot.rotation.y = baseY - d.open * (Math.PI / 2) * 0.95;
      }
    }
    // Loot props.
    for (const item of sim.loot) {
      const node = this.world.loot.get(item.def.id)!;
      node.setEnabled(item.state === 'placed');
      node.position.set(this.co.X(item.x), 0, this.co.Z(item.y));
      node.rotation.y = Math.sin(this.time * 1.5) * 0.05;
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
        f.mesh.dispose();
        return false;
      }
      if (f.kind === 'ring') {
        const s = 0.2 + k * (f.r ?? 4);
        f.mesh.scaling.set(s, 1, s);
        f.mesh.visibility = 1 - k;
      }
      return true;
    });
    this.scene.render();
  }

  private updateCrew(a: Actor, c: Crew, plan: PlanOverlay | null, i: number) {
    const visible = c.state !== 'escaped';
    a.root.setEnabled(visible);
    a.cone.setEnabled(visible && c.state !== 'down');
    if (!visible) return;
    a.root.position.set(this.co.X(c.x), 0, this.co.Z(c.y));
    a.body.rotation.y = this.co.rotY(c.facing);
    const moving = c.state === 'moving';
    a.body.position.y = moving ? Math.abs(Math.sin(this.time * 12 + i)) * 0.05 : 0;
    if (c.state === 'down') {
      a.body.rotation.x = Math.PI / 2;
      a.body.position.y = 0.2;
      a.ring.visibility = 0.35;
      return;
    }
    a.body.rotation.x = 0;
    a.ring.visibility = 1;
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

  private updateEnemy(a: Actor, e: Enemy, sim: Sim) {
    const planning = this.mode === 'planning';
    let visible: boolean;
    if (e.state === 'gone') visible = false;
    else if (planning) visible = e.known;
    else visible = e.seen || (e.known && (e.state === 'down' || e.state === 'subdued'));
    a.root.setEnabled(visible);
    a.cone.setEnabled(visible && e.state !== 'down' && e.state !== 'subdued');
    if (!visible) return;
    a.root.position.set(this.co.X(e.x), 0, this.co.Z(e.y));
    a.body.rotation.y = this.co.rotY(e.facing);
    a.body.rotation.x = 0;
    a.body.position.y = 0;
    a.body.scaling.y = 1;
    a.arms?.forEach((m) => m.setEnabled(e.state === 'subdued'));
    if (e.state === 'down') {
      a.body.rotation.x = Math.PI / 2;
      a.body.position.y = 0.2;
      a.ring.visibility = 0.3;
    } else if (e.state === 'subdued') {
      a.body.scaling.y = 0.7;
      a.ring.visibility = 0.45;
    } else {
      a.ring.visibility = 1;
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
    g.strokeStyle = '#ffffff';
    g.lineWidth = s * 0.07;
    g.beginPath();
    g.moveTo(s * 0.3, s * 0.85);
    g.lineTo(s * 0.3, s * 0.3);
    g.moveTo(s * 0.7, s * 0.85);
    g.lineTo(s * 0.7, s * 0.3);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(s * 0.3, s * 0.22, s * 0.09, 0, Math.PI * 2);
    g.arc(s * 0.7, s * 0.22, s * 0.09, 0, Math.PI * 2);
    g.fill();
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
