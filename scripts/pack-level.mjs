// Shrinks a level exported from Blender: vertex data quantised to 16-bit
// positions and texture coordinates and 8-bit normals (KHR_mesh_quantization,
// which Babylon reads as is). About half the size, nothing visible lost.
// Run: node scripts/pack-level.mjs public/models/burgess/level.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, quantize } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('usage: node scripts/pack-level.mjs <level.glb>');
const before = statSync(path).size;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path);
await doc.transform(
  dedup(),
  // 16 bits over a 300 m level is under 5 mm; the lightmap's coordinates
  // need better than one texel in 4096.
  quantize({ quantizePosition: 16, quantizeTexcoord: 16, quantizeNormal: 8, quantizeColor: 8 }),
);
await io.write(path, doc);
console.log(`${path}: ${(before / 1e6).toFixed(1)} MB -> ${(statSync(path).size / 1e6).toFixed(1)} MB`);
