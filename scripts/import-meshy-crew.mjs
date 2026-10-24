// Readies a crew member rigged and animated in Meshy for the game:
// - the moving clips are made to walk on the spot (the game moves the body),
//   and the speed each one covers the ground at is printed for src/render;
// - clips take the game's names (Idle, Walk, Run, CrouchWalk, Down), and
//   the held poses the game needs are made from the first frame of a moving
//   clip: Aim (rifle up, from walking while shooting) and CrouchIdle;
// - Meshy's idle looks all round and sways, which reads as fidgeting from
//   above, so it keeps only a share of its movement about its average pose;
// - Meshy poses the arms for a rifle but sends no gun, so a plain rifle is
//   built on the right hand bone, pointing at the left hand as it is while
//   running and shooting (the clip with a true two-handed grip, and the one
//   the crew move with most);
// - the armed models (crew-photoreal/armed) bring their own guns, skinned to
//   the right hand (Weapon_Pistol, _Rifle, _Shotgun, _SMG; the game shows
//   one), and pistol clips, which take the names PistolWalk, PistolRun,
//   PistolAim and PistolFire; their textures are cut down to what a figure
//   seen from above needs.
// Run: node scripts/import-meshy-crew.mjs <meshy.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node scripts/import-meshy-crew.mjs <meshy.glb> <out.glb>');

const RENAME = {
  Walk_Forward_While_Shooting: 'Walk',
  Run_and_Shoot: 'Run',
  Cautious_Crouch_Walk_Forward: 'CrouchWalk',
  Shot_and_Fall_Backward: 'Down',
  Pistol_Walk_Aim: 'PistolWalk',
  Pistol_Run: 'PistolRun',
  Pistol_Aim_Idle: 'PistolAim',
  Pistol_Fire: 'PistolFire',
};
/** Held poses: name, and the clip whose first frame they hold. Meshy's Combat_Stance holds the hands too far apart for a rifle. */
const HELD = { Aim: 'Walk_Forward_While_Shooting', CrouchIdle: 'Cautious_Crouch_Walk_Forward' };
/** Clips calmed down, and the share of their movement they keep. */
const CALM = { Idle: 0.25 };
/** Clips that travel; Down keeps its fall. */
const MOVING = ['Walk_Forward_While_Shooting', 'Run_and_Shoot', 'Rifle_Charge', 'Cautious_Crouch_Walk_Forward', 'Sneaky_Walk', 'Pistol_Walk_Aim', 'Pistol_Run'];

// ------------------------------------------------------------ small maths

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const qnorm = (q) => q.map((x) => x / Math.hypot(...q));
function slerp(a, b, t) {
  const d = qdot(a, b);
  if (d < 0) return slerp(a, b.map((x) => -x), t);
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (b[i] - x) * t));
  const th = Math.acos(d);
  const ka = Math.sin((1 - t) * th) / Math.sin(th);
  const kb = Math.sin(t * th) / Math.sin(th);
  return a.map((x, i) => x * ka + b[i] * kb);
}
const rot = (q, v) => qmul(qmul(q, [...v, 0]), conj(q)).slice(0, 3);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const node = (name) => root.listNodes().find((n) => n.getName() === name);

// Meshy sometimes leaves a stray icosphere in the scene.
for (const n of root.listNodes()) {
  if (/icosphere/i.test(n.getName()) || /icosphere/i.test(n.getMesh()?.getName() ?? '')) n.dispose();
}

/** World transforms of every node with one animation held at keyframe `k` (uniform scales only). */
function pose(anim, k) {
  const local = new Map(root.listNodes().map((n) => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale()[0] }]));
  for (const ch of anim?.listChannels() ?? []) {
    const o = ch.getSampler().getOutput();
    const v = o.getElement(Math.min(k, o.getCount() - 1), []);
    const l = local.get(ch.getTargetNode());
    if (ch.getTargetPath() === 'translation') l.t = v;
    else if (ch.getTargetPath() === 'rotation') l.r = v;
    else if (ch.getTargetPath() === 'scale') l.s = v[0];
  }
  const world = new Map();
  const of = (n) => {
    if (world.has(n)) return world.get(n);
    const l = local.get(n);
    const p = n.getParentNode();
    const w = p ? (() => {
      const pw = of(p);
      return { t: add(pw.t, rot(pw.r, mul(l.t, pw.s))), r: qmul(pw.r, l.r), s: pw.s * l.s };
    })() : { t: l.t, r: l.r, s: l.s };
    world.set(n, w);
    return w;
  };
  return of;
}

const anim = (name) => root.listAnimations().find((a) => a.getName() === name);
const hips = node('Hips');
const armatureScale = node('Armature')?.getScale()[0] ?? 1;

// ------------------------------------------------- clips walk on the spot

const speeds = {};
for (const name of MOVING) {
  const a = anim(name);
  if (!a) continue;
  const ch = a.listChannels().find((c) => c.getTargetNode() === hips && c.getTargetPath() === 'translation');
  const times = ch.getSampler().getInput();
  const o = ch.getSampler().getOutput();
  const n = o.getCount();
  const t0 = times.getElement(0, [])[0];
  const span = times.getElement(n - 1, [])[0] - t0;
  const first = o.getElement(0, []);
  const last = o.getElement(n - 1, []);
  const dx = last[0] - first[0];
  const dz = last[2] - first[2];
  for (let i = 0; i < n; i++) {
    const f = (times.getElement(i, [])[0] - t0) / span;
    const v = o.getElement(i, []);
    o.setElement(i, [v[0] - dx * f, v[1], v[2] - dz * f]);
  }
  let travel = Math.hypot(dx, dz) * armatureScale;
  if (travel < 0.05) {
    // Already on the spot: two strides a loop, each as long as a foot sweeps back.
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n; k++) {
      const w = pose(a, k);
      const z = w(node('LeftFoot')).t[2] - w(hips).t[2];
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    travel = 2 * (hi - lo);
  }
  speeds[RENAME[name] ?? name] = +(travel / span).toFixed(2);
}

// ----------------------------------------------------- a rifle in the hand

const armed = root.listNodes().some((n) => n.getName().startsWith('Weapon_'));
const stance = pose(anim('Run_and_Shoot'), 0);
const hand = stance(node('RightHand'));
const fore = stance(node('RightForeArm')).t;
const left = stance(node('LeftHand')).t;
// The palm sits a little past the wrist, along the forearm.
const palm = add(hand.t, mul(norm(sub(hand.t, fore)), 0.06));
const D = norm(sub(left, palm));
const U = norm(sub([0, 1, 0], mul(D, D[1])));
const R = cross(U, D);
const toLocal = (p) => mul(rot(conj(hand.r), sub(p, hand.t)), 1 / hand.s);
const dirLocal = (d) => rot(conj(hand.r), d);

// Rifle space: x right, y up, z down the barrel, metres, pistol grip at the palm.
const BOXES = [
  { c: [0, 0.055, 0.04], s: [0.05, 0.075, 0.3] }, // receiver
  { c: [0, 0.04, -0.21], s: [0.04, 0.09, 0.2] }, // stock
  { c: [0, 0.006, -0.01], s: [0.03, 0.1, 0.04] }, // pistol grip
  { c: [0, -0.02, 0.13], s: [0.035, 0.13, 0.055] }, // magazine
  { c: [0, 0.06, 0.32], s: [0.042, 0.05, 0.26] }, // handguard
  { c: [0, 0.065, 0.52], s: [0.018, 0.018, 0.16] }, // barrel
  { c: [0, 0.1, 0.05], s: [0.025, 0.02, 0.1] }, // sight rail
];
const positions = [];
const normals = [];
const indices = [];
const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
const toWorld = (v) => add(palm, add(add(mul(R, v[0]), mul(U, v[1])), mul(D, v[2])));
for (const b of BOXES) {
  for (const [n, u, v] of FACES) {
    const base = positions.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 1, 2].map((i) => b.c[i] + (n[i] * b.s[i]) / 2 + (u[i] * su * b.s[i]) / 2 + (v[i] * sv * b.s[i]) / 2);
      positions.push(...toLocal(toWorld(p)));
      normals.push(...dirLocal(norm(add(add(mul(R, n[0]), mul(U, n[1])), mul(D, n[2])))));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
const buffer = root.listBuffers()[0];
const acc = (type, arr, ctor) => doc.createAccessor().setType(type).setArray(new ctor(arr)).setBuffer(buffer);
const metal = doc.createMaterial('Weapon').setBaseColorFactor([0.035, 0.04, 0.05, 1]).setMetallicFactor(0.55).setRoughnessFactor(0.45);
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', acc('VEC3', positions, Float32Array))
  .setAttribute('NORMAL', acc('VEC3', normals, Float32Array))
  .setIndices(acc('SCALAR', indices, Uint16Array))
  .setMaterial(metal);
// Faces wind one way in rifle space; a mirrored basis would turn them inside out.
if (dot(cross(R, U), D) < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
if (!armed) node('RightHand').addChild(doc.createNode('Weapon').setMesh(doc.createMesh('Weapon').addPrimitive(prim)));
else for (const a of [prim.getAttribute('POSITION'), prim.getAttribute('NORMAL'), prim.getIndices()]) a.dispose();
if (armed) metal.dispose();

// ------------------------------------------------------------ held poses

for (const [name, from] of Object.entries(HELD)) {
  const a = anim(from);
  if (!a) continue;
  const held = doc.createAnimation(name);
  for (const ch of a.listChannels()) {
    const o = ch.getSampler().getOutput();
    const v = o.getElement(0, []);
    const sampler = doc
      .createAnimationSampler()
      .setInput(acc('SCALAR', [0, 1], Float32Array))
      .setOutput(acc(o.getType(), [...v, ...v], Float32Array))
      .setInterpolation('STEP');
    held.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
}

// ------------------------------------------------------------ calmer clips

for (const [name, keep] of Object.entries(CALM)) {
  for (const ch of anim(name)?.listChannels() ?? []) {
    const o = ch.getSampler().getOutput();
    const keys = Array.from({ length: o.getCount() }, (_, i) => o.getElement(i, []));
    if (ch.getTargetPath() === 'rotation') {
      // The average pose: the keys summed on the same side as the first, normalised.
      const mean = qnorm(keys.reduce((m, q) => m.map((x, i) => x + (qdot(q, keys[0]) < 0 ? -q[i] : q[i])), [0, 0, 0, 0]));
      keys.forEach((q, i) => o.setElement(i, slerp(mean, q, keep)));
    } else {
      const mean = keys.reduce((m, v) => m.map((x, i) => x + v[i] / keys.length), keys[0].map(() => 0));
      keys.forEach((v, i) => o.setElement(i, mean.map((x, j) => x + (v[j] - x) * keep)));
    }
  }
}

for (const a of root.listAnimations()) if (RENAME[a.getName()]) a.setName(RENAME[a.getName()]);

// The figure is under a hundred pixels tall on screen: 1K maps for the body, small ones for the guns.
if (armed) {
  const gun = new Set(root.listMeshes().filter((m) => m.getName().startsWith('Weapon_') || root.listNodes().some((n) => n.getMesh() === m && n.getName().startsWith('Weapon_'))).flatMap((m) => m.listPrimitives().map((p) => p.getMaterial())));
  const gunTex = new Set([...gun].flatMap((m) => m ? [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture()] : []).filter(Boolean));
  for (const [i, t] of root.listTextures().entries()) t.setName(gunTex.has(t) ? `gun-${i}` : `body-${i}`);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], pattern: /^gun-/, quality: 82 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], pattern: /^body-/, quality: 86 }),
  );
}

await io.write(out, doc);
const grip = Math.hypot(...sub(left, palm));
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB, left hand ${grip.toFixed(2)} m up the rifle`);
console.log(JSON.stringify(speeds));
