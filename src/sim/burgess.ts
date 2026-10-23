// The second job: a gang's cash count by the old lime kiln in Burgess Park,
// Camberwell, at night. The paths and the kiln's footprint come from
// OpenStreetMap (burgessGround.ts); the gang, their car and everything they
// carry are made up.

import { GROUND, TREES } from './burgessGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type Level, type LootDef, type PropDef, type Room } from './level.ts';

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

  // The lime kiln (1816, listed): a squat brick octagon, nine metres across,
  // with a solid core and a passage round it under the draw arches.
  fill(18, 4, 26, 12, '#');
  fill(19, 5, 25, 11, '.');
  fill(21, 7, 23, 9, '#');
  for (const [x, y] of [
    [18, 4], [19, 4], [18, 5], [25, 4], [26, 4], [26, 5],
    [18, 11], [18, 12], [19, 12], [26, 11], [25, 12], [26, 12],
  ]) set(x, y, GROUND[y][x]);
  for (const [x, y] of [[19, 5], [25, 5], [19, 11], [25, 11]]) set(x, y, '#');
  // The north arch has lost its gate.
  set(22, 4, 'O');

  // Planting beds: the only cover on open grass.
  for (const [x0, y0, x1, y1] of [
    [4, 14, 5, 17],
    [11, 22, 13, 24],
    [13, 15, 14, 16],
    [19, 17, 21, 18],
    [31, 7, 33, 9],
    [6, 24, 8, 25],
    [28, 21, 29, 22],
  ]) fill(x0, y0, x1, y1, 'b');

  const doors: DoorDef[] = [
    { x: 22, y: 12, locked: true, axis: 'h', name: 'South arch gate' },
    { x: 18, y: 8, locked: true, axis: 'v', name: 'West arch gate' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  const rooms: Room[] = [{ id: 'kiln', name: 'Kiln arches', x0: 19, y0: 5, x1: 25, y1: 11, floor: 'tiles' }];

  const trees: [number, number][] = [
    ...TREES,
    [7, 7], [12, 4], [30, 2], [34, 13], [9, 19], [16, 25], [21, 25], [33, 18], [2, 23], [27, 25], [1, 9], [31, 26],
  ];
  const props: PropDef[] = [
    ...trees.map(([x, y]) => ({ kind: 'tree', x, y, w: 1, h: 1, solid: true })),
    // The count: a picnic table under a lamp, the gang's car on the verge.
    { kind: 'picnicTable', x: 28, y: 16, w: 2, h: 2 },
    { kind: 'car', x: 25, y: 13, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'bench', x: 24, y: 27, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'bench', x: 9, y: 27, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'bin', x: 15, y: 28, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 5, y: 28, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 17, y: 28, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 29, y: 28, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 27, y: 19, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 15, y: 2, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 9, y: 11, w: 1, h: 1, solid: true },
  ];
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'The count on the picnic table', x: 28.5, y: 16.5, value: 6000, time: 2.5, heavy: false },
    { id: 'product', name: 'The re-up in the car boot', x: 24.5, y: 13.5, value: 4500, time: 2.5, heavy: false },
    { id: 'bag', name: 'The float in the kiln', x: 24.5, y: 6.5, value: 15000, time: 4, heavy: true },
  ];

  // Marlowe's lot: five of them, no dog.
  const enemies: EnemyDef[] = [
    { id: 'elder', kind: 'dealer', model: 'gang-leader', name: 'Elder', x: 30.5, y: 16.5, facing: (Math.PI * 3) / 4, patrol: [] },
    { id: 'minder', kind: 'soldier', model: 'gang-muscle-a', name: 'Minder', x: 20.5, y: 10.5, facing: 0, patrol: [] },
    {
      id: 'shotter', kind: 'soldier', model: 'gang-muscle-b', name: 'Shotter', x: 17.5, y: 3.5, facing: 0,
      patrol: [
        { x: 17.5, y: 3.5 },
        { x: 23.5, y: 1.5 },
        { x: 27.5, y: 6.5 },
        { x: 27.5, y: 10.5 },
        { x: 23.5, y: 1.5 },
      ],
    },
    {
      id: 'lookout', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 33.5, y: 27.5, facing: Math.PI,
      patrol: [
        { x: 33.5, y: 27.5 },
        { x: 22.5, y: 27.5 },
      ],
    },
    { id: 'younger', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 24.5, y: 26.5, facing: Math.PI / 2, patrol: [] },
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
      { x: 6.5, y: 29.5 },
      { x: 7.5, y: 30.5 },
      { x: 8.5, y: 29.5 },
      { x: 9.5, y: 30.5 },
    ],
    exit: { x0: 0, y0: 28, x1: 4, y1: 29 },
    van: { x0: 0, y0: 30, x1: 4, y1: 31 },
    unscouted: ['kiln'],
    props,
    lights: [
      { kind: 'street', x: 5.5, y: 28.5 },
      { kind: 'street', x: 17.5, y: 28.5 },
      { kind: 'street', x: 29.5, y: 28.5 },
      { kind: 'street', x: 27.5, y: 19.5 },
      { kind: 'street', x: 15.5, y: 2.5 },
      { kind: 'street', x: 9.5, y: 11.5 },
      { kind: 'car', x: 30.5, y: 14 },
      { kind: 'van', x: 2.5, y: 30.5 },
    ],
    solid,
    gate: { x: 35.5, y: 30.5 },
    backup: { spawn: [{ x: 35.5, y: 29.5 }, { x: 35.5, y: 30.5 }], target: { x: 22.5, y: 14.5 }, place: 'the canal path' },
    covered: [{ x0: 18, y0: 4, x1: 27, y1: 13 }],
    darkness: 0.45,
  };
}
