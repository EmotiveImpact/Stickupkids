// Writes the level data as JSON for the Blender scene builder (art/level).
// Run: node --experimental-strip-types scripts/export-level.ts
import { writeFileSync } from 'node:fs';
import { buildEstateHouse } from '../src/sim/level.ts';

const level = buildEstateHouse();
const out = new URL('../art/level/estate.json', import.meta.url);
writeFileSync(out, JSON.stringify({ ...level, tiles: level.tiles.map((r) => r.join('')) }, null, 1));
console.log('wrote', out.pathname);
