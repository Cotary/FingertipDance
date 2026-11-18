/**
 * 烘焙器 —— 把设计稿的 CSS 元素烘成运行时贴图（S2.1）
 *
 * ## 为什么需要这个
 *
 * 设计稿里没有一张图片（我扫过：0 个 <img>、0 个外链图）。
 * 所有视觉都是 CSS 渐变 + box-shadow 现算的。所以不能"下载资源"，
 * 只能**烘**：让浏览器把 CSS 算完，把结果截成图。
 *
 * 实测精度：烘焙路线均值 Δ 0.49/255，手绘路线 5.29/255。差 11 倍。
 *
 * ## 关键实现细节
 *
 * 1. **6× 超采样再缩到 3×**：截图时 6 倍，游戏里按 3 倍显示 = 2:1 下采样，
 *    这是抗锯齿最干净的组合。1:1 截 3× 缩放后边缘会有锯齿。
 *
 * 2. **透明底 + 外扩边距**：外阴影必须在外扩区里，否则贴图边缘会被切平。
 *    外扩量按实际 box-shadow 算（设计稿最远 28px offset + 52px blur）。
 *
 * 3. **九宫格切片**：圆角 + 阴影的矩形面板，任意尺寸拉伸时圆角会变形。
 *    必须切成 9 片（四角 + 四边 + 中心），只拉伸中间和边，
 *    这也是 Unity Sprite Border / CSS border-image / 安卓 .9.png 的标准做法。
 *
 * ```bash
 * node bake.mjs                      # 烘全部
 * node bake.mjs --only tile.pale     # 只烘一个
 * node bake.mjs --ninepatch          # 额外产出九宫格切片
 * ```
 */

import fs from 'node:fs';
import path from 'node:path';
import { calcPad, withIsolatedElement } from './baseline.mjs';

const ROOT = path.resolve(process.cwd());
const OUT = path.join(ROOT, 'baked');
const BASELINE = path.join(ROOT, 'baseline');

/**
 * 烘焙倍率 = 运行时倍率 = 3。
 *
 * ## 为什么不是"6× 超采样再缩到 3×"
 *
 * 我原来以为超采样更稳，实测推翻了这个想法：
 *   - 平滑渐变类（棋子、面板）：6×→3× 与原生 3× 差 Δ≈0.5，超采样无害也无益
 *   - 细线条类（图标，SVG 描边 1.5px）：6×→3× 差 Δ≈1.3、分块 Δ≈8.9
 *     —— 重采样把 1px 描边糊掉了，**比原生 3× 更差**
 *
 * 结论：只有「要在运行时继续缩小」时才值得超采样。我们运行时是 1:1 绘制，
 * 原生 3× 就是最准的。高分屏（dpr>3）让它轻微放大，肉眼无感。
 */
const BAKE_SCALE = 3;
/** 输出时保留的倍率 */
const OUT_SCALE = 3;

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

/**
 * 九宫格切分参数探测。
 *
 * 从 computed style 里读 border-radius 和 box-shadow，算出：
 *   - corner: 四个角要保留的像素（= 圆角半径 + 最大模糊外扩）
 *   - 这样拉伸时角不变形、阴影不断裂
 */
function ninePatchParams(style) {
  const radius = parseFloat(style.borderRadius) || 0;
  // 从 box-shadow 里取最大的 blur + |offset|
  let maxExtent = 0;
  const re = /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/g;
  let m;
  while ((m = re.exec(style.boxShadow || '')) !== null) {
    const oy = Math.abs(parseFloat(m[2]));
    const blur = parseFloat(m[3]);
    maxExtent = Math.max(maxExtent, oy + blur * 0.5);
  }
  // 角切片只需覆盖「圆角本身」，不需要覆盖阴影外扩——
  // 阴影是围绕整个形状的，九宫格拉伸时边和中心一起拉，阴影自然跟着走。
  // 上一版把 maxExtent 也算进来，导致 84px 的小方块算出 corner=40
  // （接近短边一半），切片后中间只剩几条像素，拉伸必糊。
  const corner = Math.max(4, Math.min(radius, 32));
  return { radius, maxExtent: +maxExtent.toFixed(1), corner: +corner.toFixed(1) };
}

async function main() {
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const doNinePatch = process.argv.includes('--ninepatch');

  const manPath = path.join(BASELINE, 'manifest.json');
  if (!fs.existsSync(manPath)) {
    console.error('先跑 baseline.mjs --build（需要 manifest 与 computed style）');
    process.exit(1);
  }
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const designPath = path.join(ROOT, '..', '..', '风格样片', man.design);
  const targets = only ? man.targets.filter(t => t.id.includes(only)) : man.targets;

  fs.mkdirSync(OUT, { recursive: true });

  const { chromium } = await import(pwPath);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: BAKE_SCALE,
    viewport: { width: 1280, height: 900 },
  });
  await page.goto('file:///' + designPath.replace(/\\/g, '/'));
  await page.waitForTimeout(2500);
  const H = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1280, height: Math.min(H + 100, 30000) });
  await page.waitForTimeout(600);

  const out = [];
  for (const t of targets) {
    const loc = page.locator(t.selector).first();
    if (!(await loc.count())) { console.warn(`  ! 无匹配 ${t.id}`); continue; }
    const box = await loc.boundingBox();
    if (!box) { console.warn(`  ! 不可见 ${t.id}`); continue; }

    const style = await loc.evaluate(el => {
      const s = getComputedStyle(el);
      return { borderRadius: s.borderRadius, boxShadow: s.boxShadow, filter: s.filter };
    });
    const np = ninePatchParams(style);

    // 外扩：与 baseline.mjs 共用 calcPad()，保证两边尺寸严格一致
    const pad = calcPad(style);
    const clip = {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    };

    // 与 baseline 共用隔离逻辑：否则外扩区会截到父容器卡面，
    // 贴图里变成"一整张状态卡"而不是一颗棋子。
    const raw = await withIsolatedElement(page, t.selector, async () => {
      await page.evaluate((p) => {
        const st = document.getElementById('__bake_stage__');
        if (st) st.style.left = p + 'px', st.style.top = p + 'px';
      }, pad);
      return page.screenshot({ clip: { x: 0, y: 0, width: clip.width, height: clip.height }, omitBackground: true });
    });
    if (!raw) { console.warn(`  ! 隔离失败 ${t.id}`); continue; }

    // 倍率一致时直接存原图（不重采样 = 零损失）。
    // 只有在 BAKE_SCALE > OUT_SCALE 时才需要下面这段缩放。
    const png = BAKE_SCALE === OUT_SCALE
      ? raw.toString('base64')
      : await page.evaluate(async ([b64, outW, outH]) => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas');
      c.width = outW; c.height = outH;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, outW, outH);
      const u = c.toDataURL('image/png');
      return u.split(',')[1];
    }, [
      raw.toString('base64'),
      Math.round(clip.width * OUT_SCALE),
      Math.round(clip.height * OUT_SCALE),
    ]);
    const name = `${t.id}.png`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(png, 'base64'));

    // 逻辑尺寸（运行时按这个画）
    const logical = {
      w: +(clip.width).toFixed(2),
      h: +(clip.height).toFixed(2),
      pad,
      contentW: +box.width.toFixed(2),
      contentH: +box.height.toFixed(2),
    };

    out.push({
      id: t.id,
      file: name,
      logical,
      bakeScale: BAKE_SCALE,
      drawScale: OUT_SCALE,
      // 运行时该按多少 CSS 像素画
      drawAs: { w: logical.w, h: logical.h },
      ninePatch: doNinePatch ? {
        corner: np.corner,
        radius: np.radius,
        // 切片坐标基于烘焙后的实际像素
        slices: {
          left: Math.round((pad + np.corner) * OUT_SCALE),
          right: Math.round((pad + np.corner) * OUT_SCALE),
          top: Math.round((pad + np.corner) * OUT_SCALE),
          bottom: Math.round((pad + np.corner) * OUT_SCALE),
        },
      } : undefined,
    });

    console.log(`  ✓ ${t.id.padEnd(22)} ${logical.w}×${logical.h} (内容 ${logical.contentW}×${logical.contentH}, 外扩 ${pad})`);
  }

  fs.writeFileSync(path.join(OUT, 'baked.manifest.json'), JSON.stringify({
    bakedAt: new Date().toISOString(),
    bakeScale: BAKE_SCALE,
    drawScale: OUT_SCALE,
    assets: out,
  }, null, 2));

  await browser.close();
  console.log(`\n烘焙完成：${out.length} 个 → ${OUT}`);
  console.log(`提示：运行时按 ${OUT_SCALE}× 素材、${'{'}dpr${'}'} 倍屏绘制，drawImage 时不用再缩放。`);
}

await main();
