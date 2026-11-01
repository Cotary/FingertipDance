/**
 * UI 视觉验证画廊。
 *
 * 用真实绘制代码 + RecordingCtx（Canvas2D→SVG）渲染 8 个界面，
 * 输出 tools/ui-gallery.html，可在预览面板直接查看。
 *
 * 运行：npm run ui:gallery
 */
import './preload';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordingCtx } from './canvas2svg';
import { DESIGN_W, DESIGN_H, computeLayout } from '../src/render/layout';
import { nightSky } from '../src/ui/draw';
import { drawHomePage, type HomePageState } from '../src/ui/home';
import { drawMapView, createMapState, scrollToLevel } from '../src/ui/mapview';
import { drawRankPage, createRankState } from '../src/ui/leaderboard';
import { drawProfilePage, type ProfilePageState } from '../src/ui/profile';
import { drawSkinsPage, type SkinsPageState } from '../src/ui/skins';
import { drawNav, type NavTab } from '../src/ui/nav';
import { drawBoard, drawEndpoints } from '../src/render/board';
import { drawTrail } from '../src/render/trail';
import { drawHud, drawProgressBar, drawResult, drawButton, type Button } from '../src/ui/hud';
import { skinById } from '../src/render/skins';
import { CellType } from '../src/core/types';
import type { LevelData } from '../src/core/levelTable';
import type { Cell } from '../src/core/types';
import type { LeaderboardItem } from '../src/net/api';

const NOW = 1_700_000_000_000;

type Ctx = CanvasRenderingContext2D;

/** 开一张画布并铺夜空背景。 */
function begin(): RecordingCtx {
  const c = new RecordingCtx();
  nightSky(c as unknown as Ctx, NOW);
  return c;
}

/** 渲染一页并返回 SVG。 */
function render(page: (ctx: Ctx) => void, nav?: NavTab): string {
  const c = begin();
  page(c as unknown as Ctx);
  if (nav) drawNav(c as unknown as Ctx, nav, NOW);
  return c.toSvg(DESIGN_W, DESIGN_H);
}

// ── 主页 ──
const homeState: HomePageState = {
  maxLevel: 37,
  levelCount: 1000,
  nickname: '小满',
  avatar: '',
  skinCount: 6,
  totalSkins: 16,
};

// ── 地图 ──
const stars: Record<string, number> = {};
for (let i = 1; i <= 36; i++) stars[String(i)] = i % 7 === 0 ? 2 : i % 5 === 0 ? 1 : 3;
const mapState = createMapState(37, 1000, stars);
mapState.scrollY = scrollToLevel(37);

// ── 排行榜 ──
const board9 = (rank: number, nickname: string, maxLevel: number, totalTimeMs: number): LeaderboardItem => ({
  rank, uid: rank, nickname, avatar: '', maxLevel, totalTimeMs,
});
const rankState = createRankState();
rankState.global = {
  loading: false,
  myRank: 37,
  total: 1284,
  list: [
    board9(1, '阿岚', 342, 3_600_000),
    board9(2, '一只刺猬', 318, 4_100_000),
    board9(3, 'Momo', 296, 4_800_000),
    board9(4, '深夜连着玩', 271, 5_200_000),
    board9(5, '柚子茶', 254, 5_900_000),
    board9(6, '不困', 233, 6_300_000),
    board9(7, '拔萝卜', 210, 6_800_000),
    board9(8, '线线线', 198, 7_200_000),
  ],
};

// ── 我的 ──
const profileState: ProfilePageState = {
  nickname: '小满',
  avatar: '',
  maxLevel: 37,
  totalSteps: 1284,
  totalTimeMs: 2_460_000,
  adWatchCnt: 9,
  unlockedSkins: ['wood', 'mint', 'graphite', 'slate', 'blush', 'amber'],
  totalSkins: 16,
  soundOn: true,
  vibrateOn: true,
};

// ── 皮肤 ──
const skinsState: SkinsPageState = {
  equipped: 'mint',
  unlocked: new Set(['wood', 'mint', 'graphite', 'slate', 'blush', 'amber']),
  page: 0,
};

// ── 游戏内：造一个 7×7 关卡 + 一条已走过的路径 ──
function makeLevel(): LevelData {
  const w = 7;
  const h = 7;
  const grid: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) row.push({ type: CellType.BRICK, dir: 0 });
    grid.push(row);
  }
  const blocks: Array<[number, number]> = [[1, 1], [2, 2], [4, 3], [3, 4], [5, 5]];
  for (const [x, y] of blocks) grid[y][x] = { type: CellType.BLOCK, dir: 0 };
  grid[6][0] = { type: CellType.START, dir: 0 };
  grid[0][6] = { type: CellType.END, dir: 0 };
  grid[5][2] = { type: CellType.ONEWAY, dir: 3 };
  return { idx: 37, seed: 37, w, h, grid, shortest: 14, turns: 6, blocks: blocks.length, oneways: 1, diff: 42 };
}

const level = makeLevel();
const layout = computeLayout(level.w, level.h);
/** 一条从起点(0,6)走到终点(6,0)的折线路径，绕开阻挡块。 */
const realPath: Array<[number, number]> = [
  [0, 6], [1, 6], [2, 6], [2, 5], [2, 4], [3, 4], [4, 4], [4, 5], [5, 5], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
];

const gameScreen = (ctx: Ctx): void => {
  const lit = new Set(realPath.map(([x, y]) => y * level.w + x));
  const path = realPath.map(([x, y]) => y * level.w + x);
  drawBoard(ctx, level, layout, { lit, path, hint: new Set([3 * level.w + 3]), shakeCell: -1, shakeAt: 0 }, skinById('mint'), NOW);
  drawTrail(ctx, path, level.w, layout, '#4FC3F7', 'rgba(79,195,247,0.42)');
  drawEndpoints(ctx, level, layout);
  drawHud(ctx, 37, '薄荷', 6, 16);
  drawProgressBar(ctx, 37, 1000);
  const btns: Button[] = [
    { x: 40, y: 100, w: 90, h: 60, label: '返回', kind: 'ghost', id: 'backHome' },
    { x: DESIGN_W - 210, y: 100, w: 90, h: 60, label: '提示', kind: 'ghost', id: 'hint' },
    { x: DESIGN_W - 110, y: 100, w: 90, h: 60, label: '跳过', kind: 'ghost', id: 'skip' },
  ];
  btns.forEach((b) => drawButton(ctx, b, false));
};

const resultScreen = (ctx: Ctx): void => {
  // 结算页需要棋盘做底，否则遮罩下是空的
  gameScreen(ctx);
  drawResult(ctx, 37, 15, 14, 41_500, { id: 'neon', name: '霓虹' }, 37 / 1000);
};

// ── 组装 HTML ──
interface Panel {
  title: string;
  svg: string;
}

const panels: Panel[] = [
  { title: '主页大厅', svg: render((c) => void drawHomePage(c, homeState, NOW), 'home') },
  { title: '关卡地图', svg: render((c) => void drawMapView(c, mapState, NOW), 'map') },
  { title: '排行榜 · 总榜', svg: render((c) => void drawRankPage(c, rankState, NOW), 'rank') },
  { title: '我的', svg: render((c) => void drawProfilePage(c, profileState, NOW), 'profile') },
  { title: '皮肤', svg: render((c) => void drawSkinsPage(c, skinsState, NOW), 'skins') },
  { title: '游戏内', svg: render(gameScreen) },
  { title: '通关结算', svg: render(resultScreen) },
];

/** 只渲染指定界面并 1:1 输出（调细节用）：npm run ui:gallery -- game */
const only = process.argv[2];
const shown = only ? panels.filter((p) => p.title.includes(only)) : panels;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>连连看 · UI 设计稿（真实渲染）</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: ${only ? '0' : '40px 28px 60px'};
    background: #0a0820; color: #fff;
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 6px; letter-spacing: .5px; }
  p.sub { margin: 0 0 32px; color: #8f89c8; font-size: 13px; }
  .grid { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; }
  figure { margin: 0; }
  .phone {
    width: ${only ? '750px' : '375px'}; height: ${only ? '1334px' : '667px'};
    border-radius: ${only ? '0' : '26px'}; overflow: hidden;
    box-shadow: ${only ? 'none' : '0 18px 48px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.09)'};
    background: #100c30;
  }
  .phone svg { display: block; width: 100%; height: 100%; }
  figcaption { ${only ? 'display:none;' : ''} margin-top: 12px; text-align: center; font-size: 13px; color: #b9b4e8; letter-spacing: .4px; }
</style>
</head>
<body>
${only ? '' : `<h1>连连看 · 糖果夜空 UI</h1>
<p class="sub">由真实 Canvas 绘制代码离线渲染（Canvas2D → SVG），非手绘设计稿</p>`}
<div class="grid">
${shown
  .map(
    (p) => `  <figure><div class="phone">${p.svg}</div><figcaption>${p.title}</figcaption></figure>`,
  )
  .join('\n')}
</div>
</body>
</html>
`;

const out = resolve(import.meta.dirname ?? '.', only ? 'ui-debug.html' : 'ui-gallery.html');
writeFileSync(out, html, 'utf8');
console.log(`[ui-gallery] 已生成 ${out}（${shown.length} 个界面，${(html.length / 1024).toFixed(0)} KB）`);
