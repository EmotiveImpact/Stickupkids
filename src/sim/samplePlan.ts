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
 * A plan for the count in Burgess Park. Kemi picks the kiln's west gate for
 * the float and Jojo follows her in to hold the minder. On A, Taz takes the
 * re-up from the car boot and comes up behind the elder; Dex takes the count.
 */
export function burgessPlans(): Waypoint[][] {
  return [
    // 1 Dex, Muscle: the count on the picnic table.
    [wp(6, 29), wp(10, 22), wp(16, 19, 'A'), wp(24, 13), wp(29, 12), wp(29, 15), wp(28, 16), wp(23, 15), wp(15, 20), wp(6, 27), wp(2, 28)],
    // 2 Kemi, Creeper: west gate, the float.
    [wp(7, 30), wp(3, 21), wp(6, 13), wp(15, 9), wp(17, 8), wp(20, 7), wp(24, 6), wp(20, 7), wp(16, 8), wp(6, 13), wp(3, 20), wp(3, 28)],
    // 3 Jojo, Lookout: in behind Kemi, holds the minder until B.
    [wp(8, 29), wp(2, 20), wp(6, 12), wp(15, 9), wp(17, 8), wp(19, 8, 'B'), wp(16, 8), wp(6, 13), wp(2, 20), wp(1, 28)],
    // 4 Taz, Talker: the car boot, then talks the elder down.
    [wp(9, 30), wp(10, 21), wp(17, 18, 'A'), wp(24, 13), wp(29, 12), wp(30, 14), wp(29, 12), wp(23, 15), wp(15, 20), wp(8, 27), wp(4, 29)],
  ];
}
