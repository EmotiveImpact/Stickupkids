// Rigged, animated characters from a glTF (art/crew/make_crew.py for now,
// the AI-generated models later). Each crew member and enemy is an instance
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

/** The model is 1.78 m; a touch over life size reads better from above. */
export const CHAR_SCALE = 1.12;
const FADE = 0.18;

export interface Look {
  /** The identifying colour: crew colour or enemy red. */
  slot: string;
  /** Clothing tint. */
  cloth?: string;
}

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
  private count = 0;

  private constructor(container: AssetContainer) {
    this.container = container;
  }

  /** `path` without extension, as for loadModel. */
  static async load(scene: Scene, path: string): Promise<CharacterKit> {
    return new CharacterKit(await loadModel(path, scene));
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
    const rim = Color3.FromHexString(look.slot).toLinearSpace().scale(RIM);
    const seen = new Set<PBRMaterial>();
    for (const m of meshes) {
      m.isPickable = false;
      const mat = m.material as PBRMaterial | null;
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      mat.environmentIntensity = 0;
      mat.maxSimultaneousLights = MAX_LIGHTS;
      if (!mat.name.endsWith('Slot')) new RimPlugin(mat).colour.copyFrom(rim);
      if (mat.name.endsWith('Slot')) {
        mat.albedoColor = Color3.FromHexString(look.slot).toLinearSpace();
        mat.emissiveColor = mat.albedoColor.clone();
        mat.emissiveIntensity = 1.6;
      } else if (mat.name.endsWith('Cloth')) {
        // Lifted off black so the silhouette holds at night.
        mat.albedoColor = Color3.FromHexString(look.cloth ?? '#3a4052').toLinearSpace();
      } else if (mat.name.endsWith('Dark')) {
        mat.albedoColor = Color3.FromHexString('#181a21').toLinearSpace();
      }
    }
    const groups = new Map<string, AnimationGroup>();
    for (const g of inst.animationGroups) {
      g.stop();
      groups.set(g.name.slice(g.name.indexOf(':') + 1), g);
    }
    const light = new HemisphericLight(`${id}:light`, Vector3.Up(), scene);
    light.specular = Color3.Black();
    light.includedOnlyMeshes = meshes;
    return new Character(root, body, meshes, groups, light);
  }
}

export class Character {
  readonly root: TransformNode;
  /** Turns with facing; tips over when down. */
  readonly body: TransformNode;
  readonly meshes: AbstractMesh[];
  readonly light: HemisphericLight;
  private readonly groups: Map<string, AnimationGroup>;
  private cur: AnimationGroup | null = null;
  private fading: AnimationGroup[] = [];
  private frozen = false;

  constructor(root: TransformNode, body: TransformNode, meshes: AbstractMesh[], groups: Map<string, AnimationGroup>, light: HemisphericLight) {
    this.root = root;
    this.body = body;
    this.meshes = meshes;
    this.groups = groups;
    this.light = light;
  }

  has(clip: string) {
    return this.groups.has(clip);
  }

  /** Crossfade to a looping clip. */
  play(clip: string, speed = 1) {
    const g = this.groups.get(clip) ?? this.groups.get('Idle');
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
