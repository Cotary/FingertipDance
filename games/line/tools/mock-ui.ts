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
import { DESIGN_W, DESIGN_H } from '../src/render/layout';
import { computeLayout } from '../src/render/layout';
import { CLAY } from '../src/ui/clay';
import { drawHomePage, type HomePageState } from '../src/ui/home';
import { drawMapView } from '../src/ui/mapdraw';
import { createMapState, scrollToLevel } from '../src/ui/mapview';
import { drawRankPage, createRankState } from '../src/ui/leaderboard';
import { drawProfilePage, type ProfilePageState } from '../src/ui/profile';
import { drawStatsPanel } from '../src/ui/statsPanel';
import { drawSharePanel, type SharePanelState } from '../src/ui/sharePanel';
import { drawSkinsPage, type SkinsPageState } from '../src/ui/skins';
import { drawNav, type NavTab } from '../src/ui/nav';
import { drawBoard, drawEndpoints } from '../src/render/board';
import { drawTrail } from '../src/render/trail';
import { drawHud, drawPlayFootnote, drawPlayTip, drawPlayLegend, drawPlaySub, drawResult, drawButton } from '../src/ui/hud';

/** 盘底按钮的几何：与 `src/main.ts` 的 hintBtn / skipBtn / backHomeBtn 同值。 */
const TIP_BTN = { x: 44, y: 876, w: 662, h: 104, label: '提 示', kind: 'primary' as const, id: 'hint' };
const SKIP_BTN = { x: 44, y: 1196, w: 321, h: 88, label: '跳 过', kind: 'secondary' as const, id: 'skip' };
const BACK_BTN = { x: 385, y: 1196, w: 321, h: 88, label: '返 回', kind: 'secondary' as const, id: 'backHome' };
import { skinById } from '../src/render/skins';
import { CellType } from '../src/core/types';
import { themeById } from '../src/render/themes';
import { packCell, CoverCell } from '../src/core/cover/v3/types';
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
  starCount: 96,
  totalRetries: 23,
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
const MAP_THEME = q.get('t') ?? 'mise';
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
  soundOn: true,
  vibrateOn: true,
  starCount: 96,
  totalRetries: 23,
  threeStarCount: 12,
  currentLevel: 38,
  uid: 88214,
};

// ── 战绩弹层 / 分享抽屉 ──
export const sharePanelState: SharePanelState = {
  levelIdx: 47,
  undos: 0,
  nickname: '瓷生',
  uid: 88214,
  copy: '第 047 关，我不信你过得去',
  copyIndex: 3,
  query: 'l=47&uid=88214&name=%E7%93%B7%E7%94%9F',
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
  // `?p=themes&t=abyss` 直接看在展台上的某一套 —— 八套逐张验收要用它，
  // 否则只能每张截三次图、点两次陶片才能换到
  themeSelected: themeQ.get('t') ?? 'mise',
  themeEquipped: 'mise',
  // `?p=themes&lock=1` 按第 350 关的进度看：玻璃穹顶已解锁、后面几套锁着
  maxLevel: themeQ.get('lock') ? 350 : 1000,
  themeAllUnlocked: !themeQ.get('lock'),
  // `?p=themes&scroll=800` 直接看货架滚到底的样子（验收「最后一行够不够得着」）
  themeScroll: Number(themeQ.get('scroll') ?? 0),
};

// ── 游戏内：造一张 8×8 的示意盘 + 一条已走过的路径 ──
//
// 尺寸照设计稿 03 屏（8×8）：并排对照时格子的器型、面色、缝宽一一对应。
// 机制也照设计稿配齐（单向 / 星屑 / 钥匙 / 门 / 传送 / 冰面 + 四块石头），
// 这样"图例只列盘上真有的机制"这条规则才能被看出来。
const PATTERN = [
  '.....E..',
  '#.......',
  '..#.....',
  'ii....#.',
  '....t...',
  '........',
  's.....s#',
  'S.>....k',
];

/** 已走过的格子（一条从 (0,7) 爬到 (6,0) 的阶梯路）。 */
const realPath: Array<[number, number]> = [
  [0, 7], [1, 7], [1, 6], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5],
  [5, 4], [5, 3], [5, 2], [5, 1], [5, 0], [6, 0],
];

function makeLevel(): LevelData {
  const w = 8;
  const h = 8;
  const grid: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) {
      const ch = PATTERN[y][x];
      let type: CellType = CellType.BRICK;
      if (ch === '#') type = CellType.BLOCK;
      else if (ch === 'S') type = CellType.START;
      else if (ch === 'E') type = CellType.END;
      else if (ch === '>') type = CellType.ONEWAY;
      row.push({ type, dir: ch === '>' ? 3 : 0 });
    }
    grid.push(row);
  }
  return { idx: 37, seed: 37, w, h, grid, shortest: 14, turns: 6, blocks: 4, oneways: 1, diff: 42 };
}

export const level = makeLevel();
export const layout = computeLayout(level.w, level.h);

/** 示意盘的真实机制层（`PATTERN` → CoverCell 编码）。 */
function packedGrid(): Uint8Array {
  const grid = new Uint8Array(level.w * level.h);
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const ch = PATTERN[y][x];
      let type: number = CoverCell.BRICK;
      let dir = 0;
      let group = 0;
      if (ch === '#') type = CoverCell.BLOCK;
      else if (ch === 'S') type = CoverCell.START;
      else if (ch === 'E') type = CoverCell.END;
      else if (ch === '>') { type = CoverCell.ONEWAY; dir = 3; }
      else if (ch === 's') { type = CoverCell.SHARD; group = x === 0 ? 0 : 1; }
      else if (ch === 'k') { type = CoverCell.KEY; group = 0; }
      else if (ch === 'D') { type = CoverCell.GATE; group = 0; }
      else if (ch === 't') { type = CoverCell.PORTAL; group = 0; }
      else if (ch === 'i') type = CoverCell.ICE;
      grid[y * level.w + x] = packCell(type, dir, group);
    }
  }
  return grid;
}

export const gameScreen = (ctx: Ctx): void => {
  const lit = new Set(realPath.map(([x, y]) => y * level.w + x));
  const path = realPath.map(([x, y]) => y * level.w + x);

  // 主题渲染（默认 mise；`?t=classic` 强制走经典皮肤）——
  // 和 main.ts 的 ThemeDrawCtx 同构：backdrop 铺屏 + board 画盘。
  const themeId = themeQ.get('t') ?? 'mise';
  const t = themeId !== 'classic' ? themeById(themeId) : undefined;
  if (t) {
    t.backdrop(ctx, { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H });
    t.board({
      ctx,
      board: { w: level.w, h: level.h, grid: packedGrid() },
      layout,
      state: {
        covered: lit,
        path,
        keysHeld: new Set<number>(),
        shardsGot: new Set<number>(),
        shardNext: 0,
        hint: [3 * level.w + 3],
      },
      now: NOW,
      dpr: 2,
    });
  } else {
    drawBoard(ctx, level, layout, { lit, path, hint: new Set([3 * level.w + 3]), shakeCell: -1, shakeAt: 0 }, skinById('mint'), NOW);
    drawTrail(ctx, path, level.w, layout, CLAY.terracotta);
    drawEndpoints(ctx, level, layout);
  }
  const chrome = t?.chrome;
  drawHud(ctx, level.idx, '薄荷', 6, 16, { done: 52, total: 86, shardNext: 1 }, chrome);
  drawPlayFootnote(ctx, 0, chrome);
  // 盘底三层：金提示 → 图例 → 次级行动（和 main.ts 的 play 分支同版式）。
  // 图例这里放**满编 7 枚**（含墨石）：这一屏是排版对照用的。
  if (chrome) drawPlayTip(ctx, TIP_BTN, false);
  else drawButton(ctx, TIP_BTN, false, undefined, chrome);
  drawPlayLegend(ctx, [
    { kind: 'rock', label: '墨石', bg: '#16211C', ink: 'rgba(158,186,168,0.92)' },
    { kind: 'arrow', label: '单向门', bg: '#26333B', ink: '#F2DCA8' },
    { kind: 'star', label: '星屑 序', bg: '#B89045', ink: '#2A2114' },
    { kind: 'key', label: '钥匙', bg: '#A07E3C', ink: '#2A2114' },
    { kind: 'gate', label: '门', bg: '#26333B', ink: 'rgba(240,235,220,0.8)' },
    { kind: 'portal', label: '传送门', bg: '#5C5192', ink: 'rgba(240,235,255,0.85)' },
    { kind: 'ice', label: '冰面', bg: '#7FA8A0', ink: 'rgba(20,50,45,0.75)' },
  ], 1008, chrome);
  if (chrome) {
    drawPlaySub(ctx, SKIP_BTN, false);
    drawPlaySub(ctx, BACK_BTN, false);
  } else {
    drawButton(ctx, SKIP_BTN, false, undefined, chrome);
    drawButton(ctx, BACK_BTN, false, undefined, chrome);
  }
};

export const resultScreen = (ctx: Ctx): void => {
  // 结算页需要棋盘做底，否则遮罩下是空的
  gameScreen(ctx);
  // cover 口径：0 次重来 → 三星「一气呵成」，数据格是「重来 / 用时」
  drawResult(ctx, 37, 15, 14, 41_500, { id: 'neon', name: '霓虹' }, 37 / 1000, 0);
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
  { key: 'stats', title: '我的 · 战绩弹层', nav: 'profile', draw: (c) => {
    void drawProfilePage(c, profileState, NOW);
    drawStatsPanel(c, {
      maxLevel: profileState.maxLevel,
      currentLevel: profileState.currentLevel,
      starCount: profileState.starCount,
      threeStarCount: profileState.threeStarCount,
      totalRetries: profileState.totalRetries,
      totalSteps: profileState.totalSteps,
      totalTimeMs: profileState.totalTimeMs,
      adWatchCnt: profileState.adWatchCnt,
      levelCount: 1000,
    });
  } },
  { key: 'share', title: '我的 · 分享抽屉', nav: 'profile', draw: (c) => {
    void drawProfilePage(c, profileState, NOW);
    drawSharePanel(c, sharePanelState);
  } },
  // 「分享选关」：地图页的另一个读法 —— 点任意关就发给好友。
  // 视觉上必须一眼看出是在选关（标题变「挑一关分享」、脚卡变「取消」），
  // 否则和普通地图长得一样，玩家会以为点下去是进关。
  { key: 'sharePick', title: '地图 · 分享选关', nav: 'map', draw: (c) => {
    const st = createMapState(mapLv, 1000, stars);
    st.scrollY = scrollToLevel(mapLv);
    st.shareMode = true;
    void drawMapView(c, st, NOW, MAP_THEME);
  } },
  // 「结算页开抽屉」：从通关结果直接分享这一局（带成绩）。
  { key: 'resultShare', title: '结算 · 分享抽屉', draw: (c) => {
    resultScreen(c);
    drawSharePanel(c, sharePanelState);
  } },
  { key: 'skins', title: '主题', nav: 'skins', draw: (c) => void drawSkinsPage(c, skinsState, NOW) },
  { key: 'themes', title: '棋盘主题', nav: 'skins', draw: (c) => void drawSkinsPage(c, themesState, NOW) },
  { key: 'game', title: '游戏内', draw: gameScreen },
  { key: 'result', title: '通关结算', draw: resultScreen },
];

/** 按 key 找一屏。 */
export function pageByKey(key: string): PageDef | undefined {
  return PAGES.find((p) => p.key === key);
}

export { drawNav };
