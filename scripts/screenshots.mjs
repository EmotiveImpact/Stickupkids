// Headless screenshots of the running game. Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const shots = (process.env.SHOTS ?? 'title=?|planning=?auto=planning|raid=?auto=raid&t=11|paused=?auto=raid&t=24&pause=1|results=?auto=raid&t=90').split('|').map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
for (const [name, query] of shots) {
  await page.goto(base + query);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.WAIT ?? 2500));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', `${out}/${name}.png`);
}
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
await browser.close();
