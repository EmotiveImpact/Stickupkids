// Level data: the types every job shares, and the first job, a mid-terrace
// on a British estate. Pure data, no engine code, so any renderer can draw it.
//
// Grid cells are one world unit. x runs west to east, y runs north to south.
// Tile codes:
//   p pavement / path     r road          g grass / garden
//   . indoor floor        # wall          X neighbouring house (solid)
//   W window (blocks movement, not sight) = low wall or fence (same)
//   D door                O open doorway
//   w water (blocks movement, not sight)  b shrubs (block both)

export type Vec = { x: number; y: number };
export type DoorState = 'closed' | 'open' | 'locked' | 'broken';
export type GoCode = 'A' | 'B' | 'C';

export interface DoorDef {
  x: number;
  y: number;
  locked: boolean;
  /** 'h' when the door sits in a wall running west to east. */
  axis: 'h' | 'v';
  name: string;
}

export interface LootDef {
  id: string;
  name: string;
  x: number;
  y: number;
  value: number;
  /** Seconds to bag it. */
  time: number;
  /** Heavy loot slows the carrier. */
  heavy: boolean;
}

export type EnemyKind = 'dealer' | 'soldier' | 'runner' | 'dog' | 'civilian';

/**
 * How someone behaves once they clock the crew.
 * - guard: shouts for the others and hunts the crew down.
 * - muscle: hard to scare, holds his post and fights from there.
 * - boss: talks before he shoots; only the Talker can talk him down, and his men stand down with him.
 * - nervous: gives up easily, but if he sees you first he grabs the nearest stash and runs.
 * - runner: runs for help, shouting the place up, and brings the backup sooner.
 * - dog: charges, and its barking brings everyone near.
 * - nosy: a civilian. Rings 999 unless someone gets to them first. Never armed, never a target.
 */
export type Persona = 'guard' | 'muscle' | 'boss' | 'nervous' | 'runner' | 'dog' | 'nosy';

/** The persona each kind has unless its EnemyDef says otherwise. */
export const DEFAULT_PERSONA: Record<EnemyKind, Persona> = {
  dealer: 'nervous',
  soldier: 'guard',
  runner: 'runner',
  dog: 'dog',
  civilian: 'nosy',
};

export interface EnemyDef {
  id: string;
  kind: EnemyKind;
  name: string;
  x: number;
  y: number;
  /** Radians, 0 = east, PI/2 = south (y grows southwards). */
  facing: number;
  patrol: Vec[];
  /** Character model, when this one has their own (defaults to the kind's). */
  model?: string;
  /** Behaviour, when it differs from the kind's default. */
  persona?: Persona;
}

export interface PropDef {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians the prop faces, same convention as EnemyDef.facing. */
  facing?: number;
  solid?: boolean;
}

export interface LightDef {
  kind: 'street' | 'tv' | 'fridge' | 'van' | 'ceiling' | 'car';
  x: number;
  y: number;
}

export interface Room {
  id: string;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floor: 'carpet' | 'boards' | 'tiles' | 'lino';
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Level {
  id: string;
  name: string;
  w: number;
  h: number;
  tiles: string[][];
  rooms: Room[];
  doors: DoorDef[];
  loot: LootDef[];
  enemies: EnemyDef[];
  crewStarts: Vec[];
  exit: Rect;
  van: Rect;
  unscouted: string[];
  props: PropDef[];
  lights: LightDef[];
  /** Cells blocked by solid props. */
  solid: boolean[][];
  /** Where a fleeing runner gets out. */
  gate: Vec;
  /** Where their backup turns up, and the spot they head for. */
  backup: { spawn: Vec[]; target: Vec; place: string };
  /** Roofed ground (no rain). */
  covered: Rect[];
  /**
   * 0: lamps make no difference. Towards 1, the further the crew are from a
   * street lamp, the closer an enemy has to be to see them.
   */
  darkness: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 + 1 && y >= r.y0 && y <= r.y1 + 1;
}

export function roomAt(level: Level, x: number, y: number): Room | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (const r of level.rooms) {
    if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) return r;
  }
  return null;
}

export function buildEstateHouse(): Level {
  const w = 30;
  const h = 26;
  const tiles: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('g'));
  const set = (x: number, y: number, c: string) => {
    tiles[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };

  // Back alley and garden fence with a gate.
  fill(0, 0, 29, 0, 'p');
  fill(0, 1, 29, 1, '=');
  set(14, 1, 'p');
  set(15, 1, 'p');
  fill(0, 2, 29, 6, 'g');
  for (let y = 2; y <= 6; y++) {
    set(0, y, '=');
    set(29, y, '=');
  }

  // The terrace row: neighbours either side, a side passage on the east.
  fill(0, 7, 3, 19, 'X');
  fill(29, 7, 29, 19, 'X');
  fill(26, 7, 28, 19, 'p');

  // House shell and internal walls.
  fill(4, 7, 25, 19, '#');
  fill(5, 8, 24, 18, '.');
  fill(11, 8, 11, 18, '#');
  fill(14, 8, 14, 18, '#');
  fill(5, 13, 10, 13, '#');
  fill(15, 13, 24, 13, '#');
  set(20, 13, 'O');

  // Front garden, low front wall with a gate, pavement and road.
  fill(0, 20, 29, 20, 'g');
  set(3, 20, '=');
  set(12, 20, 'p');
  set(13, 20, 'p');
  fill(0, 21, 29, 21, '=');
  set(12, 21, 'p');
  set(13, 21, 'p');
  fill(26, 21, 28, 21, 'p');
  fill(0, 22, 29, 23, 'p');
  fill(0, 24, 29, 25, 'r');

  // Windows.
  for (const [x, y] of [
    [7, 7], [8, 7], [21, 7], [22, 7],
    [7, 19], [8, 19], [18, 19], [19, 19], [20, 19], [21, 19],
    [25, 10], [25, 16],
  ]) set(x, y, 'W');

  const doors: DoorDef[] = [
    { x: 19, y: 7, locked: false, axis: 'h', name: 'Back door' },
    { x: 12, y: 19, locked: true, axis: 'h', name: 'Front door' },
    { x: 11, y: 10, locked: true, axis: 'v', name: 'Back bedroom' },
    { x: 11, y: 16, locked: false, axis: 'v', name: 'Living room' },
    { x: 14, y: 10, locked: false, axis: 'v', name: 'Kitchen' },
    { x: 14, y: 16, locked: false, axis: 'v', name: 'Dining room' },
  ];
  for (const d of doors) set(d.x, d.y, 'D');

  const rooms: Room[] = [
    { id: 'stash', name: 'Back bedroom', x0: 5, y0: 8, x1: 10, y1: 12, floor: 'carpet' },
    { id: 'living', name: 'Living room', x0: 5, y0: 14, x1: 10, y1: 18, floor: 'carpet' },
    { id: 'hall', name: 'Hall', x0: 12, y0: 8, x1: 13, y1: 18, floor: 'boards' },
    { id: 'kitchen', name: 'Kitchen', x0: 15, y0: 8, x1: 24, y1: 12, floor: 'tiles' },
    { id: 'dining', name: 'Dining room', x0: 15, y0: 14, x1: 24, y1: 18, floor: 'boards' },
  ];

  const props: PropDef[] = [
    // Living room: TV against the west wall, sofa facing it.
    { kind: 'tv', x: 5, y: 15, w: 1, h: 3, facing: 0, solid: true },
    { kind: 'sofa', x: 8, y: 15, w: 1, h: 3, facing: Math.PI, solid: true },
    { kind: 'coffeeTable', x: 6, y: 16, w: 1, h: 1 },
    { kind: 'armchair', x: 9, y: 18, w: 1, h: 1, facing: -Math.PI / 2, solid: true },
    // Hall stairs.
    { kind: 'stairs', x: 12, y: 8, w: 2, h: 2, solid: true },
    // Kitchen.
    { kind: 'counter', x: 15, y: 8, w: 3, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'counter', x: 22, y: 8, w: 3, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'fridge', x: 24, y: 11, w: 1, h: 1, facing: Math.PI, solid: true },
    // Dining room.
    { kind: 'table', x: 18, y: 15, w: 3, h: 2, solid: true },
    { kind: 'cabinet', x: 15, y: 18, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    // Back bedroom (the stash room).
    { kind: 'bed', x: 5, y: 8, w: 2, h: 3, solid: true },
    { kind: 'shelves', x: 9, y: 8, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    // Garden and street dressing.
    { kind: 'shed', x: 21, y: 2, w: 3, h: 2, solid: true },
    { kind: 'gardenTable', x: 8, y: 3, w: 2, h: 2, solid: true },
    { kind: 'bins', x: 28, y: 8, w: 1, h: 2, solid: true },
    { kind: 'bins', x: 4, y: 20, w: 1, h: 1, solid: true },
    { kind: 'tree', x: 1, y: 3, w: 2, h: 2, solid: true },
    { kind: 'hedge', x: 16, y: 20, w: 6, h: 1, solid: true },
    { kind: 'lamp', x: 8, y: 23, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 23, y: 23, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 5, y: 0, w: 1, h: 1, solid: true },
    { kind: 'car', x: 17, y: 24, w: 4, h: 2, solid: true },
  ];
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'Cash on the coffee table', x: 6.5, y: 16.5, value: 4000, time: 2, heavy: false },
    { id: 'product', name: 'Product in the kitchen', x: 21.5, y: 9.5, value: 3500, time: 2.5, heavy: false },
    { id: 'bag', name: 'The stash bag', x: 7.5, y: 11.5, value: 12000, time: 4, heavy: true },
  ];

  const enemies: EnemyDef[] = [
    { id: 'dealer', kind: 'dealer', name: 'Dealer', x: 8.5, y: 16.5, facing: Math.PI, patrol: [] },
    {
      id: 'soldier', kind: 'soldier', name: 'Soldier', x: 16.5, y: 10.5, facing: 0,
      patrol: [
        { x: 16.5, y: 10.5 },
        { x: 21.5, y: 11.5 },
        { x: 20.5, y: 14.5 },
        { x: 16.5, y: 15.5 },
        { x: 20.5, y: 14.5 },
        { x: 21.5, y: 11.5 },
      ],
    },
    { id: 'runner', kind: 'runner', name: 'Younger', x: 9.5, y: 11.5, facing: Math.PI, patrol: [] },
    {
      id: 'dog', kind: 'dog', name: 'Dog', x: 6.5, y: 5.5, facing: 0,
      patrol: [
        { x: 6.5, y: 5.5 },
        { x: 18.5, y: 5.5 },
      ],
    },
    // Next door, out on the front step: sees the side passage and the front gardens.
    { id: 'neighbour', kind: 'civilian', model: 'dealer', name: 'Neighbour', x: 28.5, y: 20.5, facing: Math.PI * 0.9, patrol: [] },
  ];

  return {
    id: 'estate',
    name: 'Mid-terrace, Harrow Road estate',
    w,
    h,
    tiles,
    rooms,
    doors,
    loot,
    enemies,
    crewStarts: [
      { x: 10.5, y: 22.5 },
      { x: 11.5, y: 23.5 },
      { x: 14.5, y: 22.5 },
      { x: 15.5, y: 23.5 },
    ],
    exit: { x0: 1, y0: 22, x1: 5, y1: 23 },
    van: { x0: 1, y0: 24, x1: 5, y1: 25 },
    unscouted: ['stash'],
    props,
    lights: [
      { kind: 'street', x: 8.5, y: 23.5 },
      { kind: 'street', x: 23.5, y: 23.5 },
      { kind: 'street', x: 5.5, y: 0.5 },
      { kind: 'tv', x: 6.2, y: 16.5 },
      { kind: 'fridge', x: 23.4, y: 11.5 },
      { kind: 'van', x: 3.5, y: 24.5 },
      { kind: 'ceiling', x: 12.8, y: 14.5 },
      { kind: 'ceiling', x: 19.5, y: 16 },
    ],
    solid,
    gate: { x: 14.5, y: 0.5 },
    backup: { spawn: [{ x: 14.5, y: 0.5 }, { x: 15.5, y: 0.5 }], target: { x: 12.5, y: 14.5 }, place: 'the back gate' },
    covered: [{ x0: 4, y0: 7, x1: 26, y1: 20 }],
    darkness: 0,
  };
}

/** Solid-prop mask for a level's props. */
export function solidMask(w: number, h: number, props: PropDef[]): boolean[][] {
  const solid = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  for (const p of props) {
    if (!p.solid) continue;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (solid[y]) solid[y][x] = true;
  }
  return solid;
}
