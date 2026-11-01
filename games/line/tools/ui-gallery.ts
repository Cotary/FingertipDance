/**
 * UI 视觉验证画廊（离线，Canvas2D → SVG）。
 *
 * 用**真实绘制代码**渲染八屏，输出 tools/ui-gallery.html，可在预览面板直接查看。
 * 数据来自 `tools/mock-ui.ts`，与浏览器端的 `live-gallery.ts` 共一份 ——
 * 两边各存一套 mock 迟早会漂移，核对时会对着不同的数字吵架。
 *
 * 局限：RecordingCtx 画不出 `createPattern`，所以**颗粒层在这里是缺失的**。
 * 要看材质（颗粒 / 指压痕）请走 live-gallery：`bash scripts/shot-ui.sh`。
 *
 * 运行：npm run ui:gallery [关键字]
 */
import './preload';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordingCtx } from './canvas2svg';
import { DESIGN_W, DESIGN_H } from '../src/render/layout';
import { clayBackdrop } from '../src/ui/clay';
import { drawNav } from '../src/ui/nav';
import { PAGES, NOW, type PageDef } from './mock-ui';

type Ctx = CanvasRenderingContext2D;

/** 渲染一页并返回 SVG。 */
function render(page: PageDef): string {
  const c = new RecordingCtx();
  clayBackdrop(c as unknown as Ctx);
  page.draw(c as unknown as Ctx);
  if (page.nav) drawNav(c as unknown as Ctx, page.nav, NOW);
  return c.toSvg(DESIGN_W, DESIGN_H);
}

/** 只渲染指定界面并 1:1 输出（调细节用）：npm run ui:gallery -- game */
const only = process.argv[2];
const shown = only ? PAGES.filter((p) => p.key.includes(only) || p.title.includes(only)) : PAGES;
const single = shown.length === 1;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>连连看 · UI 设计稿（黏土工坊）</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: ${single ? '0' : '40px 28px 60px'};
    background: #0a0820; color: #fff;
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 6px; letter-spacing: .5px; }
  p.sub { margin: 0 0 32px; color: #8f89c8; font-size: 13px; }
  .grid { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; }
  figure { margin: 0; }
  .phone {
    width: ${single ? '750px' : '375px'}; height: ${single ? '1334px' : '667px'};
    border-radius: ${single ? '0' : '26px'}; overflow: hidden;
    box-shadow: ${single ? 'none' : '0 18px 48px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.09)'};
    background: #100c30;
  }
  .phone svg { display: block; width: 100%; height: 100%; }
  figcaption { ${single ? 'display:none;' : ''} margin-top: 12px; text-align: center; font-size: 13px; color: #b9b4e8; letter-spacing: .4px; }
</style>
</head>
<body>
${single ? '' : `<h1>连连看 · 黏土工坊 UI</h1>
<p class="sub">真实 Canvas 绘制代码离线渲染（Canvas2D → SVG），非手绘稿 · 颗粒层需看 live-gallery</p>`}
<div class="grid">
${shown
  .map((p) => `  <figure><div class="phone">${render(p)}</div><figcaption>${p.title}</figcaption></figure>`)
  .join('\n')}
</div>
</body>
</html>
`;

const out = resolve(import.meta.dirname ?? '.', single ? 'ui-debug.html' : 'ui-gallery.html');
writeFileSync(out, html, 'utf8');
console.log(`[ui-gallery] 已生成 ${out}（${shown.length} 个界面，${(html.length / 1024).toFixed(0)} KB）`);
