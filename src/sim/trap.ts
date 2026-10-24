// They Slid: the crew's own trap, a mid-terrace off East Street in Walworth
// (the same house as the Harrow Road job, so it shares its baked art).
// Marlowe's lot found out where the crew keep it. They come through the
// front, then over the back fence, then both.

import { buildEstateHouse, type EnemyDef, type Level, type LootDef, type Wave } from './level.ts';

export function buildTrap(): Level {
  const house = buildEstateHouse();
  // Their own house: the crew have keys to every door but the front.
  const doors = house.doors.map((d) => ({ ...d, locked: d.name === 'Front door' }));
  const loot: LootDef[] = [
    { id: 'bag', name: 'The stash bag in the back bedroom', x: 7.5, y: 11.5, value: 12000, time: 4, heavy: true },
    { id: 'product', name: 'The food in the kitchen', x: 21.5, y: 9.5, value: 5500, time: 2.5, heavy: false },
    { id: 'cash', name: "The P's on the coffee table", x: 6.5, y: 16.5, value: 4000, time: 2, heavy: false },
  ];
  const man = (id: string, name: string, model: string, x: number, y: number, facing: number): EnemyDef => ({ id, kind: 'soldier', model, name, x, y, facing, patrol: [] });
  const N = -Math.PI / 2;
  const S = Math.PI / 2;
  const waves: Wave[] = [
    {
      t: 4,
      place: 'the front',
      enemies: [man('w1a', 'Muscle', 'gang-muscle-a', 12.5, 24.5, N), man('w1b', 'Younger', 'gang-runner', 11.5, 24.5, N), man('w1c', 'Shotter', 'gang-lookout', 13.5, 25.5, N)],
    },
    {
      t: 26,
      place: 'over the back fence',
      enemies: [man('w2a', 'Muscle', 'gang-muscle-b', 14.5, 0.5, S), man('w2b', 'Shotter', 'gang-lookout', 15.5, 0.5, S), man('w2c', 'Younger', 'gang-runner', 13.5, 0.5, S)],
    },
    {
      t: 50,
      place: 'the front and the back',
      enemies: [
        man('w3a', 'Shooter', 'gang-leader', 12.5, 24.5, N),
        man('w3b', 'Muscle', 'gang-muscle-a', 13.5, 24.5, N),
        man('w3c', 'Shotter', 'gang-lookout', 14.5, 0.5, S),
        man('w3d', 'Muscle', 'gang-muscle-b', 15.5, 0.5, S),
      ],
    },
  ];
  return {
    ...house,
    id: 'slid',
    name: 'The trap, East Street',
    mode: 'slid',
    doors,
    loot,
    // Only the neighbour on the step: anyone else on the street has gone in.
    enemies: house.enemies.filter((e) => e.kind === 'civilian'),
    unscouted: [],
    crewStarts: [
      { x: 12.5, y: 11.5 },
      { x: 8.5, y: 10.5 },
      { x: 19.5, y: 11.5 },
      { x: 9.5, y: 14.5 },
    ],
    waves,
    barricades: 2,
  };
}
