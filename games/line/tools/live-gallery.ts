/**
 * 浏览器端八屏画廊（真 canvas）。
 *
 * 与 `ui-gallery.ts` 的分工：
 * - ui-gallery.ts  → RecordingCtx → SVG，看**布局**
 * - live-gallery.ts → 真 canvas + 颗粒贴图，看**材质**（pattern / 颗粒层只有这里能出）
 *
 * 用法：dev server 起在 5174 时
 *   /tools/live-gallery.html?p=home
 * 再用 headless Chrome 截图：
 *   chrome --headless=new --screenshot=out.png --window-size=750,1334 --virtual-time-budget=4000 <url>
 */
import { DESIGN_W, DESIGN_H } from '../src/render/layout';
import { clayBackdrop } from '../src/ui/clay';
import { drawNav } from '../src/ui/nav';
import { pageByKey, PAGES, NOW } from './mock-ui';

const params = new URLSearchParams(location.search);
const key = params.get('p') ?? 'home';
const page = pageByKey(key);

const canvas = document.createElement('canvas');
canvas.width = DESIGN_W;
canvas.height = DESIGN_H;
canvas.style.width = `${DESIGN_W}px`;
canvas.style.height = `${DESIGN_H}px`;
document.body.appendChild(canvas);

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('no 2d context');
ctx.setTransform(1, 0, 0, 1, 0, 0);

clayBackdrop(ctx);
if (page) {
  page.draw(ctx);
  if (page.nav) drawNav(ctx, page.nav, NOW);
}

// 供截图脚本判断是否画完
document.title = `ready:${key}`;

// 列出所有可用 key，方便人工核对
if (!page) {
  document.title = `unknown:${key}`;
  console.warn('可用页面：', PAGES.map((p) => p.key).join(', '));
}
