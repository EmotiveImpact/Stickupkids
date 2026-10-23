// The second job: a gang's cash count by the old lime kiln in Burgess Park,
// Camberwell, at night. The map is a 250 by 155 metre slice of the real
// park, from Albany Road in the north-west to Wells Way in the east: the
// paths, the car park, the adventure playground hut and the BMX track's
// fence come from OpenStreetMap (burgessGround.ts). The gang, their car and
// everything they carry are made up.

import { GROUND, TREES } from './burgessGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type LightDef, type Level, type LootDef, type PropDef, type Room, type Vec } from './level.ts';
import { mulberry32 } from './sim.ts';

/** Where the kiln sits: its north-west corner cell. */
export const KILN = { x: 86, y: 111 };

export function buildBurgessPark(): Level {
  const h = GROUND.length;
  const w = GROUND[0].length;
  const tiles: string[][] = GROUND.map((r) => r.split(''));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  // Kiln cells are given relative to its corner.
  const K = (x: number, y: number): [number, number] => [KILN.x + x, KILN.y + y];

  // The lime kiln (1816, listed): a squat brick octagon, nine metres across,
  // with a solid core and a passage round it under the draw arches.
  fill(...K(0, 0), ...K(8, 8), '#');
  fill(...K(1, 1), ...K(7, 7), '.');
  fill(...K(3, 3), ...K(5, 5), '#');
  for (const [x, y] of [
    [0, 0], [1, 0], [0, 1], [7, 0], [8, 0], [8, 1],
    [0, 7], [0, 8], [1, 8], [8, 7], [7, 8], [8, 8],
  ]) set(...K(x, y), GROUND[KILN.y + y][KILN.x + x]);
  for (const [x, y] of [[1, 1], [7, 1], [1, 7], [7, 7]]) set(...K(x, y), '#');
  // The north arch has lost its gate.
  set(...K(4, 0), 'O');

  const doors: DoorDef[] = [
    { x: KILN.x + 4, y: KILN.y + 8, locked: true, axis: 'h', name: 'South arch gate' },
    { x: KILN.x, y: KILN.y + 4, locked: true, axis: 'v', name: 'West arch gate' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');
  const rooms: Room[] = [{ id: 'kiln', name: 'Kiln arches', x0: KILN.x + 1, y0: KILN.y + 1, x1: KILN.x + 7, y1: KILN.y + 7, floor: 'tiles' }];

  // Gaps in the BMX track's fence: west onto the footpath, east onto Wells
  // Way, south onto the diagonal path.
  for (const [gx, gy] of [[171, 46], [234, 62], [212, 112]]) {
    for (let y = gy - 2; y <= gy + 2; y++) for (let x = gx - 3; x <= gx + 3; x++) {
      if (tiles[y][x] === '=' && Math.hypot(x - gx, y - gy) <= 1.6) set(x, y, 'g');
    }
  }

  const props: PropDef[] = [];
  const add = (p: PropDef) => props.push(p);
  // Free open ground: grass with nothing on it or next to it.
  const taken = (x: number, y: number) => props.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);
  const open = (x: number, y: number, r = 1) => {
    for (let yy = y - r; yy <= y + r; yy++) {
      for (let xx = x - r; xx <= x + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || tiles[yy][xx] !== 'g') return false;
      }
    }
    return true;
  };
  /** The nearest grass cell to a spot that touches a path, for lamps and benches. */
  const verge = (x: number, y: number): Vec => {
    for (let r = 0; r < 6; r++) {
      for (let yy = y - r; yy <= y + r; yy++) {
        for (let xx = x - r; xx <= x + r; xx++) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
          if (tiles[yy]?.[xx] !== 'g' || taken(xx, yy)) continue;
          const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[yy + dy]?.[xx + dx] === 'p' || tiles[yy + dy]?.[xx + dx] === 'r');
          if (touches) return { x: xx, y: yy };
        }
      }
    }
    return { x, y };
  };

  // The count: a picnic table under a lamp just south-east of the kiln.
  add({ kind: 'picnicTable', x: 97, y: 123, w: 2, h: 2 });
  // The gang's car in the adventure playground car park, lights on.
  add({ kind: 'car', x: 86, y: 12, w: 4, h: 2, facing: 0, solid: true });
  // The crew's van on Wells Way, by the end of the canal path.
  const van = { x0: 241, y0: 128, x1: 242, y1: 132 };

  // Park lamps. The canal path and Wells Way are lit all along; the paths
  // across the middle of the park are dark, which is the way in.
  const lampSpots: [number, number][] = [
    // Canal path, west to east.
    [6, 132], [30, 133], [54, 134], [79, 135], [104, 136], [128, 137], [152, 138], [176, 140], [200, 141], [224, 143],
    // Wells Way, west pavement.
    [236, 12], [236, 38], [236, 64], [236, 90], [236, 116], [236, 140],
    // Albany Road.
    [16, 22], [44, 12],
    // The car park, by the hut.
    [97, 5],
    // The cycle path down the west side.
    [60, 30], [60, 70], [60, 108],
  ];
  // The count's lamp stands right by the table, off the path.
  const lamps = [{ x: 100, y: 121 }, ...lampSpots.map(([x, y]) => verge(x, y))];
  for (const l of lamps) add({ kind: 'lamp', x: l.x, y: l.y, w: 1, h: 1, solid: true });

  for (const [x, y, f] of [
    [108, 139, -Math.PI / 2], [66, 139, -Math.PI / 2], [140, 140, -Math.PI / 2], [190, 143, -Math.PI / 2], [76, 131, Math.PI / 2],
  ] as [number, number, number][]) {
    const v = verge(x, y);
    add({ kind: 'bench', x: v.x, y: v.y, w: 2, h: 1, facing: f, solid: true });
  }
  for (const [x, y] of [[84, 133], [150, 136], [58, 22], [234, 100]]) {
    const v = verge(x, y);
    add({ kind: 'bin', x: v.x, y: v.y, w: 1, h: 1, solid: true });
  }

  // Planting beds: on open grass the only cover there is. Some placed for
  // the approaches, the rest scattered.
  const beds: [number, number, number, number][] = [
    [101, 128, 103, 129], [92, 127, 93, 128], [80, 120, 81, 122], [104, 112, 106, 113], [76, 105, 78, 106],
    [94, 100, 96, 101], [110, 124, 111, 126], [86, 20, 87, 21], [80, 28, 82, 29], [94, 24, 95, 26],
    [205, 28, 207, 29], [215, 34, 216, 36], [180, 120, 182, 121], [160, 128, 161, 130], [130, 128, 132, 129],
    [120, 100, 121, 102], [140, 110, 142, 111], [50, 120, 52, 121], [40, 100, 41, 102], [70, 50, 72, 51],
  ];
  const rnd = mulberry32(20261023);
  for (let tries = 0; beds.length < 70 && tries < 4000; tries++) {
    const x = 2 + Math.floor(rnd() * (w - 6));
    const y = 2 + Math.floor(rnd() * (h - 6));
    const bw = 1 + Math.floor(rnd() * 3);
    const bh = 1 + Math.floor(rnd() * 2);
    if (!open(x, y, 2) || !open(x + bw, y + bh, 2) || nearKeep(x, y)) continue;
    if (beds.some(([a, b, c, d]) => x <= c + 4 && x + bw >= a - 4 && y <= d + 4 && y + bh >= b - 4)) continue;
    beds.push([x, y, x + bw, y + bh]);
  }
  for (const [x0, y0, x1, y1] of beds) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tiles[y][x] === 'g') set(x, y, 'b');
  }

  // Trees: the ones on the map, and more scattered over the grass the way
  // the park has them (the mapping is far from complete).
  const trees: [number, number][] = TREES.filter(([x, y]) => tiles[y][x] === 'g');
  for (let tries = 0; trees.length < 320 && tries < 20000; tries++) {
    const x = 1 + Math.floor(rnd() * (w - 2));
    const y = 1 + Math.floor(rnd() * (h - 2));
    if (!open(x, y, 1) || nearKeep(x, y) || taken(x, y)) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - y) < 5.5)) continue;
    trees.push([x, y]);
  }
  for (const [x, y] of trees) add({ kind: 'tree', x, y, w: 1, h: 1, solid: true });
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'The count on the picnic table', x: 97.5, y: 123.5, value: 6000, time: 2.5, heavy: false },
    { id: 'bag', name: 'The float in the kiln', x: KILN.x + 6.5, y: KILN.y + 2.5, value: 15000, time: 4, heavy: true },
    { id: 'product', name: 'The re-up in the car boot', x: 85.5, y: 12.5, value: 4500, time: 2.5, heavy: false },
    { id: 'phones', name: 'A bag of phones at the BMX track', x: 206.5, y: 24.5, value: 3500, time: 2, heavy: false },
  ];

  // Marlowe's lot: eleven of them and a dog, spread over the park.
  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // At the count.
    { id: 'elder', kind: 'dealer', model: 'gang-leader', name: 'Elder', x: 99.5, y: 124.5, facing: Math.PI, patrol: [] },
    { id: 'tally', kind: 'dealer', model: 'gang-muscle-b', name: 'Tally', x: 98.5, y: 121.5, facing: Math.PI * 0.75, patrol: [] },
    // Inside the arches, watching the west passage.
    { id: 'minder', kind: 'soldier', model: 'gang-muscle-a', name: 'Minder', x: KILN.x + 2.5, y: KILN.y + 6.5, facing: -Math.PI / 2, patrol: [] },
    // Round the back of the kiln, north and west.
    {
      id: 'shotter', kind: 'soldier', model: 'gang-muscle-b', name: 'Shotter', x: 96.5, y: 108.5, facing: Math.PI,
      patrol: loop([96, 108], [84, 106], [80, 114], [84, 106]),
    },
    { id: 'younger', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 104.5, y: 128.5, facing: Math.PI, patrol: [] },
    // On the canal path, both ways.
    {
      id: 'eastLookout', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 118.5, y: 137.5, facing: 0,
      patrol: loop([118, 137], [160, 139]),
    },
    { id: 'westLookout', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 64.5, y: 135.5, facing: Math.PI, patrol: [] },
    // Walking the dark path between the car park and the kiln.
    {
      id: 'runnerUp', kind: 'soldier', model: 'gang-muscle-a', name: 'Shotter', x: 76.5, y: 30.5, facing: Math.PI / 2,
      patrol: loop([76, 30], [86, 50], [98, 72], [100, 84], [98, 72], [86, 50]),
    },
    // At the car.
    { id: 'driver', kind: 'soldier', model: 'gang-muscle-a', name: 'Driver', x: 91.5, y: 15.5, facing: Math.PI / 2, patrol: [] },
    { id: 'dog', kind: 'dog', name: 'Dog', x: 88.5, y: 17.5, facing: Math.PI / 2, patrol: loop([88, 17], [81, 9], [95, 9]) },
    // On the BMX track with the phones.
    { id: 'bmxYounger', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 208.5, y: 26.5, facing: Math.PI, patrol: [] },
    {
      id: 'bmxLookout', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 203.5, y: 30.5, facing: Math.PI / 2,
      patrol: loop([203, 30], [204, 70], [214, 96], [217, 60], [214, 30]),
    },
  ];

  const lights: LightDef[] = [
    ...lamps.map((l) => ({ kind: 'street' as const, x: l.x + 0.5, y: l.y + 0.5 })),
    { kind: 'car', x: 90.5, y: 13 },
    { kind: 'van', x: 241.5, y: 127.5 },
  ];

  return {
    id: 'burgess',
    name: 'The count, Burgess Park',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 237.5, y: 128.5 },
      { x: 238.5, y: 129.5 },
      { x: 237.5, y: 130.5 },
      { x: 238.5, y: 131.5 },
    ],
    exit: { x0: 236, y0: 127, x1: 238, y1: 133 },
    van,
    unscouted: ['kiln'],
    props,
    lights,
    solid,
    // The youngers run for Albany Road; their backup comes back the same way.
    gate: { x: 10.5, y: 21.5 },
    backup: { spawn: [{ x: 12.5, y: 16.5 }, { x: 14.5, y: 15.5 }, { x: 16.5, y: 15.5 }], target: { x: 90.5, y: 108.5 }, place: 'Albany Road' },
    covered: [{ x0: KILN.x, y0: KILN.y, x1: KILN.x + 9, y1: KILN.y + 9 }],
    darkness: 0.5,
  };
}

/** Spots kept clear of scattered trees and beds: the kiln, the count, the car, the van and the BMX stash. */
function nearKeep(x: number, y: number): boolean {
  const keep: [number, number, number][] = [
    [KILN.x + 4, KILN.y + 4, 9],
    [98, 123, 6],
    [88, 13, 7],
    [240, 130, 6],
    [206, 25, 6],
  ];
  return keep.some(([kx, ky, r]) => Math.hypot(x - kx, y - ky) < r);
}
