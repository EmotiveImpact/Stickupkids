// Writes each job's level data as JSON for the Blender scene builders
// (art/level): art/level/<job id>.json.
// Run: node --experimental-strip-types scripts/export-level.ts
import { writeFileSync } from 'node:fs';
import { JOBS } from '../src/sim/jobs.ts';

for (const job of JOBS) {
  const level = job.build();
  const out = new URL(`../art/level/${level.id}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify({ ...level, tiles: level.tiles.map((r) => r.join('')) }, null, 1));
  console.log('wrote', out.pathname);
}
