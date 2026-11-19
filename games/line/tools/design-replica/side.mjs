import fs from 'node:fs';
import path from 'node:path';

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);

const BASE = 'I:/work/f-game/docs/连连看/复刻SOP/scripts/baseline';
const SHOTS = 'I:/work/f-game/games/line/shots';

const ids = process.argv.slice(2);
const list = ids.length ? ids : [
  'mise__tile.pale',
  'mise__tile.deep',
  'mise__tile.stone',
  'mise__tile.frost',
  'mingsha__tile.pale',
  'mingsha__tile.deep',
];

const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

const rows = list.map((id) => {
  const a = path.join(BASE, `${id}.png`);
  const c = path.join(SHOTS, `${id}.png`);
  return {
    id,
    hasA: fs.existsSync(a),
    hasC: fs.existsSync(c),
    a: fs.existsSync(a) ? b64(a) : '',
    c: fs.existsSync(c) ? b64(c) : '',
  };
});

const cells = rows.map((r) => `
  <div style="margin-bottom:26px">
    <div style="font:600 13px system-ui;color:#D4AF6A;margin-bottom:8px;letter-spacing:.08em">${r.id}</div>
    <div style="display:flex;gap:14px">
      <div>
        <div style="font:10px system-ui;color:#7A7468;margin-bottom:4px">设计稿</div>
        ${r.hasA ? `<img src="${r.a}" style="width:150px;height:150px;background:#0E1815;border-radius:8px">` : '<div style="width:150px;height:150px;background:#1a1a1a"></div>'}
      </div>
      <div>
        <div style="font:10px system-ui;color:#7A7468;margin-bottom:4px">我们</div>
        ${r.hasC ? `<img src="${r.c}" style="width:150px;height:150px;background:#0E1815;border-radius:8px">` : '<div style="width:150px;height:150px;background:#1a1a1a"></div>'}
      </div>
    </div>
  </div>`).join('');

const browser = await chromium.launch();
const p = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 700, height: 400 } });
await p.setContent(`<!doctype html><html><body style="margin:0;background:#0A0F0C;padding:24px">
  <div style="font:600 16px system-ui;color:#EDE7DA;margin-bottom:20px">设计稿 vs 我们的出图</div>
  <div style="display:flex;flex-wrap:wrap;gap:10px">${cells}</div>
</body></html>`);
await p.waitForTimeout(600);
const out = 'side-by-side.png';
await p.screenshot({ path: out, fullPage: true });
console.log('saved', out);
await browser.close();
