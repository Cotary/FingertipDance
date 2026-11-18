/**
 * 实验：区分「手绘的误差」是【锯齿/分辨率问题】还是【结构翻译问题】。
 *
 * 这决定了「大图能不能解决问题」：
 *   - 若是分辨率问题 → 让设计出超大图 + 烘焙，能救
 *   - 若是结构问题   → 大图救不了，必须改画法（或改用烘焙）
 *
 * 方法：拿真值（基线图）做「降采样→升回」的重采样，
 * 这产生的是**纯高频误差（锯齿/模糊）**，DC 分量几乎不变。
 * 然后把误差分解成：
 *   DC   —— 系统性偏移（整体偏亮/偏暗/偏色）= 结构翻译问题
 *   HF   —— 高频残差（锯齿、边缘、细节错）= 分辨率问题
 *
 * 判读：
 *   若「纯重采样」的 HF 就已经接近手绘的总误差 → 手绘主要是分辨率问题
 *   若「纯重采样」的 HF 远小于手绘总误差 → 手绘主要是结构问题
 */
import fs from 'node:fs';
import path from 'node:path';

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);

const ROOT = path.resolve(process.cwd());
const BASE = path.join(ROOT, 'baseline');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

/** 比对两张同尺寸图，返回 mean / DC / HF / 分块 / 最差像素 */
async function compare(aB64, bB64) {
  return page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej;
      i.src = 'data:image/png;base64,' + s;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, c.width, c.height).data;
    };
    const A = px(ia), B = px(ib);
    if (A.length !== B.length) return { sizeMismatch: true };

    let sum = 0, n = 0, over8 = 0, max = 0;
    let sR = 0, sG = 0, sB = 0;
    const BS = 32;
    const blocks = new Map();
    const worst = [];

    for (let i = 0; i < A.length; i += 4) {
      const aA = A[i + 3], aB = B[i + 3];
      if (aA < 8 && aB < 8) continue;
      const dr = A[i] - B[i], dg = A[i + 1] - B[i + 1], db = A[i + 2] - B[i + 2];
      const da = aA - aB;
      const d = Math.sqrt((dr * dr + dg * dg + db * db + da * da) / 4);
      sum += d; n++;
      sR += dr; sG += dg; sB += db;
      if (d > max) max = d;
      if (d > 8) {
        over8++;
        if (worst.length < 8) worst.push({ x: (i / 4) % A[0], d: +d.toFixed(1) });
      }
      const px4 = i / 4;
      const bk = `${Math.floor((px4 % (A.length / 4)) / BS)},${Math.floor(Math.floor(px4 / (A.length / 4)) / BS)}`;
      const e = blocks.get(bk) || { sum: 0, n: 0 };
      e.sum += d; e.n++; blocks.set(bk, e);
    }
    let wb = 0;
    for (const e of blocks.values()) {
      if (e.n < BS * BS * 0.1) continue;
      wb = Math.max(wb, e.sum / e.n);
    }
    const mean = sum / Math.max(1, n);
    const dc = Math.sqrt(sR * sR + sG * sG + sB * sB) / (3 * Math.max(1, n));
    return {
      mean: +mean.toFixed(2),
      pct8: +(over8 / Math.max(1, n) * 100).toFixed(2),
      max: +max.toFixed(1),
      blockMean: +wb.toFixed(2),
      dc: +dc.toFixed(2),
      hf: +Math.sqrt(Math.max(0, mean * mean - dc * dc)).toFixed(2),
      dcRGB: [sR, sG, sB].map(v => +(v / Math.max(1, n)).toFixed(2)),
    };
  }, [aB64, bB64]);
}

/** 生成「降采样 k 倍再升回」的真值版本 */
async function resampled(srcB64, factor) {
  return page.evaluate(async ([src, f]) => {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej;
      i.src = 'data:image/png;base64,' + src;
    });
    const w = Math.round(img.width * f), h = Math.round(img.height * f);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, w, h);
    const c2 = document.createElement('canvas'); c2.width = img.width; c2.height = img.height;
    const x2 = c2.getContext('2d', { willReadFrequently: true });
    x2.imageSmoothingEnabled = true; x2.imageSmoothingQuality = 'high';
    x2.drawImage(c, 0, 0, img.width, img.height);
    return c2.toDataURL('image/png').split(',')[1];
  }, [srcB64, factor]);
}

const TARGETS = ['tile.pale', 'tile.deep', 'tile.stone', 'tile.frost', 'icon.key', 'icon.stone'];

console.log('═'.repeat(84));
console.log('实验：把真值降采样 k 倍再升回 —— 制造「纯分辨率」误差');
console.log('  若手绘误差主要由分辨率造成，这里的 HF 就该接近手绘的总 Δ');
console.log('═'.repeat(84));
console.log('元素          k=1/3              k=1/2              k=1/4');
console.log('              mean   DC    HF    mean   DC    HF    mean   DC    HF');
console.log('─'.repeat(84));

const agg = { '1/3': [], '1/2': [], '1/4': [] };
for (const t of TARGETS) {
  const bp = path.join(BASE, `${t}.png`);
  if (!fs.existsSync(bp)) { console.log(`${t.padEnd(12)} (无基线)`); continue; }
  const a = fs.readFileSync(bp).toString('base64');
  const cells = [];
  for (const [label, f] of [['1/3', 1 / 3], ['1/2', 1 / 2], ['1/4', 1 / 4]]) {
    const b = await resampled(a, f);
    const r = await compare(a, b);
    cells.push(`${String(r.mean).padStart(5)} ${String(r.dc).padStart(6)} ${String(r.hf).padStart(6)}`);
    agg[label].push(r);
  }
  console.log(`${t.padEnd(12)} ${cells.join('  ')}`);
}

console.log();
console.log('汇总（各元素平均）：');
for (const [label, arr] of Object.entries(agg)) {
  if (!arr.length) continue;
  const avg = (k) => (arr.reduce((s, r) => s + r[k], 0) / arr.length).toFixed(2);
  console.log(`  降到 ${label.padEnd(4)} →  mean ${avg('mean').padStart(5)}   DC ${avg('dc').padStart(5)}   HF ${avg('hf').padStart(5)}`);
}

console.log();
console.log('═'.repeat(84));
console.log('对照：doc 40 实测的手绘路线总误差 = mean 5.29 / pct8 17.4%');
console.log('═════��══════════════════════════════════════════════════════════════════');
console.log();
console.log('判读：');
console.log('  • 重采样的 DC 若很小 → 说明它只制造了「锯齿/模糊」，是纯分辨率问题');
console.log('  • 手绘 5.29 若 ≫ 同等分辨率下的重采样误差 → 手绘的主要问题是【结构翻译】');
console.log('    （阴影层序、模糊近似、渐变停靠点算错），大图救不了');
console.log('  • 但若手绘 5.29 ≈ 重采样误差 → 那确实是分辨率问题，大图 + 烘焙能救');

await browser.close();
