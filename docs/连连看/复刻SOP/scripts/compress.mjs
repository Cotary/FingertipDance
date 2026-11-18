/**
 * 贴图压缩验证 —— 27MB PNG 会把微信 4MB 首包直接撑爆，必须压缩。
 * 这里实测 WebP / AVIF 的实际体积与保真度，给决策提供数字。
 */
import fs from 'node:fs';
import path from 'node:path';
const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);

const DIR = path.join(process.cwd(), 'baked');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png'));

const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<html></html>');

let totPng = 0, totWebp = 0;
const rows = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(DIR, f));
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  totPng += buf.length;

  const r = await p.evaluate(async (src) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const out = {};
    for (const q of [0.95, 0.9, 0.8]) {
      const u = c.toDataURL('image/webp', q);
      out['webp' + q] = Math.round((u.length - 'data:image/webp;base64,'.length) * 0.75);
    }
    // 保真度：webp q0.8 与 png 的像素差
    const wu = c.toDataURL('image/webp', 0.8);
    const wi = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = wu; });
    const c2 = document.createElement('canvas');
    c2.width = wi.width; c2.height = wi.height;
    const x2 = c2.getContext('2d', { willReadFrequently: true });
    x2.drawImage(wi, 0, 0);
    const a = x.getImageData(0, 0, c.width, c.height).data;
    const d2 = x2.getImageData(0, 0, c2.width, c2.height).data;
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] < 8) continue;
      s += Math.sqrt(((a[i] - d2[i]) ** 2 + (a[i + 1] - d2[i + 1]) ** 2 + (a[i + 2] - d2[i + 2]) ** 2) / 3);
      n++;
    }
    return { w: img.width, h: img.height, ...out, fidelity: +(s / n).toFixed(2) };
  }, dataUrl);

  totWebp += r['webp0.8'];
  rows.push({ f, png: buf.length, ...r });
}

await b.close();

rows.sort((a, b) => b.png - a.png);
console.log('文件'.padEnd(26) + '尺寸'.padEnd(12) + 'PNG'.padEnd(11) + 'WebP80'.padEnd(11) + '压缩比'.padEnd(9) + 'WebP80保真Δ');
console.log('─'.repeat(90));
for (const r of rows.slice(0, 12)) {
  console.log(
    r.f.replace('.png', '').padEnd(26) +
    (r.w + '×' + r.h).padEnd(12) +
    (r.png / 1024).toFixed(0).padStart(6) + 'KB  ' +
    (r['webp0.8'] / 1024).toFixed(0).padStart(6) + 'KB  ' +
    (r.png / r['webp0.8']).toFixed(1).padStart(5) + '×   ' +
    String(r.fidelity).padStart(6)
  );
}
console.log('─'.repeat(90));
console.log('合计 '.padEnd(39) + (totPng / 1048576).toFixed(1) + 'MB    ' +
  (totWebp / 1048576).toFixed(2) + 'MB    ' + (totPng / totWebp).toFixed(1) + '×');
console.log('\n微信首包预算 4MB —— WebP 后 ' + (totWebp / 1048576).toFixed(2) + 'MB ' +
  (totWebp < 4 * 1048576 ? '✅ 能装下' : '❌ 仍超限，需减资产或分包'));
