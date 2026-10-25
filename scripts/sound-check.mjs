// Plays the sample plan in headless Chromium and checks the sound engine
// loads every file, starts its beds and fires effects as the raid happens.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.text().startsWith('sound') && errors.push(m.text()));
// Note every sound that starts, by its length (each file's length is known).
await page.addInitScript(() => {
  window.__played = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__played.push({ d: Math.round((this.buffer?.duration ?? 0) * 100) / 100, loop: this.loop });
    return start.apply(this, a);
  };
});
await page.goto(`${base}?job=estate`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.mouse.click(4, 4);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.start(true));
await page.waitForTimeout(500);
await page.evaluate(() => window.__game.go());
// Headless frames are slow, so push the raid on half a second at a time and
// let each frame hand its events to the sound engine. Codes go in on the way.
const codes = ['A', 'B', 'C'];
for (let i = 0; i < 120; i++) {
  const done = await page.evaluate(() => {
    window.__game.advance(0.5);
    return !!window.__game.sim.outcome;
  });
  if (i % 12 === 6 && codes.length) await page.evaluate((c) => window.__game.code(c), codes.shift());
  await page.waitForTimeout(120);
  if (done) break;
}
console.log('raid', await page.evaluate(() => ({ t: Math.round(window.__game.sim.time), outcome: window.__game.sim.outcome?.reason })));
await page.waitForTimeout(2500);
const played = await page.evaluate(() => window.__played);
const beds = played.filter((p) => p.loop).length;
const shots = played.filter((p) => !p.loop).length;
console.log(`beds started ${beds}, effects played ${shots}`);
console.log(JSON.stringify(played.slice(0, 60)));
assert.ok(beds >= 2, 'ambience beds started');
assert.ok(shots >= 10, 'effects played during the raid');
assert.deepEqual(errors, [], 'no sound errors');
await browser.close();
