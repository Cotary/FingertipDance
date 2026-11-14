/**
 * 关卡地图页 —— 一条通往星穹的古道（几何 / 状态 / 命中）。
 *
 * ## 这一版换的不是装饰，是空间
 *
 * 上一版是「平铺的山道」：节点等大、路面等宽、世界门是一块横跨屏幕的牌子。
 * 它的问题不是颜色，是**没有纵深**——一屏十四个一样大的圆点，
 * 读起来像贴在墙上的清单，不像一条要走的路。
 *
 * 新版按「站在路上往前看」组织：
 *
 * - **远小近大**：`depthScale(y)` 让位于视野上方的节点缩到 0.72、下方放到 1.05，
 *   路面同步从 28px 宽收到 80px。透视是唯一让人相信「前面还有路」的线索。
 * - **天空有层**：星点按 0.15 的视差走、星云几乎不动、行星固定在远处。
 *   滚动时三层速度不同，2D 画面就有了相机在动的错觉。
 * - **路是一条带**：不再是 `lineWidth` 描边，而是沿 Catmull-Rom 采样后
 *   左右各偏移半个路宽拼出的多边形，透视收窄会真的发生在几何上。
 * - **未解锁是暗星，不是坑**：深色球体 + 一圈冷光边，读作「还没点亮」。
 *   凹坑是黏土桌面的语言，放到星空里会变成一个黑洞。
 *
 * 配色按**当前棋盘主题**取（`render/mapstyle.ts`）：九套主题九片夜空，
 * 但共用同一套构图。
 *
 * ## 几何的两条硬约束（测试锁着）
 *
 * 1. 节点必须落在 `[40, 656]` 里 —— 右边 656 之后是导轨的手势区（见 `RAIL`）。
 * 2. 世界门必须夹在两个节点**中间**，不能和任何节点重叠（见 `test/mapview.test.ts`）。
 *
 * 绘制在 `ui/mapdraw.ts`。这里只留「路在哪、点得中哪」。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { SKINS } from '../render/skins';
import { DEBUG_ENABLED } from '../core/debug';

// ────────────────────────────── 尺寸 ──────────────────────────────

/** 相邻两关的垂直间距。8 关左右填满一屏 —— 看细节，不是看清单。 */
export const NODE_STEP = 116;

/**
 * 世界门独占的额外高度。门夹在两关之间，不占任何一关的位置。
 *
 * 140 而不是 96：门高 84，两关间距 = 116 + GATE_H ± 20（y 有 ±10 的呼吸）。
 * 96 时门顶正好压在**世界末关的星星**上（星星画在节点下方 r + 18 + 10 处），
 * 世界末关刚好插着旗、带着星，是这张图上最需要看清的一格。
 */
const GATE_H = 140;

/** 第一关节点的中心 y（顶部遮罩 204 以下留一点呼吸）。 */
export const FIRST_NODE_Y = 246;

/** 可视区顶部（遮罩下沿）。 */
export const ROUTE_TOP = 200;

/** 可视区底部。下面 196px 留给吸底的「继续」按钮和导航栏。 */
export const VIEW_BOTTOM = DESIGN_H - 196;

/** 山道的中轴（0..706 的中点，右边 44px 是导轨）。 */
export const CENTER_X = 353;

/** 蜿蜒振幅。353 ± (198 + 20) = [135, 571]，加减最大节点半径 46 仍在 [89, 617] 内。 */
const WAVE_AMP = 198;

/** 每个节点推进的相位。2π/0.72 ≈ 8.7 关一个来回 —— 长周期才像山路，短周期像弹簧。 */
const WAVE_K = 0.95;

/** 右侧导轨。 */
export const RAIL = {
  /**
   * 手势区左边界（这个 x 以右都算导轨）。
   *
   * 节点最右到 617（`CENTER_X + WAVE_AMP + 副波 + 半径`），656 留了近 40px
   * 余量：再往左就开始吃掉节点边缘的点击，再往右（比如 686）在 375 宽的手机上
   * 只剩 24px，拇指按不准。
   */
  hitLeft: 656,
  /** 轨道中心 x */
  center: DESIGN_W - 28,
  /** 轨道宽度 */
  width: 7,
  /** 轨道上下端 */
  top: 214,
  bottom: VIEW_BOTTOM - 8,
  /** 滑块最小高度：太短就抓不住 */
  thumbMinH: 64,
} as const;

// ────────────────────────────── 世界 ──────────────────────────────

/** 世界：关号区间 + 名字 + 主色。 */
export interface World {
  from: number;
  to: number;
  name: string;
  /** 世界主色：世界门、导轨刻度、节点星球、星尘。 */
  accent: string;
}

/**
 * 七个世界。
 *
 * 区间来自 `core/cover/v3/generate.ts` 的 WORLDS，两边必须一致
 * （`test/mapview.test.ts` 锁住了）。
 *
 * 色值比黏土版亮一档：它们要压在深色夜空上。太暗的绿/蓝在 #0A1226 上
 * 只剩一团脏灰，分不出「苗圃」和「苔原」。
 */
export const WORLDS: World[] = [
  { from: 1, to: 12, name: '苗圃', accent: '#8FE3A8' },
  { from: 13, to: 32, name: '石溪', accent: '#7FC8F0' },
  { from: 33, to: 64, name: '苔原', accent: '#7FE0C4' },
  { from: 65, to: 152, name: '熔炉', accent: '#F0906A' },
  { from: 153, to: 404, name: '深井', accent: '#8C9BE8' },
  { from: 405, to: 704, name: '云阶', accent: '#E8D9B8' },
  { from: 705, to: 1000, name: '星穹', accent: '#F2C86A' },
];

/** 世界末关（插旗的关号）。 */
export const WORLD_ENDS: number[] = WORLDS.map((w) => w.to);

/**
 * 皮肤奖励关。只认 premium —— 普通皮肤已经整体改成广告解锁，
 * 标在地图上会误导成「打这关才有」。
 */
export const SKIN_LEVELS: number[] = SKINS
  .filter((s) => s.unlockType === 'milestone' && s.unlockValue > 0)
  .map((s) => s.unlockValue);

// ────────────────────────────── 小工具 ──────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 确定性伪随机：同一个 seed 永远同一个值。地形不能用 Math.random（每帧会跳）。 */
export function hash(n: number): number {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// ────────────────────────────── 几何 ──────────────────────────────

/** 地图状态。 */
export interface MapViewState {
  /**
   * 当前关号（= 下一个可玩的关号）。
   *
   * 语义：**已经通关的最高关号 + 1**。
   * 一关都没通 → 1；刚打完第 1 关 → 2。
   *
   * ## 为什么不用「最高已通关关号」
   *
   * 服务端 `users.max_level` 存的是「最高**已通关**关号」（0 = 没通关过），
   * 而地图的三态判定是「比当前关小的都通了，比当前关大的都锁着」。
   * 直接拿 `maxLevel` 当当前关用会整体错一格：
   * 通关第 1 关后地图会把第 1 关画成「当前」（可重玩）、
   * 把第 2 关锁着 —— 玩家会觉得「明明通关了，怎么还在原地」。
   *
   * 所以这里统一用「当前关号」语义，`maxLevel` 只在统计/排行榜里出现。
   */
  currentLevel: number;
  /** 关卡总数 */
  levelCount: number;
  /** 关号 → 星级（0 表示还没打过） */
  stars: Record<string, number>;
  /** 当前滚动偏移 */
  scrollY: number;
  /** 最大滚动偏移 */
  maxScrollY: number;
  /** 提示气泡文案（为空则不显示） */
  toast: string;
  /** 提示气泡显示起始时间 */
  toastAt: number;
  /**
   * 平滑滚动目标（点世界刻度 / 「回到当前关」时用）。
   *
   * 直接赋值会让画面瞬移，玩家不知道自己去了哪；缓动过去才能建立
   * 「我往上/往下走了多远」的空间感。`null` = 没有待执行的目标。
   */
  scrollTarget: number | null;
  /** 甩指惯性速度（设计像素 / 毫秒）。每帧衰减。 */
  fling: number;
  /** 是否正在拖右侧导轨（拖时滑块加宽 + 出浮标） */
  scrub: boolean;
  /** 调试模式：所有关卡都可点。见 `debugUnlockAll` 的说明。 */
  debugUnlockAll: boolean;
}

/** 到指定关号为止，前面插了几道门。 */
function gatesBefore(idx: number): number {
  let n = 0;
  for (let i = 1; i < WORLDS.length; i++) if (WORLDS[i].from <= idx) n++;
  return n;
}

/**
 * 第 idx 关节点的中心 y（世界坐标，未减 scrollY）。
 * 关号 1-based。严格单调递增 —— `visibleRange` 靠这条做二分。
 */
export function nodeY(idx: number): number {
  const i = idx - 1;
  // 行距也留一点呼吸（±10）。等距会让「每一关都一样重」，
  // 而不等距读起来像人一步步走出来的。下界 96 仍然远大于两个节点的半径和。
  return FIRST_NODE_Y + i * NODE_STEP + Math.sin(i * 1.73) * 10 + gatesBefore(idx) * GATE_H;
}

/**
 * 第 idx 关节点的中心 x。
 *
 * 主波是长周期正弦（山路），再叠一条几乎看不出来的高频小波：
 * 纯正弦的两个波峰波谷之间是等距的，加一点不规则才不像函数图像。
 */
export function nodeX(idx: number): number {
  const i = idx - 1;
  // 主波决定走哪边，副波（20px、频率和主波不整除）负责「同一条斜坡上也有起伏」：
  // 只有主波时，两个拐点之间的距离是一段**笔直**的斜线，一眼就是正弦函数图像。
  return CENTER_X + Math.sin(i * WAVE_K) * WAVE_AMP + Math.sin(i * 2.41 + 0.7) * 20;
}

/** 节点坐标。关号 1-based。 */
export function mapNodePos(idx: number): { x: number; y: number } {
  return { x: nodeX(idx), y: nodeY(idx) };
}

/**
 * 透视缩放：视野上方（远）小，下方（近）大。
 *
 * 这是「3D 倾向」的全部秘密 —— 不改任何世界坐标，只改**画多大**。
 * 命中判断也用它，所以视觉大小和可点区域永远一致（不会出现
 * 「看着是个小星，点半天点不中」）。
 *
 * 指数 0.8 而不是线性：线性会让中段的路突然变宽，像折了一刀；
 * 0.8 的曲线在视野中部更平缓，符合「近处变化快、远处变化慢」的透视直觉。
 *
 * @param screenY 屏幕坐标 y（已减 scrollY）
 */
export function depthScale(screenY: number): number {
  const t = clamp((screenY - ROUTE_TOP) / (VIEW_BOTTOM - ROUTE_TOP), 0, 1);
  return 0.72 + 0.33 * Math.pow(t, 0.8);
}

/** 路面半宽（设计像素）。远处 14、近处 40 —— 一条真的会收窄的带子。 */
export function roadHalfWidth(screenY: number): number {
  const t = clamp((screenY - ROUTE_TOP) / (VIEW_BOTTOM - ROUTE_TOP), 0, 1);
  return 11 + 16 * Math.pow(t, 0.9);
}

/** 某关节点的视觉半径（未解锁 / 已通关 / 当前关三态 + 透视）。 */
export function nodeRadius(idx: number, screenY: number, st: MapViewState): number {
  const milestone = WORLD_ENDS.includes(idx);
  const base = idx === st.currentLevel ? 46 : idx < st.currentLevel ? (milestone ? 44 : 39) : 32;
  return base * depthScale(screenY);
}

/** 第 gi 道门的中心 y。正好落在前后两关中间。导出供测试校验几何。 */
export function gateCenterY(gi: number): number {
  const from = WORLDS[gi + 1].from;
  return (nodeY(from - 1) + nodeY(from)) / 2;
}

/** 关号所属的世界下标。 */
export function worldOf(idx: number): number {
  for (let i = WORLDS.length - 1; i >= 0; i--) if (idx >= WORLDS[i].from) return i;
  return 0;
}

/** 内容总高度（最后一关再往下留一段，让它能滚到屏幕中部）。 */
function contentBottom(levelCount: number): number {
  if (levelCount <= 0) return ROUTE_TOP;
  return nodeY(levelCount) + 120;
}

/**
 * 创建初始状态。
 *
 * ## `debugUnlockAll` 的生效条件
 *
 * 只有**构建期调试开关**（`DEBUG_ENABLED`）打开时才允许真的开这个模式。
 * 生产构建里 `DEBUG_ENABLED` 恒为 `false` → 这里直接忽略传入值 →
 * 就算调用方误传了 `true`，调试入口也不存在。
 */
export function createMapState(
  currentLevel: number,
  levelCount: number,
  stars: Record<string, number>,
  debugUnlockAll = false,
): MapViewState {
  return {
    currentLevel,
    levelCount,
    stars,
    scrollY: 0,
    maxScrollY: Math.max(0, contentBottom(levelCount) - VIEW_BOTTOM),
    toast: '',
    toastAt: 0,
    scrollTarget: null,
    fling: 0,
    scrub: false,
    debugUnlockAll: DEBUG_ENABLED && debugUnlockAll,
  };
}

/**
 * 某关当前是否可点。
 *
 * 正常情况：`idx <= currentLevel` 可点（已通关的可重玩，当前关可玩）。
 * 调试模式（`debugUnlockAll`）：**全部可点** —— 测试时能直接进任意一关。
 *
 * ## 为什么这里也判一次 `DEBUG_ENABLED`
 *
 * 让生产构建能把整个调试分支**彻底 tree-shake 掉**：
 * `DEBUG_ENABLED` 被内联成 `false` → `false && ...` 整块被删。
 */
export function isLevelPlayable(idx: number, st: MapViewState): boolean {
  if (DEBUG_ENABLED && st.debugUnlockAll) return true;
  return idx <= st.currentLevel;
}

/** 第一个 `nodeY >= y` 的关号。 */
function firstAtLeast(y: number, levelCount: number): number {
  let lo = 1;
  let hi = levelCount;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nodeY(mid) < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 计算可视区内的节点区间。
 *
 * 视线之外多带一关：曲线段的切线要用到相邻节点，
 * 只给刚好可见的那几关，路会在屏幕边缘「折」一下。
 */
export function visibleRange(scrollY: number, levelCount: number): { first: number; last: number } {
  if (levelCount <= 0) return { first: 1, last: 0 };
  const top = scrollY + ROUTE_TOP - NODE_STEP;
  const bot = scrollY + VIEW_BOTTOM + NODE_STEP;

  const first = clamp(firstAtLeast(top, levelCount) - 1, 1, levelCount);
  let last = first;
  for (let i = first; i <= levelCount; i++) {
    if (nodeY(i) > bot) break;
    last = i;
  }
  return { first, last: clamp(last, 1, levelCount) };
}

/** 判断点击落在哪个关卡节点上。@returns 关号，未命中返回 -1 */
export function pickMapNode(x: number, y: number, st: MapViewState): number {
  const { first, last } = visibleRange(st.scrollY, st.levelCount);
  for (let i = first; i <= last; i++) {
    const p = mapNodePos(i);
    const cy = p.y - st.scrollY;
    const dx = x - p.x;
    const dy = y - cy;
    // 半径与视觉一致，再给 6px 宽容：远端的节点只有 26px，
    // 严格按视觉半径判会让「看着能点」变成「点不中」。
    // 下限 32 是触控底线，不能为了透视把手感做没了。
    const r = Math.max(32, nodeRadius(i, cy, st) + 6);
    if (dx * dx + dy * dy <= r * r) return i;
  }
  return -1;
}

/**
 * 让指定关号滚动到可视区中部（进入地图时聚焦当前关用）。
 *
 * 下限夹到 0：前几关的节点本来就在屏幕上部，硬居中会把内容推出上边界，
 * 露出「地图之外」的空白。
 */
export function scrollToLevel(idx: number): number {
  return Math.max(0, nodeY(idx) - (ROUTE_TOP + VIEW_BOTTOM) / 2);
}

/** 设计坐标 y 处最接近的那一关（导轨浮标用）。 */
export function levelNear(y: number, levelCount: number): number {
  if (levelCount <= 0) return 1;
  const lo = firstAtLeast(y, levelCount);
  if (lo > 1 && Math.abs(nodeY(lo - 1) - y) < Math.abs(nodeY(lo) - y)) return lo - 1;
  return lo;
}

// ────────────────────────────── 滚动动力学 ──────────────────────────────

/**
 * 推进一帧滚动。
 *
 * 两件事只能在这里做：
 * - **缓动到目标**（点世界刻度）：直接赋值会让画面瞬移，玩家丢失空间感
 * - **甩指惯性**：`onUp` 只给一个初速度，衰减必须按帧算，
 *   交给 `setTimeout` 会在切后台时被节流成「回前台突然滚一大段」
 */
export function stepMapScroll(st: MapViewState, dt: number): void {
  if (st.scrollTarget !== null) {
    const target = clamp(st.scrollTarget, 0, st.maxScrollY);
    const k = 1 - Math.exp(-dt / 72);
    const next = st.scrollY + (target - st.scrollY) * k;
    if (Math.abs(target - next) < 0.6) {
      st.scrollY = target;
      st.scrollTarget = null;
    } else {
      st.scrollY = next;
    }
    return;
  }

  if (Math.abs(st.fling) > 0.01) {
    st.scrollY = clamp(st.scrollY + st.fling * dt, 0, st.maxScrollY);
    st.fling *= Math.exp(-dt / 320);
    // 撞到上下边界就停：继续衰减会让手指离屏后还在「顶」着边
    if (st.scrollY <= 0 || st.scrollY >= st.maxScrollY) st.fling = 0;
    else if (Math.abs(st.fling) < 0.01) st.fling = 0;
  }
}

// ────────────────────────────── 导轨 ──────────────────────────────

/** 导轨几何：轨道范围 + 滑块位置。 */
export function railGeometry(st: MapViewState): {
  top: number;
  h: number;
  thumbH: number;
  thumbTop: number;
} {
  const top = RAIL.top;
  const h = RAIL.bottom - RAIL.top;
  const viewH = VIEW_BOTTOM - ROUTE_TOP;
  const ratio = st.maxScrollY > 0 ? clamp(viewH / st.maxScrollY, 0, 1) : 1;
  const thumbH = Math.max(RAIL.thumbMinH, Math.round(h * ratio));
  const pos = st.maxScrollY > 0 ? clamp(st.scrollY / st.maxScrollY, 0, 1) : 0;
  return { top, h, thumbH, thumbTop: top + (h - thumbH) * pos };
}

/** 某一关在导轨上的 y（按内容比例映射）。 */
export function railYOf(level: number, st: MapViewState): number {
  const g = railGeometry(st);
  const contentH = st.maxScrollY + (VIEW_BOTTOM - ROUTE_TOP);
  const p = contentH > 0 ? clamp(nodeY(level) / contentH, 0, 1) : 0;
  return g.top + p * g.h;
}

/** 导轨上的落点 → 滚动偏移。`grab` 是按下点相对滑块顶部的偏移。 */
export function railScrollAt(y: number, st: MapViewState, grab: number): number {
  const g = railGeometry(st);
  const span = g.h - g.thumbH;
  const rel = span > 0 ? (y - grab - g.top) / span : 0;
  return clamp(rel, 0, 1) * st.maxScrollY;
}

/** 导轨命中结果。 */
export interface RailHit {
  /**
   * - `scrub`：拖滑块（最常用）
   * - `world`：点了某个世界的刻度 → 缓动跳过去
   * - `current`：点了当前关的小圆点 → 缓动跳回自己
   */
  kind: 'scrub' | 'world' | 'current';
  /** `world` / `current` 时的目标关号 */
  level?: number;
  /** `scrub` 时按下点相对滑块顶部的偏移 */
  grab: number;
}

/**
 * 导轨命中判定。
 *
 * 顺序很重要：**先判滑块再判刻度**。滑块只有 64px 高，刻度又正好压在
 * 轨道上 —— 先判刻度的话，想拖滑块却因为手指偏了两像素被弹到另一个世界。
 */
export function pickRail(x: number, y: number, st: MapViewState): RailHit | null {
  if (x < RAIL.hitLeft) return null;
  if (y < RAIL.top - 36 || y > RAIL.bottom + 12) return null;

  const g = railGeometry(st);
  if (y >= g.thumbTop && y <= g.thumbTop + g.thumbH) {
    return { kind: 'scrub', grab: y - g.thumbTop };
  }
  if (Math.abs(y - railYOf(st.currentLevel, st)) <= 22) {
    return { kind: 'current', level: st.currentLevel, grab: 0 };
  }
  for (let wi = 1; wi < WORLDS.length; wi++) {
    if (Math.abs(y - railYOf(WORLDS[wi].from, st)) <= 15) {
      return { kind: 'world', level: WORLDS[wi].from, grab: 0 };
    }
  }
  // 空白处按下 = 把滑块中心挪到手指处，然后跟着拖
  return { kind: 'scrub', grab: g.thumbH / 2 };
}
