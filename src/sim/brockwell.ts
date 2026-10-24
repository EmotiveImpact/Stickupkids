// Brockwell Lido, Herne Hill: a pickup at night, after the pool has shut.
// The café on the north wall is the shop window, the plant room in the south
// wing is the stash, and the pool lights stay on. The map is a 150 by 100
// metre slice of the north edge of Brockwell Park turned so the pool runs
// across it: the lido's walls and wings, the car park and the park paths come
// from OpenStreetMap (brockwellGround.ts). Everything inside the walls at
// night, and everyone there, is made up.

import { GROUND, TREES } from './brockwellGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type LightDef, type Level, type LootDef, type PropDef, type Room } from './level.ts';
import { mulberry32 } from './sim.ts';

/** The pool, the deck round it, the café and the plant room. */
export const POOL = { x0: 42, x1: 91, y0: 34, y1: 56 };
export const DECK = { x0: 32, x1: 101, y0: 28, y1: 65 };
export const CAFE = { x0: 58, x1: 72, y0: 18, y1: 27 };
export const PLANT = { x0: 58, x1: 72, y0: 72, y1: 78 };

export function buildBrockwell(): Level {
  const h = GROUND.length;
  const w = GROUND[0].length;
  const tiles: string[][] = GROUND.map((r) => r.split(''));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };

  // The deck round the pool, and the pool.
  for (let y = DECK.y0; y <= DECK.y1; y++) for (let x = DECK.x0; x <= DECK.x1; x++) if ('g='.includes(tiles[y][x])) set(x, y, 'p');
  fill(POOL.x0, POOL.y0, POOL.x1, POOL.y1, 'w');
  // The café terrace in front of it.
  for (let y = 24; y < DECK.y0; y++) for (let x = 55; x <= 76; x++) if ('g='.includes(tiles[y][x])) set(x, y, 'p');

  // The café: the counter and seats west, the store east, a back door onto the park.
  fill(CAFE.x0, CAFE.y0, CAFE.x1, CAFE.y1, '#');
  fill(CAFE.x0 + 1, CAFE.y0 + 1, CAFE.x1 - 1, CAFE.y1 - 1, '.');
  fill(68, CAFE.y0 + 1, 68, CAFE.y1 - 1, '#');
  for (const x of [60, 61, 62, 66, 67]) set(x, CAFE.y1, 'W');

  // The plant room in the south wing, behind a steel door off the deck.
  fill(PLANT.x0, PLANT.y0, PLANT.x1, PLANT.y1, '#');
  fill(PLANT.x0 + 1, PLANT.y0 + 1, PLANT.x1 - 1, PLANT.y1 - 1, '.');
  for (let x = PLANT.x0; x <= PLANT.x1; x++) if (tiles[PLANT.y0 - 1][x] !== 'p') set(x, PLANT.y0 - 1, 'p');

  // The way in from the car park, and the café's back door onto the park.
  set(111, 30, 'p');
  const doors: DoorDef[] = [
    { x: 110, y: 30, locked: true, axis: 'v', name: 'Car park gate' },
    { x: 40, y: 19, locked: true, axis: 'h', name: 'Park gate' },
    { x: 64, y: CAFE.y1, locked: false, axis: 'h', name: 'Café doors' },
    { x: 68, y: 22, locked: false, axis: 'v', name: 'Café store' },
    { x: 62, y: CAFE.y0, locked: true, axis: 'h', name: 'Café back door' },
    { x: 65, y: PLANT.y0, locked: true, axis: 'h', name: 'Plant room' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  const rooms: Room[] = [
    { id: 'cafe', name: 'Café', x0: 59, y0: 19, x1: 67, y1: 26, floor: 'tiles' },
    { id: 'store', name: 'Café store', x0: 69, y0: 19, x1: 71, y1: 26, floor: 'lino' },
    { id: 'plant', name: 'Plant room', x0: 59, y0: 73, x1: 71, y1: 77, floor: 'lino' },
  ];

  const props: PropDef[] = [
    // The café: the counter along the back, a fridge, tables.
    { kind: 'counter', x: 60, y: 20, w: 4, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'fridge', x: 59, y: 19, w: 1, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'table', x: 60, y: 24, w: 2, h: 1 },
    { kind: 'table', x: 65, y: 24, w: 2, h: 1 },
    // The store: shelves of stock.
    { kind: 'shelves', x: 71, y: 19, w: 1, h: 3, facing: Math.PI, solid: true },
    { kind: 'crate', x: 69, y: 26, w: 1, h: 1, solid: true },
    // Sunbeds along the north side of the pool, stacked for the night.
    { kind: 'bench', x: 46, y: 30, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'bench', x: 54, y: 30, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'bench', x: 78, y: 30, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'bench', x: 86, y: 30, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'bench', x: 50, y: 61, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    { kind: 'bench', x: 80, y: 61, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    // The plant room: the filter tanks and the chemicals.
    { kind: 'bins', x: 59, y: 73, w: 2, h: 2, solid: true },
    { kind: 'shelves', x: 71, y: 73, w: 1, h: 3, facing: Math.PI, solid: true },
    { kind: 'crate', x: 67, y: 77, w: 2, h: 1, solid: true },
    // Their car in the car park, and other cars.
    { kind: 'car', x: 124, y: 40, w: 4, h: 2, facing: Math.PI, solid: true },
    { kind: 'parked', x: 124, y: 22, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'parked', x: 132, y: 30, w: 4, h: 2, facing: Math.PI, solid: true },
  ];
  const add = (p: PropDef) => props.push(p);
  const free = (x: number, y: number) =>
    tiles[y]?.[x] !== undefined && 'gp'.includes(tiles[y][x]) && !props.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);

  // Lamps on the park paths and in the car park; the deck has the pool lights.
  const lampSpots: [number, number][] = [
    [20, 16], [50, 16], [84, 16], [108, 20], [114, 44], [116, 64],
    [120, 16], [140, 30], [118, 90], [18, 50], [18, 80], [60, 96], [100, 96],
  ];
  const lamps = lampSpots.map(([x, y]) => {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return { x, y };
  });
  for (const l of lamps) add({ kind: 'lamp', x: l.x, y: l.y, w: 1, h: 1, solid: true });

  const rnd = mulberry32(20261028);
  const trees: [number, number][] = TREES.filter(([x, y]) => tiles[y][x] === 'g' && free(x, y));
  for (let tries = 0; trees.length < 46 && tries < 6000; tries++) {
    const x = 1 + Math.floor(rnd() * (w - 2));
    const y = 1 + Math.floor(rnd() * (h - 2));
    if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => tiles[y + dy][x + dx] === 'g' && free(x + dx, y + dy))) continue;
    // Not on the lido's lawns.
    if (x > 20 && x < 112 && y > 18 && y < 74) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - y) < 8)) continue;
    trees.push([x, y]);
  }
  for (const [x, y] of trees) add({ kind: 'tree', x, y, w: 1, h: 1, solid: true });
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'The café till', x: 62.5, y: 21.5, value: 3000, time: 2, heavy: false },
    { id: 'product', name: 'Bagged up in the café store', x: 70.5, y: 24.5, value: 7000, time: 3, heavy: false },
    { id: 'bag', name: 'The stash in the plant room', x: 64.5, y: 75.5, value: 12000, time: 4, heavy: true },
    { id: 'product2', name: 'The re-up in the car boot', x: 128.5, y: 40.5, value: 4000, time: 2.5, heavy: false },
  ];

  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // In the café, the manager at the counter with his back to the doors.
    { id: 'boss', kind: 'dealer', model: 'gang-leader', name: 'Manager', x: 63.5, y: 22.5, facing: -Math.PI / 2, patrol: [] },
    { id: 'bagger', kind: 'runner', model: 'gang-runner', name: 'Bagger', x: 70.5, y: 25.5, facing: Math.PI / 2, patrol: [] },
    // Sat by the pool, and walking the deck the long way round.
    { id: 'pool', kind: 'soldier', model: 'gang-muscle-a', name: 'Shotter', x: 52.5, y: 31.5, facing: Math.PI / 2, patrol: [] },
    {
      id: 'deck', kind: 'soldier', model: 'gang-muscle-b', name: 'Shotter', x: 96.5, y: 60.5, facing: Math.PI, patrol: loop([96, 60], [36, 60], [36, 31], [96, 31]),
    },
    // Minding the plant room door.
    { id: 'plant', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 65.5, y: 69.5, facing: -Math.PI / 2, patrol: [] },
    // Their driver in the car park, and a younger on the park path by the north gate.
    { id: 'driver', kind: 'soldier', model: 'gang-muscle-a', name: 'Driver', x: 123.5, y: 42.5, facing: Math.PI, patrol: [] },
    { id: 'younger', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 36.5, y: 16.5, facing: 0, patrol: loop([30, 16], [56, 16]) },
    { id: 'dog', kind: 'dog', name: 'Dog', x: 80.5, y: 6.5, facing: 0, patrol: loop([70, 6], [100, 6]) },
  ];

  const lights: LightDef[] = [
    ...lamps.map((l) => ({ kind: 'street' as const, x: l.x + 0.5, y: l.y + 0.5 })),
    { kind: 'ceiling', x: 63, y: 23 },
    { kind: 'ceiling', x: 70, y: 23 },
    { kind: 'fridge', x: 59.6, y: 19.6 },
    { kind: 'ceiling', x: 65, y: 75 },
    { kind: 'car', x: 124, y: 41 },
    { kind: 'van', x: 140, y: 16.5 },
  ];

  return {
    id: 'brockwell',
    name: 'The pickup, Brockwell Lido',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 134.5, y: 15.5 },
      { x: 134.5, y: 16.5 },
      { x: 135.5, y: 15.5 },
      { x: 135.5, y: 16.5 },
    ],
    exit: { x0: 132, y0: 14, x1: 136, y1: 18 },
    van: { x0: 138, y0: 16, x1: 142, y1: 17 },
    unscouted: ['plant'],
    props,
    lights,
    solid,
    // The younger runs for Dulwich Road; backup comes in by the park gate.
    gate: { x: 2.5, y: 0.5 },
    backup: { spawn: [{ x: 1.5, y: 0.5 }, { x: 3.5, y: 0.5 }, { x: 2.5, y: 1.5 }], target: { x: 40.5, y: 22.5 }, place: 'Dulwich Road' },
    covered: [
      { x0: CAFE.x0, y0: CAFE.y0, x1: CAFE.x1, y1: CAFE.y1 },
      { x0: PLANT.x0, y0: PLANT.y0, x1: PLANT.x1, y1: PLANT.y1 },
    ],
    darkness: 0.55,
  };
}
