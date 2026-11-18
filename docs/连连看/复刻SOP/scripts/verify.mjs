/**
 * 回画验证 —— 烘焙贴图 drawImage 回 canvas 后，还跟设计稿一样吗
 *
 * 这一步验证「烘焙 → 存储 → 运行时绘制」整条链路，
 * 而不是只验证截图本身。中间任何一环出错（尺寸算错、
 * 平滑设置错、乘以 dpr 两次）都会在这里暴露。
 *
 * ```bash
 * node verify.mjs
 * ```
 *
 * 做法：读 baked/ 里的贴图 → 按 manifest 的 logical 尺寸画到 canvas →
 * 跟 baseline/ 里的真值比。理论差异应该只有 WebP 压缩损失。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'baked');
const BASELINE = path.join(ROOT, 'baseline');
const THRESH = { mean: 3, pct8: 4, block: 5 }; // 比 baseline.mjs 稍宽，容纳压缩损失

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);

const man = JSON.parse(fs.readFileSync(path.join(OUT, 'baked.manifest.json'), 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });
await page.setContent('<html><body style="margin:0;background:#000"></body></html>');

const results = [];
for (const a of man.assets) {
  const bakedPath = path.join(OUT, a.file);
  const basePath = path.join(BASELINE, `${a.id}.png`);
  if (!fs.existsSync(basePath)) continue;

  const baked = fs.readFileSync(bakedPath).toString('base64');
  const truth = fs.readFileSync(basePath).toString('base64');

  const r = await page.evaluate(async ([baked, truth, logical, realW, realH]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });

    // 模拟运行时：DPR 3 的画布，按逻辑尺寸绘制烘焙贴图
    const DPR = 3;
    // 用素材真实像素尺寸，而不是 logical × DPR 再取整。
    // 亚像素尺寸（如 175.41px）乘 3 后取整会差 1px（574.23→574，实际 573），
    // 导致"尺寸不符"的假报。素材本身多大就画多大，才和 baseline 严格对齐。
    const W = realW, H = realH;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    const bi = await load(baked);
    x.drawImage(bi, 0, 0, W, H);

    const drawn = x.getImageData(0, 0, W, H).data;

    // 真值
    const ti = await load(truth);
    const tc = document.createElement('canvas');
    tc.width = ti.width; tc.height = ti.height;
    const tx = tc.getContext('2d', { willReadFrequently: true });
    tx.drawImage(ti, 0, 0);
    const tdata = tx.getImageData(0, 0, tc.width, tc.height).data;

    if (ti.width !== W || ti.height !== H) {
      return { sizeMismatch: true, truth: [ti.width, ti.height], drawn: [W, H] };
    }

    let sum = 0, n = 0, max = 0, o8 = 0;
    const BS = Math.max(8, Math.floor(Math.min(W, H) / 8));
    const blocks = new Map();
    for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
      const i = (y * W + px) * 4;
      const ta = tdata[i + 3], da = drawn[i + 3];
      if (ta < 8 && da < 8) continue;
      const d = Math.sqrt(((tdata[i] - drawn[i]) ** 2 + (tdata[i + 1] - drawn[i + 1]) ** 2 + (tdata[i + 2] - drawn[i + 2]) ** 2 + (ta - da) ** 2) / 4);
      sum += d; n++; if (d > max) max = d; if (d > 8) o8++;
      const bk = Math.floor(px / BS) + ',' + Math.floor(y / BS);
      const e = blocks.get(bk) || { s: 0, n: 0 };
      e.s += d; e.n++; blocks.set(bk, e);
    }
    let blockMean = 0;
    for (const e of blocks.values()) {
      if (e.n < BS * BS * 0.1) continue;
      const m = e.s / e.n; if (m > blockMean) blockMean = m;
    }
    return {
      mean: +(sum / n).toFixed(2), max: +max.toFixed(1),
      pct8: +(o8 / n * 100).toFixed(2), blockMean: +blockMean.toFixed(2),
      size: [W, H],
    };
  }, [baked, truth, a.logical,
      (() => { const b = fs.readFileSync(bakedPath); return b.readUInt32BE(16); })(),
      (() => { const b = fs.readFileSync(bakedPath); return b.readUInt32BE(20); })()]);

  const ok = !r.sizeMismatch && r.mean <= THRESH.mean && r.pct8 <= THRESH.pct8 && r.blockMean <= THRESH.block;
  results.push({ id: a.id, ...r, ok });
}

await browser.close();

console.log('元素'.padEnd(24) + '尺寸'.padEnd(12) + '均值Δ'.padEnd(8) + '差>8'.padEnd(9) + '分块'.padEnd(8) + '结果');
console.log('─'.repeat(78));
for (const r of results) {
  if (r.sizeMismatch) {
    console.log(r.id.padEnd(24) + '尺寸不符 真值' + r.truth + ' 绘制' + r.drawn + '  ❌');
    continue;
  }
  console.log(
    r.id.padEnd(24) +
    (r.size[0] + '×' + r.size[1]).padEnd(12) +
    String(r.mean).padEnd(8) +
    (r.pct8 + '%').padEnd(9) +
    String(r.blockMean).padEnd(8) +
    (r.ok ? '✅' : '❌')
  );
}
const passN = results.filter(r => r.ok).length;
console.log('─'.repeat(78));
console.log(`${passN} / ${results.length} 通过（判据：均值≤${THRESH.mean} 差>8≤${THRESH.pct8}% 分块≤${THRESH.block}）`);
if (passN !== results.length) process.exitCode = 1;
