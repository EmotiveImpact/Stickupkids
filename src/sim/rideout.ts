// Ride Out: Marlowe's lot posted up at the east end of Burgess Park, on the
// same map as the count (burgess.ts), at night. The crew pull up on Wells
// Way, catch who they can and get gone before the rest of the park wakes up.
// Nobody is touching the food tonight: there is no loot.

import { buildBurgessPark } from './burgess.ts';
import type { EnemyDef, Level } from './level.ts';

export function buildRideOut(): Level {
  const park = buildBurgessPark();
  const loop = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const enemies: EnemyDef[] = [
    // Up and down the canal path on a bike, filming himself.
    {
      id: 'bikes', kind: 'runner', model: 'gang-runner', name: 'Younger on a bike', x: 215.5, y: 143.5, facing: 0, target: true,
      patrol: loop([215, 143], [230, 144], [215, 143], [200, 142]),
      story: { x: 206.5, y: 142.5, mins: 9, caption: 'Wheelies on the canal path' },
    },
    // On the bench by the canal path.
    {
      id: 'bench', kind: 'soldier', model: 'gang-muscle-b', name: 'Shotter', x: 190.5, y: 142.5, facing: -Math.PI / 2, patrol: [], target: true,
      story: { x: 190.5, y: 142.5, mins: 22, caption: 'Smoking on the bench by the canal path' },
    },
    // Minding the gap in the BMX track fence.
    {
      id: 'gate', kind: 'soldier', model: 'gang-muscle-a', persona: 'muscle', name: 'Big man', x: 212.5, y: 113.5, facing: Math.PI / 2, patrol: [], target: true,
      story: { x: 212.5, y: 113.5, mins: 35, caption: 'Holding the gate to the BMX track' },
    },
    // Walking the cut-through between Wells Way and the canal.
    {
      id: 'walker', kind: 'soldier', model: 'gang-lookout', name: 'Lookout', x: 203.5, y: 121.5, facing: -Math.PI / 4, target: true,
      patrol: loop([203, 121], [215, 115], [229, 108], [215, 115]),
      story: { x: 221.5, y: 112.5, mins: 14, caption: 'Walking the cut-through off Wells Way' },
    },
    // On the phone by the bins on Wells Way.
    {
      id: 'phone', kind: 'soldier', model: 'gang-lookout', name: 'Younger', x: 237.5, y: 90.5, facing: Math.PI / 2, target: true,
      patrol: loop([237, 96], [237, 84]),
      story: { x: 237.5, y: 99.5, mins: 5, caption: 'On the phone by the bins on Wells Way' },
    },
    // Nothing to do with it: waiting for a bus across the road.
    { id: 'busStop', kind: 'civilian', model: 'dealer', name: 'Woman at the bus stop', x: 248.5, y: 118.5, facing: Math.PI, patrol: [] },
  ];
  return {
    ...park,
    id: 'rideout',
    name: 'Ride out, Burgess Park',
    mode: 'rideout',
    enemies,
    loot: [],
    unscouted: [],
    // Anyone who runs, runs west along the canal path for the others.
    gate: { x: 180.5, y: 139.5 },
    // The block wakes up fast: down Wells Way from the north and along the canal path from the west.
    backup: {
      spawn: [{ x: 236.5, y: 77.5 }, { x: 237.5, y: 78.5 }, { x: 176.5, y: 139.5 }, { x: 178.5, y: 139.5 }],
      target: { x: 215.5, y: 128.5 },
      place: 'Wells Way and the canal path',
      time: 25,
      models: ['gang-muscle-a', 'gang-leader', 'gang-muscle-b', 'gang-lookout'],
    },
  };
}
