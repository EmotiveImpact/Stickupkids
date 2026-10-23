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
