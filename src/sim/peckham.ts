// The multi-storey car park off Rye Lane, Peckham: a handover on the ground
// deck between two cars, one side with the product and the other with the
// money. The map is a 150 by 100 metre slice of the real place: the car park,
// the Peckhamplex beside it, Cerise Road and the path along the railway come
// from OpenStreetMap (peckhamGround.ts). The deck's fittings, the handover and
// everyone at it are made up.

import { GROUND, TREES } from './peckhamGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type LightDef, type Level, type LootDef, type PropDef, type Room } from './level.ts';
import { mulberry32 } from './sim.ts';

/** The car park's ground deck, inside its walls. */
export const DECK = { x0: 102, x1: 146, y0: 32, y1: 58 };

export function buildPeckham(): Level {
  const h = GROUND.length;
  const w = GROUND[0].length;
  const tiles: string[][] = GROUND.map((r) => r.split(''));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };

  // The yard north of the cinema and the car park is all tarmac and paving.
  for (let y = 0; y < 31; y++) for (let x = 30; x < 120; x++) if (tiles[y][x] === 'g') set(x, y, 'p');

  // The deck: concrete walls, open bays in the north and east walls, a column
  // every eight metres across and twelve down, the ramp up in the north-east corner.
  const { x0: dx0, x1: dx1, y0: dy0, y1: dy1 } = DECK;
  fill(dx0 - 1, dy0 - 1, dx1 + 1, dy1 + 1, '#');
  fill(dx0, dy0, dx1, dy1, '.');
  for (let x = dx0 + 12; x <= dx1 - 8; x += 4) set(x, dy0 - 1, 'W');
  for (let y = dy0 + 18; y <= dy1 - 2; y += 3) set(dx1 + 1, y, 'W');
  // The way in for cars off Cerise Road.
  fill(105, dy0 - 1, 109, dy0 - 1, '.');
  for (let y = 23; y < dy0 - 1; y++) for (let x = 104; x <= 110; x++) set(x, y, 'r');
  for (let x = dx0 + 6; x <= dx1 - 8; x += 8) for (let y = dy0 + 7; y <= dy1 - 4; y += 12) set(x, y, '#');
  fill(139, dy0, dx1, 47, 'X');
  // The stair core in the south-west corner and its passage out to the railway path.
  fill(dx0, 52, 108, 52, '#');
  fill(108, 53, 108, dy1, '#');
  fill(104, dy1 + 2, 106, 63, 'p');

  const doors: DoorDef[] = [
    { x: 105, y: 52, locked: false, axis: 'h', name: 'Stairs' },
    { x: 105, y: dy1 + 1, locked: true, axis: 'h', name: 'Stair door' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  const rooms: Room[] = [
    { id: 'deck', name: 'Ground deck', x0: dx0, y0: dy0, x1: 138, y1: 51, floor: 'tiles' },
    { id: 'deck2', name: 'Ground deck', x0: 109, y0: 52, x1: dx1, y1: dy1, floor: 'tiles' },
    { id: 'deck3', name: 'Foot of the ramp', x0: 139, y0: 48, x1: dx1, y1: 51, floor: 'tiles' },
    { id: 'stairs', name: 'Stair core', x0: dx0, y0: 53, x1: 107, y1: dy1, floor: 'tiles' },
  ];

  const props: PropDef[] = [
    // The handover: the seller's car facing east, the buyer's facing west.
    { kind: 'car', x: 116, y: 44, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'car', x: 127, y: 44, w: 4, h: 2, facing: Math.PI, solid: true },
    // Cars left on the deck overnight, nose in against the walls.
    { kind: 'parked', x: 112, y: 32, w: 2, h: 4, facing: -Math.PI / 2, solid: true },
    { kind: 'parked', x: 120, y: 32, w: 2, h: 4, facing: -Math.PI / 2, solid: true },
    { kind: 'parked', x: 132, y: 32, w: 2, h: 4, facing: -Math.PI / 2, solid: true },
    { kind: 'parked', x: 116, y: 55, w: 2, h: 4, facing: Math.PI / 2, solid: true },
    { kind: 'parked', x: 128, y: 55, w: 2, h: 4, facing: Math.PI / 2, solid: true },
    { kind: 'parked', x: 140, y: 55, w: 2, h: 4, facing: Math.PI / 2, solid: true },
    { kind: 'stairs', x: dx0, y: 53, w: 2, h: 6, solid: true },
    { kind: 'bigBin', x: 110, y: 26, w: 2, h: 1, solid: true },
    { kind: 'parked', x: 80, y: 20, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'parked', x: 92, y: 22, w: 4, h: 2, facing: Math.PI, solid: true },
  ];
  const add = (p: PropDef) => props.push(p);
  const free = (x: number, y: number) =>
    tiles[y]?.[x] !== undefined && 'gp'.includes(tiles[y][x]) && !props.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);

  const lampSpots: [number, number][] = [
    [58, 4], [58, 16], [76, 18], [96, 18], [112, 22],
    [40, 30], [30, 60], [60, 72], [96, 66], [130, 63], [148, 60],
    [22, 52], [22, 72],
  ];
  const lamps = lampSpots.map(([x, y]) => {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return { x, y };
  });
  for (const l of lamps) add({ kind: 'lamp', x: l.x, y: l.y, w: 1, h: 1, solid: true });

  const rnd = mulberry32(20261027);
  const trees: [number, number][] = TREES.filter(([x, y]) => tiles[y][x] === 'g' && free(x, y));
  for (let tries = 0; trees.length < 34 && tries < 4000; tries++) {
    const x = 1 + Math.floor(rnd() * (w - 2));
    const y = 1 + Math.floor(rnd() * (h - 2));
    if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => tiles[y + dy][x + dx] === 'g' && free(x + dx, y + dy))) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - y) < 8)) continue;
    trees.push([x, y]);
  }
  for (const [x, y] of trees) add({ kind: 'tree', x, y, w: 1, h: 1, solid: true });
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'product', name: "The seller's boot", x: 115.5, y: 44.5, value: 7000, time: 3, heavy: false },
    { id: 'product2', name: 'The sample on the bonnet', x: 120.5, y: 46.5, value: 3000, time: 2, heavy: false },
    { id: 'bag', name: "The buyer's money", x: 126.5, y: 46.5, value: 12000, time: 3.5, heavy: true },
    { id: 'cash', name: "The buyer's car", x: 131.5, y: 44.5, value: 3000, time: 2, heavy: false },
  ];

  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // The handover, face to face between the cars.
    { id: 'seller', kind: 'dealer', model: 'gang-leader', name: 'Seller', x: 122.5, y: 46.5, facing: 0, patrol: [] },
    { id: 'sellerMuscle', kind: 'soldier', model: 'gang-muscle-a', name: 'Muscle', x: 118.5, y: 47.5, facing: Math.PI / 2, patrol: [] },
    { id: 'buyer', kind: 'dealer', model: 'gang-leader', name: 'Buyer', x: 125.5, y: 46.5, facing: Math.PI, patrol: [] },
    { id: 'buyerMuscle', kind: 'soldier', model: 'gang-muscle-b', name: 'Muscle', x: 132.5, y: 47.5, facing: Math.PI / 2, patrol: [] },
    // On the ramp, watching the deck, and at the way in.
    { id: 'ramp', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 137.5, y: 49.5, facing: Math.PI, patrol: [] },
    { id: 'entrance', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 107.5, y: 29.5, facing: -Math.PI / 3, patrol: [] },
    // The yard, and a younger on the railway path by the stair door.
    { id: 'yard', kind: 'soldier', model: 'gang-muscle-a', name: 'Shotter', x: 70.5, y: 22.5, facing: 0, patrol: loop([70, 22], [86, 22], [70, 22], [56, 26]) },
    { id: 'path', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 104.5, y: 65.5, facing: Math.PI, patrol: [] },
  ];

  const lights: LightDef[] = [
    ...lamps.map((l) => ({ kind: 'street' as const, x: l.x + 0.5, y: l.y + 0.5 })),
    { kind: 'ceiling', x: 114, y: 40 },
    { kind: 'ceiling', x: 126, y: 40 },
    { kind: 'ceiling', x: 114, y: 52 },
    { kind: 'ceiling', x: 130, y: 52 },
    { kind: 'ceiling', x: 105, y: 55 },
    { kind: 'car', x: 120, y: 45 },
    { kind: 'car', x: 127, y: 45 },
    { kind: 'van', x: 53.5, y: 2 },
  ];

  return {
    id: 'peckham',
    name: 'The handover, Rye Lane car park',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 51.5, y: 8.5 },
      { x: 52.5, y: 8.5 },
      { x: 51.5, y: 9.5 },
      { x: 52.5, y: 9.5 },
    ],
    exit: { x0: 50, y0: 7, x1: 55, y1: 11 },
    van: { x0: 53, y0: 2, x1: 54, y1: 6 },
    unscouted: [],
    props,
    lights,
    solid,
    // The younger runs for Rye Lane; their backup comes back along the railway path.
    gate: { x: 20.5, y: 79.5 },
    backup: { spawn: [{ x: 19.5, y: 79.5 }, { x: 21.5, y: 79.5 }, { x: 20.5, y: 78.5 }], target: { x: 105.5, y: 64.5 }, place: 'Rye Lane' },
    covered: [{ x0: dx0 - 1, y0: dy0 - 1, x1: dx1 + 1, y1: dy1 + 1 }],
    darkness: 0.5,
  };
}
