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
