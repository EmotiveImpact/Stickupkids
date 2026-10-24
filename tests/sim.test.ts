import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEstateHouse } from '../src/sim/level.ts';
import { Grid } from '../src/sim/grid.ts';
import { Sim, planSegments, TALK_TIME, type Enemy, type Waypoint } from '../src/sim/sim.ts';
import { payoutFor, revengeRisk } from '../src/sim/payout.ts';
import { inRect, type EnemyDef, type Level, type Vec } from '../src/sim/level.ts';
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

// ------------------------------------------------------------ personalities

/** The crew stand where they are put and do nothing; anyone not placed waits near the van (outside the getaway zone, or they would count as away). */
function standing(level: Level, spots: (Vec | null)[]): Waypoint[][] {
  return level.crewStarts.map((s, i) => {
    const at = spots[i] ?? (inRect(level.exit, s.x, s.y) ? { x: level.exit.x0 - 8.5 - i, y: s.y } : s);
    return [{ ...at, hold: null, kick: false }];
  });
}

function steps(sim: Sim, seconds: number, log?: string[]) {
  const end = sim.time + seconds;
  while (!sim.outcome && sim.time < end) {
    sim.step(1 / 60);
    if (log) for (const e of sim.events) log.push(e.type === 'say' ? `say:${e.text}` : e.type);
    sim.events = [];
  }
}

const enemy = (sim: Sim, id: string) => sim.enemies.find((e) => e.id === id) as Enemy;

/** Burgess Park with only the people named (plus any extra placed by hand). */
function parkWith(ids: string[], extra: EnemyDef[] = []): Level {
  const level = buildBurgessPark();
  level.enemies = [...level.enemies.filter((e) => ids.includes(e.id)), ...extra];
  return level;
}

const man: EnemyDef = { id: 'man', kind: 'soldier', name: 'Man', x: 103.5, y: 124.5, facing: 0, patrol: [] };

test('the old head talks before he shoots, then his men go with him', () => {
  // Dex walks up in front of the Elder by the lamp at the count. A gun alone will not move him.
  const level = parkWith(['elder'], [man]);
  const sim = new Sim(level, standing(level, [{ x: 96.5, y: 124.5 }]));
  const log: string[] = [];
  steps(sim, 2, log);
  assert.equal(enemy(sim, 'elder').state, 'standoff');
  assert.equal(enemy(sim, 'man').state, 'standoff', 'his man waits on his word');
  assert.ok(log.includes('say:WHO SENT YOU?'));
  assert.equal(sim.shots, 0);
  steps(sim, TALK_TIME, log);
  assert.ok(log.includes('say:WRONG ANSWER'), 'nobody talked him down');
  assert.ok(['hostile', 'down'].includes(enemy(sim, 'elder').state));
  assert.ok(['hostile', 'down'].includes(enemy(sim, 'man').state), 'and his man goes with him');
});

test('Taz talks the old head down, and his men stand down with him', () => {
  const level = parkWith(['elder'], [man]);
  const sim = new Sim(level, standing(level, [{ x: 96.5, y: 124.5 }, null, null, { x: 96.5, y: 125.5 }]));
  const log: string[] = [];
  steps(sim, 8, log);
  assert.equal(enemy(sim, 'elder').state, 'subdued');
  assert.equal(enemy(sim, 'man').state, 'subdued', 'he tells his man to leave it');
  assert.equal(sim.shots, 0);
  assert.ok(!log.includes('alert'), 'nobody went hostile');
});

test('a nervous dealer grabs the stash and runs; held up, he drops it; away, it is lost', () => {
  const level = parkWith(['tally']);
  let sim = new Sim(level, standing(level, []));
  const tally = () => enemy(sim, 'tally');
  const cash = () => sim.loot.find((l) => l.def.id === 'cash')!;
  // Something spooks him (as a shout or a gunshot would).
  (sim as unknown as { becomeHostile(e: Enemy, t: Vec): void }).becomeHostile(tally(), { x: 110, y: 124 });
  assert.equal(tally().state, 'fleeing');
  steps(sim, 3);
  assert.equal(cash().state, 'snatched');
  // Kemi steps out in front of him: he gives up and the money hits the floor.
  const k = sim.crew[1];
  k.x = tally().x - 2;
  k.y = tally().y;
  k.facing = 0;
  steps(sim, 2);
  assert.equal(tally().state, 'subdued');
  assert.equal(cash().state, 'placed');
  // Left alone, he gets away with it.
  sim = new Sim(level, standing(level, []));
  (sim as unknown as { becomeHostile(e: Enemy, t: Vec): void }).becomeHostile(tally(), { x: 110, y: 124 });
  steps(sim, 120);
  assert.equal(tally().state, 'gone');
  assert.equal(cash().state, 'lost');
});

test('a neighbour who sees the crew rings 999 unless someone gets to them first', () => {
  const level = buildEstateHouse();
  level.enemies = level.enemies.filter((e) => e.id === 'neighbour');
  // Dex in the front gardens, seven metres off: in sight, too far to hold them up.
  const sim = new Sim(level, standing(level, [{ x: 21.5, y: 20.5 }]));
  const log: string[] = [];
  steps(sim, 10, log);
  assert.ok(sim.policeCalled);
  assert.ok(log.includes('police'));
  assert.ok(sim.police >= 0.25 && sim.policeActive);
  // The estate's sample plan has Jojo get to them mid-call.
  const quiet = new Sim(buildEstateHouse(), samplePlans());
  run(quiet, [[5, 'A'], [20, 'B']]);
  assert.equal(quiet.outcome!.policeCalled, false);
  assert.equal(enemy(quiet, 'neighbour').state, 'subdued');
});

test('a younger runs for help shouting, nobody shoots him in the back, and he brings the backup sooner', () => {
  const level = parkWith(['younger']);
  const sim = new Sim(level, standing(level, []));
  const younger = enemy(sim, 'younger');
  const log: string[] = [];
  (sim as unknown as { becomeHostile(e: Enemy, t: Vec): void }).becomeHostile(younger, { x: 110, y: 128 });
  steps(sim, 4, log);
  assert.equal(younger.state, 'fleeing');
  assert.ok(log.includes('say:OPPS! OPPS!'));
  assert.ok(log.filter((t) => t === 'noise').length >= 2, 'he keeps shouting as he goes');
  // Kemi right behind him: a gun on him, not a bullet in him.
  const k = sim.crew[1];
  k.x = younger.x + 2;
  k.y = younger.y;
  k.facing = Math.PI;
  steps(sim, 0.5);
  assert.equal(sim.shots, 0);
  assert.ok(younger.surrender > 0);
  k.x = 230.5;
  k.y = 120.5;
  steps(sim, 120, log);
  assert.equal(younger.state, 'gone');
  assert.ok(sim.backupT === -2 || sim.backupT <= 15, 'backup on its way sooner');
});

test("a dog's barking brings the others, but not the neighbour; muscle holds his post", () => {
  const level = parkWith(['dog', 'driver', 'neighbour']);
  const sim = new Sim(level, standing(level, []));
  const log: string[] = [];
  (sim as unknown as { becomeHostile(e: Enemy, t: Vec): void }).becomeHostile(enemy(sim, 'dog'), { x: 70.5, y: 30.5 });
  steps(sim, 6, log);
  assert.equal(enemy(sim, 'driver').state, 'hostile');
  assert.ok(log.includes('say:COME THEN'));
  assert.notEqual(enemy(sim, 'neighbour').state, 'calling', 'a barking dog is nothing new');
  const d = enemy(sim, 'driver');
  assert.ok(Math.hypot(d.x - d.home.x, d.y - d.home.y) < 0.5, 'the driver stays by the car');
});

test('clean jobs pay better', () => {
  assert.equal(payoutFor(20000, 0, 3, 0).total, 28000);
  assert.equal(payoutFor(20000, 0, 9, 0).multiplier, 1.45, 'hold-ups count up to +20%');
  assert.equal(payoutFor(20000, 2, 0, 0).total, 14000);
  assert.equal(payoutFor(20000, 0, 0, 1).total, 19000);
  assert.equal(payoutFor(10000, 6, 0, 2).multiplier, 0.3, 'never below 30%');
  assert.equal(payoutFor(0, 0, 4, 0).lines.length, 0, 'no take, no bonus');
  assert.equal(revengeRisk(0, 18), 0);
  assert.equal(revengeRisk(2, 34), 43);
  for (const job of JOBS) {
    const sim = new Sim(job.build(), job.samplePlans());
    run(sim, job.sampleCodes, 400);
    const o = sim.outcome!;
    assert.equal(o.bodies, 0, job.id);
    assert.ok(o.payout.total > o.take, `${job.id}: a quiet plan earns the clean bonus`);
  }
});
