// Electric Avenue, Brixton: a shop unit on the avenue used as a trap, backing
// onto the covered market at Market Row. The map is a 150 by 100 metre slice
// of the real place: the avenue, the market blocks, Atlantic Road, Coldharbour
// Lane and the service road behind Connaught Mansions come from OpenStreetMap
// (brixtonGround.ts). The shop, the people in it and what they keep are made up.

import { GROUND, TREES } from './brixtonGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type LightDef, type Level, type LootDef, type PropDef, type Room } from './level.ts';
import { mulberry32 } from './sim.ts';

/** The trap: the shop unit on the south side of the avenue. */
export const SHOP = { x0: 18, x1: 30, y0: 37, y1: 49 };
/** Market Row: the arm from Electric Lane and the arm from the avenue to Coldharbour Lane. */
export const ROW_EW = { x0: 6, x1: 58, y0: 50, y1: 53 };
export const ROW_NS = { x0: 55, x1: 58, y0: 42, y1: 85 };

export function buildBrixton(): Level {
  const h = GROUND.length;
  const w = GROUND[0].length;
  // Nothing grows here: every open cell is paving.
  const tiles: string[][] = GROUND.map((r) => r.replace(/g/g, 'p').split(''));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };

  // Market Row, cut through the market blocks, gated at every end for the night.
  fill(ROW_EW.x0, ROW_EW.y0, ROW_EW.x1, ROW_EW.y1, '.');
  fill(ROW_NS.x0, ROW_NS.y0, ROW_NS.x1, ROW_NS.y1, '.');
  fill(ROW_EW.x0 - 1, ROW_EW.y0, ROW_EW.x0 - 1, ROW_EW.y1, '#');
  fill(ROW_NS.x0, ROW_NS.y0 - 1, ROW_NS.x1, ROW_NS.y0 - 1, '#');
  fill(ROW_NS.x0, ROW_NS.y1 + 1, ROW_NS.x1, ROW_NS.y1 + 1, '#');

  // A back passage from Market Row out to the service road, past the bins.
  fill(60, 62, 73, 63, '.');

  // The shop: the counter at the front, a stock room and the back room behind.
  const { x0: sx0, x1: sx1, y0: sy0, y1: sy1 } = SHOP;
  fill(sx0, sy0, sx1, sy1, '#');
  fill(sx0 + 1, sy0 + 1, sx1 - 1, sy1 - 1, '.');
  fill(sx0 + 1, 43, sx1 - 1, 43, '#');
  fill(24, 44, 24, sy1 - 1, '#');
  for (const x of [20, 21, 27, 28]) set(x, sy0, 'W');

  const doors: DoorDef[] = [
    { x: 24, y: sy0, locked: true, axis: 'h', name: 'Shutter' },
    { x: 21, y: 43, locked: false, axis: 'h', name: 'Stock room' },
    { x: 27, y: 43, locked: true, axis: 'h', name: 'Back room' },
    { x: 24, y: 46, locked: false, axis: 'v', name: 'Back room side' },
    { x: 21, y: sy1, locked: false, axis: 'h', name: 'Back door' },
    { x: ROW_EW.x0 - 1, y: 51, locked: true, axis: 'v', name: 'Market gate, Electric Lane' },
    { x: 56, y: ROW_NS.y0 - 1, locked: false, axis: 'h', name: 'Market gate, Electric Avenue' },
    { x: 56, y: ROW_NS.y1 + 1, locked: true, axis: 'h', name: 'Market gate, Coldharbour Lane' },
    { x: 59, y: 62, locked: true, axis: 'v', name: 'Fire exit' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  const rooms: Room[] = [
    { id: 'shop', name: 'Shop', x0: 19, y0: 38, x1: 29, y1: 42, floor: 'lino' },
    { id: 'stock', name: 'Stock room', x0: 19, y0: 44, x1: 23, y1: 48, floor: 'boards' },
    { id: 'back', name: 'Back room', x0: 25, y0: 44, x1: 29, y1: 48, floor: 'boards' },
    { id: 'row', name: 'Market Row', x0: ROW_EW.x0, y0: ROW_EW.y0, x1: ROW_EW.x1, y1: ROW_EW.y1, floor: 'tiles' },
    { id: 'row2', name: 'Market Row', x0: ROW_NS.x0, y0: ROW_NS.y0, x1: ROW_NS.x1, y1: ROW_NS.y1, floor: 'tiles' },
    { id: 'passage', name: 'Back passage', x0: 60, y0: 62, x1: 73, y1: 63, floor: 'lino' },
  ];

  const props: PropDef[] = [
    // The shop: a counter with the till, shelves of phone cases and a fridge of drinks.
    { kind: 'counter', x: 20, y: 40, w: 3, h: 1, facing: -Math.PI / 2, solid: true },
    { kind: 'shelves', x: 29, y: 38, w: 1, h: 3, facing: Math.PI, solid: true },
    { kind: 'fridge', x: 19, y: 38, w: 1, h: 1, facing: 0, solid: true },
    // Stock room: boxes and the bagging table.
    { kind: 'table', x: 20, y: 45, w: 2, h: 1, solid: true },
    { kind: 'crate', x: 23, y: 48, w: 1, h: 1, solid: true },
    { kind: 'shelves', x: 19, y: 48, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    // The back room: a telly on the end wall, a sofa and the safe in the corner.
    { kind: 'tv', x: 29, y: 44, w: 1, h: 2, facing: Math.PI, solid: true },
    { kind: 'sofa', x: 26, y: 48, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    // Market Row: shuttered stalls leave crates and bins out overnight.
    { kind: 'crate', x: 12, y: 50, w: 1, h: 1, solid: true },
    { kind: 'crate', x: 31, y: 53, w: 2, h: 1, solid: true },
    { kind: 'bins', x: 44, y: 50, w: 2, h: 1, solid: true },
    { kind: 'crate', x: 55, y: 60, w: 1, h: 2, solid: true },
    { kind: 'crate', x: 58, y: 71, w: 1, h: 1, solid: true },
    { kind: 'bins', x: 55, y: 79, w: 1, h: 2, solid: true },
    // The passage and the service road.
    { kind: 'bigBin', x: 66, y: 62, w: 2, h: 1, solid: true },
    { kind: 'car', x: 90, y: 61, w: 4, h: 2, facing: Math.PI, solid: true },
    { kind: 'parked', x: 82, y: 64, w: 4, h: 2, facing: 0, solid: true },
    // Parked along Coldharbour Lane and Atlantic Road.
    { kind: 'parked', x: 70, y: 87, w: 4, h: 2, facing: Math.PI, solid: true },
    { kind: 'parked', x: 104, y: 81, w: 4, h: 2, facing: Math.PI, solid: true },
  ];
  const add = (p: PropDef) => props.push(p);
  const free = (x: number, y: number) =>
    tiles[y]?.[x] === 'p' && !props.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);

  // Lamps on the avenue, Electric Lane, Atlantic Road and Coldharbour Lane.
  const lampSpots: [number, number][] = [
    [10, 35], [34, 34], [48, 26], [60, 12],
    [3, 45], [3, 60],
    [62, 39], [76, 38],
    [96, 14], [112, 34], [124, 46],
    [48, 88], [80, 82], [118, 74], [136, 66],
    [100, 60], [76, 60],
  ];
  const lamps = lampSpots.map(([x, y]) => {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return { x, y };
  });
  for (const l of lamps) add({ kind: 'lamp', x: l.x, y: l.y, w: 1, h: 1, solid: true });

  const rnd = mulberry32(20261026);
  const trees: [number, number][] = TREES.filter(([x, y]) => free(x, y));
  for (let tries = 0; trees.length < 8 && tries < 4000; tries++) {
    const x = 1 + Math.floor(rnd() * (w - 2));
    const y = 1 + Math.floor(rnd() * (h - 2));
    if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => free(x + dx, y + dy))) continue;
    if (y > 20 && y < 40 && x < 50) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - y) < 10)) continue;
    trees.push([x, y]);
  }
  for (const [x, y] of trees) add({ kind: 'tree', x, y, w: 1, h: 1, solid: true });
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'The till', x: 21.5, y: 39.5, value: 3000, time: 2, heavy: false },
    { id: 'product', name: 'Bagged up on the stock room table', x: 21.5, y: 46.5, value: 6000, time: 3, heavy: false },
    { id: 'cash2', name: 'The count by the sofa', x: 25.5, y: 47.5, value: 4500, time: 2, heavy: false },
    { id: 'bag', name: 'The safe in the back room', x: 28.5, y: 47.5, value: 11000, time: 4, heavy: true },
    { id: 'product2', name: 'The re-up in the car boot', x: 94.5, y: 61.5, value: 4000, time: 2.5, heavy: false },
  ];

  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // In the shop.
    { id: 'boss', kind: 'dealer', model: 'gang-leader', name: 'Shopkeeper', x: 27.5, y: 45.5, facing: 0, patrol: [] },
    { id: 'counter', kind: 'soldier', model: 'gang-muscle-a', name: 'Counter', x: 24.5, y: 39.5, facing: -Math.PI / 2, patrol: [] },
    { id: 'bagger', kind: 'runner', model: 'gang-runner', name: 'Bagger', x: 22.5, y: 45.5, facing: Math.PI, patrol: [] },
    // Walking Market Row, the long way round.
    {
      id: 'row', kind: 'soldier', model: 'gang-muscle-b', name: 'Shotter', x: 40.5, y: 51.5, facing: 0,
      patrol: loop([40, 51], [56, 51], [56, 66], [56, 51], [12, 51]),
    },
    // Inside the avenue gate, watching the avenue.
    { id: 'gate', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 57.5, y: 43.5, facing: -Math.PI / 2, patrol: [] },
    // The avenue itself.
    { id: 'avenue', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 30.5, y: 31.5, facing: Math.PI, patrol: loop([30, 31], [8, 31], [44, 28]) },
    { id: 'corner', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 12.5, y: 34.5, facing: -Math.PI / 2, patrol: [] },
    // At the car on the service road, with the dog.
    { id: 'driver', kind: 'soldier', model: 'gang-muscle-a', name: 'Driver', x: 92.5, y: 63.5, facing: Math.PI, patrol: [] },
    { id: 'dog', kind: 'dog', name: 'Dog', x: 80.5, y: 61.5, facing: 0, patrol: loop([76, 61], [100, 61]) },
  ];

  const lights: LightDef[] = [
    ...lamps.map((l) => ({ kind: 'street' as const, x: l.x + 0.5, y: l.y + 0.5 })),
    { kind: 'ceiling', x: 24.5, y: 40.5 },
    { kind: 'ceiling', x: 27, y: 46 },
    { kind: 'fridge', x: 19.6, y: 38.6 },
    { kind: 'tv', x: 28.6, y: 45 },
    { kind: 'ceiling', x: 20, y: 52 },
    { kind: 'ceiling', x: 46, y: 52 },
    { kind: 'ceiling', x: 57, y: 56 },
    { kind: 'ceiling', x: 57, y: 76 },
    { kind: 'car', x: 89, y: 62 },
    { kind: 'van', x: 133, y: 73.5 },
  ];

  return {
    id: 'brixton',
    name: 'The trap, Electric Avenue',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 127.5, y: 73.5 },
      { x: 127.5, y: 74.5 },
      { x: 127.5, y: 75.5 },
      { x: 128.5, y: 76.5 },
    ],
    exit: { x0: 125, y0: 72, x1: 129, y1: 77 },
    van: { x0: 131, y0: 73, x1: 135, y1: 74 },
    unscouted: ['back'],
    props,
    lights,
    solid,
    // The younger runs for Brixton Road; the backup comes down the avenue.
    gate: { x: 2.5, y: 28.5 },
    backup: { spawn: [{ x: 1.5, y: 27.5 }, { x: 1.5, y: 29.5 }, { x: 2.5, y: 30.5 }], target: { x: 24.5, y: 35.5 }, place: 'Brixton Road' },
    covered: [
      { x0: SHOP.x0, y0: SHOP.y0, x1: SHOP.x1, y1: SHOP.y1 },
      { x0: ROW_EW.x0 - 1, y0: ROW_EW.y0, x1: ROW_EW.x1, y1: ROW_EW.y1 },
      { x0: ROW_NS.x0, y0: ROW_NS.y0 - 1, x1: ROW_NS.x1, y1: ROW_NS.y1 + 1 },
      { x0: 60, y0: 62, x1: 73, y1: 63 },
    ],
    darkness: 0.45,
  };
}
