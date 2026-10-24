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

test('rewriting everyone as orders from where they stand changes nothing', () => {
  for (const job of JOBS) {
    const plain = new Sim(job.build(), job.samplePlans());
    run(plain, job.sampleCodes, 400);
    // The same raid, paused every few seconds (pausing rewrites each plan as orders).
    const paused = new Sim(job.build(), job.samplePlans());
    const dt = 1 / 60;
    let next = 0;
    while (!paused.outcome && paused.time < 400) {
      if (paused.time >= next) {
        next += 3;
        for (const c of paused.crew) if (c.state !== 'down' && c.state !== 'escaped') paused.setOrders(c.def.slot, paused.orders(c.def.slot));
      }
      for (const [t, c] of job.sampleCodes) if (paused.time < t && paused.time + dt >= t) paused.callCode(c);
      paused.step(dt);
      paused.events = [];
    }
    assert.equal(paused.outcome?.reason, plain.outcome?.reason, job.id);
    assert.equal(paused.outcome?.take, plain.outcome?.take, job.id);
    assert.equal(paused.time.toFixed(2), plain.time.toFixed(2), job.id);
  }
});

test('mid-raid orders: a new route, a hold for a go code, and a lock still being picked', () => {
  const level = buildEstateHouse();
  const sim = new Sim(level, []);
  const start = sim.orders(1);
  assert.equal(start.length, 1);
  // Send Dex two cells along the street and on, holding at the first for C.
  const s = start[0];
  const hold = { x: s.x + 2, y: s.y, hold: 'C' as const, kick: false };
  const on = { x: s.x + 4, y: s.y, hold: null, kick: false };
  sim.setOrders(1, [...start, hold, on]);
  for (let i = 0; i < 60 * 10; i++) sim.step(1 / 60);
  const dex = sim.crew[0];
  assert.equal(dex.state, 'hold');
  assert.ok(Math.hypot(dex.x - hold.x, dex.y - hold.y) < 0.05);
  // While held, his orders start where he stands, with the hold.
  assert.equal(sim.orders(1)[0].hold, 'C');
  sim.callCode('C');
  for (let i = 0; i < 60 * 10; i++) sim.step(1 / 60);
  assert.ok(Math.hypot(dex.x - on.x, dex.y - on.y) < 0.05);

  // Adding a point further on does not stop someone part way through a lock.
  const raid = new Sim(level, samplePlans());
  let picker = null;
  for (let i = 0; i < 60 * 120 && !picker; i++) {
    raid.step(1 / 60);
    picker = raid.crew.find((c) => c.action?.kind === 'pick' && c.action.t > 0.5) ?? null;
  }
  assert.ok(picker, 'someone picks a lock in the sample plan');
  const act = picker!.action;
  const o = raid.orders(picker!.def.slot);
  o.push({ ...o[o.length - 1] });
  raid.setOrders(picker!.def.slot, o);
  assert.equal(picker!.action, act);
  assert.equal(picker!.state, 'pick');
});
