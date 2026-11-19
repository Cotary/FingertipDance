/**
 * 批量出图 —— 驱动出图页，把每个元素画出来存成 PNG。
 *
 * ## 在流程里的位置（40 文档 §S4 前置条件）
 *
 * ```
 * 设计稿 ──baseline.mjs──→ baseline/<id>.png     （标准答案）
 * 游戏   ──shoot.mjs────→ shots/<id>.png        （我们的答卷）
 *                              ↓
 *                     baseline.mjs --check --shots shots/
 * ```
 *
 * 没有这一步，像素闸门就是空的：`--check` 会报「缺少游戏截图」。
 *
 * ## 用法
 *
 * ```bash
 * node tools/design-replica/shoot.mjs                     # 两套主题都出
 * node tools/design-replica/shoot.mjs --theme mise         # 只出一套
 * node tools/design-replica/shoot.mjs --only tile.pale     # 只出一个
 * node tools/design-replica/shoot.mjs --shots ./shots      # 指定输出目录
 * ```
 *
 * 前提：dev server 已启动（本脚本不负责起服务）。
 */

import fs from 'node:fs';
import path from 'node:path';

const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};

const BASE = arg('--base', process.env.SHOOT_BASE || 'http://127.0.0.1:50003');
const SHOTS = path.resolve(arg('--shots', 'shots'));
const ONLY_THEME = arg('--theme', null);
const ONLY_ID = arg('--only', null);
/** baseline 的 manifest —— 尺寸与 pad 的唯一来源 */
const MANIFEST = path.resolve(
  arg('--manifest', '../../docs/连连看/复刻SOP/scripts/baseline/manifest.json'),
);

/**
 * 两套主题都要出。
 *
 * 为什么不是只出当前装备的那套：设计稿是**两套都画了**的
 * （天青 + 丹青各一份 html），基线也是两套分开建的。
 * 只对一套会让另一套的偏差永远没人发现。
 */
const THEMES = ['mise', 'mingsha'];

const { chromium } = await import(pwPath);

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  // 尺寸从 manifest 读 —— 硬编码 62 会被闸门第一道就判「尺寸不一致」，
  // 因为设计稿里 `.pressed` 是 70.4、`.arrive` 是 69.12，各元素不同
  if (!fs.existsSync(MANIFEST)) {
    console.error(`找不到 manifest：${MANIFEST}`);
    console.error('先跑：cd docs/连连看/复刻SOP/scripts && node baseline.mjs --build');
    process.exit(1);
  }
  const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  /** theme -> baseId -> {w, pad} */
  const sizeOf = new Map();
  for (const t of man.targets || []) {
    if (!sizeOf.has(t.theme)) sizeOf.set(t.theme, new Map());
    sizeOf.get(t.theme).set(t.baseId ?? t.id, {
      w: t.box[0],
      h: t.box[1],
      pad: t.pad,
    });
  }

  const browser = await chromium.launch();
  /**
   * DPR 必须 = 3，与 baseline.mjs 的 deviceScaleFactor 严格一致。
   *
   * canvas 内部已经按 3x 画好（width = 逻辑宽 × 3），
   * 但 `el.screenshot()` 是按 **CSS 尺寸** 乘 DPR 截的。
   * 如果这里 DPR=1，截出来是 188×188；基线是 564×564 → 第一道就判尺寸不符。
   *
   * 所以这里要 DPR=3，并且把 canvas 的 CSS 尺寸设成逻辑尺寸
   * （core.ts 里 `canvas.style.width = logicalW + 'px'` 已经这么做了）。
   */
  const page = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 1200, height: 1200 } });

  // 先取清单
  await page.goto(`${BASE}/tools/design-replica/shoot.html?list=1`);
  await page.waitForFunction(() => Array.isArray(window.__list), { timeout: 10000 });
  const list = await page.evaluate(() => window.__list);

  const themes = ONLY_THEME ? [ONLY_THEME] : THEMES;
  let ok = 0;
  const failed = [];

  for (const theme of themes) {
    const sizes = sizeOf.get(theme);
    if (!sizes) {
      console.warn(`  ! manifest 里没有主题 ${theme} 的基线，先跑 --build`);
      continue;
    }

    for (const item of list) {
      if (ONLY_ID && !item.id.includes(ONLY_ID)) continue;

      const sz = sizes.get(item.id);
      if (!sz) {
        // 基线里没有这个元素 = 它没被建基线，出图也没意义
        failed.push({ theme, id: item.id, why: 'manifest 里无此元素（基线未建）' });
        continue;
      }

      const url = `${BASE}/tools/design-replica/shoot.html`
        + `?theme=${theme}&cell=${encodeURIComponent(item.id)}`
        + `&w=${sz.w}&pad=${sz.pad}`;
      await page.goto(url);

      try {
        await page.waitForFunction(() => window.__done || window.__error, { timeout: 8000 });
      } catch {
        failed.push({ theme, id: item.id, why: '超时（页面未报完成）' });
        continue;
      }

      const err = await page.evaluate(() => window.__error);
      if (err) {
        failed.push({ theme, id: item.id, why: err });
        continue;
      }

      const el = page.locator('#shot');
      // 文件名与 baseline 的 id 完全一致：mise__tile.pale.png
      const name = `${theme}__${item.id}.png`;
      await el.screenshot({ path: path.join(SHOTS, name), omitBackground: true });
      ok++;
      process.stdout.write(`  ✓ ${name}  ${sz.w}×${sz.h} pad=${sz.pad}\n`);
    }
  }

  await browser.close();

  console.log('');
  console.log(`出图完成：${ok} 张 → ${SHOTS}`);
  if (failed.length) {
    console.log('');
    console.log('失败：');
    for (const f of failed) console.log(`  ✗ ${f.theme} / ${f.id}：${f.why}`);
    process.exitCode = 1;
  }
}

await main();
