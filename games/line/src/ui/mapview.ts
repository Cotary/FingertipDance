/**
 * 关卡地图页 —— 一扇望向无尽山径的窗（几何 / 状态 / 命中）。
 *
 * ## 这一版的坐标是「翻过来」的
 *
 * 设计稿里 040 在画面底部、055 在顶部：**往上是未来，往下是来路**。
 * 而关号越大，世界坐标 y 越大（沿路往下长）。所以屏幕 y 要翻一次：
 *
 *     screenY = FLIP_BASE − contentY + scrollY
 *
 * `FLIP_BASE = ROUTE_TOP + VIEW_BOTTOM`，正好是「屏幕中心 ↔ 内容不变」的
 * 对称轴。翻完之后滚动方向也跟着反：手指往下拉 = 看上面的路（后面的关）。
 *
 * 好处是滚动、命中、导轨三处的公式都不用改结构：
 * - `scrollToLevel(L) = nodeY(L) − 中心`，和翻之前一模一样；
 * - 可视内容区间仍是 `[scrollY + ROUTE_TOP, scrollY + VIEW_BOTTOM]`；
 * - 只有「某个内容点画在屏幕哪」这一处需要翻（`screenYOf`）。
 *
 * ## 场景是卡，不是全屏
 *
 * 定稿把地图收进一张 662×972 的圆角卡：卡外是标题与脚卡，卡内是这一段山径，
 * 卡的上缘与下缘各有一层雾 —— 雾外还有路，但看不见（那就是「无尽」）。
 *
 * ## 几何的两条硬约束（测试锁着）
 *
 * 1. 节点必须落在 `[40, RAIL.hitLeft − r]` 里 —— 右边是导轨的手势区。
 * 2. `nodeY` 严格单调 —— `visibleRange` 的二分依赖它。
 *
 * 绘制在 `ui/mapdraw.ts`。这里只留「路在哪、点得中哪」。
 */
import { DESIGN_W } from '../render/layout';
import { SKINS } from '../render/skins';
import { DEBUG_ENABLED } from '../core/debug';

// ────────────────────────────── 尺寸 ──────────────────────────────

/** 相邻两关的垂直间距（设计稿 31 CSS → 62）：一屏 15 关左右。 */
export const NODE_STEP = 62;

/**
 * 第一关节点的内容 y。
 *
 * 420 是「第 1 关恰好落在雾气上沿之上」的位置：scrollY=0 时
 * 它的屏幕 y = FLIP_BASE − 420 = 756，珠下的关号 818 也还在雾外。
 * 再小（比如 240）第 1 关会被压进底部的雾里，新玩家第一眼看不到自己。
 */
export const FIRST_NODE_Y = 420;

/**
 * 地图场景卡（设计稿 02 屏：22..353 × 87..657 CSS → 44..706 × 102..1074）。
 *
 * 卡片高度比设计稿矮（972 而不是 1140）：750×1334 的屏比 375×812 矮 145 CSS，
 * 如果把卡做成 1140，标题与脚卡就没地方站了。卡占「标题之外的全部」，
 * 这个比例（972/1334 ≈ 73%）和设计稿（570/776 ≈ 73%）是一致的。
 */
export const SCENE = { x: 44, y: 102, w: DESIGN_W - 88, h: 972, r: 40 } as const;

/** 可视区顶部 = 卡片上沿。 */
export const ROUTE_TOP = SCENE.y;

/** 可视区底部 = 卡片下沿。 */
export const VIEW_BOTTOM = SCENE.y + SCENE.h;

/** 屏幕 y 的翻转基准（对称轴）。 */
export const FLIP_BASE = ROUTE_TOP + VIEW_BOTTOM;

/**
 * 内容 y → 屏幕 y（已减滚动）。
 *
 * 关卡越大越靠上：往上是没走完的路，往下是走过的路。
 */
export function screenYOf(contentY: number, scrollY: number): number {
  return FLIP_BASE - contentY + scrollY;
}

/** 山道的中轴（0..706 的中点，右边 44px 是导轨）。 */
export const CENTER_X = 353;

/**
 * ── 山径的两层：一条走势腿 + 一层摆动 ──
 *
 * 定稿 02 屏实测（16 关，x 从 52 走到 272 CSS）：**整体向右上方走**，
 * 沿途只是 ±35 CSS 的小幅摆动（周期约 7 关）。也就是说——
 *
 *   走势（低频、大振幅）负责「这一段山往右上」，
 *   摆动（高频、小振幅）负责「路是人踩出来的，不是尺子画的」。
 *
 * 旧实现把两件事压成一层正弦：振幅 198、周期 6.6 关。结果是
 * **一屏（15 关）横着扫两个来回**，读起来是弹簧或者折线，不是山路，
 * 而且每个来回的中段是等斜率直线 —— 就是「圆与圆几乎直线相连」的来源。
 *
 * 现在拆成两层：
 *
 * - **走势**是「三角波 + 滑动平均」：一条上升腿（往右上）接一条折返腿
 *   （往左上），转弯处用 1.8 关的滑动平均磨圆。三角波保证中段是真的在斜行
 *   （斜率恒定、不磨蹭）；滑动平均只在拐角处生效，把尖角变成半径 ~110px 的弯。
 *
 *   为什么不用正弦或 `smoothstep`：两者在波峰附近斜率都趋近 0，于是路径会
 *   **贴着头顶竖着走四五个节点**（两颗粒子上下叠着），比直线更难看。
 *   三角波的斜率是常数，节点永远在往前走。
 *
 * - **摆动**是设计稿那条 ±26 的小波（周期 6.8 关），让每一段斜线都有起伏。
 */
const DRIFT_AMP = 230;

/**
 * 上升腿与折返腿跨越的关数。一个周期 28 关 ≈ 1.8 屏：
 * **一屏里最多见一个回头弯**（旧版是两个半来回）。
 */
const LEG_UP = 16;
const LEG_DOWN = 12;

/** 拐角圆化窗口（关）。1.8 关 ≈ 110px 半径 —— 再大就开始吃掉直线段了。 */
const DRIFT_SMOOTH = 1.8;

/** 相位：整体平移到「第 1 关在左下、正往右上走」的位置。 */
const DRIFT_PHASE = 0;

/** 摆动振幅：设计稿 ±35 CSS → 70 设备像素；这里 26，叠上走势后每屏横跨约 430。 */
const WOB_AMP = 26;

/** 摆动周期 ≈ 6.8 关（设计稿 7 关），与走势周期（28）不整除。 */
const WOB_K = 0.92;

/** 摆动的相位与第二谐波：让「同一段斜坡」也有起伏，不是纯正弦。 */
const WOB_PHI = 0.4;
const WOB2_AMP = 5;
const WOB2_K = 2.31;
const WOB2_PHI = 1.1;

/** 未圆化的走势：三角波，一个周期里先爬 16 关再折回 12 关。 */
function triDrift(i: number): number {
  const cycle = LEG_UP + LEG_DOWN;
  const u = (((i + DRIFT_PHASE) % cycle) + cycle) % cycle;
  if (u < LEG_UP) return -DRIFT_AMP + (2 * DRIFT_AMP * u) / LEG_UP;
  return DRIFT_AMP - (2 * DRIFT_AMP * (u - LEG_UP)) / LEG_DOWN;
}

/**
 * 走势腿的横向偏移（相对 `CENTER_X`）。
 *
 * = 三角波在 ±`DRIFT_SMOOTH`/2 范围内的 7 点平均。直线段原样通过，
 * 只有拐角被磨圆 —— 这正是盘山路的形状：长直坡 + 一个抱过来的回头弯。
 */
function driftOf(i: number): number {
  const N = 7;
  let sum = 0;
  for (let k = 0; k < N; k++) sum += triDrift(i + (k / (N - 1) - 0.5) * DRIFT_SMOOTH);
  return sum / N;
}

/**
 * 右侧导轨。
 *
 * 定稿没有导轨，但 1000 关靠手指滑是滑不到第 700 关的 —— 这是真实功能，
 * 保留，做成「几乎看不见的一根线 + 一颗小金珠」，压在卡片右缘内 24px。
 *
 * **方向跟着地图翻**：珠子在上 = 走得远（∞），在下 = 第 1 关。
 * 导轨若还是「上 = 内容开头」，手指往上推却看到关号变小，会立刻拧巴。
 */
export const RAIL = {
  /** 手势区左边界（这个 x 以右都算导轨）。 */
  hitLeft: 656,
  /** 轨道中心 x：卡片右缘 706 内收 24 */
  center: SCENE.x + SCENE.w - 24,
  /** 轨道宽度 */
  width: 6,
  /** 轨道上下端（卡片内收 48） */
  top: SCENE.y + 48,
  bottom: SCENE.y + SCENE.h - 48,
  /** 滑块最小高度：太短就抓不住 */
  thumbMinH: 56,
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

/**
 * 第 idx 关节点的内容 y（未减 scrollY、未翻转）。关号 1-based。
 * 严格单调递增 —— `visibleRange` 靠这条做二分。
 */
export function nodeY(idx: number): number {
  const i = idx - 1;
  // 行距也留一点呼吸（±10 → 间距 52..72）：等距会让「每一关都一样重」，
  // 而不等距读起来像人一步步走出来的。设计稿实测间距就是 24..40 CSS。
  return FIRST_NODE_Y + i * NODE_STEP + Math.sin(i * 1.73) * 10;
}

/**
 * 第 idx 关节点的中心 x。
 *
 * 走势腿（往右上慢慢爬、偶尔绕一个回头弯）+ 摆动（踩出来的起伏）。
 * 两层周期不整除，所以「每个弯长得不一样」，但整体方向始终是往上偏右。
 */
export function nodeX(idx: number): number {
  const i = idx - 1;
  return CENTER_X
    + driftOf(i)
    + Math.sin(i * WOB_K + WOB_PHI) * WOB_AMP
    + Math.sin(i * WOB2_K + WOB2_PHI) * WOB2_AMP;
}

/** 节点坐标。关号 1-based。 */
export function mapNodePos(idx: number): { x: number; y: number } {
  return { x: nodeX(idx), y: nodeY(idx) };
}

/**
 * 某关节点的视觉半径（设计稿实测 ×2）。
 *
 * 定稿是**平的**：不再做「远小近大」。纸雕等高线的场景里没有灭点，
 * 节点一旦随位置缩放，就看不出哪颗是「现在」——四态靠形状与颜色区分。
 */
export function nodeRadius(idx: number, _screenY: number, st: MapViewState): number {
  if (idx === st.currentLevel) return 26;
  if (idx > st.currentLevel) return idx % 10 === 0 ? 23 : 19;
  return 20;
}

/** 关号所属的世界下标。 */
export function worldOf(idx: number): number {
  for (let i = WORLDS.length - 1; i >= 0; i--) if (idx >= WORLDS[i].from) return i;
  return 0;
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
    // 滚到底时最后一关正好落在卡片下沿：max 使 screenY(N) = VIEW_BOTTOM
    maxScrollY: levelCount > 0
      ? Math.max(0, nodeY(levelCount) - (FLIP_BASE - VIEW_BOTTOM))
      : 0,
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
    const cy = screenYOf(p.y, st.scrollY);
    const dx = x - p.x;
    const dy = y - cy;
    // 半径与视觉一致，再给 8px 宽容。下限 34 是触控底线（19 的虚圈只有 38 宽）。
    const r = Math.max(34, nodeRadius(i, cy, st) + 8);
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
  // 上 = 走得远：滚得越深，珠子越靠上（和地图的翻转方向一致）
  const pos = st.maxScrollY > 0 ? clamp(st.scrollY / st.maxScrollY, 0, 1) : 0;
  return { top, h, thumbH, thumbTop: top + (h - thumbH) * (1 - pos) };
}

/**
 * 某一关在导轨上的 y —— **与滑块中心严格对齐**。
 *
 * 老实现用「内容比例」映射，和滑块的公式差半个滑块高，
 * 结果「当前关的小点」飘在滑块旁边。这里直接从滑块几何反推，两者永远重合。
 */
export function railYOf(level: number, st: MapViewState): number {
  const g = railGeometry(st);
  const scroll = clamp(scrollToLevel(level), 0, st.maxScrollY);
  const pos = st.maxScrollY > 0 ? scroll / st.maxScrollY : 0;
  return g.top + (g.h - g.thumbH) * (1 - pos) + g.thumbH / 2;
}

/** 导轨上的落点 → 滚动偏移。`grab` 是按下点相对滑块顶部的偏移。 */
export function railScrollAt(y: number, st: MapViewState, grab: number): number {
  const g = railGeometry(st);
  const span = g.h - g.thumbH;
  const rel = span > 0 ? (y - grab - g.top) / span : 0;
  // 珠子越靠上 = 关号越大 = 滚得越深
  return clamp(1 - rel, 0, 1) * st.maxScrollY;
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
  // 空白处按下 = 把滑块中心挪到手指处，然后跟着拖
  return { kind: 'scrub', grab: g.thumbH / 2 };
}
