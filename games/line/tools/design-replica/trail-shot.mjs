import fs from 'node:fs';
const pw = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pw);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 800, height: 1000 } });
await page.goto('http://127.0.0.1:50002/tools/design-replica/trail-check.html');

try {
  await page.waitForFunction(() => window.__done || window.__error, { timeout: 10000 });
} catch {
  console.log('超时');
}
const steps = await page.evaluate(() => window.__steps);
 if (steps) console.log('规则层实际走法:');
 if (steps) steps.forEach((x) => console.log('  ' + x));
 const err = await page.evaluate(() => window.__error);
if (err) console.log('ERR:', err);

const el = page.locator('#shot');
await el.screenshot({ path: 'trail-check.png', omitBackground: true });
 await page.screenshot({ path: 'trail-zoom.png', clip: { x: 60, y: 150, width: 640, height: 660 } });
console.log('saved');
await browser.close();
