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
await page.getByText('Plan the job').click();

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
await page.screenshot({ path: process.env.OUT ? `${process.env.OUT}/smoke-raid.png` : '/tmp/smoke-raid.png' });

// Over to Burgess Park without a reload: the level swaps and its sample plan gets away.
await page.evaluate(() => window.__game.pickJob('burgess'));
await page.waitForFunction(() => window.__game.job === 'burgess' && document.body.classList.contains('loaded'), null, { timeout: 90000 });
const park = await page.evaluate(() => {
  const g = window.__game;
  g.start(true);
  g.go();
  g.advance(120, [[24, 'A'], [34, 'B']]);
  return g.sim.outcome;
});
assert.equal(park?.reason, 'escaped', 'the park sample plan escapes');
assert.ok(park.take >= 15000, 'and takes the float');
await page.screenshot({ path: process.env.OUT ? `${process.env.OUT}/smoke-park.png` : '/tmp/smoke-park.png' });
assert.deepEqual(errors, [], 'no page errors');
console.log('smoke test passed');
await browser.close();
