import fs from 'node:fs';

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);

const BASE = 'I:/work/f-game/docs/连连看/复刻SOP/scripts/baseline';
const SHOTS = 'I:/work/f-game/games/line/shots';

const ids = [
  'mise__tile.pale', 'mise__tile.deep', 'mise__tile.frost', 'mise__tile.stone',
  'mingsha__tile.pale', 'mingsha__tile.deep', 'mingsha__tile.frost', 'mingsha__tile.stone',
];

const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

const cells = ids.map((id) => `
  <div style="width:230px">
    <div style="font:600 11px system-ui;color:#D4AF6A;margin-bottom:6px;letter-spacing:.06em">${id}</div>
    <div style="display:flex;gap:6px">
      <div>
        <div style="font:9px system-ui;color:#7A7468;margin-bottom:3px">设计稿</div>
        <img src="${b64(`${BASE}/${id}.png`)}" style="width:108px;height:108px;background:#0E1815;border-radius:6px">
      </div>
      <div>
        <div style="font:9px system-ui;color:#7A7468;margin-bottom:3px">我们</div>
        <img src="${b64(`${SHOTS}/${id}.png`)}" style="width:108px;height:108px;background:#0E1815;border-radius:6px">
      </div>
    </div>
  </div>`).join('');

const browser = await chromium.launch();
const p = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1100, height: 500 } });
await p.setContent(`<!doctype html><html><body style="margin:0;background:#0A0F0C;padding:26px">
  <div style="font:600 17px system-ui;color:#EDE7DA;margin-bottom:6px">40 文档流程实跑结果 · 两套主题 × 4 种基础格</div>
  <div style="font:11px system-ui;color:#7A7468;margin-bottom:22px;line-height:1.9">
    左＝设计稿真值（baseline）　右＝游戏侧出图（shots）　口径：DPR3、按 manifest 尺寸与 pad
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:16px">${cells}</div>
</body></html>`);
await p.waitForTimeout(700);
await p.screenshot({ path: 'shoot-report.png', fullPage: true });
console.log('saved shoot-report.png');
await browser.close();
