import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEstateHouse } from '../src/sim/level.ts';
import { Grid } from '../src/sim/grid.ts';
import { Sim, planSegments, type Waypoint } from '../src/sim/sim.ts';
import { samplePlans } from '../src/sim/samplePlan.ts';
import { buildBurgessPark } from '../src/sim/burgess.ts';
import { JOBS } from '../src/sim/jobs.ts';

test('walls block sight, windows do not', () => {
  const g = new Grid(buildEstateHouse());
  // Through the kitchen side window from the side passage.
  assert.equal(g.lineOfSight(27.5, 10.5, 22.5, 10.5), true);
  // Through the wall between the kitchen and the hall.
  assert.equal(g.lineOfSight(16.5, 11.5, 12.5, 11.5), false);
  // Closed door blocks sight until opened.
  assert.equal(g.lineOfSight(12.5, 16.5, 9.5, 16.5), false);
  g.setDoor(11, 16, 'open');
  assert.equal(g.lineOfSight(12.5, 16.5, 9.5, 16.5), true);
});

test('dogs cannot path through shut doors, crew can', () => {
  const g = new Grid(buildEstateHouse());
  assert.ok(g.findPath(19.5, 5.5, 19.5, 9.5, 'crew'));
  assert.equal(g.findPath(19.5, 5.5, 19.5, 9.5, 'dog'), null);
});

test('every sample plan segment is reachable', () => {
  const level = buildEstateHouse();
  const g = new Grid(level);
  for (const plan of samplePlans()) {
    for (const seg of planSegments(g, plan)) assert.ok(seg.length > 0);
  }
});

function run(sim: Sim, codes: [number, 'A' | 'B' | 'C'][], maxT = 240) {
  const dt = 1 / 60;
  const log: string[] = [];
  while (!sim.outcome && sim.time < maxT) {
    for (const [t, c] of codes) if (sim.time < t && sim.time + dt >= t) sim.callCode(c);
    sim.step(dt);
    for (const e of sim.events) if (e.type !== 'noise' && e.type !== 'shot') log.push(`${sim.time.toFixed(1)} ${JSON.stringify(e)}`);
    sim.events = [];
  }
  return log;
}

test('the sample plan gets the crew out with the loot', () => {
  const sim = new Sim(buildEstateHouse(), samplePlans());
  const log = run(sim, [[5, 'A'], [20, 'B']]);
  if (process.env.SIM_LOG) console.log(log.join('\n'), sim.outcome, sim.crew.map((c) => [c.def.name, c.state, c.hp, c.x.toFixed(1), c.y.toFixed(1)]));
  assert.ok(sim.outcome, 'job should end');
  assert.equal(sim.outcome!.reason, 'escaped');
  assert.ok(sim.outcome!.take >= 15000, `take was ${sim.outcome!.take}`);
});

test('kicking the front door is loud and starts the police clock', () => {
  const plans = samplePlans();
  plans[1][1].kick = true;
  const sim = new Sim(buildEstateHouse(), plans);
  run(sim, [[5, 'A'], [20, 'B']], 15);
  assert.ok(sim.police > 0.05);
});

test('with no plan nobody moves and driving off ends the job', () => {
  const level = buildEstateHouse();
  const sim = new Sim(level, []);
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  assert.equal(sim.outcome, null);
  sim.driveOff();
  assert.equal(sim.outcome!.reason, 'droveOff');
  assert.equal(sim.outcome!.take, 0);
});

test('a reckless plan through the front door turns into a firefight', () => {
  const level = buildEstateHouse();
  const kickIn = (sx: number, sy: number): Waypoint[] => [
    { x: sx, y: sy, hold: null, kick: true },
    { x: 12.5, y: 18.5, hold: null, kick: true },
    { x: 17.5, y: 11.5, hold: null, kick: true },
    { x: 3.5, y: 22.5, hold: null, kick: false },
  ];
  const sim = new Sim(level, level.crewStarts.map((s) => kickIn(s.x, s.y)));
  run(sim, [], 120);
  assert.ok(sim.shots > 0, 'shots should be fired');
  assert.ok(sim.police > 0.2, 'police clock should be well under way');
});

test('every job has a plan that gets out quietly with the money', () => {
  for (const job of JOBS) {
    const level = job.build();
    const g = new Grid(level);
    for (const plan of job.samplePlans()) for (const seg of planSegments(g, plan)) assert.ok(seg.length > 0, `${job.id} plan reachable`);
    const sim = new Sim(level, job.samplePlans());
    run(sim, job.sampleCodes, 400);
    assert.equal(sim.outcome?.reason, 'escaped', job.id);
    assert.ok(sim.outcome!.take >= 15000, `${job.id} take was ${sim.outcome!.take}`);
  }
});

test('in the park, lamplight decides how far off they see you', () => {
  const sim = new Sim(buildBurgessPark(), []);
  // Under the lamp by the picnic table, and out on the dark grass.
  assert.ok(sim.visibility({ x: 100.5, y: 121.5 }) > 0.95);
  assert.ok(sim.visibility({ x: 150.5, y: 60.5 }) < 0.6);
  // The estate is lit all over.
  assert.equal(new Sim(buildEstateHouse(), []).visibility({ x: 2.5, y: 4.5 }), 1);
});

test('shrubs block sight and movement, water blocks movement only', () => {
  const level = buildBurgessPark();
  const g = new Grid(level);
  assert.equal(g.passable(102, 128, 'crew'), false);
  assert.equal(g.lineOfSight(99.5, 128.5, 105.5, 128.5), false);
  level.tiles[0][0] = 'w';
  assert.equal(new Grid(level).passable(0, 0, 'crew'), false);
  assert.equal(new Grid(level).blocksSight(0, 0), false);
});
