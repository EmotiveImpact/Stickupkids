// The jobs on offer. Each one is a level, a sample plan and the words the
// job board shows.

import { buildBurgessPark } from './burgess.ts';
import { buildEstateHouse, type GoCode, type JobMode, type Level, type Vec } from './level.ts';
import { buildRideOut } from './rideout.ts';
import { burgessPlans, rideOutPlans, samplePlans, trapBarricades, trapPlans } from './samplePlan.ts';
import type { Waypoint } from './sim.ts';
import { buildTrap } from './trap.ts';

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
  /** Stick-up unless given. */
  mode?: JobMode;
  /** The baked level it is played on, in public/models/ (its own id unless given). */
  art?: string;
  /** They Slid: the doors the sample plan barricades. */
  sampleBarricades?: Vec[];
}

/** The folder holding a job's baked level. */
export const artOf = (job: Job) => `models/${job.art ?? job.id}/`;

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
      "Marlowe's lot count the week's money by the old lime kiln after dark, and they have the park covered from Albany Road to Wells Way. The float sits inside the kiln arches and the count is on a picnic table under a lamp. Their car is up in the adventure playground car park with the re-up in the boot, and a younger is minding a bag of phones on the BMX track. The van waits on Wells Way. The canal path is lit end to end; the grass in between is not.",
    intel: [
      'Elder and Tally at the table, a younger close by',
      'Lookouts on the canal path, a shotter behind the kiln',
      'Driver and a dog at the car, two more at the BMX track',
      'Kiln arches unscouted',
    ],
    heat: 4,
    build: buildBurgessPark,
    samplePlans: burgessPlans,
    sampleCodes: [
      [62, 'A'],
      [86, 'B'],
    ],
  },
  {
    id: 'rideout',
    mode: 'rideout',
    art: 'burgess',
    title: 'Ride out, Burgess Park',
    place: 'Wells Way, Burgess Park SE5',
    brief:
      "Marlowe's lot posted up at the bottom of the park an hour ago and Jojo's been watching their story since. Mandem in the whip, ballys on, and nobody's touching the food tonight. Catch who you can and get gone before the rest of the park wakes up. Every one you touch, they're coming back for.",
    intel: [
      'Five of them, known only from what they post',
      'Jojo keeps the pins coming while he is up',
      'The park wakes up 25 seconds after the first shout',
      'A woman at the bus stop across Wells Way',
    ],
    heat: 4,
    build: buildRideOut,
    samplePlans: rideOutPlans,
    sampleCodes: [],
  },
  {
    id: 'slid',
    mode: 'slid',
    art: 'estate',
    title: 'They slid, East Street',
    place: 'Your trap, off East Street, Walworth SE17',
    brief:
      "Marlowe's lot found out where you keep it, and now they're outside the trap. Barricade the doors, put Dex on the stairs with the ting and hold it down till they back off or the boydem turn up. The bag's in the back bedroom, the food's in the kitchen and the P's are on the coffee table.",
    intel: [
      'Three waves: the front, then over the back fence, then both',
      'Two barricades: click a door to brace it',
      'Standing still, the crew are in cover',
      'The neighbour rings 999 when the shooting starts',
    ],
    heat: 3,
    build: buildTrap,
    samplePlans: trapPlans,
    sampleCodes: [],
    sampleBarricades: trapBarricades,
  },
];

export function jobById(id: string | null | undefined): Job {
  return JOBS.find((j) => j.id === id) ?? JOBS[0];
}
