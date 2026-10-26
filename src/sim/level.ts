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
/** barricaded: shut and propped from inside. Only people breaking in get through, and slowly. */
export type DoorState = 'closed' | 'open' | 'locked' | 'broken' | 'barricaded';
export type GoCode = 'A' | 'B' | 'C';

/**
 * What kind of job it is.
 * - stickup: rob the place and get back to the van.
 * - rideout: catch the people you came for and get gone before their side wakes up.
 * - slid: they have come for your place. Hold it until they back off or the police turn up.
 */
export type JobMode = 'stickup' | 'rideout' | 'slid';

/** What a target last put on their story: where they were, and how long before the job. */
export interface StoryPost {
  x: number;
  y: number;
  mins: number;
  caption: string;
}

/** They Slid: who comes through the doors, when, and from where. Each runs back the way they came. */
export interface Wave {
  /** Seconds into the job. */
  t: number;
  /** Where they come from, for the notes ("the front"). */
  place: string;
  enemies: EnemyDef[];
}

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
  /** Ride Out: one of the people the crew came for. */
  target?: boolean;
  /** Ride Out: their last post, which is all the crew know of them before they are seen. */
  story?: StoryPost;
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
  /**
   * Where their backup turns up, and the spot they head for. `time`: seconds
   * from the first alarm (45 unless given). `models`: who comes, in spawn order.
   */
  backup: { spawn: Vec[]; target: Vec; place: string; time?: number; models?: string[] };
  /** Roofed ground (no rain). */
  covered: Rect[];
  /**
   * 0: lamps make no difference. Towards 1, the further the crew are from a
   * street lamp, the closer an enemy has to be to see them.
   */
  darkness: number;
  /** Stick-up unless given. */
  mode?: JobMode;
  /** They Slid: the people coming for the place, wave by wave. */
  waves?: Wave[];
  /** They Slid: how many doors the crew can barricade. */
  barricades?: number;
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

  // Back gardens are house-wide, fenced off from next door's.
  for (let y = 2; y <= 6; y++) {
    set(5, y, '=');
    set(21, y, '=');
  }

  // The terrace row: neighbours either side, a side passage on the east.
  // Rooms are about 1.2 times a real Victorian terrace's (4 by 5 m and 5 by 5 m).
  fill(0, 7, 5, 19, 'X');
  fill(24, 7, 29, 19, 'X');
  fill(21, 7, 23, 19, 'p');

  // House shell and internal walls.
  fill(6, 7, 20, 19, '#');
  fill(7, 8, 19, 18, '.');
  fill(11, 8, 11, 18, '#');
  fill(14, 8, 14, 18, '#');
  fill(7, 13, 10, 13, '#');
  fill(15, 13, 19, 13, '#');
  set(18, 13, 'O');

  // Front garden, low front wall with a gate, pavement and road.
  fill(0, 20, 29, 20, 'g');
  set(5, 20, '=');
  set(12, 20, 'p');
  set(13, 20, 'p');
  fill(0, 21, 29, 21, '=');
  set(12, 21, 'p');
  set(13, 21, 'p');
  fill(21, 21, 23, 21, 'p');
  fill(0, 22, 29, 23, 'p');
  fill(0, 24, 29, 25, 'r');

  // Windows.
  for (const [x, y] of [
    [8, 7], [9, 7], [16, 7], [17, 7],
    [8, 19], [9, 19], [16, 19], [17, 19], [18, 19],
    [20, 10], [20, 16],
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
    { id: 'stash', name: 'Back bedroom', x0: 7, y0: 8, x1: 10, y1: 12, floor: 'carpet' },
    { id: 'living', name: 'Living room', x0: 7, y0: 14, x1: 10, y1: 18, floor: 'carpet' },
    { id: 'hall', name: 'Hall', x0: 12, y0: 8, x1: 13, y1: 18, floor: 'boards' },
    { id: 'kitchen', name: 'Kitchen', x0: 15, y0: 8, x1: 19, y1: 12, floor: 'tiles' },
    { id: 'dining', name: 'Dining room', x0: 15, y0: 14, x1: 19, y1: 18, floor: 'boards' },
  ];

  const props: PropDef[] = [
    // Living room: TV against the back wall, sofa under the front window facing it.
    { kind: 'tv', x: 8, y: 14, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'sofa', x: 7, y: 18, w: 3, h: 1, facing: -Math.PI / 2, solid: true },
    { kind: 'coffeeTable', x: 8, y: 16, w: 1, h: 1 },
    { kind: 'armchair', x: 7, y: 14, w: 1, h: 1, facing: 0, solid: true },
    // Hall stairs.
    { kind: 'stairs', x: 12, y: 8, w: 2, h: 2, solid: true },
    // Kitchen.
    { kind: 'counter', x: 15, y: 8, w: 3, h: 1, facing: Math.PI / 2, solid: true },
    { kind: 'counter', x: 19, y: 9, w: 1, h: 2, facing: Math.PI, solid: true },
    { kind: 'fridge', x: 19, y: 11, w: 1, h: 1, facing: Math.PI, solid: true },
    // Dining room.
    { kind: 'table', x: 16, y: 15, w: 3, h: 2, solid: true },
    { kind: 'cabinet', x: 15, y: 18, w: 2, h: 1, facing: -Math.PI / 2, solid: true },
    // Back bedroom (the stash room).
    { kind: 'bed', x: 7, y: 8, w: 2, h: 3, solid: true },
    { kind: 'shelves', x: 9, y: 8, w: 2, h: 1, facing: Math.PI / 2, solid: true },
    // Garden and street dressing.
    { kind: 'shed', x: 17, y: 2, w: 3, h: 2, solid: true },
    { kind: 'gardenTable', x: 8, y: 3, w: 2, h: 2, solid: true },
    { kind: 'bins', x: 23, y: 8, w: 1, h: 2, solid: true },
    { kind: 'bins', x: 7, y: 20, w: 1, h: 1, solid: true },
    { kind: 'tree', x: 1, y: 3, w: 2, h: 2, solid: true },
    { kind: 'hedge', x: 15, y: 20, w: 5, h: 1, solid: true },
    { kind: 'lamp', x: 8, y: 23, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 23, y: 23, w: 1, h: 1, solid: true },
    { kind: 'lamp', x: 5, y: 0, w: 1, h: 1, solid: true },
    { kind: 'car', x: 17, y: 24, w: 4, h: 2, solid: true },
  ];
  const solid = solidMask(w, h, props);

  const loot: LootDef[] = [
    { id: 'cash', name: 'Cash on the coffee table', x: 8.5, y: 16.5, value: 4000, time: 2, heavy: false },
    { id: 'product', name: 'Product in the kitchen', x: 17.5, y: 10.5, value: 3500, time: 2.5, heavy: false },
    { id: 'bag', name: 'The stash bag', x: 7.5, y: 11.5, value: 12000, time: 4, heavy: true },
  ];

  const enemies: EnemyDef[] = [
    { id: 'dealer', kind: 'dealer', name: 'Dealer', x: 8.5, y: 17.5, facing: -Math.PI / 2, patrol: [] },
    {
      id: 'soldier', kind: 'soldier', name: 'Soldier', x: 16.5, y: 9.5, facing: -Math.PI / 2,
      // Bagging up at the counter, back to the room.
      patrol: [],
    },
    { id: 'runner', kind: 'runner', name: 'Younger', x: 9.5, y: 11.5, facing: Math.PI, patrol: [] },
    {
      id: 'dog', kind: 'dog', name: 'Dog', x: 7.5, y: 5.5, facing: 0,
      patrol: [
        { x: 7.5, y: 5.5 },
        { x: 15.5, y: 5.5 },
      ],
    },
    // Next door, out on the front step: sees the side passage and the front gardens.
    { id: 'neighbour', kind: 'civilian', model: 'dealer', name: 'Neighbour', x: 25.5, y: 20.5, facing: Math.PI * 0.9, patrol: [] },
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
      { kind: 'tv', x: 9, y: 14.8 },
      { kind: 'fridge', x: 18.6, y: 11.5 },
      { kind: 'van', x: 3.5, y: 24.5 },
      { kind: 'ceiling', x: 12.8, y: 14.5 },
      { kind: 'ceiling', x: 17.5, y: 16 },
    ],
    solid,
    gate: { x: 14.5, y: 0.5 },
    backup: { spawn: [{ x: 14.5, y: 0.5 }, { x: 15.5, y: 0.5 }], target: { x: 12.5, y: 14.5 }, place: 'the back gate' },
    covered: [{ x0: 6, y0: 7, x1: 21, y1: 20 }],
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
