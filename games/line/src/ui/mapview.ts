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

/** 相邻两关的垂直间距（设计稿 32.4 CSS → 65；取 70 让圈与圈之间松一点）。 */
export const NODE_STEP = 70;

/**
 * 触控半径下限。
 *
 * 必须 **≥ `NODE_STEP` / 2**（70/2 = 35，取 36 留一点重叠）：
 * 小圈（未至 r=16）加 8px 宽容也只有 24，比行距的一半还小，
 * 两个命中圈就不相接了 —— 相邻两关正中间会出现一条点不中任何东西的死带。
 */
const TOUCH_MIN = 36;

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

/**
 * 内容 x → 屏幕 x（已减相机横移）。
 *
 * ## 为什么要有一个横向相机
 *
 * 卡片只有 662 宽。如果要求「路持续向右上」又必须整条塞进这张卡里，
 * 就只有一条出路：让它每 8 关折回一次 —— 那正是锯齿的来源。
 *
 * 设计样片之所以好看，是因为它画的是一条**长卷**：路可以一直往右上爬，
 * 由视口跟着走，而不是把 1000 关压进一张卡片。
 * 这里补上同一个机制：`nodeX` 返回的是**世界坐标**，绘制和命中统一减掉
 * 相机偏移 `camX`。于是路想走多远走多远，屏幕上永远只看到一段。
 */
export function screenXOf(contentX: number, camX: number): number {
  return contentX - camX;
}

/**
 * 相机横向偏移：让当前关落在卡片横向的舒适区。
 *
 * ## 为什么不是简单居中
 *
 * 路口居中会让「走过的路」和「没走的路」各占一半卡片，
 * 玩家看不到前方有什么，也看不到自己从哪来。
 * 定稿的构图是**当前关偏左、前方留白**（像人站在山口往上看），
 * 所以这里把当前关放在卡片宽度的 `CAM_ANCHOR` 处，右侧留给未知。
 */
const CAM_ANCHOR = 0.42;

/**
 * 相机横移量：让**视野中心那一关**落在卡片横向的 `CAM_ANCHOR` 处。
 *
 * ## 为什么锚的是「视野中心」而不是「当前关」
 *
 * 第一版按 `currentLevel` 算，结果玩家一滚走，画面就空了：
 * 相机停在当前关的世界 x，而视野里全是几百关之外的节点，
 * 减掉那个偏移后横向全部飞出卡片 —— 整屏只剩等高线背景。
 *
 * 地图是**上下滚动**的，横向必须跟着视口走，屏幕上的每一屏才都看得见路。
 *
 * ## 为什么只跟「趋势」、不跟蜿蜒
 *
 * 早先版本直接 `nodeX(中心关)` 当相机 x，等于把蜿蜒也一起跟了：
 * 弯处的世界 x 每关变化 60~70px，相机就跟着横向抽搐，
 * 玩家**上下拖**的时候，整幅画面在左右平移 —— 手感像在横着滑，
 * 完全不是「往上爬山」。
 *
 * 现在相机只跟 `BASE0 + SLOPE·t` 这一条斜线（趋势项），
 * 蜿蜒留在画面上自己摆。于是：
 *
 * - 拖动时内容的横向位移**恒定** = `SLOPE` px/关，不会再忽快忽慢；
 * - 弯道的幅度 100% 留在屏幕上（以前被相机吃掉一半）。
 *
 * 代价是当前关不再死死钉在 42% 处，会随弯左右晃 ±A —— 这正是想要的：
 * 路在摆，人跟着路走。
 *
 * ## 为什么用浮点关号而不是 `levelNear` 取整
 *
 * 取整会让相机逐关跳一格（每关 13px），拖起来有顿挫。
 * 这里按 y 在相邻两关之间线性插值，得到连续的浮点关号。
 *
 * @param scrollY 当前滚动偏移
 * @param levelCount 关卡总数
 */
export function camXOf(scrollY: number, levelCount: number): number {
  // 视野中心的关号（**连续值**，不是取整）
  const midY = scrollY + (ROUTE_TOP + VIEW_BOTTOM) / 2;
  const t = levelAtY(midY, levelCount);
  const anchor = SCENE.x + SCENE.w * CAM_ANCHOR;
  return ROUTE_BASE0 + ROUTE_SLOPE * t - anchor;
}

/**
 * ── 山径的横向几何：一条在长卷上自由蜿蜒的路 ──
 *
 * ## 走过的弯路（两版都被否决的写法）
 *
 * **第一版**：中轴 + 对称三角波 + 两层正弦，全是零均值 ——
 * 路只在屏幕中部来回荡，拖导轨时像一根弹簧。
 *
 * **第二版**：基线 + 固定 6 关缓爬 / 2 关陡折的三角波。
 * 数值上「持续向右」达标了，但差分是完全重复的
 * `44,44,44,44,24,-110,-110` —— 每 8 关一模一样地复读，
 * 肉眼看到的是机械锯齿，不是山径。
 *
 * 两版的共同枷锁是同一个：**想把 1000 关压进一张 662 宽的卡片**。
 * 于是横向位移只能靠「折返」来省地方，怎么调都是折线。
 *
 * ## 现在的公式：长卷 + 相机
 *
 *     x(i) = BASE0 + ROUTE_SLOPE·i          // 世界坐标：每关稳定右移
 *          + run(i)                         // 不等长折返：右摆长、左退短
 *
 * 世界坐标里 `x` 一路向右延伸（真实的长卷，1000 关走 16000px）；
 * 屏幕上看到的是减掉 `camX` 之后的那一段，相机跟着视野中心走。
 * 因为不需要再「省地方」，折返只要负责**弯**，不用负责**右移** ——
 * 右移交给斜率。两者一分开，参数就都能取到该有的量级。
 *
 * ## 为什么不是正弦
 *
 * 正弦在波峰处斜率趋零：那里会有四五个节点几乎竖着排成一列，
 * 拖过去像卡住。折返段内用 smoothstep，两端本来就会放慢，
 * 不需要靠正弦的「自然趋零」—— 而它带来的竖直堆叠是纯损失。
 */

/**
 * 世界坐标的横向斜率（设备像素 / 关）。
 *
 * 这是「长卷向右上方延伸」的主项；屏幕上只看到视野中心附近那一段。
 *
 * 它同时决定了**拖动时内容的横向流速**（相机只跟趋势，见 `camXOf`）：
 * 每滚一关，画面平移 `SLOPE` px。取 13 是刻意压过的 ——
 * 16 时一屏要横移 224px，上下拖的感觉会偏「斜着滑」；
 * 13 时是 182px，跨度仍够（配合下面的振幅，一屏 190~330px），
 * 但竖向手感明显更正。
 */
const ROUTE_SLOPE = 13;

/**
 * 折返的振幅基准值（设备像素）。
 *
 * 实际每一折的振幅在 `ROUTE_AMP ± ROUTE_AMP_JITTER` 上再叠一层
 * 长周期调制（`ROUTE_AMP_SWING`），实测落在 52~108 之间 ——
 * 也就是**有的弯深、有的弯浅**，不再是每 9 关复读一次的等幅锯齿。
 *
 * 基准取 84：峰谷差 ~168，一屏高度是 15 关 × 70px = 1050px，
 * 弯的横向摆幅占竖向的 ~16%，眼睛能明确读出「在绕」而不是「直线」。
 *
 * 上限受两件事夹住：
 * - 屏幕横向：锚点 42%，振幅再大节点会顶到卡片左右缘；
 * - 单关横移：p99 已到 61px/关，再快就成折线拐角了。
 */
const ROUTE_AMP = 84;

/**
 * 每折振幅的随机浮动比例（±38%）。
 *
 * 这是「千篇一律」的解药：只让段长随机，弯的**深浅**还是同一个模子，
 * 远看就是一串同款 S。实测加上 ±38% 后，连着的弯从 123px 到 202px 不等。
 *
 * 再往上（>45%）会让最深的弯单关横移过 90px，读起来像折线，所以停在这里。
 */
const ROUTE_AMP_JITTER = 0.38;

/**
 * 振幅的长周期调制：周期（关）与深度（比例）。
 *
 * 47 关 ≈ 3 屏多 —— 玩家连滑几屏，会有「这一段绕得凶」和
 * 「这一段比较直」的段落感；而单屏之内看不出周期，不会读成节奏。
 */
const ROUTE_AMP_PERIOD = 47;
const ROUTE_AMP_SWING = 0.13;

/**
 * 右摆段 / 左退段的长度范围（关）。
 *
 * ## 这是整个形态的关键
 *
 * 设计稿 02 屏 16 个节点的差分是
 * `+36,+30,-10,-28,+8,+40,+44,+34,-8,-40,-14,+36,+48,+34,+10` ——
 * 正项合计 320，负项只有 −100，**右行占比 76%**。
 *
 * 换算成段长就是「右摆 6~8 关、左退 4~5 关」的不等长节奏，
 * 所以 `ROUTE_RIGHT` 明显长于 `ROUTE_LEFT`（右行占比约 60%）。
 * 一个完整折返周期 10~13 关，一屏（15 关）里一到两个弯。
 *
 * 左退段取 4~5（而不是更短）是为了**压住坡度**：
 * 左退要在 L 关内退回 2A，速度 ≈ 3A/L。A=84、L=4 时约 63px/关，
 * 已经是「看得出是个急弯」的上限；L=3 时会到 84px/关，像折线。
 *
 * 之前两版都栽在这里：
 * - 固定 6+2：段长恒定，形态每 8 关精确复读 → 机械锯齿；
 * - 纯正弦：波峰处斜率趋零，节点上下叠成一列，而且左右各半 → 原地打转。
 */
const ROUTE_RIGHT: readonly [number, number] = [6, 8];
const ROUTE_LEFT: readonly [number, number] = [4, 5];

/** 段表种子。固定值 → 同一关号永远同一位置（可测试、不依赖帧序）。 */
const RUN_SEED = 0x2545f491;

/**
 * 一个折返段：起点（关，0-based）、长度、两端的有符号峰位。
 *
 * 存 `p0/p1` 而不是「方向 + 振幅」，是因为**每折的振幅不一样**：
 * 相邻两折在转折点必须接得上（`p1` 就是下一段的 `p0`），
 * 而它们的深度可以不同 —— 这才是「有胖有瘦」的来源。
 * 若存成「方向 + 单一 AMP」，转折点就会跳一格。
 */
interface RouteRun {
  from: number;
  len: number;
  p0: number;
  p1: number;
}

/**
 * 按序号取一个确定性随机数（0~1）。
 *
 * 不能用「顺序取」：段表是按需增长的，`buildRuns(4000)` 与
 * `buildRuns(8000)` 里「转折点」的个数不同，顺序取会让同一折
 * 拿到不同的振幅 —— 玩家滑到中途，前面的路会突然变形。
 * 改成对序号做哈希，第 j 个转折点的振幅永远只取决于 j。
 */
function randAt(j: number): number {
  let h = (Math.imul(j + 1, 0x27d4eb2d) ^ RUN_SEED) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** 生成到足够远的折返段表（确定性 LCG，只用于段长）。 */
function buildRuns(need: number): RouteRun[] {
  let x = RUN_SEED;
  const next = (): number => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return (x >>> 8) / 0x1000000;
  };

  // 第一遍：转折点的关号（段长随机，右长左短）
  const turns: number[] = [0];
  for (let j = 0; turns[turns.length - 1] < need; j++) {
    const [lo, hi] = j % 2 === 0 ? ROUTE_RIGHT : ROUTE_LEFT;
    turns.push(turns[turns.length - 1] + lo + next() * (hi - lo));
  }

  // 第二遍：每个转折点的振幅（±浮动 × 长周期调制）
  const ampAt = (t: number, j: number): number => {
    const jitter = 1 - ROUTE_AMP_JITTER + 2 * ROUTE_AMP_JITTER * randAt(j);
    const swing = 1 + ROUTE_AMP_SWING * Math.sin((2 * Math.PI * t) / ROUTE_AMP_PERIOD);
    return ROUTE_AMP * jitter * swing;
  };
  const out: RouteRun[] = [];
  for (let k = 0; k < turns.length - 1; k++) {
    // 转折点交替落在 +A / −A：偶数号是谷（−A），奇数号是峰（+A）
    const s0 = k % 2 === 0 ? -1 : 1;
    out.push({
      from: turns[k],
      len: turns[k + 1] - turns[k],
      p0: s0 * ampAt(turns[k], k),
      p1: -s0 * ampAt(turns[k + 1], k + 1),
    });
  }
  return out;
}

/** 段表（按需增长）。 */
let RUNS: RouteRun[] = buildRuns(4096);

/** 取关号所属的段。 */
function runAt(i: number): RouteRun {
  while (i >= RUNS[RUNS.length - 1].from) RUNS = buildRuns(Math.ceil(i) + 4096);
  let lo = 0;
  let hi = RUNS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (RUNS[mid].from <= i) lo = mid;
    else hi = mid - 1;
  }
  return RUNS[lo];
}

/**
 * 世界坐标的横向位置（关号 1-based）。
 *
 *     x(i) = BASE0 + SLOPE·i + run(i)
 *
 * `run(i)` 在相邻两个转折点之间做 smoothstep 插值（而不是直线 ——
 * 直线段速度恒定，节点会像传送带一样匀速平移，缺少「走到拐弯处放慢」的感觉）。
 * 两端峰位 `p0 / p1` 各带自己的振幅，所以每一折的深浅都不同。
 */
export function nodeX(idx: number): number {
  const i = idx - 1;
  const r = runAt(i);
  const u = Math.min(1, Math.max(0, (i - r.from) / r.len));
  const eased = u * u * (3 - 2 * u);
  return ROUTE_BASE0 + ROUTE_SLOPE * i + r.p0 + (r.p1 - r.p0) * eased;
}

/**
 * 世界坐标的起点 x（第 1 关）。
 *
 * 因为现在有横向相机（`camXOf`），这个值不再承担「塞进卡片」的约束，
 * 只影响长卷的绝对原点。取 190 是为了让第 1 关（相机在最左、
 * `camXOf(1) = nodeX(1) - anchor`）自然贴近卡片左缘。
 */
const ROUTE_BASE0 = 190;


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
  /**
   * 分享选关模式。
   *
   * ## 为什么要一个模式而不是另开一页
   *
   * 「挑一关发给好友」需要的东西和地图**完全一样**：全部关卡、已过关/未过关、
   * 能滚能拖能跳。另做一个选择器等于把这套几何再实现一遍，还得担着
   * 两份坐标漂移的风险。所以只加一个布尔量：同样的地图，读法换一套 ——
   *
   * - 节点点击 = 选中这一关并弹分享面板（不是进关）
   * - 未解锁的关**也能分享**（分享不是玩，不该被进度限制）
   * - 页面顶部出一条说明带 + 取消，让玩家随时知道自己在什么模式里
   */
  shareMode: boolean;
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

/** 节点坐标。关号 1-based。（世界坐标，屏幕位置要再过 `screenXOf`） */
export function mapNodePos(idx: number): { x: number; y: number } {
  return { x: nodeX(idx), y: nodeY(idx) };
}

/**
 * 某关节点的视觉半径（设计稿实测 ×2，再收一档）。
 *
 * 定稿是**平的**：不再做「远小近大」。纸雕等高线的场景里没有灭点，
 * 节点一旦随位置缩放，就看不出哪颗是「现在」——四态靠形状与颜色区分。
 *
 * ## 比设计稿再小一号的理由
 *
 * 设计稿的半径÷间距是 9.5/32.4 ≈ 0.29。我们的地图卡只有 972 高
 * （750×1334 画布比 375×812 矮一截，卡不可能做成 1140），
 * 同样的间距塞进来的关数一样多，但**卡更矮**——照抄 0.29 会显得挤。
 * 收到 16/70 ≈ 0.23，圈与圈之间才有设计稿那种「一阶一阶」的呼吸。
 */
export function nodeRadius(idx: number, _screenY: number, st: MapViewState): number {
  // 百关大圈（每 100 关）：整枚玉璧的外廓半径。
  // 它是地图上最大的圆章，优先级高于当前关 —— 当前关正好落在 100/200
  // 时画的也是这枚大圈（只是换成金面）。
  if (idx % 100 === 0 && idx > 0) return 33;
  if (idx === st.currentLevel) return 23;
  if (idx > st.currentLevel) return idx % 10 === 0 ? 20 : 16;
  return 17;
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
    shareMode: false,
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

/**
 * 点到线段的最短距离。用于「按在两关之间的路面上」。
 */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  // t = 投影在 [0,1] 之间的夹紧
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 路面「走廊」的半宽（设备像素）。
 *
 * 命中圈接不上的那段路面，按在路面上就该按到旁边那一关。
 * 取 22：比路面本身（外晕 18）略宽一点，够手指粗，又不会把远处的关捞进来。
 */
const CORRIDOR = 22;

/** 判断点击落在哪个关卡节点上。@returns 关号，未命中返回 -1 */
export function pickMapNode(x: number, y: number, st: MapViewState): number {
  const { first, last } = visibleRange(st.scrollY, st.levelCount);
  // 与绘制用同一个相机：命中判定的 x 是屏幕坐标，节点是世界坐标
  const camX = camXOf(st.scrollY, st.levelCount);
  const nodes: { x: number; y: number; r: number }[] = [];
  for (let i = first; i <= last; i++) {
    const p = mapNodePos(i);
    const cy = screenYOf(p.y, st.scrollY);
    nodes.push({
      x: screenXOf(p.x, camX),
      y: cy,
      // 半径与视觉一致，再给 8px 宽容；下限 36（不能小于半个行距）。
      r: Math.max(TOUCH_MIN, nodeRadius(i, cy, st) + 8),
    });
  }

  // ① 直接命中节点圆盘
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    const dx = x - n.x;
    const dy = y - n.y;
    if (dx * dx + dy * dy <= n.r * n.r) return first + k;
  }

  // ② 落在两关之间的「路面」上 —— 归给最近的那一关
  //
  // ## 为什么需要这一档
  //
  // 折返的陡崖段里，相邻两关横向能差 110+。两枚半径 36 的命中圈
  // **接不上**，中间留下一条死带：按下去毫无反应。
  //
  // 这不是新公式带来的病 —— 旧公式（对称三角波）同样有：
  // 实测前 400 关里有 194 对相邻节点的命中圈不相交，一半的地图都有死带。
  //
  // 路面是玩家看得见的东西，所以「按在路面上」就该按到旁边那一关。
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k + 1 < nodes.length; k++) {
    const a = nodes[k];
    const b = nodes[k + 1];
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) > CORRIDOR) continue;
    const da = Math.hypot(x - a.x, y - a.y);
    const db = Math.hypot(x - b.x, y - b.y);
    const near = Math.min(da, db);
    if (near >= bestD) continue;
    bestD = near;
    best = da <= db ? first + k : first + k + 1;
  }
  return best;
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

/**
 * 设计坐标 y → **连续的**关号（相邻两关之间线性插值）。
 *
 * 和 `levelNear` 的区别：后者返回整数（用于「视野中间是哪一关」这种判断），
 * 这个返回浮点（用于相机这种**需要连续**的量）。
 *
 * `nodeY` 不是严格线性的（它有 `sin(i·1.73)·10` 的呼吸），
 * 所以插值用相邻两关的实际 y 做分母，而不是常量 `NODE_STEP`。
 */
export function levelAtY(y: number, levelCount: number): number {
  if (levelCount <= 0) return 1;
  const lo = firstAtLeast(y, levelCount);
  // 夹到两端（滚出地图时不外推）
  if (lo <= 1) return 1;
  if (lo > levelCount) return levelCount;
  const y1 = nodeY(lo - 1);
  const y2 = nodeY(lo);
  const span = y2 - y1;
  if (span <= 0) return lo;
  // y 落在 [y1, y2) 内 → 关号落在 [lo-1, lo)
  return lo - 1 + (y - y1) / span;
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
