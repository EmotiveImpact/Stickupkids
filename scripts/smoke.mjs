// Drives the game with a real mouse and keyboard in headless Chromium:
// plan a route by clicking, press Enter, check the raid runs and pauses.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
// Past the title, onto the job board. Every job's Plan button has to sit on screen.
await page.keyboard.press('Enter');
const plan = page.getByRole('button', { name: 'Plan the job' });
const box = await plan.boundingBox();
assert.ok(box && box.y + box.height <= 900, 'Plan the job is on screen');
await plan.click();

const clickMap = async (x, y, button = 'left') => {
  const p = await page.evaluate(([x, y]) => window.__game.toScreen(x, y), [x, y]);
  await page.mouse.click(p.x, p.y, { button });
  await page.waitForTimeout(80);
};

// Dex: through the front gate to the front door, then hold for A.
await page.keyboard.press('1');
await clickMap(12.5, 20.5);
await clickMap(12.5, 17.5);
await clickMap(9.5, 16.5);
let plans = await page.evaluate(() => window.__game.plans.map((p) => p.length));
assert.equal(plans[0], 4, 'three waypoints added for Dex');
// Right click removes the last point.
await clickMap(9.5, 16.5, 'right');
plans = await page.evaluate(() => window.__game.plans.map((p) => p.length));
assert.equal(plans[0], 3, 'right click removed a point');
// Select the gate point and hold it for A.
await clickMap(12.5, 20.5);
await page.keyboard.press('a');
const hold = await page.evaluate(() => window.__game.plans[0][1].hold);
assert.equal(hold, 'A', 'gate point holds for A');
// Kemi: walk to the front door.
await page.keyboard.press('2');
await clickMap(13.5, 20.5);
await page.screenshot({ path: process.env.OUT ? `${process.env.OUT}/smoke-planning.png` : '/tmp/smoke-planning.png' });

await page.keyboard.press('Enter');
assert.equal(await page.evaluate(() => window.__game.phase), 'raid');
// Software WebGL is slow, so wait for the clock to tick, then fast-forward.
await page.waitForFunction(() => window.__game.sim.time > 0.1, null, { timeout: 30000 });
await page.evaluate(() => window.__game.advance(4));
const dexState = await page.evaluate(() => window.__game.sim.crew[0].state);
assert.equal(dexState, 'hold', 'Dex waits at the gate for A');
await page.keyboard.press('a');
await page.evaluate(() => window.__game.advance(1));
assert.notEqual(await page.evaluate(() => window.__game.sim.crew[0].state), 'hold', 'A releases Dex');
await page.keyboard.press(' ');
const t1 = await page.evaluate(() => window.__game.sim.time);
await page.waitForTimeout(700);
const t2 = await page.evaluate(() => window.__game.sim.time);
assert.equal(t1, t2, 'pause stops the clock');

// Paused: redraw Kemi's route from where she stands, hold its first point for B.
// Two open cells in a line from where she stands, found by the page's own grid.
const [p1, p2] = await page.evaluate(() => {
  const s = window.__game.sim;
  const k = s.crew[1];
  const cx = Math.floor(k.x) + 0.5;
  const cy = Math.floor(k.y) + 0.5;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const a = { x: cx + dx * 2, y: cy + dy * 2 };
    const b = { x: cx + dx * 4, y: cy + dy * 4 };
    if (s.grid.findPath(cx, cy, a.x, a.y, 'crew')?.length === 2 && s.grid.findPath(a.x, a.y, b.x, b.y, 'crew')?.length === 2) return [a, b];
  }
  return [null, null];
});
assert.ok(p1, 'open ground beside Kemi');
await page.keyboard.press('2');
await clickMap(p1.x, p1.y);
await clickMap(p2.x, p2.y);
let orders = await page.evaluate(() => window.__game.sim.orders(2));
assert.equal(orders.length, 3, 'two clicks redraw Kemi from where she stands');
assert.deepEqual([orders[1].x, orders[1].y], [p1.x, p1.y]);
await clickMap(p1.x, p1.y);
await page.keyboard.press('b');
orders = await page.evaluate(() => window.__game.sim.orders(2));
assert.equal(orders[1].hold, 'B', 'her first point holds for B');
assert.equal(await page.evaluate(() => window.__game.sim.codes.has('B')), false, 'picking a point and pressing B sets a hold, not the code');
await page.screenshot({ path: process.env.OUT ? `${process.env.OUT}/smoke-orders.png` : '/tmp/smoke-orders.png' });
await page.keyboard.press(' ');
await page.evaluate(() => window.__game.advance(4));
let kemi = await page.evaluate(() => window.__game.sim.crew[1]);
assert.equal(kemi.state, 'hold', 'Kemi waits at her new point for B');
assert.ok(Math.hypot(kemi.x - p1.x, kemi.y - p1.y) < 0.05);
await page.keyboard.press('b');
await page.evaluate(() => window.__game.advance(3));
kemi = await page.evaluate(() => window.__game.sim.crew[1]);
assert.ok(Math.hypot(kemi.x - p2.x, kemi.y - p2.y) < 0.05, 'B sends her on');

// Live, with no pause: a click on the map alone does nothing; click Kemi, then where she goes.
await page.keyboard.press('Escape');
await clickMap(p1.x, p1.y);
assert.equal((await page.evaluate(() => window.__game.sim.orders(2))).length, 1, 'a stray click gives no order');
const k0 = await page.evaluate(() => window.__game.sim.crew[1]);
await clickMap(k0.x, k0.y);
// The hint follows within a frame or two (software WebGL is slow).
await page.waitForFunction(() => /Click where Kemi should go/.test(document.querySelector('.hint').textContent), null, { timeout: 15000 });
await clickMap(p1.x, p1.y);
orders = await page.evaluate(() => window.__game.sim.orders(2));
assert.deepEqual([orders[1].x, orders[1].y], [p1.x, p1.y], 'Kemi takes the live order');
await page.evaluate(() => window.__game.advance(3));
kemi = await page.evaluate(() => window.__game.sim.crew[1]);
assert.ok(Math.hypot(kemi.x - p1.x, kemi.y - p1.y) < 0.05, 'and walks there');
await page.keyboard.press(' ');
await page.screenshot({ path: process.env.OUT ? `${process.env.OUT}/smoke-raid.png` : '/tmp/smoke-raid.png' });

// Over to Burgess Park without a reload: the level swaps and its sample plan gets away.
await page.evaluate(() => window.__game.pickJob('burgess'));
await page.waitForFunction(() => window.__game.job === 'burgess' && document.body.classList.contains('loaded'), null, { timeout: 90000 });
const park = await page.evaluate(() => {
  const g = window.__game;
  g.start(true);
  g.go();
  g.advance(240, [[62, 'A'], [86, 'B']]);
  return g.sim.outcome;
});
assert.equal(park?.reason, 'escaped', 'the park sample plan escapes');
assert.ok(park.take >= 15000, 'and takes the float');
await page.screenshot({ path: process.env.OUT ? `${process.env.OUT}/smoke-park.png` : '/tmp/smoke-park.png' });

// The replay plays the same raid again and ends the same way.
await page.getByRole('button', { name: 'Watch the replay' }).click();
await page.waitForFunction(() => window.__game.phase === 'replay' && window.__game.sim.time > 0, null, { timeout: 30000 });
const again = await page.evaluate(() => window.__game.finishReplay());
assert.deepEqual(again, park, 'the replay ends as the raid did');
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__game.phase === 'results', null, { timeout: 10000 });
// The two other kinds of job: a ride out on the opps, and holding the trap.
for (const [id, check] of [
  ['rideout', (o) => o.reason === 'escaped' && o.caught >= 4],
  ['slid', (o) => (o.reason === 'heldIt' || o.reason === 'police') && o.kept >= 16000],
]) {
  await page.evaluate((j) => window.__game.pickJob(j), id);
  await page.waitForFunction((j) => window.__game.job === j && document.body.classList.contains('loaded'), id, { timeout: 90000 });
  const o = await page.evaluate(() => {
    const g = window.__game;
    g.start(true);
    g.go();
    g.advance(200);
    return g.sim.outcome;
  });
  assert.ok(o && check(o), `the ${id} sample plan works: ${JSON.stringify(o && { reason: o.reason, caught: o.caught, kept: o.kept })}`);
}
assert.deepEqual(errors, [], 'no page errors');
console.log('smoke test passed');
await browser.close();
