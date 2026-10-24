import type { GoCode } from './level.ts';
import type { Waypoint } from './sim.ts';

const wp = (x: number, y: number, hold: GoCode | null = null, kick = false): Waypoint => ({
  x: x + 0.5,
  y: y + 0.5,
  hold,
  kick,
});

/**
 * A quiet plan for the estate house. Kemi picks the front door and the back
 * bedroom, Dex and Taz follow in on A, Jojo watches the side windows until B.
 */
export function samplePlans(): Waypoint[][] {
  return [
    // 1 Dex, Muscle: living room cash.
    [wp(10, 22), wp(13, 20, 'A'), wp(12, 16), wp(9, 16), wp(6, 14), wp(6, 16), wp(12, 17), wp(12, 20), wp(3, 22)],
    // 2 Kemi, Creeper: front door, back bedroom bag.
    [wp(11, 23), wp(12, 20), wp(12, 17), wp(12, 11), wp(7, 11), wp(12, 12), wp(12, 20), wp(2, 23)],
    // 3 Jojo, Lookout: side passage, eyes on the kitchen.
    [wp(14, 22), wp(27, 20), wp(27, 13, 'B'), wp(27, 20), wp(5, 22)],
    // 4 Taz, Talker: dining room and kitchen product.
    [wp(15, 23), wp(13, 21, 'A'), wp(13, 15), wp(16, 16), wp(21, 14), wp(21, 9), wp(21, 14), wp(15, 16), wp(13, 17), wp(13, 20), wp(4, 23)],
  ];
}

/**
 * A plan for the count in Burgess Park. From the van on Wells Way the crew
 * cross the dark grass north of the canal path, away from the lamps, and wait
 * east of the kiln. On A, Taz talks down the younger from behind, Dex the two
 * at the table, and Kemi picks the kiln's south gate with Jojo behind her to
 * hold the minder. Dex takes the count, Kemi the float; on B Jojo lets the
 * minder go and everyone goes back the way they came.
 */
export function burgessPlans(): Waypoint[][] {
  const out = [wp(130, 110), wp(175, 116), wp(218, 121)];
  const back = [...out].reverse();
  return [
    // 1 Dex, Muscle: the two at the table, then the count.
    [wp(237, 128), ...back, wp(108, 119, 'A'), wp(101, 121), wp(97, 123), wp(106, 118), ...out, wp(237, 128)],
    // 2 Kemi, Creeper: the south gate and the float.
    [wp(238, 129), ...back, wp(103, 115, 'A'), wp(96, 120), wp(90, 120), wp(92, 113), wp(90, 120), wp(96, 120), wp(103, 115), ...out, wp(238, 129)],
    // 3 Jojo, Lookout: in behind Kemi, holds the minder until B.
    [wp(237, 130), ...back, wp(105, 114, 'A'), wp(96, 121), wp(91, 120), wp(89, 118, 'B'), wp(91, 120), wp(96, 121), wp(105, 114), ...out, wp(237, 130)],
    // 4 Taz, Talker: the younger from behind, then over to the table.
    [wp(238, 131), ...back, wp(110, 127, 'A'), wp(107, 128), wp(102, 126), wp(106, 118), ...out, wp(238, 131)],
  ];
}

/**
 * A ride out on Marlowe's lot at the east end of Burgess Park. Jojo goes up
 * Wells Way for the younger by the bins; Dex and Taz go over the dark grass
 * for the cut-through and the big man on the BMX gate; Kemi goes down to the
 * canal path for the bench. Everyone straight back to the whip.
 */
export function rideOutPlans(): Waypoint[][] {
  return [
    // 1 Dex, Muscle: the big man on the gate, then back.
    [wp(237, 128), wp(228, 122), wp(217, 118), wp(213, 116), wp(222, 121), wp(232, 126), wp(237, 128)],
    // 2 Kemi, Creeper: along the dark grass to the bench on the canal path.
    [wp(238, 129), wp(225, 134), wp(205, 138), wp(194, 140), wp(205, 138), wp(225, 134), wp(238, 129)],
    // 3 Jojo, Lookout: up Wells Way for the younger by the bins.
    [wp(237, 130), wp(237, 112), wp(237, 98), wp(237, 112), wp(237, 130)],
    // 4 Taz, Talker: the cut-through, behind Dex.
    [wp(238, 131), wp(228, 124), wp(219, 120), wp(210, 121), wp(219, 120), wp(230, 126), wp(238, 131)],
  ];
}

/**
 * Holding the trap. Both outside doors barricaded (trapBarricades). Dex at
 * the foot of the stairs and Taz beside him cover the hall from the front
 * door; Jojo and Kemi cover the kitchen from the back door.
 */
export function trapPlans(): Waypoint[][] {
  return [
    // 1 Dex: on the stairs, facing the front door.
    [wp(12, 11), wp(12, 12)],
    // 2 Kemi: out of the back bedroom into the kitchen.
    [wp(8, 10), wp(12, 10), wp(15, 10), wp(16, 12), wp(16, 11)],
    // 3 Jojo: in the kitchen, facing the back door.
    [wp(19, 11), wp(20, 12), wp(20, 11)],
    // 4 Taz: through the living room into the hall beside Dex.
    [wp(9, 14), wp(12, 16), wp(13, 11), wp(13, 12)],
  ];
}

/** The two outside doors, barricaded. */
export const trapBarricades = [
  { x: 12, y: 19 },
  { x: 19, y: 7 },
];
