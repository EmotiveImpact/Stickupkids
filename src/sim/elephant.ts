// The railway arches south of Elephant and Castle: a weed grow in one arch of
// the viaduct, a car wash in the next, a cobbled lane in front and a footpath
// behind. The map is a 150 by 90 metre slice of the real place turned so the
// viaduct runs across it: the roads that pass under it, the buildings round
// it and the paths come from OpenStreetMap (elephantGround.ts). The arches'
// fittings, the grow and the people in it are made up.

import { GROUND, TREES } from './elephantGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type LightDef, type Level, type LootDef, type PropDef, type Room } from './level.ts';
import { mulberry32 } from './sim.ts';

/** The viaduct's rows, north and south face. */
export const VIADUCT = { y0: 22, y1: 42 };
/** The grow (three arches knocked through) and the car wash, west pier to east pier. */
export const GROW = { x0: 64, x1: 82 };
export const WASH = { x0: 56, x1: 64 };

export function buildElephant(): Level {
  const h = GROUND.length;
  const w = GROUND[0].length;
  const tiles: string[][] = GROUND.map((r) => r.split(''));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const { y0: vy0, y1: vy1 } = VIADUCT;

  // The viaduct: solid brick, except where the roads pass under it.
  for (let y = vy0; y <= vy1; y++) for (let x = 0; x < w; x++) if (tiles[y][x] !== 'r') set(x, y, 'X');
  // The lane in front of the arches, and a strip of pavement along their faces.
  fill(40, vy1 + 1, 118, vy1 + 5, 'r');
  fill(46, vy1 + 1, 112, vy1 + 1, 'p');

  // The car wash: an open arch, piers either side, the back bricked up.
  fill(WASH.x0 + 1, vy0 + 1, WASH.x1 - 1, vy1, 'p');

  // The grow: one long hall behind a roller shutter, the stockroom in the
  // back corner, the clone room and the grower's bedroom partitioned off
  // along the front, a fire door out to the footpath at the back.
  const { x0: gx0, x1: gx1 } = GROW;
  fill(gx0, vy0, gx1, vy1, '#');
  fill(gx0 + 1, vy0 + 1, gx1 - 1, vy1 - 1, '.');
  // Stockroom partition.
  fill(gx0 + 1, 28, 70, 28, '#');
  fill(70, vy0 + 1, 70, 28, '#');
  // Clone room and bedroom partitions.
  fill(71, 36, gx1 - 1, 36, '#');
  fill(71, 37, 71, vy1 - 1, '#');
  fill(76, 37, 76, vy1 - 1, '#');
  set(74, vy1, 'W');

  const doors: DoorDef[] = [
    { x: 67, y: vy1, locked: true, axis: 'h', name: 'Shutter' },
    { x: 71, y: vy0, locked: true, axis: 'h', name: 'Fire door' },
    { x: 67, y: 28, locked: false, axis: 'h', name: 'Stockroom' },
    { x: 73, y: 36, locked: false, axis: 'h', name: 'Clone room' },
    { x: 79, y: 36, locked: false, axis: 'h', name: 'Bedroom' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  // Small rooms first: the grow's rectangle takes in the whole arch.
  const rooms: Room[] = [
    { id: 'stock', name: 'Stockroom', x0: 65, y0: 23, x1: 69, y1: 27, floor: 'tiles' },
    { id: 'clone', name: 'Clone room', x0: 72, y0: 37, x1: 75, y1: 41, floor: 'tiles' },
    { id: 'bedroom', name: 'Bedroom', x0: 77, y0: 37, x1: 81, y1: 41, floor: 'lino' },
    { id: 'grow', name: 'Grow room', x0: 65, y0: 23, x1: 81, y1: 41, floor: 'tiles' },
  ];

  const props: PropDef[] = [
    // Three tents along the back wall, a fourth on the east wall, ducting over them.
    { kind: 'tent', x: 72, y: 23, w: 3, h: 3, solid: true },
    { kind: 'tent', x: 75, y: 23, w: 3, h: 3, solid: true },
    { kind: 'tent', x: 78, y: 23, w: 3, h: 3, solid: true },
    { kind: 'tent', x: 79, y: 29, w: 3, h: 3, solid: true },
    // Six flood tables of plants under light bars, aisles between.
    { kind: 'flood', x: 65, y: 30, w: 4, h: 1, solid: true },
    { kind: 'flood', x: 65, y: 32, w: 4, h: 1, solid: true },
    { kind: 'flood', x: 65, y: 34, w: 4, h: 1, solid: true },
    { kind: 'flood', x: 72, y: 30, w: 4, h: 1, solid: true },
    { kind: 'flood', x: 72, y: 32, w: 4, h: 1, solid: true },
    { kind: 'flood', x: 72, y: 34, w: 4, h: 1, solid: true },
    // The water tank, and the bagging table by the shutter.
    { kind: 'tank', x: 80, y: 33, w: 2, h: 2, solid: true },
    { kind: 'scales', x: 65, y: 38, w: 2, h: 1, facing: 0, solid: true },
    // Stockroom: a drying rack, supply shelving.
    { kind: 'rack', x: 66, y: 23, w: 2, h: 2, solid: true },
    { kind: 'supply', x: 65, y: 25, w: 1, h: 3, facing: 0, solid: true },
    // Clone room: trays of cuttings on a bench.
    { kind: 'clones', x: 72, y: 39, w: 2, h: 2, solid: true },
    // Bedroom: the grower's bed and the lamp by it.
    { kind: 'growbed', x: 79, y: 38, w: 2, h: 3, facing: Math.PI, solid: true },
    { kind: 'lampside', x: 81, y: 37, w: 1, h: 1, solid: true },
    // The car wash: their car under the arch, a pressure washer, a stack of tyres.
    { kind: 'car', x: 59, y: 30, w: 2, h: 4, facing: Math.PI / 2, solid: true },
    { kind: 'washer', x: 57, y: 38, w: 1, h: 1, solid: true },
    { kind: 'tyres', x: 62, y: 25, w: 1, h: 2, solid: true },
    { kind: 'bigBin', x: 84, y: 44, w: 2, h: 1, solid: true },
    { kind: 'bigBin', x: 51, y: 44, w: 2, h: 1, solid: true },
    // Parked along the lane.
    { kind: 'parked', x: 86, y: 46, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'parked', x: 93, y: 46, w: 4, h: 2, facing: Math.PI, solid: true },
  ];
  const add = (p: PropDef) => props.push(p);
  const free = (x: number, y: number) =>
    tiles[y]?.[x] !== undefined && 'gp'.includes(tiles[y][x]) && !props.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);

  // Lamps along the lane and the footpath; the arches themselves are dark.
  const lampSpots: [number, number][] = [
    [50, 43], [74, 43], [98, 43], [110, 48],
    [44, 19], [62, 19], [84, 19], [100, 19],
    [38, 48], [122, 20], [120, 52], [28, 18],
  ];
  const lamps = lampSpots.map(([x, y]) => {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return { x, y };
  });
  for (const l of lamps) add({ kind: 'lamp', x: l.x, y: l.y, w: 1, h: 1, solid: true });

  const rnd = mulberry32(20261025);
  const trees: [number, number][] = TREES.filter(([x, y]) => tiles[y][x] === 'g' && free(x, y));
  for (let tries = 0; trees.length < 40 && tries < 4000; tries++) {
    const x = 1 + Math.floor(rnd() * (w - 2));
    const y = 1 + Math.floor(rnd() * (h - 2));
    if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => tiles[y + dy][x + dx] === 'g' && free(x + dx, y + dy))) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - y) < 8)) continue;
    trees.push([x, y]);
  }
  for (const [x, y] of trees) add({ kind: 'tree', x, y, w: 1, h: 1, solid: true });
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'product', name: 'Bagged-up by the scales', x: 67.5, y: 39.5, value: 6000, time: 3, heavy: false },
    { id: 'product2', name: 'The drying crop', x: 68.5, y: 25.5, value: 5000, time: 3, heavy: false },
    { id: 'cash', name: 'Takings by the bed', x: 78.5, y: 40.5, value: 4000, time: 2, heavy: false },
    { id: 'bag', name: 'The float in the bedroom', x: 77.5, y: 37.5, value: 9000, time: 4, heavy: true },
    { id: 'product3', name: 'The re-up in the car boot', x: 59.5, y: 29.5, value: 3500, time: 2.5, heavy: false },
  ];

  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // In the arch.
    { id: 'boss', kind: 'dealer', model: 'gang-leader', name: 'Grower', x: 78.5, y: 39.5, facing: Math.PI / 2, patrol: [] },
    { id: 'tender', kind: 'runner', model: 'gang-runner', name: 'Tender', x: 70.5, y: 29.5, facing: Math.PI / 2, patrol: loop([70, 29], [70, 35], [77, 35], [77, 29]) },
    { id: 'guard', kind: 'soldier', model: 'gang-muscle-a', name: 'Guard', x: 68.5, y: 40.5, facing: Math.PI / 2, patrol: [] },
    // The car wash.
    { id: 'washer', kind: 'soldier', model: 'gang-muscle-b', name: 'Washer', x: 60.5, y: 39.5, facing: Math.PI / 2, patrol: [] },
    { id: 'driver', kind: 'dealer', model: 'gang-muscle-a', name: 'Driver', x: 61.5, y: 31.5, facing: Math.PI, patrol: [] },
    { id: 'dog', kind: 'dog', name: 'Dog', x: 57.5, y: 34.5, facing: 0, patrol: loop([57, 34], [57, 26]) },
    // The lane, end to end.
    { id: 'lane', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 90.5, y: 45.5, facing: Math.PI, patrol: loop([90, 45], [48, 45]) },
    { id: 'corner', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 44.5, y: 45.5, facing: 0, patrol: [] },
    // The footpath behind the arches.
    { id: 'path', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 56.5, y: 20.5, facing: 0, patrol: loop([46, 20], [80, 20]) },
  ];

  const lights: LightDef[] = [
    ...lamps.map((l) => ({ kind: 'street' as const, x: l.x + 0.5, y: l.y + 0.5 })),
    { kind: 'ceiling', x: 70.5, y: 31 },
    { kind: 'ceiling', x: 77.5, y: 27 },
    { kind: 'ceiling', x: 67.5, y: 38.5 },
    { kind: 'ceiling', x: 67.5, y: 25.5 },
    { kind: 'ceiling', x: 74, y: 39 },
    { kind: 'ceiling', x: 79, y: 39 },
    { kind: 'car', x: 60, y: 34 },
    { kind: 'van', x: 107, y: 46 },
  ];

  return {
    id: 'elephant',
    name: 'The grow, Elephant arches',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 104.5, y: 44.5 },
      { x: 105.5, y: 44.5 },
      { x: 104.5, y: 46.5 },
      { x: 105.5, y: 46.5 },
    ],
    exit: { x0: 102, y0: 43, x1: 106, y1: 47 },
    van: { x0: 108, y0: 45, x1: 112, y1: 46 },
    unscouted: ['grow'],
    props,
    lights,
    solid,
    // The younger runs for Walworth Road; the gang's backup comes back down the lane.
    gate: { x: 40.5, y: 45.5 },
    backup: { spawn: [{ x: 41.5, y: 44.5 }, { x: 41.5, y: 46.5 }, { x: 42.5, y: 45.5 }], target: { x: 67.5, y: 44.5 }, place: 'Walworth Road' },
    covered: [
      { x0: 0, y0: vy0, x1: w - 1, y1: vy1 },
    ],
    darkness: 0.5,
  };
}
