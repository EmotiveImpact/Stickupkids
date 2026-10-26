// Rigged, animated characters from glTF: the AI character pipeline's models,
// one per kind, all on the same skeleton and clip names. Each crew member and enemy is an instance
// with its own skeleton, its own animation groups and a light that carries
// the baked light at its feet.

import {
  Color3,
  HemisphericLight,
  MaterialPluginBase,
  PBRMaterial,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type AnimationGroup,
  type AssetContainer,
  type Material,
  type MaterialDefines,
  type Scene,
  type UniformBuffer,
} from './babylon.ts';
import { MAX_LIGHTS, loadModel } from './estate.ts';

/** The model is 1.78 m and shown at life size, so people stand a head under the 2 m doors. */
export const CHAR_SCALE = 1.0;
const FADE = 0.18;

export type Weapon = 'pistol' | 'rifle' | 'shotgun' | 'smg';

export interface Look {
  /** The identifying colour: crew colour or enemy red. */
  slot: string;
  /** Clothing tint. */
  cloth?: string;
  /** Which of the model's guns to show, when it brings several (the armed crew do). */
  weapon?: Weapon;
}

/** Guns held in one hand play the model's Pistol clips where it has them; long guns play the plain ones. */
const CLIPS_FOR: Record<Weapon, string> = { pistol: 'Pistol', rifle: '', shotgun: '', smg: '' };

/**
 * A fresnel rim in the character's own colour, so a dark figure in a dark
 * room still shows its outline: crew in their colour, enemies in red.
 */
class RimPlugin extends MaterialPluginBase {
  readonly colour = new Color3();
  power = 2.6;

  constructor(material: Material) {
    super(material, 'Rim', 200, { RIM: false });
    this._enable(true);
  }

  prepareDefines(defines: MaterialDefines) {
    defines.RIM = true;
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'rimColour', size: 3, type: 'vec3' },
        { name: 'rimPower', size: 1, type: 'float' },
      ],
      fragment: 'uniform vec3 rimColour;\nuniform float rimPower;',
    };
  }

  bindForSubMesh(ubo: UniformBuffer) {
    ubo.updateColor3('rimColour', this.colour);
    ubo.updateFloat('rimPower', this.power);
  }

  getClassName() {
    return 'RimPlugin';
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef RIM
finalColor.rgb += rimColour * pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), rimPower);
#endif
`,
    };
  }
}

/** Rim strength in linear light (before exposure). */
const RIM = 0.24;

export class CharacterKit {
  private readonly container: AssetContainer;
  private readonly speeds: Record<string, number>;
  private count = 0;

  private constructor(container: AssetContainer, speeds: Record<string, number>) {
    this.container = container;
    this.speeds = speeds;
  }

  /**
   * `path` without extension, as for loadModel. `speeds`: how fast each
   * moving clip covers the ground at 1x, in metres a second, when the model
   * has its own (scripts/import-meshy-crew.mjs prints them).
   */
  static async load(scene: Scene, path: string, speeds: Record<string, number> = {}): Promise<CharacterKit> {
    return new CharacterKit(await loadModel(path, scene), speeds);
  }

  spawn(scene: Scene, name: string, look: Look): Character {
    const id = `${name}${this.count++}`;
    const inst = this.container.instantiateModelsToScene((n) => `${id}:${n}`, true, { doNotInstantiate: true });
    const root = new TransformNode(id, scene);
    root.scaling.setAll(CHAR_SCALE);
    const body = new TransformNode(`${id}:body`, scene);
    body.parent = root;
    for (const n of inst.rootNodes) n.parent = body;
    const meshes = inst.rootNodes.flatMap((n) => n.getChildMeshes(false));
    // One gun in the hand, the rest put away; and Meshy's stray icosphere, if it came along.
    for (const m of meshes) {
      const gun = /Weapon_(\w+)/.exec(m.name)?.[1]?.toLowerCase();
      if ((gun && gun !== (look.weapon ?? 'rifle')) || /icosphere/i.test(m.name)) m.setEnabled(false);
    }
    const slots: PBRMaterial[] = [];
    const rims: RimPlugin[] = [];
    const seen = new Set<PBRMaterial>();
    for (const m of meshes) {
      m.isPickable = false;
      const mat = m.material as PBRMaterial | null;
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      mat.environmentIntensity = 0;
      mat.maxSimultaneousLights = MAX_LIGHTS;
      if (mat.name.endsWith('Slot')) {
        mat.emissiveIntensity = 1.6;
        slots.push(mat);
      } else {
        rims.push(new RimPlugin(mat));
      }
      // The AI models carry their colours in the vertices; a cloth tint only darkens them.
      if (look.cloth && mat.name.endsWith('Cloth')) mat.albedoColor = Color3.FromHexString(look.cloth).toLinearSpace();
    }
    const groups = new Map<string, AnimationGroup>();
    for (const g of inst.animationGroups) {
      g.stop();
      groups.set(g.name.slice(g.name.indexOf(':') + 1), g);
    }
    const light = new HemisphericLight(`${id}:light`, Vector3.Up(), scene);
    light.specular = Color3.Black();
    light.includedOnlyMeshes = meshes;
    const c = new Character(root, body, meshes, groups, light, slots, rims, this.speeds, CLIPS_FOR[look.weapon ?? 'rifle']);
    c.setTint(look.slot);
    return c;
  }
}

export class Character {
  readonly root: TransformNode;
  /** Turns with facing; tips over when down. */
  readonly body: TransformNode;
  readonly meshes: AbstractMesh[];
  readonly light: HemisphericLight;
  private readonly groups: Map<string, AnimationGroup>;
  private readonly slots: PBRMaterial[];
  private readonly rims: RimPlugin[];
  private readonly speeds: Record<string, number>;
  /** Prefix of the clips for the gun in hand (Pistol), tried before the plain clip. */
  private readonly hold: string;
  private cur: AnimationGroup | null = null;
  private fading: AnimationGroup[] = [];
  private frozen = false;

  constructor(
    root: TransformNode,
    body: TransformNode,
    meshes: AbstractMesh[],
    groups: Map<string, AnimationGroup>,
    light: HemisphericLight,
    slots: PBRMaterial[],
    rims: RimPlugin[],
    speeds: Record<string, number>,
    hold = '',
  ) {
    this.root = root;
    this.body = body;
    this.meshes = meshes;
    this.groups = groups;
    this.light = light;
    this.slots = slots;
    this.rims = rims;
    this.speeds = speeds;
    this.hold = hold;
  }

  /** The clip actually played for `clip`: its version for the gun in hand, if the model has one. */
  private clipFor(clip: string): string {
    return this.hold && this.groups.has(this.hold + clip) ? this.hold + clip : clip;
  }

  /** Ground speed of a moving clip at 1x, in metres a second, if the model says. */
  natural(clip: string): number | undefined {
    return this.speeds[this.clipFor(clip)];
  }

  /** Recolour the trim and rim: the slot colour, or grey once an enemy is out of it. */
  setTint(hex: string) {
    const c = Color3.FromHexString(hex).toLinearSpace();
    for (const m of this.slots) {
      m.albedoColor = c.clone();
      m.emissiveColor = c.clone();
    }
    for (const r of this.rims) r.colour.copyFrom(c).scaleInPlace(RIM);
  }

  has(clip: string) {
    return this.groups.has(this.clipFor(clip));
  }

  /** Crossfade to a clip. A clip that does not loop holds its last frame (Down). */
  play(clip: string, speed = 1, loop = true) {
    const g = this.groups.get(this.clipFor(clip)) ?? this.groups.get('Idle');
    if (!g) return;
    if (this.frozen) {
      this.frozen = false;
      for (const x of this.groups.values()) if (x.isStarted) x.play(true);
    }
    g.speedRatio = speed;
    if (g === this.cur) return;
    const i = this.fading.indexOf(g);
    if (i >= 0) this.fading.splice(i, 1);
    else {
      g.weight = 0;
      g.start(true, speed);
      g.weight = 0;
      // A one-shot clip loops once, then holds on its last frame. Letting it
      // stop instead would drop it from the blend and spring back to rest.
      if (!loop) {
        g.onAnimationGroupLoopObservable.addOnce(() => {
          g.pause();
          g.goToFrame(g.to);
        });
      }
    }
    if (this.cur) this.fading.push(this.cur);
    this.cur = g;
  }

  /** Hold the current pose (for bodies on the floor). */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    for (const g of this.groups.values()) if (g.isStarted) g.pause();
  }

  update(dt: number) {
    if (this.frozen) return;
    const k = Math.min(1, dt / FADE);
    if (this.cur) this.cur.weight = Math.min(1, Math.max(0, this.cur.weight) + k);
    this.fading = this.fading.filter((g) => {
      g.weight = Math.max(0, g.weight - k);
      if (g.weight > 0) return true;
      g.stop();
      return false;
    });
  }

  setEnabled(on: boolean) {
    this.root.setEnabled(on);
    this.light.setEnabled(on);
  }
}
