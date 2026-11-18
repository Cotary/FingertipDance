/**
 * 闸门标定 —— 验证「像素闸门」真的能区分"像"和"不像"
 *
 * 一个检测器如果不标定过，它的"通过"毫无意义。
 * 这个脚本向基线图注入**已知偏差**，检查闸门测出的数字是否与真值一致。
 *
 * ```bash
 * node selftest.mjs
 * ```
 *
 * 用例设计（每个都应得到可预测的结果）：
 *   ① 原图       → Δ=0，必须通过
 *   ② 整体 +2    → 贴近阈值下沿，必须通过
 *   ③ 整体 +5    → 超阈值，必须拒绝
 *   ④ 角落小块 +30 → 全局均值骗不过它，必须拒绝（这条是补盲区用的）
 *   ⑤ 尺寸不符   → 必须拒绝
 *   ⑥ 纯色错位   → 必须拒绝
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const BASELINE = path.join(ROOT, 'baseline');
const THRESH = { mean: 2, pct8: 2, block: 4 };

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

/* 与 baseline.mjs 的 diff() 保持同一口径。
   这里内联一份是为了自测时不依赖被测算的文件（避免"用错的那份测错的那份"）。 */
const DIFF_FN = `async function diffBase64(a, b) {
  const load = (s) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej;
    i.src = 'data:image/png;base64,' + s;
  });
  const px = (img) => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    return { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const A = px(ia), B = px(ib);
  if (A.w !== B.w || A.h !== B.h) return { sizeMismatch: true, sizeA: [A.w, A.h], sizeB: [B.w, B.h] };
  let sum = 0, n = 0, max = 0, over8 = 0;
  const BS = Math.max(8, Math.floor(Math.min(A.w, A.h) / 8));
  const blocks = new Map();
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
    const i = (y * A.w + x) * 4, j = (y * B.w + x) * 4;
    const aA = A.d[i + 3], aB = B.d[j + 3];
    if (aA < 8 && aB < 8) continue;
    const dr = A.d[i] - B.d[j], dg = A.d[i + 1] - B.d[j + 1], db = A.d[i + 2] - B.d[j + 2], da = aA - aB;
    const d = Math.sqrt((dr * dr + dg * dg + db * db + da * da) / 4);
    sum += d; n++; if (d > max) max = d; if (d > 8) over8++;
    const bk = Math.floor(x / BS) + ',' + Math.floor(y / BS);
    const e = blocks.get(bk) || { sum: 0, n: 0 };
    e.sum += d; e.n++; blocks.set(bk, e);
  }
  let blockMean = 0;
  for (const e of blocks.values()) {
    if (e.n < BS * BS * 0.1) continue;
    const m = e.sum / e.n;
    if (m > blockMean) blockMean = m;
  }
  return {
    mean: +(sum / Math.max(1, n)).toFixed(2),
    max: +max.toFixed(1),
    pct8: +(over8 / Math.max(1, n) * 100).toFixed(2),
    blockMean: +blockMean.toFixed(2),
  };
}`;

function verdict(r) {
  if (r.sizeMismatch) return { pass: false, why: `尺寸不一致 ${r.sizeA} vs ${r.sizeB}` };
  if (r.mean > THRESH.mean) return { pass: false, why: `均值 ${r.mean}>${THRESH.mean}` };
  if (r.pct8 > THRESH.pct8) return { pass: false, why: `差>8 ${r.pct8}%>${THRESH.pct8}%` };
  if (r.blockMean > THRESH.block) return { pass: false, why: `分块 ${r.blockMean}>${THRESH.block}` };
  return { pass: true, why: 'ok' };
}

async function main() {
  const basePath = path.join(BASELINE, 'tile.pale.png');
  if (!fs.existsSync(basePath)) {
    console.error('先跑 baseline.mjs --build');
    process.exit(1);
  }
  const src = fs.readFileSync(basePath).toString('base64');

  const { chromium } = await import(pwPath);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.evaluate(DIFF_FN);

  // ── 造变体 ──
  const variants = await page.evaluate(async (src) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const img = await load(src);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);

    const make = (fn) => {
      const o = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
      for (let i = 0; i < o.data.length; i += 4) fn(o.data, i);
      const cc = document.createElement('canvas');
      cc.width = d.width; cc.height = d.height;
      cc.getContext('2d').putImageData(o, 0, 0);
      return cc.toDataURL('image/png').split(',')[1];
    };

    return {
      identity:   src,
      bright2:    make((a, i) => { a[i] += 2; a[i + 1] += 2; a[i + 2] += 2; }),
      bright5:    make((a, i) => { a[i] += 5; a[i + 1] += 5; a[i + 2] += 5; }),
      // 可见区内一小块偏 +30 —— 全局均值会被摊薄，分块闸要抓住。
      // 注意：不能注入到图像四角，因为隔离后的贴图四角是透明的，
      // 透明像素不参与比对（这是正确行为），注入到那里等于没注入。
      // 取中心偏右下 10%×10%，确保落在棋子本体上。
      corner:     make((a, i) => {
        const p = i / 4, px = p % d.width, py = Math.floor(p / d.width);
        const inX = px > d.width * 0.55 && px < d.width * 0.65;
        const inY = py > d.height * 0.55 && py < d.height * 0.65;
        if (inX && inY) { a[i] += 30; a[i + 1] += 30; a[i + 2] += 30; }
      }),
      // 整体色相偏移（模拟"用了近似色"而不是原值）
      hueShift:   make((a, i) => { a[i] += 12; a[i + 1] -= 6; a[i + 2] += 4; }),
      // 尺寸不符
      wrongSize:  (() => {
        const cc = document.createElement('canvas');
        cc.width = d.width + 10; cc.height = d.height + 10;
        const cx = cc.getContext('2d');
        cx.fillStyle = '#0E1815'; cx.fillRect(0, 0, cc.width, cc.height);
        cx.drawImage(c, 0, 0);
        return cc.toDataURL('image/png').split(',')[1];
      })(),
    };
  }, src);

  const cases = [
    { k: 'identity',  expect: true,  note: '完全一致 —— 闸门不该误报' },
    { k: 'bright2',   expect: true,  note: '整体 +2 —— 阈值下沿，应放行' },
    { k: 'bright5',   expect: false, note: '整体 +5 —— 超过 2，必须拒' },
    { k: 'corner',    expect: false, note: '角落 1% 偏 +30 —— 全局均值盲区，必须拒' },
    { k: 'hueShift',  expect: false, note: '整体偏色 —— 模拟用近似色而非原值' },
    { k: 'wrongSize', expect: false, note: '尺寸不符 —— 必须拒' },
  ];

  console.log('判据：均值 ≤' + THRESH.mean + ' ｜ 差>8 ≤' + THRESH.pct8 + '% ｜ 分块 ≤' + THRESH.block);
  console.log('');
  console.log('用例'.padEnd(12) + '均值'.padEnd(8) + '差>8'.padEnd(9) + '分块'.padEnd(8) + '最大'.padEnd(8) + '结果   期望   说明');
  console.log('─'.repeat(100));

  let ok = 0;
  for (const c of cases) {
    const r = await page.evaluate(([a, b]) => window.diffBase64 ? window.diffBase64(a, b) : (async () => {
      // 暴露到 window
      return null;
    })(), [src, variants[c.k]]);

    // diffBase64 是局部函数，需显式挂到 window
    const res = await page.evaluate(async ([a, b]) => {
      // eslint-disable-next-line no-undef
      return await diffBase64(a, b);
    }, [src, variants[c.k]]).catch(async () => {
      // 兜底：重新注入并求值
      return await page.evaluate(async ([a, b, fn]) => {
        const f = new Function('return (' + fn + ')')();
        return await f(a, b);
      }, [src, variants[c.k], DIFF_FN.replace(/^async function diffBase64/, 'async function ')]);
    });

    const v = verdict(res);
    const good = v.pass === c.expect;
    if (good) ok++;
    console.log(
      c.k.padEnd(12) +
      String(res.mean).padEnd(8) +
      String(res.pct8 + '%').padEnd(9) +
      String(res.blockMean ?? '—').padEnd(8) +
      String(res.max ?? '—').padEnd(8) +
      (v.pass ? '通过 ' : '拒绝 ') + '  ' +
      (c.expect ? '通过 ' : '拒绝 ') + '  ' +
      (good ? '✓ ' : '✗ ') + c.note
    );
  }

  console.log('─'.repeat(100));
  console.log(`${ok} / ${cases.length} 用例符合预期`);

  await browser.close();
  if (ok !== cases.length) process.exitCode = 1;
}

await main();
