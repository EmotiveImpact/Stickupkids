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
    [wp(10, 22), wp(13, 20, 'A'), wp(12, 16), wp(10, 16), wp(8, 15), wp(8, 16), wp(12, 17), wp(12, 20), wp(3, 22)],
    // 2 Kemi, Creeper: front door, back bedroom bag.
    [wp(11, 23), wp(12, 20), wp(12, 17), wp(12, 11), wp(7, 11), wp(12, 12), wp(12, 20), wp(2, 23)],
    // 3 Jojo, Lookout: side passage, eyes on the kitchen.
    [wp(14, 22), wp(22, 20), wp(22, 13, 'B'), wp(22, 20), wp(5, 22)],
    // 4 Taz, Talker: dining room and kitchen product.
    [wp(15, 23), wp(13, 21, 'A'), wp(13, 15), wp(15, 16), wp(18, 14), wp(17, 10), wp(18, 14), wp(15, 16), wp(13, 17), wp(13, 20), wp(4, 23)],
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
 * A plan for the Aylesbury stash flat. The crew come in from Thurlow Street
 * across the dark courtyard south of the block, keeping off the lit walkway.
 * Kemi picks the front door and the back bedroom, Dex and Taz follow her in
 * on A for the living room and the kitchen, and Jojo watches the walkway
 * until B.
 */
export function aylesburyPlans(): Waypoint[][] {
  const out = [wp(120, 56), wp(96, 57)];
  const back = [...out].reverse();
  return [
    // 1 Dex, Muscle: the landlord and the cash in the living room.
    [wp(133, 50), ...out, wp(77, 50, 'A'), wp(75, 47), wp(75, 43), wp(73, 43), wp(71, 41), wp(75, 43), wp(75, 47), ...back, wp(133, 50)],
    // 2 Kemi, Creeper: front door, back bedroom bag.
    [wp(133, 51), ...out, wp(75, 49), wp(75, 47), wp(75, 45), wp(76, 44), wp(78, 44), wp(79, 44), wp(76, 44), wp(75, 47), ...back, wp(133, 51)],
    // 3 Jojo, Lookout: eyes on the walkway until B.
    [wp(133, 52), ...out, wp(84, 52, 'B'), ...back, wp(133, 52)],
    // 4 Taz, Talker: the door man, then the kitchen.
    [wp(133, 53), ...out, wp(73, 50, 'A'), wp(75, 47), wp(76, 42), wp(78, 40), wp(80, 41), wp(76, 41), wp(75, 47), ...back, wp(133, 53)],
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
 * A plan for the grow under the Elephant arches. The crew leave the van at the
 * east end of the lane, go under the viaduct on the road and come back along
 * the footpath behind it, out of the lane lookout's sight. On A they take the
 * footpath lookout and Kemi picks the fire door; Dex and Taz follow her in
 * through the grow room to the office. Jojo watches the footpath until B.
 */
export function elephantPlans(): Waypoint[][] {
  const out = [wp(116, 44), wp(110, 20), wp(96, 21)];
  const back = [...out].reverse();
  return [
    // 1 Dex, Muscle: through the grow room to the office, the takings.
    [wp(104, 44), ...out, wp(92, 21, 'A'), wp(70, 21), wp(68, 23), wp(68, 35), wp(66, 37), wp(67, 39), wp(66, 37), wp(68, 35), wp(68, 23), wp(70, 21), ...back, wp(104, 44)],
    // 2 Kemi, Creeper: the fire door, the crop in the aisle.
    [wp(105, 44), ...out, wp(93, 20, 'A'), wp(69, 21), wp(68, 23), wp(68, 25), wp(68, 31), wp(68, 23), wp(69, 21), ...back, wp(105, 44)],
    // 3 Jojo, Lookout: eyes down the footpath until B.
    [wp(104, 46), ...out, wp(95, 21, 'A'), wp(78, 20, 'B'), ...back, wp(104, 46)],
    // 4 Taz, Talker: the footpath lookout, then the grower and the float.
    [wp(105, 46), ...out, wp(91, 20, 'A'), wp(72, 20), wp(69, 21), wp(68, 23), wp(68, 35), wp(67, 37), wp(69, 40), wp(70, 40), wp(67, 37), wp(68, 35), wp(68, 23), wp(69, 21), ...back, wp(105, 46)],
  ];
}

export function brixtonPlans(): Waypoint[][] {
  const out = [wp(118, 77), wp(90, 83), wp(66, 87)];
  const back = [...out].reverse();
  const row = [wp(56, 84), wp(56, 52), wp(40, 52), wp(22, 51)];
  const rowBack = [...row].reverse();
  return [
    // 1 Dex, Muscle: the stock room, then through the side door to the back room and the safe.
    [wp(127, 73), ...out, wp(62, 88, 'A'), ...row, wp(21, 48), wp(21, 46), wp(23, 46), wp(25, 46), wp(25, 47), wp(28, 47), wp(25, 46), wp(21, 48), ...rowBack, ...back, wp(127, 73)],
    // 2 Kemi, Creeper: picks the Coldharbour Lane gate, then the till in the shop.
    [wp(127, 74), ...out, wp(56, 87), wp(56, 85, 'A'), ...row, wp(21, 48), wp(21, 44), wp(21, 42), wp(21, 39), wp(21, 42), wp(21, 44), wp(21, 48), ...rowBack, ...back, wp(127, 74)],
    // 3 Jojo, Lookout: minds the gate until B.
    [wp(127, 75), ...out, wp(60, 88, 'A'), wp(57, 84, 'B'), wp(60, 88), ...back, wp(127, 75)],
    // 4 Taz, Talker: first in, the shotter in Market Row, the bagger, then the man on the counter.
    [wp(128, 76), ...out, wp(58, 88, 'A'), ...row, wp(21, 48), wp(21, 44), wp(22, 42), wp(23, 41), wp(22, 42), wp(21, 44), wp(21, 48), ...rowBack, ...back, wp(128, 76)],
  ];
}

export function peckhamPlans(): Waypoint[][] {
  const out = [wp(60, 12), wp(95, 13), wp(99, 22)];
  const back = [...out].reverse();
  const inside = [wp(107, 33), wp(110, 38)];
  const outside = [...inside].reverse();
  return [
    // 1 Dex, Muscle: the seller from behind, the sample, then the buyer's money.
    [wp(52, 9), ...out, wp(99, 25, 'A'), ...inside, wp(119, 41), wp(120, 43), wp(120, 46), wp(126, 46), wp(120, 42), wp(110, 38), ...outside, wp(104, 28), ...back, wp(52, 9)],
    // 2 Kemi, Creeper: round the seller's car to the boot, the seller's muscle.
    [wp(51, 9), ...out, wp(100, 25, 'A'), ...inside, wp(114, 42), wp(115, 44), wp(114, 42), ...outside, wp(104, 28), ...back, wp(51, 9)],
    // 3 Jojo, Lookout: the buyer's muscle from behind.
    [wp(51, 8), ...out, wp(99, 26, 'A'), ...inside, wp(126, 39), wp(133, 43), wp(126, 39), ...outside, wp(104, 28), ...back, wp(51, 8)],
    // 4 Taz, Talker: the lookout on the way in, the buyer, his car, the lookout on the ramp.
    [wp(52, 8), ...out, wp(104, 28), wp(106, 31, 'A'), ...inside, wp(126, 40), wp(127, 42), wp(131, 44), wp(136, 45), wp(137, 46), wp(126, 40), ...outside, wp(104, 28), ...back, wp(52, 8)],
  ];
}

export function brockwellPlans(): Waypoint[][] {
  const out = [wp(124, 26), wp(113, 30)];
  const back = [...out].reverse();
  const deckEast = [wp(108, 30), wp(100, 32), wp(97, 64), wp(90, 68)];
  const deckEastBack = [...deckEast].reverse();
  const terrace = [wp(108, 30), wp(100, 29), wp(72, 28), wp(64, 28)];
  const terraceBack = [...terrace].reverse();
  return [
    // 1 Dex, Muscle: round the east end of the pool to the plant room, the stash.
    [wp(133, 15), ...out, wp(114, 31, 'A'), ...deckEast, wp(70, 70), wp(67, 70), wp(65, 71), wp(65, 74), wp(64, 75), wp(65, 73), wp(65, 71), wp(70, 70), ...deckEastBack, ...back, wp(133, 15)],
    // 2 Kemi, Creeper: picks the car park gate, then the till and the café store.
    [wp(133, 16), ...out, wp(111, 30), wp(109, 30, 'A'), ...terrace, wp(64, 26), wp(64, 22), wp(62, 21), wp(64, 22), wp(67, 22), wp(70, 24), wp(67, 22), wp(64, 26), ...terraceBack, ...back, wp(133, 16)],
    // 3 Jojo, Lookout: with Dex, picks the plant room door.
    [wp(133, 17), ...out, wp(114, 29, 'A'), ...deckEast, wp(71, 69), wp(66, 71), wp(65, 72), wp(66, 71), wp(71, 69), ...deckEastBack, ...back, wp(133, 17)],
    // 4 Taz, Talker: the manager and the bagger, then the shotter by the pool.
    [wp(132, 16), ...out, wp(113, 29, 'A'), ...terrace, wp(64, 25), wp(64, 23), wp(67, 22), wp(69, 23), wp(67, 22), wp(66, 24), wp(64, 26), wp(64, 28), wp(56, 28), wp(52, 29), wp(56, 28), ...terraceBack, ...back, wp(132, 16)],
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
    [wp(17, 11), wp(18, 12), wp(18, 11)],
    // 4 Taz: through the living room into the hall beside Dex.
    [wp(9, 15), wp(12, 16), wp(13, 11), wp(13, 12)],
  ];
}

/** The two outside doors, barricaded. */
export const trapBarricades = [
  { x: 12, y: 19 },
  { x: 19, y: 7 },
];
