/**
 * 算出某一关参考解的屏幕坐标序列，直接喂给 `shot-cdp.mjs` 的 DRAG。
 *
 * ## 用处
 *
 * 手动拖 21 格不可能用脚本模拟（一次抖动就断线），
 * 而「结算页长什么样」「通关动画对不对」又必须在真机视口下看。
 * 这个工具用**关卡表里生成器留下的参考解**来驱动，一次拖到底。
 *
 * 用法：
 *   npx tsx tools/autoplay.ts <关卡号> <视口宽> <视口高>
 *   DRAG="$(npx tsx tools/autoplay.ts 1 375 667)" node tools/shot-cdp.mjs ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout, DESIGN_W, DESIGN_H } from '../src/render/layout';
import { decodeSolution } from '../src/core/cover/v3/codec';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const [, , idxArg, vwArg, vhArg, dprArg] = process.argv;
const idx = Number(idxArg ?? 1);
const vw = Number(vwArg ?? 375);
const vh = Number(vhArg ?? 667);
const dpr = Number(dprArg ?? 2);

const file = path.resolve(HERE, '../data/levels-v3.json');
const table = JSON.parse(fs.readFileSync(file, 'utf8')) as {
  levels: Array<{ idx: number; w: number; h: number; solution: string }>;
};
const entry = table.levels.find((l) => l.idx === idx);
if (!entry) {
  console.error(`没有第 ${idx} 关`);
  process.exit(1);
}

const layout = computeLayout(entry.w, entry.h);
const flatPath = decodeSolution(entry.solution, entry.w);

// 与 `viewport.createViewport` 同一套「等比缩放 + 居中」
const scale = Math.min(vw / DESIGN_W, vh / DESIGN_H);
const ox = (vw - DESIGN_W * scale) / 2;
const oy = (vh - DESIGN_H * scale) / 2;

const pts = flatPath.map((flat) => {
  const cx = flat % entry.w;
  const cy = Math.floor(flat / entry.w);
  const dx = layout.originX + cx * layout.cell + layout.cell / 2;
  const dy = layout.originY + cy * layout.cell + layout.cell / 2;
  return `${Math.round(dx * scale + ox)},${Math.round(dy * scale + oy)}`;
});

// dpr 只影响像素密度，不影响 CSS 坐标；留着参数是为了让调用处一眼看全
void dpr;
process.stdout.write(pts.join(','));
