// Pre-rendered backgrounds (art/level/build_site.py --still): the level drawn
// once in Cycles from each camera angle, flat on, at full detail. Each level
// mesh shows the picture's pixel for its own point instead of its live
// shading, so from the matching camera the screen is the picture, and the
// crew, enemies, doors and loot (live, on their own materials) move over it,
// hidden behind walls by the level's real shapes.

import { MaterialPluginBase, Texture, Vector3, type Material, type MaterialDefines, type PBRMaterial, type Scene, type UniformBuffer } from './babylon.ts';
import type { Estate } from './estate.ts';

/** One picture: map points p land at ((p.right - u0) / w, (p.up - v0) / h). */
interface Frame {
  image: string;
  right: [number, number, number];
  up: [number, number, number];
  u0: number;
  v0: number;
  w: number;
  h: number;
}

export type StillView = 'overhead' | 'angled';

/** Per view: sharp over where the job is played, softer over the whole map. */
type Meta = Partial<Record<StillView, { detail?: Frame; wide?: Frame }>>;

interface Tier {
  tex: Texture;
  right: Vector3;
  up: Vector3;
  /** u0, v0, w, h */
  frame: [number, number, number, number];
}

/** What every level material reads: which view's pictures, and whether they show at all. */
class State {
  on = true;
  view: StillView = 'overhead';
  /** Linear light the picture's white becomes, before the pipeline's exposure. */
  gain = 1;
  tiers = new Map<StillView, { detail: Tier; wide: Tier }>();

  current() {
    return this.on ? (this.tiers.get(this.view) ?? null) : null;
  }
}

class StillPlugin extends MaterialPluginBase {
  private readonly state: State;

  constructor(material: Material, state: State) {
    super(material, 'Still', 250, { STILL: false });
    this.state = state;
    this._enable(true);
  }

  prepareDefines(defines: MaterialDefines) {
    defines.STILL = true;
  }

  getSamplers(samplers: string[]) {
    samplers.push('stillDetail', 'stillWide');
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'stillOn', size: 1, type: 'float' },
        { name: 'stillGain', size: 1, type: 'float' },
        { name: 'stillRD', size: 3, type: 'vec3' },
        { name: 'stillUD', size: 3, type: 'vec3' },
        { name: 'stillFD', size: 4, type: 'vec4' },
        { name: 'stillRW', size: 3, type: 'vec3' },
        { name: 'stillUW', size: 3, type: 'vec3' },
        { name: 'stillFW', size: 4, type: 'vec4' },
      ],
      fragment: `uniform float stillOn;
uniform float stillGain;
uniform vec3 stillRD;
uniform vec3 stillUD;
uniform vec4 stillFD;
uniform vec3 stillRW;
uniform vec3 stillUW;
uniform vec4 stillFW;`,
    };
  }

  bindForSubMesh(ubo: UniformBuffer) {
    const t = this.state.current();
    ubo.updateFloat('stillOn', t ? 1 : 0);
    ubo.updateFloat('stillGain', this.state.gain);
    if (!t) return;
    const [d, w] = [t.detail, t.wide];
    ubo.updateVector3('stillRD', d.right);
    ubo.updateVector3('stillUD', d.up);
    ubo.updateFloat4('stillFD', ...d.frame);
    ubo.updateVector3('stillRW', w.right);
    ubo.updateVector3('stillUW', w.up);
    ubo.updateFloat4('stillFW', ...w.frame);
    ubo.setTexture('stillDetail', d.tex);
    ubo.setTexture('stillWide', w.tex);
  }

  getClassName() {
    return 'StillPlugin';
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
#ifdef STILL
uniform sampler2D stillDetail;
uniform sampler2D stillWide;
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef STILL
if (stillOn > 0.5) {
  vec2 sd = (vec2(dot(vPositionW, stillRD), dot(vPositionW, stillUD)) - stillFD.xy) / stillFD.zw;
  vec2 sw = (vec2(dot(vPositionW, stillRW), dot(vPositionW, stillUW)) - stillFW.xy) / stillFW.zw;
  vec3 pic = vec3(-1.0);
  if (all(greaterThanEqual(sd, vec2(0.0))) && all(lessThanEqual(sd, vec2(1.0)))) pic = texture2D(stillDetail, sd).rgb;
  else if (all(greaterThanEqual(sw, vec2(0.0))) && all(lessThanEqual(sw, vec2(1.0)))) pic = texture2D(stillWide, sw).rgb;
  if (pic.r >= 0.0) {
    finalColor.rgb = toLinearSpace(pic) * stillGain;
    // The crew's and enemies' shadows still fall on the picture.
    #ifdef SHADOWINUSE
    if (shadowLightCount > 0.0) finalColor.rgb *= globalShadow / shadowLightCount;
    #endif
  }
}
#endif
`,
    };
  }
}

/** The level's pictures, when it has them. */
export class Stills {
  private readonly state: State;

  private constructor(state: State) {
    this.state = state;
  }

  /**
   * Load `base`still.json and its pictures, and paint them over every level
   * mesh but the live ones (doors and loot, which get their own copies of
   * their materials). Null when the level has no pictures.
   */
  static async load(scene: Scene, base: string, estate: Estate): Promise<Stills | null> {
    let meta: Meta;
    try {
      const r = await fetch(base + 'still.json');
      if (!r.ok) return null;
      meta = (await r.json()) as Meta;
    } catch {
      return null;
    }
    const state = new State();
    const loads: Promise<boolean>[] = [];
    const textures: Texture[] = [];
    const tier = (f: Frame): Tier => {
      let done: (ok: boolean) => void = () => {};
      loads.push(new Promise((r) => (done = r)));
      const tex = new Texture(base + f.image, scene, {
        noMipmap: false,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
        onLoad: () => done(true),
        onError: () => done(false),
      });
      tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = 8;
      textures.push(tex);
      return { tex, right: new Vector3(...f.right), up: new Vector3(...f.up), frame: [f.u0, f.v0, f.w, f.h] };
    };
    for (const view of ['overhead', 'angled'] as const) {
      const m = meta[view];
      const one = m?.detail ?? m?.wide;
      if (!one) continue;
      const detail = tier(one);
      state.tiers.set(view, { detail, wide: m!.wide && m!.detail ? tier(m!.wide) : detail });
    }
    if (!state.tiers.size) return null;
    // A picture that will not load: the level plays with live shading instead.
    if (!(await Promise.all(loads)).every(Boolean)) {
      for (const t of textures) t.dispose();
      return null;
    }

    // Doors and loot move, so they keep live shading: their own material copies.
    const live = new Set([...estate.doors.values()].map((d) => d.pivot as unknown as object));
    for (const l of estate.loot.values()) live.add(l);
    const copies = new Map<Material, Material>();
    const painted = new Set<Material>();
    for (const mesh of estate.meshes) {
      const mat = mesh.material;
      if (!mat) continue;
      let p = mesh.parent;
      let moving = false;
      while (p && !moving) {
        moving = live.has(p);
        p = p.parent;
      }
      if (moving) {
        let c = copies.get(mat);
        if (!c) copies.set(mat, (c = mat.clone(`${mat.name}:live`)!));
        mesh.material = c;
      } else painted.add(mat);
    }
    for (const m of painted) new StillPlugin(m as PBRMaterial, state);
    return new Stills(state);
  }

  /** Which view's pictures show. */
  setView(view: StillView) {
    this.state.view = view;
  }

  /** Off for shots from any other angle (the Go shot), which would smear the picture. */
  setOn(on: boolean) {
    this.state.on = on;
  }

  has(view: StillView): boolean {
    return this.state.tiers.has(view);
  }

  /** Linear light for the picture's white, so it comes out as rendered after the pipeline's exposure. */
  set gain(k: number) {
    this.state.gain = k;
  }
}
