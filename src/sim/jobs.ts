// The jobs on offer. Each one is a level, a sample plan and the words the
// job board shows.

import { buildBurgessPark } from './burgess.ts';
import { buildEstateHouse, type GoCode, type Level } from './level.ts';
import { burgessPlans, samplePlans } from './samplePlan.ts';
import type { Waypoint } from './sim.ts';

export interface Job {
  id: string;
  /** Short name for the HUD. */
  title: string;
  /** Where it is, for the job board. */
  place: string;
  brief: string;
  /** What the board says you are up against. */
  intel: string[];
  /** 1 to 5. */
  heat: number;
  build(): Level;
  samplePlans(): Waypoint[][];
  /** When to call the go codes for the sample plan (seconds into the raid). */
  sampleCodes: [number, GoCode][];
}

export const JOBS: Job[] = [
  {
    id: 'estate',
    title: 'Mid-terrace, Harrow Road',
    place: 'Harrow Road estate, W9',
    brief:
      'A dealer keeps cash in the front room and a bag in the back bedroom nobody has seen inside. Front door is locked, the back door is not, and there is a dog in the garden.',
    intel: ['Dealer and a soldier inside', 'Runner, dog in the garden', 'Back bedroom unscouted'],
    heat: 2,
    build: buildEstateHouse,
    samplePlans,
    sampleCodes: [
      [5, 'A'],
      [20, 'B'],
    ],
  },
  {
    id: 'burgess',
    title: 'The count, Burgess Park',
    place: 'Burgess Park, Camberwell SE5',
    brief:
      "Marlowe's lot count the week's money by the old lime kiln after dark. The float sits inside the kiln arches, the count is on a picnic table under a lamp, and the re-up is in the car. Stay out of the lamplight and they will not see you coming.",
    intel: ['Elder at the table, shotter on the kiln path', 'Lookout and a younger on the canal path', 'Kiln arches unscouted'],
    heat: 3,
    build: buildBurgessPark,
    samplePlans: burgessPlans,
    sampleCodes: [
      [24, 'A'],
      [34, 'B'],
    ],
  },
];

export function jobById(id: string | null | undefined): Job {
  return JOBS.find((j) => j.id === id) ?? JOBS[0];
}
