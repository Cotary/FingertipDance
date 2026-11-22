/**
 * 排行榜页 —— 「2-1-3 领奖台」版式（2026-11-15 定稿，06 屏）。
 *
 * ## 坐标
 *
 * 与首页/我的同一套换算：`x = designCss × 2`、`y = (designCss − 36) × 2`。
 * 设计稿实测：
 *
 * | 元素 | 设计稿 | 画布 |
 * |---|---|---|
 * | 标题（17px 衬线） | 24,54 | 48,62 |
 * | Tab 胶囊 80×29 间距 8 | 24,87 | 48,102 宽 160 高 58 间距 16 |
 * | 领奖台（2-1-3，底边对齐） | 22,134 高 143 | 44,196 高 286 |
 * | 列表行 331×58 间距 8 | 22,299 | 44,526 高 116 间距 16 |
 *
 * ## 领奖台的堆叠是「底边对齐」
 *
 * 三个底座的下沿都在同一条线（画布 482）。第一名底座 68 高、第二名 44、第三名 28，
 * 所以头像自然形成台阶 —— 不用手算每个头像的 y。名字/分数从**各自头像底部**推
 * （+32 / +62），三个 pod 的名字因此错落，这正是设计稿的样子。
 *
 * 底座只有**上沿**是圆的（`border-radius: 8px 8px 0 0`）：下沿贴着基线，
 * 圆角会在台阶之间漏出一道缝。Canvas 的 `roundRect` 四个角一起圆，所以这里手写路径。
 *
 * ## 分数为什么紧跟名字而不是右对齐
 *
 * 设计稿把分数放在名字块后 13 CSS 处，右侧故意留 81 CSS 空白 —— 右对齐会让
 * 「数字列」变成页面第二重心，和领奖台抢戏。名字块固定 190 宽（设计 95），
 * 过长的昵称截断，保证分数不会因为名字长短而漂移。
 *
 * ## 数据不发明
 *
 * 真实接口只有 `maxLevel / totalTimeMs`，所以分数列是「N 关」而不是设计稿的
 * 「★ 星数」，副行是「用时 M 分」而不是「第 N 关 · 重来 M」。
 * 我的名次（myRank）不在可见区时，在列表下方补一根金边底栏。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedTextRight, trackedWidth, SERIF_FONT, type Button } from './hud';
import { getOpenDataCanvas } from '../platform/openData';
import type { FriendsPageState } from './friends';
import type { FriendItem, LeaderboardItem } from '../net/api';

/** 排行榜 Tab。 */
export type RankTab = 'global' | 'friends';

/** 总榜数据。 */
export interface GlobalRankData {
  list: LeaderboardItem[];
  myRank: number;
  total: number;
  loading: boolean;
  /** 当前窗口起点（0 = 第一页）。翻页后 >0，此时不画领奖台。 */
  offset: number;
  /** 每页条数（与服务端默认一致）。 */
  pageSize: number;
}

/** 排行榜页状态。 */
export interface RankPageState {
  tab: RankTab;
  global: GlobalRankData;
  friends: FriendsPageState;
}

/** 创建初始状态。 */
export function createRankState(): RankPageState {
  return {
    tab: 'global',
    global: { list: [], myRank: 0, total: 0, loading: true, offset: 0, pageSize: 50 },
    friends: { friends: [], stats: { friendCount: 0, avgLevel: 0, maxLevel: 0 }, myRank: 0, loadingOpenData: true },
  };
}

// ── 色（定稿 06 排行色板）──
const R = {
  ink: '#E4EDE6',        // c050 名字
  inkDim: '#B9B2A4',     // i300 副行
  muted: '#7A7468',      // i500 弱读数
  gold: '#D4AF6A',
  goldHi: '#F2DCA8',
  onGold: '#2A2114',
  rowBg: 'rgba(22,36,30,0.70)',
  rowBorder: 'rgba(147,179,162,0.12)',
  meBorder: 'rgba(212,175,106,0.38)',
  tabBg: 'rgba(22,36,30,0.55)',
} as const;

/** 版面尺寸（设计稿 06 屏实测 ×2）。 */
const M = {
  pad: 44,
  /** 标题基线（h3 盒顶 54 CSS → 36） */
  titleBase: 68,
  /** Tab 行 */
  tabY: 102,
  tabW: 160,
  tabH: 58,
  tabGap: 16,
  /** 领奖台：底座基线 + 三档底座高 + 列间距 */
  podiumBottom: 482,
  baseH1: 68,
  baseH2: 44,
  baseH3: 28,
  podGap: 24,
  /** 列表 */
  listTop: 526,
  rowH: 116,
  rowGap: 16,
  rowR: 26,
  /** 行内：名次块 / 头像 / 名字块 / 分数 */
  noX: 76,
  avaCx: 180,
  avaR: 34,
  nameX: 240,
  nameW: 190,
  scoreX: 456,
  /** 我的名次条 */
  mineH: 76,
} as const;

/** 行数据（两个 Tab 统一渲染）。 */
interface Row {
  rank: number;
  name: string;
  level: number;
  mins: number;
}

/**
 * 玉青 / 金渐变圆球 + 衬线首字。
 *
 * 高光的位置与我的页头像一致（左上 35°），只是小尺寸不做底部暗弧 ——
 * 34px 的球再加两层阴影会糊成一团。
 */
function drawAva(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  name: string,
  gold: boolean,
  sizeRatio = 0.66,
): void {
  const g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.44, r * 0.05, cx, cy, r * 1.1);
  if (gold) {
    g.addColorStop(0, '#FFF6E0');
    g.addColorStop(0.4, '#F0DCAB');
    g.addColorStop(0.72, '#C9A25C');
    g.addColorStop(1, '#8A6B3C');
  } else {
    g.addColorStop(0, '#DCEBDD');
    g.addColorStop(0.36, '#9FB8A8');
    g.addColorStop(0.7, '#547F6B');
    g.addColorStop(1, '#22452F');
  }

  ctx.save();
  if (gold) {
    // 第一名球外有一圈金晕（定稿 0 10px 24px rgba(212,175,106,.35)）
    ctx.shadowColor = 'rgba(212,175,106,0.35)';
    ctx.shadowBlur = r * 0.72;
    ctx.shadowOffsetY = r * 0.18;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.40)';
    ctx.shadowBlur = r * 0.34;
    ctx.shadowOffsetY = r * 0.14;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // 顶缘一道细高光：小球全靠这一笔显「釉」
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.04, r - 2, Math.PI * 1.04, Math.PI * 1.74);
  ctx.strokeStyle = gold ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.26)';
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.stroke();
  ctx.restore();

  const ch = (name || '玩').trim().slice(0, 1) || '玩';
  ctx.save();
  ctx.font = `900 ${Math.round(r * sizeRatio)}px ${SERIF_FONT}`;
  ctx.fillStyle = gold ? R.onGold : '#1D3A2E';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, cx, cy);
  ctx.restore();
}

/** 只把上沿两角做成圆角的矩形（台阶底座贴地，下沿必须是直角）。 */
function topRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/** 超宽截断：昵称不能把分数挤到看不见。 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  size: number,
  track: number,
  weight: number,
): string {
  if (trackedWidth(ctx, text, size, track, weight) <= maxW) return text;
  let s = text;
  while (s.length > 1 && trackedWidth(ctx, `${s}…`, size, track, weight) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/**
 * 绘制排行榜页。
 * @returns 可点击按钮列表（顺序：好友榜, 全服榜 —— 与设计稿左右一致）
 */
export function drawRankPage(ctx: CanvasRenderingContext2D, st: RankPageState, _now: number): Button[] {
  // ── 标题行：左标题 + 右真实读数 ──
  trackedText(ctx, '排行榜', M.pad + 4, M.titleBase, 34, R.ink, 10.88, 600);
  const totalLabel = st.tab === 'global'
    ? (st.global.total > 0 ? `${st.global.total} 人在榜` : '')
    : (st.friends.stats.friendCount > 0 ? `${st.friends.stats.friendCount} 位好友` : '');
  if (totalLabel) {
    trackedTextRight(ctx, totalLabel, DESIGN_W - M.pad - 6, M.titleBase - 6, 20, R.muted, 4.4, 500);
  }

  // ── Tab 胶囊：好友榜 / 全服榜（设计稿好友在左）──
  const tabFriends: Button = {
    x: M.pad, y: M.tabY, w: M.tabW, h: M.tabH, label: '好友榜', kind: 'secondary', id: 'tabFriends',
  };
  const tabGlobal: Button = {
    x: M.pad + M.tabW + M.tabGap, y: M.tabY, w: M.tabW, h: M.tabH, label: '全服榜', kind: 'secondary', id: 'tabGlobal',
  };
  for (const b of [tabFriends, tabGlobal]) {
    const on = (b.id === 'tabGlobal') === (st.tab === 'global');
    roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    if (on) {
      // 选中：金底暗字（定稿 .t.on 用 --g300 底）
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, '#E8CE96');
      g.addColorStop(1, R.gold);
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.fillStyle = R.tabBg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const lw = trackedWidth(ctx, b.label, 22, 5.72, on ? 700 : 400);
    trackedText(ctx, b.label, b.x + (b.w - lw) / 2, b.y + b.h / 2 + 8, 22, on ? R.onGold : R.muted, 5.72, on ? 700 : 400);
  }

  // ── 好友榜：优先画开放数据域的真实好友榜 ──
  //
  // 服务端 `/api/friends` 里的"好友"是我们自己的好友关系（加过才算），
  // 而微信开放数据域拿到的是**微信好友里玩过这个游戏的人** —— 那才是玩家
  // 理解的"好友榜"。有就用它；Web / 抖音 / 老基础库没有这个能力，回落列表。
  //
  // 首帧（`loadingOpenData`）先不画：那时共享画布还是空的，
  // 贴上去是一块黑，比"加载中"更像坏了。
  if (st.tab === 'friends' && !st.friends.loadingOpenData && drawOpenDataBoard(ctx)) {
    return [tabFriends, tabGlobal];
  }

  // ── 数据 ──
  const rows: Row[] = [];
  let myRank = 0;
  let total = 0;
  if (st.tab === 'global') {
    const g = st.global;
    myRank = g.myRank;
    total = g.total;
    if (g.loading) {
      placeholder(ctx, '加载中…');
      return [tabFriends, tabGlobal];
    }
    g.list.forEach((it: LeaderboardItem) => rows.push({
      rank: it.rank,
      name: it.nickname || '玩家',
      level: it.maxLevel,
      mins: Math.round(it.totalTimeMs / 60000),
    }));
  } else {
    const f = st.friends;
    myRank = f.myRank;
    total = f.stats.friendCount;
    if (f.loadingOpenData) {
      placeholder(ctx, '加载中…');
      return [tabFriends, tabGlobal];
    }
    f.friends.forEach((it: FriendItem, i: number) => rows.push({
      rank: i + 1,
      name: it.nickname || '好友',
      level: it.maxLevel,
      mins: Math.round(it.totalTimeMs / 60000),
    }));
  }

  if (rows.length === 0) {
    placeholder(ctx, '还没有人上榜');
    return [tabFriends, tabGlobal];
  }

  // ── 分页 ──
  //
  // 领奖台只属于**第一页**：第二页的前三名其实是全服第 51/52/53 名，
  // 把他们摆到"冠军台"上读起来像在撒谎。翻页后整块让给列表。
  const paged = st.tab === 'global' ? st.global : null;
  const offset = paged?.offset ?? 0;
  const pageSize = paged?.pageSize ?? 50;
  const showPodium = offset === 0;
  const pager = st.tab === 'global' && total > pageSize;

  const listTop = showPodium ? M.listTop : 196;
  // 分页条占 64 + 24 的呼吸，列表不能压到它底下
  const listBottom = DESIGN_H - 120 - 28 - (pager ? 88 : 0);

  if (showPodium) drawPodium(ctx, rows, myRank);
  drawList(ctx, rows, myRank, total, listTop, listBottom);

  const buttons = [tabFriends, tabGlobal];
  if (pager) buttons.push(...drawPager(ctx, offset, total, rows.length));
  return buttons;
}

/**
 * 分页条：上一页 / 下一页 + 区间读数。
 *
 * 不可用的那一侧**照画但不返回** —— 直接不画会让整条在翻到首页时
 * 突然右对齐再跳回来；画成灰的，玩家一眼知道"到顶了"。
 */
function drawPager(
  ctx: CanvasRenderingContext2D,
  offset: number,
  total: number,
  shown: number,
): Button[] {
  const y = DESIGN_H - 120 - 28 - 64;
  const bw = 190;
  const bh = 64;
  const prev: Button = { x: M.pad, y, w: bw, h: bh, label: '上一页', kind: 'secondary', id: 'rankPrev' };
  const next: Button = { x: DESIGN_W - M.pad - bw, y, w: bw, h: bh, label: '下一页', kind: 'secondary', id: 'rankNext' };

  const hasPrev = offset > 0;
  const hasNext = offset + shown < total;
  drawPagerBtn(ctx, prev, hasPrev);
  drawPagerBtn(ctx, next, hasNext);

  const end = offset + shown;
  const label = total > 0 ? `第 ${offset + 1}–${end} 名 / 共 ${total} 人` : '';
  const w = trackedWidth(ctx, label, 20, 2.4, 500);
  trackedText(ctx, label, (DESIGN_W - w) / 2, y + bh / 2 + 7, 20, R.muted, 2.4, 500);

  const out: Button[] = [];
  if (hasPrev) out.push(prev);
  if (hasNext) out.push(next);
  return out;
}

function drawPagerBtn(ctx: CanvasRenderingContext2D, b: Button, on: boolean): void {
  roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fillStyle = on ? R.rowBg : 'rgba(22,36,30,0.32)';
  ctx.fill();
  ctx.strokeStyle = on ? 'rgba(212,175,106,0.32)' : 'rgba(147,179,162,0.10)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const size = 22;
  const w = trackedWidth(ctx, b.label, size, 4.4, on ? 600 : 400);
  trackedText(ctx, b.label, b.x + (b.w - w) / 2, b.y + b.h / 2 + 8, size, on ? R.ink : 'rgba(122,116,104,0.55)', 4.4, on ? 600 : 400);
}

/**
 * 把开放数据域的好友榜画进版面。成功返回 true。
 *
 * 尺寸按**版面**给（`getOpenDataCanvas` 会顺带改共享画布尺寸并通知重画），
 * 不能用默认屏幕尺寸 —— 那会被 `drawImage` 缩放成模糊的一片。
 */
function drawOpenDataBoard(ctx: CanvasRenderingContext2D): boolean {
  const top = 196;
  const w = DESIGN_W - M.pad * 2;
  // 底栏上沿（`DESIGN_H - 120`）再留 28 的呼吸
  const h = DESIGN_H - 120 - 28 - top;
  if (h < 120) return false;

  const od = getOpenDataCanvas(w, h);
  if (!od) return false;
  try {
    ctx.drawImage(od.canvas, M.pad, top, w, h);
    return true;
  } catch {
    // 共享画布刚改过尺寸时个别基础库会抛 —— 下一帧再画
    return false;
  }
}

function placeholder(ctx: CanvasRenderingContext2D, msg: string): void {
  const y = M.listTop;
  roundRect(ctx, M.pad, y, DESIGN_W - M.pad * 2, 220, 32);
  ctx.fillStyle = R.rowBg;
  ctx.fill();
  ctx.strokeStyle = R.rowBorder;
  ctx.lineWidth = 2;
  ctx.stroke();
  const w = trackedWidth(ctx, msg, 26, 8, 600);
  trackedText(ctx, msg, (DESIGN_W - w) / 2, y + 128, 26, R.muted, 8, 600);
}

// ────────────────────────────── 领奖台 2-1-3 ──────────────────────────────

function drawPodium(ctx: CanvasRenderingContext2D, rows: Row[], myRank: number): void {
  // 视觉序：第二名（左）· 第一名（中）· 第三名（右）
  const slots: Array<{ row: Row | undefined; place: 1 | 2 | 3 }> = [
    { row: rows[1], place: 2 },
    { row: rows[0], place: 1 },
    { row: rows[2], place: 3 },
  ];
  const avaR = (p: number): number => (p === 1 ? 66 : 54);
  const baseH = (p: number): number => (p === 1 ? M.baseH1 : p === 2 ? M.baseH2 : M.baseH3);

  // 列宽 = 头像直径，间距 24，整组居中
  const totalW = slots.reduce((a, s) => a + avaR(s.place) * 2, 0) + M.podGap * 2;
  let x = (DESIGN_W - totalW) / 2;

  for (const s of slots) {
    const ar = avaR(s.place);
    const cx = x + ar;
    x += ar * 2 + M.podGap;

    const bh = baseH(s.place);
    const bTop = M.podiumBottom - bh;
    // 球底到台面恒定 86：名字/分数**站在台面上方**（设计稿 43 CSS 的
    // 「名字 18 + 分数 15 + 两段呼吸」）。球底再减去直径才是圆心。
    const avaBottom = bTop - 86;
    const avaCy = avaBottom - ar;

    // 底座（只有上沿圆角）
    topRoundRect(ctx, cx - ar, bTop, ar * 2, bh, 16);
    ctx.fillStyle = s.place === 1 ? 'rgba(212,175,106,0.17)' : 'rgba(212,175,106,0.11)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,106,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const row = s.row;
    if (!row) continue;

    drawAva(ctx, cx, avaCy, ar, row.name, s.place === 1, 0.59);

    const me = row.rank === myRank && myRank > 0;
    const nm = fitText(
      ctx,
      me ? `${row.name}（你）` : row.name,
      ar * 2 + 20,
      21,
      3.36,
      me ? 600 : 500,
    );
    const nw = trackedWidth(ctx, nm, 21, 3.36, me ? 600 : 500);
    trackedText(ctx, nm, cx - nw / 2, avaBottom + 36, 21, me ? R.goldHi : R.inkDim, 3.36, me ? 600 : 500);

    const sc = `${row.level} 关`;
    const sw = trackedWidth(ctx, sc, 21, 1.76, 500);
    trackedText(ctx, sc, cx - sw / 2, avaBottom + 66, 21, R.gold, 1.76, 500);
  }
}

// ────────────────────────────── 列表行 ──────────────────────────────

/**
 * 列表区。
 *
 * `listTop` / `listBottom` 由调用方给：第一页要给领奖台让位（526 起），
 * 翻页后整块上移（196 起）；底部还要给分页条留 88。
 */
function drawList(
  ctx: CanvasRenderingContext2D,
  rows: Row[],
  myRank: number,
  total: number,
  listTop: number,
  listBottom: number,
): void {
  // 第一页的前三名已经在领奖台上，列表从第 4 名开始；翻页后没有领奖台，全画
  const skip = listTop === M.listTop ? 3 : 0;
  const rest = rows.slice(skip);
  const avail = listBottom - listTop;
  const inPodium = skip === 3 && myRank >= 1 && myRank <= 3;
  const needMineBar = myRank > 0 && !inPodium && !rest.slice(0, 99).some((r) => r.rank === myRank);

  // 要留「我的名次」条的位置：它 76 高 + 12 间距
  const reserved = needMineBar ? M.mineH + 12 : 0;
  const fit = Math.floor((avail - reserved + M.rowGap) / (M.rowH + M.rowGap));
  const maxRows = Math.max(1, Math.min(fit, 6));

  const shown = rest.slice(0, maxRows);
  shown.forEach((row, i) => {
    drawRow(ctx, row, listTop + i * (M.rowH + M.rowGap), myRank);
  });

  if (needMineBar) {
    const y = listTop + shown.length * (M.rowH + M.rowGap);
    roundRect(ctx, M.pad, y, DESIGN_W - M.pad * 2, M.mineH, M.rowR);
    ctx.fillStyle = 'rgba(212,175,106,0.12)';
    ctx.fill();
    ctx.strokeStyle = R.meBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    const cy = y + M.mineH / 2 + 8;
    trackedText(ctx, '我的名次', M.pad + 30, cy, 22, R.inkDim, 4.8, 600);
    const label = total > 0 ? `第 ${myRank} 名 / ${total} 人` : `第 ${myRank} 名`;
    trackedTextRight(ctx, label, DESIGN_W - M.pad - 30, cy, 24, R.gold, 1.2, 600);
  }
}

function drawRow(ctx: CanvasRenderingContext2D, row: Row, y: number, myRank: number): void {
  const me = row.rank === myRank && myRank > 0;
  roundRect(ctx, M.pad, y, DESIGN_W - M.pad * 2, M.rowH, M.rowR);
  ctx.fillStyle = R.rowBg;
  ctx.fill();
  ctx.strokeStyle = me ? R.meBorder : R.rowBorder;
  ctx.lineWidth = me ? 2.5 : 2;
  ctx.stroke();

  const cy = y + M.rowH / 2;

  // 名次（衬线弱色，块内居中）
  trackedText(ctx, String(row.rank), M.noX, cy + 10, 28, R.muted, 1.4, 500);

  // 头像
  drawAva(ctx, M.avaCx, cy, M.avaR, row.name, false);

  // 名字 + 副行
  const nm = fitText(ctx, me ? `${row.name}（你）` : row.name, M.nameW, 24, 3.84, me ? 600 : 500);
  trackedText(ctx, nm, M.nameX, cy - 6, 24, me ? R.goldHi : R.ink, 3.84, me ? 600 : 500);
  trackedText(ctx, `用时 ${row.mins} 分`, M.nameX, cy + 26, 18, R.muted, 2.88, 500);

  // 分数（金色衬线，紧跟名字块 —— 见文件头）
  trackedText(ctx, `${row.level} 关`, M.scoreX, cy + 8, 26, R.goldHi, 1.3, 500);
}
