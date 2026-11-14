/**
 * 八屏 UI 的 mock 数据 + 绘制入口。
 *
 * 被两处复用：
 * - `tools/ui-gallery.ts`（node，RecordingCtx → SVG）
 * - `tools/live-gallery.ts`（浏览器，真 canvas → 可被 headless Chrome 截图）
 *
 * 之所以要两个：RecordingCtx 画不出 `createPattern` 的颗粒层，
 * 凡是要核对**材质**的，必须走真 canvas。
 */
import { DESIGN_W } from '../src/render/layout';
import { computeLayout } from '../src/render/layout';
import { CLAY } from '../src/ui/clay';
import { drawHomePage, type HomePageState } from '../src/ui/home';
import { drawMapView } from '../src/ui/mapdraw';
import { createMapState, scrollToLevel } from '../src/ui/mapview';
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

export const NOW = 1_700_000_000_000;

type Ctx = CanvasRenderingContext2D;

// ── 主页 ──
export const homeState: HomePageState = {
  maxLevel: 37,
  // 当前关 = 最高已通关 + 1
  currentLevel: 38,
  levelCount: 1000,
  nickname: '小满',
  avatar: '',
  skinCount: 6,
  totalSkins: 16,
};

// ── 地图 ──
const stars: Record<string, number> = {};
for (let i = 1; i <= 36; i++) stars[String(i)] = i % 7 === 0 ? 2 : i % 5 === 0 ? 1 : 3;
/**
 * 地图页的预览关号：`?p=map&lv=705` 可以看任意位置那张图。
 * 视觉验收必须能直接看到「世界门 / 熔炉 / 星穹」这些平时要划 40 屏才到的地方。
 */
const lvArg = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('lv') ?? 0) : 0;
const mapLv = lvArg > 0 ? lvArg : 38;

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?t=neon` 预览地图跟着某套主题变色的样子（空 = 默认星穹）。 */
const MAP_THEME = q.get('t') ?? '';
export const mapState = createMapState(mapLv, 1000, stars);
mapState.scrollY = scrollToLevel(mapLv);
// `&off=3000` 模拟「已经拖远了」：用来验收「回到当前」与导轨浮标
const offArg = Number(q.get('off') ?? 0);
if (offArg) mapState.scrollY = Math.min(mapState.maxScrollY, Math.max(0, mapState.scrollY + offArg));
// `&scrub=1` 停在「正在拖导轨」的那一帧，用来看浮标
if (q.get('scrub') === '1') mapState.scrub = true;

// ── 排行榜 ──
const board9 = (rank: number, nickname: string, maxLevel: number, totalTimeMs: number): LeaderboardItem => ({
  rank, uid: rank, nickname, avatar: '', maxLevel, totalTimeMs,
});
export const rankState = createRankState();
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
export const profileState: ProfilePageState = {
  nickname: '小满',
  avatar: '',
  maxLevel: 37,
  totalSteps: 1284,
  totalTimeMs: 2_460_000,
  adWatchCnt: 9,
  unlockedSkins: ['wood', 'mint', 'graphite', 'slate', 'blush', 'amber', 'marble'],
  totalSkins: 16,
  soundOn: true,
  vibrateOn: true,
};

// ── 皮肤 ──
export const skinsState: SkinsPageState = {
  equipped: 'mint',
  selected: 'marble',
  unlocked: new Set(['wood', 'mint', 'graphite', 'slate', 'blush', 'amber', 'marble']),
  page: 0,
};

/**
 * 皮肤页的「棋盘」页签。
 *
 * 单独给一份 state 而不是改 `skinsState`：两页签的内容完全不同，
 * 挤在一个 state 里就得在 mock 里写分支，画廊反而看不出真实布局。
 * `maxLevel` 给 400 —— 正好让玻璃穹顶、圆格罗盘已解锁、黑曜熔岩锁着，
 * 一次截屏能同时看到「已解锁」「未解锁」「使用中」三种状态。
 */
const themeQ = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export const themesState: SkinsPageState = {
  equipped: 'mint',
  selected: 'marble',
  unlocked: new Set(['wood', 'mint', 'graphite', 'slate', 'blush', 'amber', 'marble']),
  page: 0,
  tab: 'theme',
  // `?p=themes&t=abyss` 直接看在展台上的某一套 —— 八套逐张验收要用它，
  // 否则只能每张截三次图、点两次陶片才能换到
  themeSelected: themeQ.get('t') ?? 'orbit',
  themeEquipped: 'glass',
  maxLevel: 1000,
  themeAllUnlocked: true,
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

export const level = makeLevel();
export const layout = computeLayout(level.w, level.h);

/** 一条从起点(0,6)走到终点(6,0)的折线路径，绕开阻挡块。 */
const realPath: Array<[number, number]> = [
  [0, 6], [1, 6], [2, 6], [2, 5], [2, 4], [3, 4], [4, 4], [4, 5], [5, 5], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
];

export const gameScreen = (ctx: Ctx): void => {
  const lit = new Set(realPath.map(([x, y]) => y * level.w + x));
  const path = realPath.map(([x, y]) => y * level.w + x);
  drawBoard(ctx, level, layout, { lit, path, hint: new Set([3 * level.w + 3]), shakeCell: -1, shakeAt: 0 }, skinById('mint'), NOW);
  drawTrail(ctx, path, level.w, layout, CLAY.terracotta);
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

export const resultScreen = (ctx: Ctx): void => {
  // 结算页需要棋盘做底，否则遮罩下是空的
  gameScreen(ctx);
  drawResult(ctx, 37, 15, 14, 41_500, { id: 'neon', name: '霓虹' }, 37 / 1000);
};

/** 一屏 = 一个 key + 一个绘制函数（nav 单独给，因为要和页面一起画）。 */
export interface PageDef {
  key: string;
  title: string;
  nav?: NavTab;
  draw: (ctx: Ctx) => void;
}

export const PAGES: PageDef[] = [
  { key: 'home', title: '主页大厅', nav: 'home', draw: (c) => void drawHomePage(c, homeState, NOW) },
  { key: 'map', title: '关卡地图', nav: 'map', draw: (c) => void drawMapView(c, mapState, NOW, MAP_THEME) },
  { key: 'rank', title: '排行榜', nav: 'rank', draw: (c) => void drawRankPage(c, rankState, NOW) },
  { key: 'profile', title: '我的', nav: 'profile', draw: (c) => void drawProfilePage(c, profileState, NOW) },
  { key: 'skins', title: '皮肤', nav: 'skins', draw: (c) => void drawSkinsPage(c, skinsState, NOW) },
  { key: 'themes', title: '棋盘主题', nav: 'skins', draw: (c) => void drawSkinsPage(c, themesState, NOW) },
  { key: 'game', title: '游戏内', draw: gameScreen },
  { key: 'result', title: '通关结算', draw: resultScreen },
];

/** 按 key 找一屏。 */
export function pageByKey(key: string): PageDef | undefined {
  return PAGES.find((p) => p.key === key);
}

export { drawNav };
