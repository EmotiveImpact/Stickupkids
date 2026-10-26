// The Aylesbury Estate, Walworth: a ground-floor maisonette in one of the
// long deck-access slab blocks off Thurlow Street, used as a stash flat. The
// map is a 140 by 100 metre slice of the real estate turned so the blocks run
// across it: the blocks, the service roads and the paths come from
// OpenStreetMap (aylesburyGround.ts). The flat, the people in it and
// everything they keep are made up.

import { GROUND, TREES } from './aylesburyGround.ts';
import { solidMask, type DoorDef, type EnemyDef, type LightDef, type Level, type LootDef, type PropDef, type Room } from './level.ts';
import { mulberry32 } from './sim.ts';

/** The middle block's ground floor: west and east ends, north and south faces. */
export const BLOCK = { x0: 46, x1: 117, y0: 38, y1: 46 };
/** The stash flat inside it. */
export const FLAT = { x0: 69, x1: 83 };

export function buildAylesbury(): Level {
  const h = GROUND.length;
  const w = GROUND[0].length;
  const tiles: string[][] = GROUND.map((r) => r.split(''));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const { y0: by0, y1: by1 } = BLOCK;

  // A paved walkway runs along the south face of every block, under the deck above.
  for (const [y, x0, x1] of [[47, 46, 117], [18, 29, 116], [77, 46, 117]] as const) {
    for (let x = x0; x <= x1; x++) if (tiles[y][x] === 'g') set(x, y, 'p');
  }

  // The undercroft: a passage through the block west of the flat.
  fill(58, by0, 61, by1, 'p');

  // The stash flat: living room west, hall, kitchen and back bedroom east.
  // Rooms are about 1.2 times a real council maisonette's.
  const { x0: fx0, x1: fx1 } = FLAT;
  fill(fx0, by0, fx1, by1, '#');
  fill(fx0 + 1, by0 + 1, fx1 - 1, by1 - 1, '.');
  fill(74, by0 + 1, 74, by1 - 1, '#');
  fill(77, by0 + 1, 77, by1 - 1, '#');
  fill(78, 42, fx1 - 1, 42, '#');
  for (const [x, y] of [
    [70, by1], [71, by1], [72, by1], [73, by1],
    [79, by1], [80, by1], [81, by1],
    [71, by0], [72, by0], [78, by0], [79, by0],
  ]) set(x, y, 'W');

  // The stair lobby east of the flat: through from the walkway to the back.
  fill(86, by0, 90, by1, '#');
  fill(87, by0 + 1, 89, by1 - 1, '.');

  // The flat's back yard: a fenced square of concrete with a gate onto the service road.
  fill(fx0, 34, fx1, 37, 'p');
  fill(fx0, 34, fx1, 34, '=');
  fill(fx0, 34, fx0, 37, '=');
  fill(fx1, 34, fx1, 37, '=');

  // The bin store: a brick shed on the walkway west of the undercroft.
  fill(48, 48, 53, 50, '#');
  fill(49, 48, 52, 49, '.');

  const doors: DoorDef[] = [
    { x: 75, y: by1, locked: true, axis: 'h', name: 'Front door' },
    { x: 80, y: by0, locked: false, axis: 'h', name: 'Back door' },
    { x: 74, y: 43, locked: false, axis: 'v', name: 'Living room' },
    { x: 77, y: 40, locked: false, axis: 'v', name: 'Kitchen' },
    { x: 77, y: 44, locked: true, axis: 'v', name: 'Back bedroom' },
    { x: 88, y: by1, locked: false, axis: 'h', name: 'Lobby door' },
    { x: 88, y: by0, locked: false, axis: 'h', name: 'Lobby back door' },
    { x: 75, y: 34, locked: false, axis: 'h', name: 'Yard gate' },
    { x: 50, y: 50, locked: true, axis: 'h', name: 'Bin store' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  const rooms: Room[] = [
    { id: 'living', name: 'Living room', x0: 70, y0: 39, x1: 73, y1: 45, floor: 'carpet' },
    { id: 'hall', name: 'Hall', x0: 75, y0: 39, x1: 76, y1: 45, floor: 'boards' },
    { id: 'kitchen', name: 'Kitchen', x0: 78, y0: 39, x1: 82, y1: 41, floor: 'lino' },
    { id: 'stash', name: 'Back bedroom', x0: 78, y0: 43, x1: 82, y1: 45, floor: 'carpet' },
    { id: 'lobby', name: 'Stair lobby', x0: 87, y0: 39, x1: 89, y1: 45, floor: 'lino' },
    { id: 'bins', name: 'Bin store', x0: 49, y0: 48, x1: 52, y1: 49, floor: 'lino' },
  ];

  const props: PropDef[] = [
    // Living room.
    { kind: 'tv', x: 70, y: 40, w: 1, h: 3, facing: 0, solid: true },
    { kind: 'sofa', x: 73, y: 40, w: 1, h: 3, facing: Math.PI, solid: true },
    { kind: 'coffeeTable', x: 71, y: 41, w: 1, h: 1 },
    { kind: 'armchair', x: 72, y: 45, w: 1, h: 1, facing: -Math.PI / 2, solid: true },
    // Kitchen: counters on the north wall, the fridge in the corner, a table.
    { kind: 'counter', x: 79, y: 39, w: 3, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'fridge', x: 82, y: 39, w: 1, h: 1, facing: Math.PI, solid: true },
    { kind: 'table', x: 80, y: 40, w: 2, h: 1 },
    // Back bedroom.
    { kind: 'bed', x: 81, y: 43, w: 2, h: 3, solid: true },
    { kind: 'shelves', x: 78, y: 45, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    // Lobby: the stairs up to the decks.
    { kind: 'stairs', x: 87, y: 40, w: 1, h: 4, solid: true },
    // The yard: bins and a dumped washing machine.
    { kind: 'bins', x: 83, y: 35, w: 1, h: 2, solid: true },
    { kind: 'crate', x: 67, y: 35, w: 1, h: 1, solid: true },
    // Their car on the service road behind the block, the re-up in the boot.
    { kind: 'car', x: 70, y: 31, w: 4, h: 2, facing: 0, solid: true },
    // Parked cars along the service roads.
    { kind: 'parked', x: 50, y: 31, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'parked', x: 92, y: 31, w: 4, h: 2, facing: Math.PI, solid: true },
    { kind: 'parked', x: 104, y: 61, w: 4, h: 2, facing: 0, solid: true },
    { kind: 'parked', x: 60, y: 61, w: 4, h: 2, facing: Math.PI, solid: true },
  ];
  const add = (p: PropDef) => props.push(p);
  const free = (x: number, y: number) =>
    tiles[y]?.[x] === 'g' && !props.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);

  // Estate lamps: on the walkways and the courtyard paths. The courtyard
  // grass between them is dark.
  const lampSpots: [number, number][] = [
    [56, 48], [96, 48], [112, 48], [40, 48],
    [56, 19], [86, 19], [110, 19],
    [64, 78], [100, 78],
    [27, 30], [27, 60], [126, 40], [126, 70], [131, 22], [131, 88],
    [12, 54],
  ];
  const lamps = lampSpots.map(([x, y]) => {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return { x, y };
  });
  for (const l of lamps) add({ kind: 'lamp', x: l.x, y: l.y, w: 1, h: 1, solid: true });

  // Courtyard dressing: benches, bins, a few planters for cover.
  for (const [x, y, f] of [[66, 54, -Math.PI / 2], [96, 56, -Math.PI / 2], [80, 24, Math.PI / 2]] as [number, number, number][]) {
    if (free(x, y) && free(x + 1, y)) add({ kind: 'bench', x, y, w: 2, h: 1, facing: f, solid: true });
  }
  for (const [x0, y0, x1, y1] of [
    [62, 52, 63, 53], [72, 56, 74, 57], [88, 52, 89, 54], [104, 55, 106, 56], [80, 50, 81, 50],
    [56, 24, 57, 26], [70, 22, 72, 23], [98, 24, 99, 25], [112, 26, 113, 28],
    [54, 66, 56, 66], [90, 66, 92, 66], [118, 52, 119, 53],
  ]) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tiles[y][x] === 'g') set(x, y, 'b');
  }
  const rnd = mulberry32(20261024);
  const trees: [number, number][] = TREES.filter(([x, y]) => free(x, y));
  for (let tries = 0; trees.length < 34 && tries < 4000; tries++) {
    const x = 1 + Math.floor(rnd() * (w - 2));
    const y = 1 + Math.floor(rnd() * (h - 2));
    if (!free(x, y) || !free(x + 1, y) || !free(x, y + 1) || !free(x - 1, y) || !free(x, y - 1)) continue;
    if (Math.abs(y - 47) < 3 || Math.abs(y - 18) < 3 || Math.abs(y - 77) < 3) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - y) < 9)) continue;
    trees.push([x, y]);
  }
  for (const [x, y] of trees) add({ kind: 'tree', x, y, w: 1, h: 1, solid: true });
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'Cash on the coffee table', x: 71.5, y: 41.5, value: 4500, time: 2, heavy: false },
    { id: 'product', name: 'The re-up on the kitchen table', x: 80.5, y: 40.5, value: 5000, time: 2.5, heavy: false },
    { id: 'bag', name: 'The stash bag', x: 79.5, y: 44.5, value: 14000, time: 4, heavy: true },
    { id: 'product2', name: 'More in the car boot', x: 69.5, y: 31.5, value: 3500, time: 2.5, heavy: false },
  ];

  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // In the flat.
    { id: 'dealer', kind: 'dealer', model: 'gang-leader', name: 'Landlord', x: 72.5, y: 41.5, facing: Math.PI, patrol: [] },
    { id: 'hall', kind: 'soldier', model: 'gang-muscle-a', name: 'Door', x: 75.5, y: 39.5, facing: -Math.PI / 2, patrol: [] },
    { id: 'cook', kind: 'runner', model: 'gang-runner', name: 'Cook', x: 81.5, y: 41.5, facing: -Math.PI / 2, patrol: [] },
    // The dog in the yard.
    { id: 'dog', kind: 'dog', name: 'Dog', x: 70.5, y: 36.5, facing: 0, patrol: loop([70, 36], [82, 36]) },
    // A lookout in the stair lobby, watching the walkway through the glass.
    { id: 'lobby', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 88.5, y: 44.5, facing: Math.PI / 2, patrol: [] },
    // Walking the south walkway, end to end.
    {
      id: 'walker', kind: 'soldier', model: 'gang-muscle-b', name: 'Shotter', x: 100.5, y: 47.5, facing: Math.PI,
      patrol: loop([100, 47], [54, 47], [59, 43], [59, 36], [59, 43], [54, 47]),
    },
    // In the undercroft, out of the rain.
    { id: 'under', kind: 'runner', model: 'gang-runner', name: 'Younger', x: 60.5, y: 40.5, facing: 0, patrol: [] },
    // At the car behind the block.
    { id: 'driver', kind: 'soldier', model: 'gang-muscle-a', name: 'Driver', x: 75.5, y: 32.5, facing: Math.PI, patrol: [] },
    // The courtyard to the north, between the blocks.
    {
      id: 'north', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 95.5, y: 22.5, facing: Math.PI / 2,
      patrol: loop([95, 22], [68, 22], [62, 28], [68, 22]),
    },
  ];

  const lights: LightDef[] = [
    ...lamps.map((l) => ({ kind: 'street' as const, x: l.x + 0.5, y: l.y + 0.5 })),
    { kind: 'tv', x: 70.7, y: 41.5 },
    { kind: 'fridge', x: 82.4, y: 39.6 },
    { kind: 'ceiling', x: 88.5, y: 42.5 },
    { kind: 'ceiling', x: 75.8, y: 42 },
    { kind: 'car', x: 74, y: 32 },
    { kind: 'van', x: 137, y: 49.5 },
  ];

  return {
    id: 'aylesbury',
    name: 'Stash flat, Aylesbury Estate',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 133.5, y: 50.5 },
      { x: 133.5, y: 51.5 },
      { x: 133.5, y: 52.5 },
      { x: 133.5, y: 53.5 },
    ],
    exit: { x0: 131, y0: 49, x1: 134, y1: 55 },
    van: { x0: 136, y0: 50, x1: 137, y1: 54 },
    unscouted: ['stash'],
    props,
    lights,
    solid,
    // The younger runs for the service road at the west end; backup comes back that way.
    gate: { x: 30.5, y: 31.5 },
    backup: { spawn: [{ x: 29.5, y: 31.5 }, { x: 30.5, y: 32.5 }, { x: 31.5, y: 31.5 }], target: { x: 74.5, y: 48.5 }, place: 'the service road' },
    covered: [
      { x0: BLOCK.x0, y0: 47, x1: BLOCK.x1, y1: 47 },
      { x0: 58, y0: BLOCK.y0, x1: 61, y1: BLOCK.y1 },
      { x0: FLAT.x0, y0: BLOCK.y0, x1: 90, y1: BLOCK.y1 },
      { x0: 48, y0: 48, x1: 53, y1: 50 },
    ],
    darkness: 0.45,
  };
}
