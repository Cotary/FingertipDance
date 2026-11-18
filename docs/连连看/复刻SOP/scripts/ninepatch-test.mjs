/**
 * 九宫格拉伸验证 —— 贴图路线能不能用于面板，全看这一步。
 *
 * 问题：圆角 + 阴影的矩形，直接 drawImage 拉伸会把圆角拉成椭圆、阴影拉断。
 * 解法：切成 9 片，只拉伸中间和边。
 *
 * 这里验证：用九宫格把 170px 的面板拉到 300px，看角是否还是圆的。
 */
import fs from 'node:fs';
import path from 'node:path';
const pw = process.env.PLAYWRIGHT_PATH || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pw);

const DIR = path.join(process.cwd(), 'baked');
const man = JSON.parse(fs.readFileSync(path.join(DIR,'baked.manifest.json'),'utf8'));
const asset = man.assets.find(a => a.id === 'panel.state-card');
const png = fs.readFileSync(path.join(DIR, asset.file)).toString('base64');
const S = asset.ninePatch.slices;
const logical = asset.logical;
const DPR = 3;

const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: 1, viewport:{width:2350,height:1450} });
await p.setContent('<html><body style="margin:0;background:#0C1310"></body></html>');

const shot = await p.evaluate(async ([b64, S, logical, DPR]) => {
  const load = s => new Promise(r => { const i=new Image(); i.onload=()=>r(i); i.src='data:image/png;base64,'+s; });
  const img = await load(b64);
  const sw = img.width, sh = img.height;

  const canvas = document.createElement('canvas');
  canvas.width = 2300; canvas.height = 1400;
  canvas.style.cssText = 'display:block';
  document.body.appendChild(canvas);
  const x = canvas.getContext('2d');
  x.imageSmoothingQuality = 'high';

  // 目标：把内容 170×233 拉到 300×380（逻辑），乘 DPR
  const targetW = Math.round(300 * DPR), targetH = Math.round(330 * DPR);
  const OX = 40, OY = 40;

  // 源切片（素材像素）
  const sL = S.left, sR = S.right, sT = S.top, sB = S.bottom;
  const sCw = sw - sL - sR, sCh = sh - sT - sB;
  // 目标切片（等比：角保持原尺寸，中间拉伸）
  const k = targetW / (logical.w * DPR);   // 横向放大倍数
  const kH = targetH / (logical.h * DPR);
  const dL = sL, dR = sR, dT = sT, dB = sB;
  const dCw = targetW - dL - dR, dCh = targetH - dT - dB;

  const xs = [0, sL, sw - sR, sw];
  const ys = [0, sT, sh - sB, sh];
  const dxs = [0, dL, dL + dCw, targetW];
  const dys = [0, dT, dT + dCh, targetH];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const sw2 = xs[c+1]-xs[c], sh2 = ys[r+1]-ys[r];
      const dw2 = dxs[c+1]-dxs[c], dh2 = dys[r+1]-dys[r];
      if (sw2 <= 0 || sh2 <= 0) continue;
      x.drawImage(img, xs[c], ys[r], sw2, sh2, OX+dxs[c], OY+dys[r], dw2, dh2);
    }
  }

  // 右边：直接拉伸（对照）
  const OX2 = 40 + targetW + 60;
  x.drawImage(img, 0, 0, sw, sh, OX2, OY, targetW, targetH);

  // 标签
  x.fillStyle = '#7A7468';
  x.font = '600 20px "Noto Sans SC", system-ui, sans-serif';
  x.fillText('九宫格拉伸 170→300', OX, OY - 14);
  x.fillText('直接拉伸（对照）', OX2, OY - 14);

  return canvas.toDataURL('image/png').split(',')[1];
}, [png, S, logical, DPR]);

fs.writeFileSync('ninepatch-compare.png', Buffer.from(shot, 'base64'));
await b.close();
console.log('saved ninepatch-compare.png');
