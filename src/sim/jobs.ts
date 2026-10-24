// The jobs on offer. Each one is a level, a sample plan and the words the
// job board shows.

import { buildAylesbury } from './aylesbury.ts';
import { buildBrixton } from './brixton.ts';
import { buildBrockwell } from './brockwell.ts';
import { buildBurgessPark } from './burgess.ts';
import { buildPeckham } from './peckham.ts';
import { buildElephant } from './elephant.ts';
import { buildEstateHouse, type GoCode, type JobMode, type Level, type Vec } from './level.ts';
import { buildRideOut } from './rideout.ts';
import { aylesburyPlans, brixtonPlans, brockwellPlans, burgessPlans, elephantPlans, peckhamPlans, rideOutPlans, samplePlans, trapBarricades, trapPlans } from './samplePlan.ts';
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
    id: 'aylesbury',
    title: 'Stash flat, Aylesbury Estate',
    place: 'Aylesbury Estate, Walworth SE17',
    brief:
      "A ground-floor maisonette on one of the long slab blocks off Thurlow Street is somebody's stash flat. The front door opens onto the walkway under the decks, the kitchen opens onto a fenced yard with a dog in it, and their car sits on the service road behind with more in the boot. A younger hangs about in the undercroft and a shotter walks the walkway end to end. The van is on Thurlow Street.",
    intel: [
      'Landlord, a door man and a cook inside',
      'Dog in the yard, driver at the car',
      'Lookouts in the stair lobby, the undercroft and the north courtyard',
      'Back bedroom unscouted',
    ],
    heat: 3,
    build: buildAylesbury,
    samplePlans: aylesburyPlans,
    sampleCodes: [
      [28, 'A'],
      [50, 'B'],
    ],
  },
  {
    id: 'elephant',
    title: 'The grow, Elephant arches',
    place: 'Railway arches, Elephant and Castle SE1',
    brief:
      "One of the railway arches between Walworth Road and Elephant Road is a weed grow behind a roller shutter, with a car wash run by the same people in the arch next door. Four tents under the lights, a drying rack, and an office at the front where the money sits. A fire door at the back opens onto the footpath behind the viaduct. A lookout walks the lane out front, another walks the footpath, and the van is at the east end of the lane.",
    intel: [
      'The grower in the office, a guard on the office door',
      'Two and a dog at the car wash',
      'Lookouts on the lane and the footpath, a younger on the corner',
      'Grow room unscouted',
    ],
    heat: 3,
    build: buildElephant,
    samplePlans: elephantPlans,
    sampleCodes: [
      [37, 'A'],
      [75, 'B'],
    ],
  },
  {
    id: 'brixton',
    title: 'The trap, Electric Avenue',
    place: 'Electric Avenue and Market Row, Brixton SW9',
    brief:
      "A phone shop on the south side of Electric Avenue is a trap after hours. The shutter is down, a man sits behind the counter anyway, they bag up in the stock room and the money and the safe are in the back room. The back door opens onto Market Row, the covered market, which is gated shut for the night and walked by a shotter. Their car is on the service road behind Connaught Mansions with a dog on it. The van is on Coldharbour Lane.",
    intel: [
      'The shopkeeper, a man on the counter and a bagger inside',
      'A shotter in Market Row, a lookout at the avenue gate',
      'Lookout and a younger on the avenue, a driver and a dog at the car',
      'Back room unscouted',
    ],
    heat: 4,
    build: buildBrixton,
    samplePlans: brixtonPlans,
    sampleCodes: [
      [36, 'A'],
      [95, 'B'],
    ],
  },
  {
    id: 'peckham',
    title: 'The handover, Rye Lane car park',
    place: 'Multi-storey car park off Rye Lane, Peckham SE15',
    brief:
      "Two firms meet on the ground deck of the multi-storey behind the Peckhamplex after the last film. One side brings the product in the boot, the other brings the money in a bag, and they do it between their two cars with a man each at their backs. A lookout stands on the ramp and another on the way in off Cerise Road, a shotter walks the yard, and a younger waits by the stair door on the railway path. The van is up Cerise Road.",
    intel: [
      'Seller and buyer between their cars, a muscle each',
      'Lookouts on the ramp and the way in',
      'A shotter in the yard, a younger on the railway path',
      'Take the money and the product both',
    ],
    heat: 4,
    build: buildPeckham,
    samplePlans: peckhamPlans,
    sampleCodes: [
      [40, 'A'],
      [90, 'B'],
    ],
  },
  {
    id: 'brockwell',
    title: 'The pickup, Brockwell Lido',
    place: 'Brockwell Lido, Brockwell Park, Herne Hill SE24',
    brief:
      "The lido shuts at dusk but the pool lights stay on, and the café on the north wall does a different trade after dark. The manager works the till, a bagger fills orders in the café store, and the real stash sits in the plant room in the south wing with a lookout on the door. One shotter sits by the pool and another walks the deck. Their driver waits in the car park with the re-up in the boot. The park side has a younger and a dog. The van is in the car park.",
    intel: [
      'The manager and a bagger in the café',
      'Two shotters on the deck, a lookout on the plant room door',
      'A driver in the car park, a younger and a dog in the park',
      'Plant room unscouted',
    ],
    heat: 4,
    build: buildBrockwell,
    samplePlans: brockwellPlans,
    sampleCodes: [
      [30, 'A'],
      [100, 'B'],
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
