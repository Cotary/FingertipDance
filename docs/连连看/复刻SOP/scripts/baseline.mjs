/**
 * 真值快照 + 像素闸门 —— 复刻流程的"裁判"
 *
 * 这是 40-设计稿复刻可行性研究.md 里 S1/S4 两阶段的实现。
 * 它解决一个具体问题：**"像不像"不应该是肉眼判断**。
 *
 * ## 用法
 *
 * ```bash
 * # 1) 从设计稿建立基线（只需要在换设计稿时跑）
 * node baseline.mjs --build
 *
 * # 2) 拿游戏画面跟基线比（每次改完渲染代码都跑）
 * node baseline.mjs --check
 *
 * # 3) 只查某一个元素（调试时用）
 * node baseline.mjs --check --only tile.pale
 * ```
 *
 * ## 判据
 *
 * 每个元素算四个数（0-255 尺度，CSS 与 canvas 同一色彩空间）：
 *   mean   —— 逐像素 RGB 欧氏距离 ÷√3 的平均值     阈值 ≤ 2
 *   pct8   —— 距离 > 8 的像素占比                  阈值 ≤ 2%
 *   block  —— 8×8 分块里最差那一块的均值            阈值 ≤ 4
 *   max    —— 最差单点（只用于报告，不参与判定）
 *
 * 为什么要单列 block：全局均值有盲区——把一小块改得很明显（某个图标颜色错），
 * 全图均值仍然很低会被放行。实测：角落 1% 区域偏 +30，均值只有 0.25、
 * 差>8 只有 0.96%，全绿通过，但人眼一眼能看出。加了分块才堵住这个洞。
 *
 * 为什么 max 不参与判定：抗锯齿边缘天然会有个别点差异很大（圆角处
 * 一像素的插值差异就能到 40+），用 max 判会永远失败。
 *
 * 为什么 mean 阈值是 2：设计稿与"浏览器自己再渲染一次"的固有差异约 0.5-1，
 * 留一倍余量。实测手绘路线 5.29 → 判红，烘焙路线 0.49 → 通过，区分得很干净。
 * 为什么 pct8 阈值是 2%：允许抗锯齿边缘，但整片区域不允许偏。
 *
 * ## 为什么失败时要输出 RGB 具体值
 *
 * 只说"不一样"没法修。必须能说"坐标 (37,52) 设计稿是 rgb(213,227,216)，
 * 我们是 rgb(198,215,203)" —— 上一轮"整盘系统性偏亮"就是因为没有这个，
 * 靠肉眼查了很久才发现渐变线长度算短了 45%。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const BASELINE = path.join(ROOT, 'baseline');
const REPORT = path.join(ROOT, 'report');

const THRESH = { mean: 2, pct8: 2, block: 4 };

/* ────────────────────────────────────────────────────────────
   元素清单
   ────────────────────────────────────────────────────────────
   每一项 = 一个"必须长得跟设计稿一样"的东西。
   selector 是基线阶段的 CSS 选择器；尺寸用于对齐截图口径。
   DPR 固定 3，是因为设计稿按 375 逻辑宽画、游戏按 750 逻辑宽渲染，
   3 倍超采样才能覆盖到高分屏。 */
export const TARGETS = [
  // ── 棋子：材质 × 状态，共 17 种（设计稿实测 DOM 分布） ──
  // 选择器用「.pc.xxx」而不是截断到父容器，因为同一材质在不同章节
  // 尺寸不同（62/54/44px），第一处命中是图标章节的 62px，口径统一。
  { id: 'tile.pale',        selector: '.pc.pale' },
  { id: 'tile.deep',        selector: '.pc.deep' },
  { id: 'tile.stone',       selector: '.pc.stone' },
  { id: 'tile.frost',       selector: '.pc.frost' },
  { id: 'tile.pale.start',  selector: '.pc.pale.start' },
  { id: 'tile.pale.end',    selector: '.pc.pale.end' },
  { id: 'tile.pale.trail',  selector: '.pc.pale.trail' },
  { id: 'tile.pale.pressed',selector: '.pc.pale.pressed' },
  // tile.pale.hint 有 1.8s 无限呼吸动画（hintBreath），尺寸逐帧变化，
  // 不能进静态基线（每次截图尺寸都可能不同）。动效类元素由 S5 单独验。
  // { id: 'tile.pale.hint',   selector: '.pc.pale.hint' },
  { id: 'tile.pale.oneway', selector: '.pc.pale.oneway' },
  { id: 'tile.pale.key',    selector: '.pc.pale.key-cell' },
  { id: 'tile.pale.door',   selector: '.pc.pale.door-cell' },
  { id: 'tile.pale.portalA',selector: '.pc.pale.portal-a' },
  { id: 'tile.pale.portalB',selector: '.pc.pale.portal-b' },
  { id: 'tile.deep.star',   selector: '.pc.deep.star' },
  { id: 'tile.pale.arrive', selector: '.pc.pale.arrive' },
  // tile.pale.hintcell 同样是 1.8s 无限呼吸（hintCellGlow），同上。
  // { id: 'tile.pale.hintcell', selector: '.pc.pale.hintcell' },

  // ── 图标（8 个机制图标，全在 .icon-stage 里） ──
  { id: 'icon.stone',   selector: '.icon-grid .icon-card:nth-child(1) .icon-stage' },
  { id: 'icon.arrow',   selector: '.icon-grid .icon-card:nth-child(2) .icon-stage' },
  { id: 'icon.star',    selector: '.icon-grid .icon-card:nth-child(3) .icon-stage' },
  { id: 'icon.frost',   selector: '.icon-grid .icon-card:nth-child(4) .icon-stage' },
  { id: 'icon.portal',  selector: '.icon-grid .icon-card:nth-child(5) .icon-stage' },
  { id: 'icon.key',     selector: '.icon-grid .icon-card:nth-child(6) .icon-stage' },
  { id: 'icon.door',    selector: '.icon-grid .icon-card:nth-child(7) .icon-stage' },
  { id: 'icon.doorOpen',selector: '.icon-grid .icon-card:nth-child(8) .icon-stage' },

  // ── 面板 / 卡片（九宫格的来源） ──
  { id: 'panel.fix-card',   selector: '.fix-card' },
  { id: 'panel.snd-card',   selector: '.snd-card' },
  { id: 'panel.state-card', selector: '.state-card' },
  { id: 'panel.ana-tile',   selector: '.ana-tile' },
];

/* ──────────────────────────────────────────────────────────── */

/**
 * 把目标元素临时"隔离"到一块干净的透明画布上，截完再放回原处。
 *
 * ## 为什么必须做这一步（一个非常隐蔽的坑）
 *
 * `screenshot({ omitBackground: true })` 只让**页面根节点**透明，
 * 父容器的 background 仍然会被截进去。而我们的外扩区（为了装阴影
 * 往外多截 30-50px）恰好整个落在父容器里 —— 于是贴图里带住了
 * 父容器的深色卡面、甚至相邻的标题文字。
 *
 * 实测后果：`tile.pale` 的烘焙图里是一整张「未铺 · 天青釉 PALE GLAZE」
 * 状态卡，而不是一颗棋子。**而且 baseline 和 bake 犯了同一个错，
 * 两边一起错，逐像素比对 Δ=0 全绿** —— 自比对通过完全不能证明正确。
 * 这是本次工作最值得记住的教训。
 *
 * ## 做法
 *
 * 把元素剪到 `position:fixed` 的临时容器里，把 body 其它子节点
 * 全部 `visibility:hidden`，body/html 背景清空 → 截图只剩元素本身
 * 及其阴影。截完把元素放回原来的父节点和位置。
 */
export async function withIsolatedElement(page, selector, fn) {
  const handle = await page.evaluateHandle((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;

    // 记录原位，便于还原
    const parent = el.parentNode;
    const next = el.nextSibling;

    // 临时容器：固定在左上角，尺寸按元素本身
    const stage = document.createElement('div');
    stage.id = '__bake_stage__';
    const r = el.getBoundingClientRect();
    stage.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;
      width:${r.width}px;height:${r.height}px;pointer-events:none;`;

    document.body.appendChild(stage);
    stage.appendChild(el);

    // 其余内容全部隐藏（元素已在 stage 里，不受影响）
    for (const child of Array.from(document.body.children)) {
      if (child === stage) continue;
      child.setAttribute('data-bake-hide', child.style.visibility);
      child.style.visibility = 'hidden';
    }
    // 根节点背景清空，避免透明底被填色
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    return { parent, next, stage };
  }, selector);

  const ok = await page.evaluate((h) => h !== null, handle);
  if (!ok) return null;

  try {
    return await fn();
  } finally {
    await page.evaluate((h) => {
      const { parent, next, stage } = h;
      const el = stage.firstChild;
      if (el) {
        if (next && next.parentNode === parent) parent.insertBefore(el, next);
        else parent.appendChild(el);
      }
      stage.remove();
      for (const child of Array.from(document.body.children)) {
        if (!child.hasAttribute('data-bake-hide')) continue;
        child.style.visibility = child.getAttribute('data-bake-hide') || '';
        child.removeAttribute('data-bake-hide');
      }
      document.documentElement.style.background = '';
      document.body.style.background = '';
    }, handle);
    await handle.dispose();
  }
}


function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

/**
 * 计算截图外扩量 —— baseline.mjs 与 bake.mjs 必须共用这一个实现。
 *
 * 为什么不能各算各的：上一版 baseline 固定 24、bake 按阴影算到 31-51，
 * 结果基线图 336×336、烘焙图 564×564，比对时全部报"尺寸不符"，
 * 28 个元素一个都没跑通。两个文件里的同一条规则，必须只有一份实现。
 *
 * 外扩要够容纳最远的 box-shadow（offset + blur），否则贴图边缘被切平，
 * 深色底上会看到一条硬边。
 */
export function calcPad(style) {
  let maxExtent = 0;
  const re = /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/g;
  let m;
  while ((m = re.exec(style.boxShadow || '')) !== null) {
    const oy = Math.abs(parseFloat(m[2]));
    const blur = parseFloat(m[3]);
    maxExtent = Math.max(maxExtent, oy + blur * 0.5);
  }
  return Math.ceil(maxExtent) + 8;
}

/** 读 PNG 的像素（用 chromium 解，避免引第三方依赖） */
async function getBrowser() {
  // playwright 走环境变量或默认位置解析：本项目没把它装进 node_modules
  // （它只是设计期工具，不该进游戏依赖）。允许 PLAYWRIGHT_PATH 覆盖。
  const pwPath = process.env.PLAYWRIGHT_PATH
    || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
  const { chromium } = await import(pwPath);
  return chromium.launch();
}

/**
 * 逐像素比对两张同尺寸 PNG。
 * 返回统计 + 最差 N 个点的具体 RGB。
 */
async function diff(page, bufA, bufB, topN = 12) {
  return page.evaluate(async ([a, b, topN]) => {
    const load = (s) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
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
    if (A.w !== B.w || A.h !== B.h) {
      return { sizeMismatch: true, sizeA: [A.w, A.h], sizeB: [B.w, B.h] };
    }
    let sum = 0, n = 0, max = 0, over8 = 0;
    const worst = [];

    /* 分块统计 —— 全局均值有一个致命盲区：
       把一小块区域改得很明显（比如某个图标颜色错），
       全图均值仍然很低，会被放行。实测：角落 1% 区域偏 +30，
       均值只有 0.25、差>8 只有 0.96%，全绿通过 —— 但人眼一眼能看出。
       所以必须再加一路「最差分块」，任何一块超限就判红。 */
    const BS = Math.max(8, Math.floor(Math.min(A.w, A.h) / 8)); // 约 8×8 块
    const blocks = new Map(); // key -> {sum,n}

    for (let y = 0; y < A.h; y++) {
      for (let x = 0; x < A.w; x++) {
        const i = (y * A.w + x) * 4, j = (y * B.w + x) * 4;
        // 透明像素不参与（外阴影区域在两边都该是透明的）
        const aA = A.d[i + 3], aB = B.d[j + 3];
        if (aA < 8 && aB < 8) continue;
        const dr = A.d[i] - B.d[j], dg = A.d[i + 1] - B.d[j + 1], db = A.d[i + 2] - B.d[j + 2];
        const da = aA - aB;
        const d = Math.sqrt((dr * dr + dg * dg + db * db + da * da) / 4);
        sum += d; n++;
        if (d > max) max = d;
        if (d > 8) over8++;
        if (d > 8) worst.push({ x, y, design: [A.d[i], A.d[i + 1], A.d[i + 2], aA], ours: [B.d[j], B.d[j + 1], B.d[j + 2], aB], d: +d.toFixed(1) });

        const bk = `${Math.floor(x / BS)},${Math.floor(y / BS)}`;
        const e = blocks.get(bk) || { sum: 0, n: 0, x: Math.floor(x / BS) * BS, y: Math.floor(y / BS) * BS };
        e.sum += d; e.n++;
        blocks.set(bk, e);
      }
    }

    // 最差分块
    let worstBlock = { mean: 0, x: 0, y: 0, touched: 0 };
    for (const e of blocks.values()) {
      if (e.n < BS * BS * 0.1) continue; // 块内有效像素太少，不算
      const m = e.sum / e.n;
      if (m > worstBlock.mean) worstBlock = { mean: +m.toFixed(2), x: e.x, y: e.y, touched: e.n };
    }

    worst.sort((p, q) => q.d - p.d);
    return {
      mean: +(sum / Math.max(1, n)).toFixed(2),
      max: +max.toFixed(1),
      pct8: +(over8 / Math.max(1, n) * 100).toFixed(2),
      blockMean: worstBlock.mean,     // 最差块均值（局部偏差探测）
      blockAt: [worstBlock.x, worstBlock.y],
      pixels: n, worst: worst.slice(0, topN),
    };
  }, [bufA, bufB, topN]);
}

/** 判定一条结果是否通过 */
function verdict(r) {
  if (r.sizeMismatch) return { pass: false, why: `尺寸不一致：设计稿 ${r.sizeA} vs 我们 ${r.sizeB}` };
  if (r.mean > THRESH.mean) return { pass: false, why: `均值 Δ ${r.mean} > ${THRESH.mean}` };
  if (r.pct8 > THRESH.pct8) return { pass: false, why: `差>8 占比 ${r.pct8}% > ${THRESH.pct8}%` };
  // 局部闸：任何一块超限都红。没有这条，改坏一个小图标会被放行。
  if (r.blockMean > THRESH.block) {
    return { pass: false, why: `分块最差 Δ ${r.blockMean} > ${THRESH.block}（位置 ${r.blockAt}）` };
  }
  return { pass: true, why: 'ok' };
}

/* ────────────────────────────────────────────────────────────
   --build：从设计稿建基线
   ──────────────────────────────────────────────────────────── */
async function build(designPath, targets) {
  ensureDir(BASELINE);
  const browser = await getBrowser();
  const page = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 1280, height: 900 } });
  await page.goto('file:///' + designPath.replace(/\\/g, '/'));
  await page.waitForTimeout(2500); // 等字体与首屏动画
  // 设计稿是长页面，必须先撑开视口，否则 clip 超出范围会报错
  const H = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1280, height: Math.min(H + 100, 30000) });
  await page.waitForTimeout(600);

  const manifest = [];
  for (const t of targets) {
    const loc = page.locator(t.selector).first();
    const cnt = await loc.count();
    if (!cnt) {
      console.warn(`  ! 选择器无匹配：${t.id}  (${t.selector})`);
      continue;
    }
    const box = await loc.boundingBox();
    if (!box) { console.warn(`  ! 不可见：${t.id}`); continue; }

    // 外扩量必须与 bake.mjs 用**同一个算法**，否则基线图与烘焙图尺寸对不上，
    // 比对会全部报"尺寸不符"。抽成共享函数见 ninePatchParams()。
    const style = await loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        borderRadius: s.borderRadius, boxShadow: s.boxShadow,
        animationIterationCount: s.animationIterationCount,
        animationName: s.animationName,
      };
    });

    // 无限动画元素不能进静态基线：它的 box-shadow 逐帧变，
    // 外扩量也跟着变，截图尺寸不稳定（实测 hint 元素 426 vs 420）。
    // 这类元素归 S5「动效验收」管，用逐帧比对，不用静态基线。
    if ((style.animationIterationCount || '').includes('infinite')) {
      console.warn(`  ~ 跳过（无限动画 ${style.animationName}）：${t.id}`);
      continue;
    }
    const PAD = calcPad(style);

    // 隔离截图：只留元素本身，不要父容器的卡面和邻居文字。
    // 不隔离的话，外扩区会把父容器背景截进来 —— baseline 和 bake 同时犯这个错时
    // 两边一起错、比对 Δ=0 全绿，但贴图里其实是一整张卡片。
    const png = await withIsolatedElement(page, t.selector, async () => {
      // 元素被移到 fixed(0,0) 后，外扩区起点就是 (-PAD, -PAD)
      const clip = { x: 0, y: 0, width: box.width + PAD * 2, height: box.height + PAD * 2 };
      // 视口左上角可能截不到负向区域，所以 stage 放在 (PAD, PAD)
      await page.evaluate((p) => {
        const st = document.getElementById('__bake_stage__');
        if (st) st.style.left = p + 'px', st.style.top = p + 'px';
      }, PAD);
      return page.screenshot({ clip, omitBackground: true });
    });

    if (!png) { console.warn(`  ! 隔离失败：${t.id}`); continue; }
    fs.writeFileSync(path.join(BASELINE, `${t.id}.png`), png);

    // computed style 快照 —— "为什么长这样"的答案
    const cs = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      const keys = ['backgroundImage', 'backgroundColor', 'boxShadow', 'borderRadius',
        'border', 'opacity', 'width', 'height', 'filter', 'mixBlendMode'];
      const out = {};
      for (const k of keys) out[k] = s[k];
      out.innerHTML = el.innerHTML.slice(0, 2000);
      return out;
    }, t.selector);
    if (cs) fs.writeFileSync(path.join(BASELINE, `${t.id}.style.json`), JSON.stringify(cs, null, 2));

    manifest.push({ id: t.id, selector: t.selector, box: [box.width, box.height], pad: PAD });
    console.log(`  ✓ ${t.id}  ${box.width}×${box.height}`);
  }

  fs.writeFileSync(path.join(BASELINE, 'manifest.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    design: path.basename(designPath),
    dpr: 3,
    targets: manifest,
  }, null, 2));

  await browser.close();
  console.log(`\n基线已建：${manifest.length} 个元素 → ${BASELINE}`);
}

/* ────────────────────────────────────────────────────────────
   --check：游戏画面 vs 基线
   ────────────────────────────────────────────────────────────
   游戏侧的截图入口由调用方提供（--shots 目录），
   文件名与基线 id 对应：`tile.pale.default.png`。
   这样这套工具不绑定具体游戏实现，任何实现都能用。 */
async function check(shotDir, only) {
  const manPath = path.join(BASELINE, 'manifest.json');
  if (!fs.existsSync(manPath)) {
    console.error('没有基线，先跑 --build');
    process.exit(1);
  }
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  const results = [];
  for (const t of man.targets) {
    if (only && !t.id.includes(only)) continue;
    const basePath = path.join(BASELINE, `${t.id}.png`);
    const oursPath = path.join(shotDir, `${t.id}.png`);
    if (!fs.existsSync(oursPath)) {
      results.push({ id: t.id, pass: false, why: `缺少游戏截图 ${oursPath}` });
      continue;
    }
    const a = fs.readFileSync(basePath).toString('base64');
    const b = fs.readFileSync(oursPath).toString('base64');
    const r = await diff(page, a, b);
    const v = verdict(r);
    results.push({ id: t.id, ...v, ...r });
  }

  await browser.close();

  // 报告
  ensureDir(REPORT);
  const passN = results.filter(r => r.pass).length;
  const lines = [];
  lines.push(`# 像素闸门报告  ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`判据：均值 Δ ≤ ${THRESH.mean} ｜ 差>8 占比 ≤ ${THRESH.pct8}% ｜ 最差分块 ≤ ${THRESH.block}`);
  lines.push('');
  lines.push(`**${passN} / ${results.length} 通过**`);
  lines.push('');
  lines.push('| 元素 | 结果 | 均值 Δ | 差>8 | 最差块 | 最大 | 原因 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| \`${r.id}\` | ${r.pass ? '✅' : '❌'} | ${r.mean ?? '—'} | ${r.pct8 ?? '—'}% | ${r.blockMean ?? '—'} | ${r.max ?? '—'} | ${r.pass ? '' : r.why} |`);
  }

  // 失败项的细节
  const failed = results.filter(r => !r.pass && r.worst?.length);
  if (failed.length) {
    lines.push('');
    lines.push('## 失败项的具体像素');
    lines.push('');
    lines.push('> 拿这里的第一行去对照 `baseline/<id>.style.json`，通常能直接定位到是哪条 CSS 没抄对。');
    for (const f of failed) {
      lines.push('');
      lines.push(`### \`${f.id}\`  （${f.why}）`);
      lines.push('');
      lines.push('| 坐标 | 设计稿 rgba | 我们 rgba | Δ |');
      lines.push('|---|---|---|---|');
      for (const w of f.worst.slice(0, 6)) {
        lines.push(`| (${w.x},${w.y}) | \`rgba(${w.design.join(',')})\` | \`rgba(${w.ours.join(',')})\` | **${w.d}** |`);
      }
    }
  }

  const md = lines.join('\n');
  fs.writeFileSync(path.join(REPORT, 'pixel-gate.md'), md);
  console.log(md.split('\n').slice(0, 40).join('\n'));
  console.log(`\n完整报告：${path.join(REPORT, 'pixel-gate.md')}`);

  if (passN < results.length) process.exitCode = 1;
}

/* ──────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const design = getArg('--design',
  path.join(ROOT, '../../../../docs/连连看/风格样片/2026-11-16-秘色天青-图标动效音效.html'));

if (argv.includes('--build')) {
  await build(design, TARGETS);
} else if (argv.includes('--check')) {
  const shots = getArg('--shots', path.join(ROOT, 'shots'));
  await check(shots, getArg('--only', null));
} else {
  console.log('用法：');
  console.log('  node baseline.mjs --build [--design <设计稿路径>]');
  console.log('  node baseline.mjs --check [--shots <游戏截目录>] [--only <id 片段>]');
}
