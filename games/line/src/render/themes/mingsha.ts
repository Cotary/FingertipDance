/**
 * 「鸣沙·丹青」· 矿物颗粒 + 壁画剥蚀（主题 03 · 亮暖旗舰）。
 *
 * ## 为什么这套站得住
 *
 * 四套提名互不撞轴，灰度下也分得开：
 * 天青是**釉面光滑**（冷、暗展柜、一束光），这一套是**壁面颗粒**（暖、亮、剥蚀）。
 * 抽掉颜色只看灰度：天青是"暗底上一片片浮雕釉块"，鸣沙是"亮墙上的一块块剥落色片"。
 *
 * ## 三根骨头（照 `2026-11-15-鸣沙丹青-图标动效音效.html` 的三条纪律）
 *
 * 1. **颜色从石头里磨出来。** 全盘只用五个矿物色（石绿 / 朱砂 / 石青 / 赭石 / 沥金），
 *    不发明新色。未铺是"还没上色的墙皮"，已铺是"色被找回来了"。
 * 2. **边缘一定是破的。** 棋子轮廓照设计稿的 `clip-path` 是五点多边形，
 *    画框每边还有两处剥落缺口 —— 手切的色块，不是圆角按钮。
 * 3. **金是堆起来的。** 路径不是一根金线，是"沥粉"：下沿有影、上沿受光、线身有颗粒。
 *    全系列只有这一套的金属**有厚度**。
 *
 * ## 和秘色天青刻意相反的地方
 *
 * | | 秘色天青 | 鸣沙丹青 |
 * |---|---|---|
 * | 页面 | 墨玉平涂（近黑） | 暖土壁（#E3D2B4）+ 颗粒 |
 * | 未铺 | 亮釉（最亮的一档） | 淡土块（最淡，只留轮廓） |
 * | 已铺 | 深釉 + 金边 | 矿彩实色（绿 / 红 / 蓝逐格轮换） |
 * | 光 | 单点左上白光 | 整片 148° 斜光 + 矿物颗粒 |
 * | 金 | 光迹（细、亮、浮在釉上） | 沥粉（粗、钝、凸在墙上） |
 */
import { BOARD_GAP, BOARD_CARD_W, BOARD_TOP, cardOf, type BoardLayout } from '../layout';
import { roundRect } from '../board';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, LegendMark, ThemeChrome } from './types';
import { fillGrain } from '../grain';
import {
  traceGlyphPart,
  type GlyphDecor,
  type GlyphPalette,
  type GlyphPart,
  type GlyphShapes,
} from './glyphs';
import { arcPts, composeTheme, portalEntrance, truncatePts, type CellGeom, type Pt } from './kit';

const TAU = Math.PI * 2;

// ────────────────────────────── 色板 ──────────────────────────────

const K = {
  /** 页面：暖土壁（设计稿 `.stage-wall` 的三停） */
  pageHi: '#EFE0C2',
  pageMid: '#DCC79E',
  pageLo: '#CBB087',
  /** 墨：题字、注、磕边 */
  ink: '#3A2A18',
  /** 朱砂：单向门、终印、尘环 */
  red: '#B5472E',
  redDeep: '#8F3220',
  /** 沥金 */
  gold: '#C99B3F',
  goldHi: '#E2B558',
  goldLit: '#F0C868',
  goldPale: '#F6E7B8',
  /** 石绿（传送门 / 起点） */
  green: '#5E8C6E',
} as const;

/**
 * 界面配色。
 *
 * 这一屏是**亮底**，整套 chrome 的依据只有一条：文字必须比墙深。
 * 天青那套奶油金（#F2DCA8）压上来会直接消失 —— 所以这里把"强调"
 * 从"更亮的金"换成"更深的赭"（`inkStrong`）。
 */
const CHROME: ThemeChrome = {
  pill: '#3A2C1E', pillInk: '#F2E6CC',
  // 主按钮仍是全 UI 唯一的一块金（和盘面上的沥金同源）
  primary: '#C99B3F', primaryInk: '#2A1E10',
  // 次级按钮（跳过 / 返回）：一块比墙面浅半档的沙板。用 `#CBB087` 会和
  // 盘下的背景化在一起，按钮的边就只剩那根 0.3 的发丝线
  ghost: '#E2CFA8', ghostInk: '#4A3620',
  ink: '#4A3620',
  inkSoft: 'rgba(74,54,32,0.74)',
  inkDim: 'rgba(90,64,36,0.62)',
  inkStrong: '#7A3A18',
  groove: 'rgba(120,86,44,0.26)',
  // 进度填充用土红：盘面上的金已经很多了，进度条再金一次就是"到处都是金"
  fill: '#A0552F',
};

/** 盘下图例的色块：六枚矿物色片，不是六张贴纸。 */
const LEGEND = {
  arrow: { bg: '#B5472E', ink: '#F8EDD8' },
  star: { bg: '#D9A745', ink: '#3A2A10' },
  key: { bg: '#C99B3F', ink: '#3A2A10' },
  gate: { bg: '#A0552F', ink: '#F8EDD8' },
  // 传送门：深靛底（**不是石绿** —— 见 PAL_PORTAL 的说明，石绿会和石绿格融合）
  portal: { bg: '#22334F', ink: '#D7E8F6' },
  ice: { bg: '#4A6E8A', ink: '#EAF4FF' },
  rock: { bg: '#8A5236', ink: '#F4E4D0' },
} as const;

/** 展台五色签：盘面的五个关键色（设计稿色板那一排）。 */
const SWATCHES = ['#EFE0C2', '#5E8C6E', '#B5472E', '#4A6E8A', '#C99B3F'] as const;

/**
 * 图例记号：和盘面上那五枚**同一个形状**。
 *
 * 统一在 48 视图里画，按 `sw / 48` 缩 —— 所以这里可以直接用设计稿的坐标。
 * 用默认那套会出事：他的冰面画的是"一道斜坡 + 一条下滑线"，
 * 压在石青片上一比一读出来是字母「A/」。
 */
const mark = (
  draw: (c: CanvasRenderingContext2D) => void,
): LegendMark => (c, cx, cy, sw, ink) => {
  c.save();
  c.translate(cx, cy);
  c.scale(sw / 48, sw / 48);
  c.translate(-24, -24);
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  draw(c);
  c.restore();
};

const poly48 = (c: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>) => {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
};

const LEGEND_MARKS = {
  // 单向：一笔朱砂实心箭
  arrow: mark((c) => {
    poly48(c, [[5, 21.2], [27, 21.2], [27, 14], [42, 24], [27, 34], [27, 26.8], [5, 26.8]]);
    c.fill();
  }),
  // 星屑：撕边金箔
  star: mark((c) => {
    poly48(c, [
      [24, 4.5], [28.2, 16.8], [41, 17.2], [31, 25.4], [34.4, 37.8],
      [24, 30.4], [13.2, 38], [17, 25.6], [7.2, 17.4], [19.8, 16.8],
    ]);
    c.fill();
  }),
  // 冰砖：六边晶 + 一竖两斜
  ice: mark((c) => {
    c.lineWidth = 2.6;
    poly48(c, [[24, 5], [40, 15], [40, 33], [24, 43], [8, 33], [8, 15]]);
    c.stroke();
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(24, 5);
    c.lineTo(24, 43);
    c.moveTo(8, 15);
    c.lineTo(40, 33);
    c.moveTo(40, 15);
    c.lineTo(8, 33);
    c.stroke();
  }),
  // 石障：八边形 + 一道折面
  rock: mark((c) => {
    c.lineWidth = 2.4;
    poly48(c, ROCK_PTS);
    c.stroke();
    c.beginPath();
    c.moveTo(11, 13);
    c.lineTo(27, 19);
    c.lineTo(33, 30);
    c.moveTo(27, 19);
    c.lineTo(17, 25);
    c.stroke();
  }),
  // 传送门：**同心**双环 + 内环 + 芯点（和格内标同构，不是相扣的两个环）
  portal: mark((c) => {
    c.lineWidth = 3.4;
    c.beginPath();
    c.arc(24, 24, 15.2, 0, TAU);
    c.stroke();
    c.lineWidth = 1.8;
    c.beginPath();
    c.arc(24, 24, 7.2, 0, TAU);
    c.stroke();
    c.beginPath();
    c.arc(24, 24, 2.6, 0, TAU);
    c.fill();
  }),
  // 钥匙：土红钥坯 —— 环 + 柄 + 双齿（不画就等于回退到通用线稿，
  // 而通用那套的钥匙是"一个圈加一根杆"，在矿物色片上读不出"陶红钥"）
  key: mark((c) => {
    c.lineWidth = 4.4;
    c.beginPath();
    c.arc(16.8, 16.8, 7.4, 0, TAU);
    c.stroke();
    c.beginPath();
    c.moveTo(22.2, 22.2);
    c.lineTo(36.8, 36.8);
    c.moveTo(30.4, 30.4);
    c.lineTo(26.4, 34.4);
    c.moveTo(34.4, 34.4);
    c.lineTo(30.4, 38.4);
    c.stroke();
  }),
  // 门：圆拱 + 门缝 + 门环
  gate: mark((c) => {
    c.lineWidth = 3.2;
    c.beginPath();
    c.moveTo(10.4, 40);
    c.lineTo(10.4, 18);
    c.arc(24, 18, 13.6, Math.PI, 0);
    c.lineTo(37.6, 40);
    c.stroke();
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(24, 13.6);
    c.lineTo(24, 40);
    c.stroke();
  }),
} as const;

/** 稳定伪随机（同一格每帧必须同值，否则颗粒会闪）。 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ────────────────────────────── 五枚机制图标 ──────────────────────────────

/**
 * ## 两套视图，两套换算 —— 混用会让整盘图标缩小一半、右下半格
 *
 * 设计稿有**两套**机制资产，视图尺寸不同（见「伍·使用说明」）：
 *
 * | 资产 | viewBox | 格心 | 用在哪 | 换算 |
 * |---|---|---|---|---|
 * | `ICONS` | 48 | 24 | 图例 / 图鉴 / HUD | `V48 = (v−24)/24` |
 * | `MARKS` | 24 | 12 | **棋盘格心** | `V = (v−12)/12` |
 *
 * 这一版之前只有一个 `V()`，且写的是 48 视图的式子，而格内标全部照
 * `MARKS`（24 视图）抄。后果是**两个错叠在一起**：
 *
 * - 格心 `(12,12)` 被算成 `(−0.5,−0.5)` → 整枚图标偏左上**半个格**；
 * - 半径按 `/24` 而不是 `/12` → 所有环和星**缩小一半**。
 *
 * 数值核对（改前）：`portal` 的 `r=7.6` 得到 `0.317`，应为 `0.633`；
 * `star` 外径 17 只占到 `0.35`。实测就是"钥匙缩成一颗红豆、
 * 星阶糊成一团、传送门比格心小一圈"。
 *
 * 现在分成两个函数，**用哪个取决于坐标抄自哪套资产**，不再靠猜。
 *
 * 另外这五枚**不能**沿用通用几何：天青的冰面是一条斜坡（规则是"会滑"），
 * 鸣沙的冰砖是一块六边晶（规则是"比周围亮"）；天青的箭头是一根杆 + 折角，
 * 鸣沙的箭头是一笔朱砂实心箭。同一个机制，两个世界里的说法本来就不同。
 */

/** 48 视图（`ICONS`）→ 单位空间。格心 24。给冰砖、石障、图例用。 */
const V48 = (x: number, y: number): [number, number] => [(x - 24) / 24, (y - 24) / 24];
const p48 = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> =>
  pts.map(([x, y]) => V48(x, y));

/** 24 视图（`MARKS`）→ 单位空间。格心 12。给全部格内标用。 */
const V = (x: number, y: number): [number, number] => [(x - 12) / 12, (y - 12) / 12];
const vpts = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> =>
  pts.map(([x, y]) => V(x, y));

/** 石障的八边形（`drawRock` 也用这一份，图例和盘面必须是同一个形状）。 */
export const ROCK_PTS: ReadonlyArray<readonly [number, number]> = [
  [7, 30], [11, 13], [23, 7], [39, 12], [43, 27], [35, 41], [15, 42], [7, 34],
];

/**
 * 撕边金箔星 —— 设计稿的 `TORN_STAR` 路径（**24 视图**）逐点抄下来。
 *
 * ```text
 * M12 2.3 L14.1 8.4 L20.5 8.6 L15.5 12.7 L17.2 18.9
 * L12 15.2 L6.6 19 L8.5 12.8 L3.6 8.7 L9.9 8.4 Z
 * ```
 *
 * 十条边、**不等长**、外接半径 9.7 —— 这是"撕"出来的五角星，
 * 不是标准五角星（标准星各边等长，读作图标；不等长才读作金箔）。
 */
const TORN_STAR: ReadonlyArray<readonly [number, number]> = [
  [12, 2.3], [14.1, 8.4], [20.5, 8.6], [15.5, 12.7], [17.2, 18.9],
  [12, 15.2], [6.6, 19], [8.5, 12.8], [3.6, 8.7], [9.9, 8.4],
];

/**
 * 格内标几何 —— 严格照设计稿 **`MARKS`（24 viewBox，格心小印）** 抄。
 *
 * ## 这一版修正的一个方法论错误
 *
 * 上一版这里用的是 `ICONS`（48 viewBox 的**器物大图**）。
 * 设计稿「伍·使用说明」把这件事写成了**最常见的误用**：
 *
 * > 把 48px 机制图标直接贴进棋格当机关 → 图标细节按 28px 灰度校过，
 * > 贴格里**比例失衡、抢纹样**。
 *
 * 两套资产同源同貌但**岗位不同**：
 *
 * | 层 | 资产 | 视图 | 用在哪 |
 * |---|---|---|---|
 * | L1 | `ICONS` | 48 | 图鉴 / 教程 / HUD 弹层（"看说明书"） |
 * | L2 | `MARKS` | 24 | **棋盘格心**（"看棋盘"），格内渲染 36px |
 *
 * 所以棋盘上这些形状全部按 `MARKS` 重画：24 视图、线更细、装饰更少。
 * 判据就是使用说明里那句话 ——「玩家现在是在看说明书，还是在看棋盘？」
 *
 * ## 键的映射
 *
 * | 设计稿 `MARKS` | 这里 | 说明 |
 * |---|---|---|
 * | `arrow` + 四向 | `arrow` | 同坯，靠 `DIR` 旋转 |
 * | `star1/2/3` | `star`/`star2`/`star3` | 撕边金箔，一/双/品字 |
 * | `key` | `key` | 环 dash 5.2/1.1 + 内孔 + 柄 + 双齿 |
 * | `door` / `door-open` | `gate` / `gateOpen` | 圆拱 + 沥金门缝（dash 6/1.4） |
 * | `portal-a` / `portal-b` | `portalA` / `portalB` | **同心**双环 + 内环 + 沥金芯 |
 *
 * 注意传送门：设计稿 `MARKS` 是**同心**双环（cx=cy=12，r=7.6），
 * 只有 48 视图的 `ICONS.portal` 才是错开的一对。上一版把错开那版贴进格子，
 * 而使用说明「常见误用」明确点名「传送门做成石绿 → 和石绿格融为一体，
 * 此病已治：**深靛漩底 + 石青环 + 沥金芯**」。
 */
export const MS_SHAPES: GlyphShapes = {
  // 单向：朱砂厚笔实心箭（`MARKS.arrow`：`M12 3.8 L19 12 … L5 12 Z`）
  //
  // **这段几何不需要旋转**，虽然上一版转过。
  //
  // 两个箭头资产的基准方向**不一样**，这正是"看到一样就当对"最容易踩的坑：
  // - `ICONS.arrow`（48 视图）：`M5 21.2 … L42 24`，尖端在 x=42 → **朝右**，
  //   所以它在主题里必须先转成朝上，否则 `DIR.RIGHT` 会再转 90° 变朝下；
  // - `MARKS.arrow`（24 视图，这一段）：`M12 3.8 …`，尖端在 y=3.8 → **本来朝上**，
  //   再转一次就变成朝左了（实测就是这一版：UP 画成左、RIGHT 画成上）。
  arrow: [
    {
      k: 'poly',
      pts: vpts([
        [12, 3.8], [19, 12], [15.4, 12], [15.4, 20], [8.6, 20], [8.6, 12], [5, 12],
      ]),
      fill: true,
    },
  ],

  // 星屑一阶：贴金箔星（`MARKS.star1 = tornStarAt(12,12,1.02)`）
  star: [{ k: 'poly', pts: tornStarPts(12, 12, 1.02), fill: true }],

  // 二阶：双星并列（`tornStarAt(6.6,12.1,.52) + tornStarAt(17.4,12.1,.52)`）
  star2: [
    { k: 'poly', pts: tornStarPts(6.6, 12.1, 0.52), fill: true },
    { k: 'poly', pts: tornStarPts(17.4, 12.1, 0.52), fill: true },
  ],
  // 三阶：三星品字（`(12,7) + (6.9,15.8) + (17.1,15.8)`，各 0.46）
  star3: [
    { k: 'poly', pts: tornStarPts(12, 7, 0.46), fill: true },
    { k: 'poly', pts: tornStarPts(6.9, 15.8, 0.46), fill: true },
    { k: 'poly', pts: tornStarPts(17.1, 15.8, 0.46), fill: true },
  ],

  // 冰砖：石青六边晶（`ICONS.ice` 的外轮廓，`MARKS` 里没有冰 —— 冰是"地形"不是"标"）
  ice: [
    { k: 'poly', pts: p48([[24, 5], [40, 15], [40, 33], [24, 43], [8, 33], [8, 15]]), fill: true },
  ],

  /**
   * 传送门 A（入口）—— `MARKS['portal-a']`，**24 视图**，逐条照抄：
   *
   * ```text
   * circle r=7.6 stroke #22334F width 2.9                  ← 深靛**粗底环**
   * circle r=7.6 stroke #7FA8C4 width 2.1                  ← 石青中环（压在上面）
   * circle r=7.6 stroke #B8D8EC width 0.7 translate(-.3,-.4) opacity .7  ← 亮边
   * circle r=3.6 stroke #D9A745 width 1                    ← 沥金内环
   * circle r=1.3 fill   #F0C868                            ← 芯点
   * ```
   *
   * ## 关键在"三层同心叠成一条厚环"
   *
   * 外环不是一条线，是 **2.9 的深靛 + 2.1 的石青 + 0.7 的亮边** 三层同心，
   * 由粗到细压成一条"有厚度、上沿受光"的靛环。只画一条细线时，
   * 传送门读作"两个空心圈"，没有"口"的实体感 —— 这是它和星屑、
   * 钥匙最不一样的地方：那两枚是**实心**的，只有传送门靠**环的厚度**立住。
   *
   * ## 半径除数是 12，不是 24
   *
   * `r=7.6` 在 24 视图里占画布的 `7.6/12 = 0.633`；写 `/24` 只得 `0.317`，
   * 整个门缩成格心的一小撮（这就是之前"传送门比格心小一圈"的原因）。
   * 三层的 `stroke-width` 也一并按 `/12` 给 —— 粗底环 2.9 要占到 0.24 单位。
   */
  portalA: [
    // ① 深靛粗底环（`stroke #22334F / width 2.9`）—— 这道厚度是门的主体。
    //
    // **必须点名 `tone: 'ink'`**：不指名时笔触吃 `pal.accent`（石青 #7FA8C4），
    // 于是底环和中环是同一个浅蓝 —— 三层叠完只剩一片蓝，
    // "深靛外缘"整圈消失（实测：设计稿有明显的深边，引擎版是个纯蓝圈）。
    { k: 'circle', cx: 0, cy: 0, r: 7.6 / 12, width: 2.9 / 12, tone: 'ink' },
    // ② 石青中环（2.1）压上去，只留底环的上下细边露出来
    { k: 'circle', cx: 0, cy: 0, r: 7.6 / 12, width: 2.1 / 12, tone: 'accent' },
    // ③ 沥金内环（r=3.6 / width 1）
    { k: 'circle', cx: 0, cy: 0, r: 3.6 / 12, width: 1 / 12, tone: 'chip' },
    // ④ 芯点（r=1.3 实心）
    { k: 'circle', cx: 0, cy: 0, r: 1.3 / 12, fill: true, tone: 'chip', edge: false },
  ],
  /**
   * 传送门 B（出口）—— `MARKS['portal-b']`：外环改成**虚线圈**，内环也虚，中缝加一道竖线。
   *
   * `dash 3.2/2.6` 是刻意的：缺口比段长短不了多少，所以读作"虚线环"
   * 而不是"点线环"。内环 `2/1.8` 更密，因为它更小 —— 同样密度的缺口
   * 在小半径上会连成一片。
   */
  portalB: [
    // ① 深靛粗底环，虚线
    { k: 'circle', cx: 0, cy: 0, r: 7.6 / 12, width: 2.6 / 12, dash: [3.2 / 12, 2.6 / 12], tone: 'ink', cap: 'butt' },
    // ② 石青中环，虚线（同节奏）
    { k: 'circle', cx: 0, cy: 0, r: 7.6 / 12, width: 1.9 / 12, dash: [3.2 / 12, 2.6 / 12], tone: 'accent', cap: 'butt' },
    // ③ 沥金内环，更密的虚（`2/1.8`，opacity .85）
    { k: 'circle', cx: 0, cy: 0, r: 3.6 / 12, width: 1 / 12, dash: [2 / 12, 1.8 / 12], tone: 'chip', cap: 'butt' },
    // ④ 中缝一道竖线（`M12 8.4 L12 15.6`，opacity .55）—— A 没有这一笔
    { k: 'line', pts: [[0, -3.6 / 12], [0, 3.6 / 12]], width: 1 / 12, tone: 'chip' },
  ],

  // 钥匙：土红钥坯（`MARKS.key`）—— 环 dash 5.2/1.1 + 内孔 + 柄 + 双齿
  //
  // 24 视图的环只有 r=3.7，比 48 视图的 8.2 小一半 —— 这正是"格内小印"的尺度。
  // 环要**镂空**：实心圆会被笔触填成一团红饼（读作放大镜镜片）。
  key: [
    // 环：实线粗环（设计稿环是 dash 5.2/1.1，但那在 36px 格里会碎成噪点）
    { k: 'circle', cx: (8.4 - 12) / 12, cy: (8.4 - 12) / 12, r: 3.7 / 12, width: 2.3 / 12 },
    // 柄和双齿：**用 poly 画成有宽度的条**，不能用 line。
    //
    // 为什么：`line` 的宽度由笔触统一给（`0.26 × half` ≈ 24 视图的 6.2 单位），
    // 而设计稿的柄只有 2.2 单位宽 —— 粗了近三倍，柄和齿糊成一团，
    // 整枚读作"只有一个环"（实测就是这样）。
    // 用 poly 就能自己控制宽度，不受笔触摆布。
    ...keyBar([11.1, 11.1], [18.4, 18.4], 2.2),
    ...keyBar([15.2, 15.2], [13.2, 17.2], 1.9),
    ...keyBar([17.2, 17.2], [15.2, 19.2], 1.9),
  ],

  // 门 · 闭：圆拱 + 门板（`MARKS.door`：M5.2 20 L5.2 9 A6.8 6.8 0 0 1 18.8 9 L18.8 20 Z）
  //
  // 拱必须是**一条闭合路径**：拆成"弧 + 竖线"会被每段描边，画出来是三条竖线（栅栏）。
  gate: [
    {
      k: 'poly',
      pts: [
        ...vpts([[5.2, 20], [5.2, 9]]),
        ...arcPts(5.2, 9, 18.8, 9, 6.8, 0, 1, 10).slice(1).map(([x, y]) => V(x, y)),
        ...vpts([[18.8, 9], [18.8, 20]]),
      ],
      fill: true,
    },
  ],
  // 门 · 开：两片洞开 + 中间沥金暖光（`MARKS['door-open']`）
  gateOpen: [
    // 左片：底角 → 外缘竖线 → 外弧（`arcPts` 已含起点）→ 内缘竖线回底
    //
    // ## `sweep` 必须逐片照设计稿给，不能"两片对称地各给一个"
    //
    // 设计稿原文：
    // ```text
    // 左片  M2.2 20 L2.2 9.6  A6.8 6.8 0 0 1 8.2 4.7   L8.2 20 Z
    // 右片  M21.8 20 L21.8 9.6 A6.8 6.8 0 0 0 15.8 4.7 L15.8 20 Z
    // ```
    // 左片 `sweep=1`、右片 `sweep=0` —— 因为两片的**走针方向相反**
    // （左边从外向内、右边从外向内），同一个 sweep 值在两侧得到的是相反的凸向。
    //
    // 早先写成一左一右 `0 / 1`（以为"sweep 对称"），实际两片都变成向内凹：
    // 门板成了两块**方角直板**，中间那道拱没了（实测：设计稿是圆拱双开门，
    // 引擎版是个"凹"字形的方框）。
    {
      k: 'poly',
      pts: [
        ...vpts([[2.2, 20], [2.2, 9.6]]),
        ...arcPts(2.2, 9.6, 8.2, 4.7, 6.8, 0, 1, 8).slice(1).map(([x, y]) => V(x, y)),
        ...vpts([[8.2, 4.7], [8.2, 20]]),
      ],
      fill: true,
      tone: 'deep',
    },
    {
      k: 'poly',
      pts: [
        ...vpts([[21.8, 20], [21.8, 9.6]]),
        ...arcPts(21.8, 9.6, 15.8, 4.7, 6.8, 0, 0, 8).slice(1).map(([x, y]) => V(x, y)),
        ...vpts([[15.8, 4.7], [15.8, 20]]),
      ],
      fill: true,
      tone: 'deep',
    },
    // 门内涌出的沥金暖光（`fill rgba(226,181,88,.4)`）
    { k: 'poly', pts: vpts([[8.2, 20], [8.2, 5.4], [15.8, 5.4], [15.8, 20]]), fill: true },
  ],

  // 石障：图例里那枚石头必须和盘面上那块是**同一个轮廓**（`ICONS.stone` 的外形）
  rock: [{ k: 'poly', pts: p48(ROCK_PTS), fill: true }],
};

/**
 * 星阶：`cellGroup` 就是"第几颗星"。
 *
 * 设计稿：「星屑 1→2→3 **撕边金箔递进**，不写数字角标 —— 格内永远不落字」。
 * 所以阶数靠**星数**（一/双/品字）。角和式样都照 `tornStarAt` 的偏移。
 */
function starVariant(group: number): string {
  return ['star', 'star2', 'star3'][((group % 3) + 3) % 3];
}

/**
 * 把一条"有宽度的线"变成四边形（24 视图坐标，`w` 是**总宽度**）。
 *
 * 为什么不用 `GlyphPart.k = 'line'`：线的宽度由主题笔触统一决定
 * （矿物笔触给 `0.26 × half`，约 24 视图的 6.2 单位），而钥匙的柄和齿
 * 只需要 2 单位宽 —— 差三倍，画出来是一团。`poly` 才能自己定宽。
 */
function keyBar(
  a: [number, number],
  b: [number, number],
  w: number,
): GlyphPart[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  // 法向量（垂直方向），半宽
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return [
    {
      k: 'poly',
      pts: [
        V(a[0] + nx, a[1] + ny),
        V(b[0] + nx, b[1] + ny),
        V(b[0] - nx, b[1] - ny),
        V(a[0] - nx, a[1] - ny),
      ],
      fill: true,
      /**
       * **不描边**。
       *
       * 矿物的"磕边"是固定 0.085 half（≈ 24 视图的 1 单位），
       * 而这根柄只有 2.2 单位宽 —— 左右各描 1 单位，中间只剩 0.2，
       * 整根柄变成一条深褐的实心条，和齿连成一块（实测：
       * 引擎版的钥匙下半截是一团，数不出两根齿）。
       *
       * 设计稿的 `<path stroke="#9C4A2F" stroke-width="2.2">` 是
       * **一笔画出来的**，没有第二层边 —— 照那个画法，这里也不该有。
       */
      edge: false,
    },
  ];
}


/**
 * `tornStarAt(cx, cy, s)`：绕星心 `(12,12)` 缩放再挪到 `(cx, cy)`。
 *
 * 设计稿的写法是 `translate(cx cy) scale(s) translate(-12 -12)`，
 * 这里逐点算同一个变换，得到 24 视图坐标后交给 `V()`。
 *
 * ## 早先错在两处
 *
 * ① 基础星形写成了设计稿的 **2 倍**（`[24,4.5]…[41,17.2]`，即 48 视图化的
 *    `TORN_STAR`），却仍然按 24 视图的 `(v−12)/12` 归一 —— 星反而**大了一倍**，
 *    一阶星的尖角直接顶出格心；
 * ② 中心按 `(24,24)` 减，而 24 视图的星心是 `(12,12)` —— 缩放轴心偏了。
 *
 * 两处叠加，实测星阶是一团挤在右下的黄块，数不出 1/2/3 颗。
 */
function tornStarPts(cx: number, cy: number, scale: number): Array<[number, number]> {
  return TORN_STAR.map(([x, y]) => V(cx + (x - 12) * scale, cy + (y - 12) * scale));
}


/**
 * 装饰层：笔触给"语言"，这里给**这一枚的细节**。
 *
 * 全部照设计稿的 SVG 逐条抄 —— 错开 1.4 的亮边、三粒干笔缺口、
 * 冰晶的分水面、传送门的虚线圈与顶部受光弧。少一笔，这枚图标就从
 * "矿物做的"退回"矢量图标"。
 */
export const MS_DECOR: GlyphDecor = (ctx, kind, parts, half) => {
  /**
   * **24 视图的量 → 单位空间长度**：1 个单位 = `half / 12`。
   *
   * 设计稿 `MARKS` 的 viewBox 是 24（格心 12、画布边长 24），
   * 所以半径 7.6 占画布的 `7.6/12 = 0.633` —— 换算分母是 **12**。
   *
   * 早先写 `v / 24`（那是 48 视图的分母，`ICONS` 画布边长 48、
   * 半径 15.2 才占 0.633）。用在 24 视图的坐标上，**所有环和线宽都小一半**：
   * 传送门外环 `r=7.6` 只画到 0.317，比内环的实际位置还小，
   * 三层环叠成一小撮；钥匙环、门缝金线同样缩半。
   *
   * 这也是"看起来都对、但就是不像设计稿"的典型来源 —— 形状、角度、颜色
   * 全都抄对了，只有尺度整体差一倍，于是整盘读作"图标偏小、留白过多"。
   */
  const u = (v: number) => (v / 12) * half;

  /**
   * **48 视图的量 → 单位空间长度**：1 个单位 = `half / 24`。
   *
   * 只给冰砖用（`ice` 的六边晶抄自 `ICONS`，是 48 视图）。
   * 两套分母不能随手混：48 视图的 1 单位比 24 视图的细一半。
   */
  const u48 = (v: number) => (v / 24) * half;

  if (kind === 'arrow') {
    const body = parts[0];
    if (body.k !== 'poly') return;
    // 亮边 / 暗边：整块轮廓错开一点再填，靠**外层 clip 到本体**来只留边。
    //
    // 关键在于：错位必须在**世界坐标**里做。`drawGlyph` 已经按 `DIR` 转过
    // 坐标系，在旋转后的系里 `translate(0,-1.4)` 是"朝箭头前端错" ——
    // 朝上的箭头勉强还能看，朝下的箭头亮边就跑到下沿去了（光从下面来，穿帮）。
    // 解法：先用 `globalCompositeOperation` 的裁切思路太贵，这里直接
    // 在**设备空间**算偏移量，再把它换算回当前（可能旋转过的）用户空间。
    const m = ctx.getTransform();
    // 设备空间里的"左上"单位向量，换回用户空间
    const inv = m.a * m.d - m.b * m.c;
    let dx = 0;
    let dy = -u(0.55);
    if (Math.abs(inv) > 1e-6) {
      // 用户空间 → 设备空间的方向变换，取逆
      const nx = (m.d * dx - m.c * dy) / inv;
      const ny = (-m.b * dx + m.a * dy) / inv;
      dx = nx;
      dy = ny;
    }
    ctx.save();
    traceGlyphPart(ctx, body);
    ctx.clip();
    ctx.translate(dx, dy);
    traceGlyphPart(ctx, body);
    ctx.fillStyle = 'rgba(212,100,63,0.45)';
    ctx.fill();
    ctx.restore();

    // 干笔缺口：三粒没磨开的壁土。有它们，箭头才像一笔刷过去的。
    //
    // ## 三粒白点的坐标来自 `ICONS.arrow`（**48 视图**）
    //
    // 设计稿在 `ICONS.arrow` 里把它们钉在 `(11,24) (19,22.4) (16,26.2)`，
    // 而 `ICONS.arrow` 是**朝右**的（尖端 x=42）；格内标 `MARKS.arrow` 是
    // **朝上**的（尖端 y=3.8）。所以要绕画布中心转 −90°：`(x,y) → (y, 48−x)`。
    //
    // 又因为几何现在是 24 视图（画布 24、中心 12），转完还要**折半**。
    // 早先直接把 48 视图的坐标喂给 24 视图的 `V()`：圆心算到格心外，
    // 三粒白点全飘出箭头（实测在箭头右下方三颗浮尘）。
    const dots: Array<[number, number, number, number]> = [
      // [48 视图 x, 48 视图 y, 48 视图 r, alpha]
      [11, 24, 1.4, 0.70], [19, 22.4, 1.0, 0.55], [16, 26.2, 1.1, 0.50],
    ];
    for (const [x48, y48, r48, a] of dots) {
      // 转 −90°（右→上），再折半进 24 视图
      const rx24 = (48 - x48) / 2;
      const ry24 = y48 / 2;
      const [ux, uy] = V(rx24, ry24);
      ctx.beginPath();
      ctx.arc(ux * half, uy * half, u(r48 / 2), 0, TAU);
      ctx.fillStyle = `rgba(227,210,180,${a})`;
      ctx.fill();
    }

    traceGlyphPart(ctx, body);
    ctx.strokeStyle = 'rgba(90,30,15,0.55)';
    ctx.lineWidth = Math.max(1, u(0.85));
    ctx.lineJoin = 'round';
    ctx.stroke();
    return;
  }

  if (kind === 'star') {
    /**
     * 撕边金箔星 —— 设计稿 `tornStarAt` 是**三层同一个路径**，缺一层就退化成图标：
     *
     * ```text
     * path TORN_STAR  fill #D9A745                              ← 金箔底色
     * path TORN_STAR  fill #F0C868 opacity .55 translate(-.35,-.5) ← 亮金副本，向左上错
     * path TORN_STAR  fill none stroke rgba(120,80,20,.5) width .7/s ← 暗线描边
     * ```
     *
     * ## 早先画错了层次
     *
     * 这里原本是一道**三角形的白色折光线**（从星心往上一笔），
     * 那是"金属反光"的常见画法，但不是这套语言的东西 ——
     * 金箔的高光是**整块金被往上错开**露出的那道亮边，
     * 不是画上去的一条线。两者在 56px 上的差别是：
     * 折光线读作"玻璃星上的一道白"，错位副本读作"这张金箔有厚度"。
     *
     * 三层都必须走同一个 `tornStarPts` 轨迹（`parts[0]` 已经带着变体的
     * 缩放和位移），所以直接复用 `body`，只改填充色和偏移。
     */
    const body = parts[0];
    if (body.k !== 'poly') return;

    // ② 亮金副本：整块向左上错 `(-0.35, -0.5)`（24 视图单位）。
    //
    // 只在本体轮廓里可见 —— 所以先 clip 到本体，再平移重填。
    // 偏移量按 24 视图算（`u()` 的分母就是 12），不是 48 视图。
    ctx.save();
    traceGlyphPart(ctx, body);
    ctx.clip();
    ctx.translate(-u(0.35), -u(0.5));
    traceGlyphPart(ctx, body);
    ctx.fillStyle = 'rgba(240,200,104,0.55)';
    ctx.fill();
    ctx.restore();

    // ③ 暗线描边：`stroke-width .7/s`（设计稿按缩放反比给线宽，
    //    这样二阶/三阶的小星也是同样粗细的边 —— 否则小星会被粗边糊死）。
    //
    // 这里 `body` 已经是缩放后的轨迹，等价于设计稿的 `.7/s`，
    // 所以直接用固定的 0.7 单位。
    traceGlyphPart(ctx, body);
    ctx.strokeStyle = 'rgba(120,80,20,0.50)';
    ctx.lineWidth = Math.max(0.9, u(0.7));
    ctx.lineJoin = 'round';
    ctx.stroke();
    return;
  }

  if (kind === 'ice') {
    const hex = parts[0];
    if (hex.k !== 'poly') return;
    ctx.save();
    traceGlyphPart(ctx, hex);
    ctx.clip();

    // 顶面 / 右侧面：晶体只有两面受光，第三面是暗的（那就是它的厚度）
    // 冰砖抄自 `ICONS`（**48 视图**），所以这一段用 `p48` / `V48` / `u48`。
    // 早先误用 24 视图的 `vpts`：六边晶的顶面三角被压成右下角的一小片。
    const face = (pts: ReadonlyArray<readonly [number, number]>, fill: string) => {
      ctx.beginPath();
      const p = p48(pts);
      ctx.moveTo(p[0][0] * half, p[0][1] * half);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * half, p[i][1] * half);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    face([[24, 5], [40, 15], [24, 24]], '#6E93AE');
    face([[24, 24], [40, 15], [40, 33], [24, 33]], '#3A5A74');

    // 分水线：一竖两斜。晶体的"纹"只在内部，不越过轮廓
    const line = (a: readonly [number, number], b: readonly [number, number], w: number, c: string) => {
      const [ax, ay] = V48(a[0], a[1]);
      const [bx, by] = V48(b[0], b[1]);
      ctx.beginPath();
      ctx.moveTo(ax * half, ay * half);
      ctx.lineTo(bx * half, by * half);
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(0.8, u48(w));
      ctx.stroke();
    };
    line([24, 5], [24, 43], 1.3, 'rgba(230,245,255,0.55)');
    line([8, 15], [40, 33], 1.0, 'rgba(230,245,255,0.30)');
    line([40, 15], [8, 33], 1.0, 'rgba(230,245,255,0.30)');
    ctx.restore();

    traceGlyphPart(ctx, hex);
    ctx.strokeStyle = 'rgba(20,45,65,0.55)';
    ctx.lineWidth = Math.max(0.9, u48(1.2));
    ctx.stroke();
    return;
  }

  if (kind === 'portalA' || kind === 'portalB' || kind === 'portal') {
    /**
     * 传送门 —— 主体（三层外环 + 金内环 + 芯点）全在 `MS_SHAPES` 里按
     * `MARKS['portal-a']` 逐条给了，**这里只补两笔几何表达不了的东西**：
     *
     * ① 外环的**亮边**：设计稿 `stroke #B8D8EC / width 0.7 /
     *    translate(-0.3,-0.4) / opacity .7` —— 往左上错一点点的一道细亮线，
     *    压在靛环上沿。它的作用不是"再画一圈"，而是让环看起来**有上沿**：
     *    光从左上来，环的左上缘亮、右下缘沉下去，环才有厚度。
     *    少了它，三层同心读作"一个扁平的粗圈"。
     *
     * ② 出口的**中缝竖线**已经在 shapes 里（`portalB` 的第 4 个图元），
     *    这里不重复。
     *
     * ## 亮边的偏移量按 24 视图
     *
     * `(-0.3, -0.4)` 是 24 视图的单位，所以走 `u()`（分母 12）；
     * 早先误用 48 视图的分母，亮边只错开 1/4 的位置 —— 它和粗环重合到
     * 看不出来，等于没画。
     */
    const dash = kind === 'portalB';
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash(dash ? [u(3.2), u(2.6)] : []);
    }
    ctx.arc(-u(0.3), -u(0.4), u(7.6), 0, TAU);
    ctx.strokeStyle = 'rgba(184,216,236,0.70)';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(0.7, u(0.7));
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'key') {
    // 土红钥的细节（`MARKS.key`，**24 视图**，坐标经 `u()` 换算）。
    //
    // 这一版踩过的坑连着三个，全在"单位"上：
    // ① 装饰层一开始抄了 48 视图的坐标（环 r=5.7、中心 −7），而几何是 24 视图
    //    （环 r=3.7、中心 (8.4−24)/24）—— 两套混用，几笔全飘到图形外；
    // ② dash 写了 `/12`，而 `u()` 与 `V()` 都按 24 分 —— 段长差一倍，
    //    环被切成碎渣，实测格子里只剩一团糊；
    // ③ 圆心写成 `(8.4−12)/12`，`V()` 的基准是 24 —— 又偏了一格。
    //
    // 现在全部按 24 视图：环心 8.4、环 r 3.7、钥孔 r 1.15。
    const KX = 8.4;
    const KY = 8.4;

    /**
     * ## 位置必须走 `V()`，只有半径和线宽走 `u()`
     *
     * `u(v) = v/12*half` 是**以格心为原点的长度**，把绝对坐标 `(8.4, 8.4)`
     * 喂给它，算出来的是"从格心往左上量 8.4 单位" —— 环心跑到格外的左上角。
     * `V(8.4, 8.4) = (−0.3, −0.3)` 才是设计稿那个偏左上的环心。
     *
     * 早先这几笔全用 `u()`：环的亮边飘到左上、钥孔飘到同样位置、
     * 反光点也飘过去 —— 三笔在盘子外叠成一个浅色圆点（实测钥匙右下
     * 那个"多出来的粉圈"就是它们）。
     */
    const P = (x: number, y: number): [number, number] => {
      const [ux, uy] = V(x, y);
      return [ux * half, uy * half];
    };

    // ① 环的亮边：设计稿第二圈 `stroke #B5472E / width 0.7 / translate(-0.3,-0.35)`
    const e = P(KX - 0.3, KY - 0.35);
    ctx.beginPath();
    ctx.arc(e[0], e[1], u(3.7), 0, TAU);
    ctx.strokeStyle = 'rgba(181,71,46,0.50)';
    ctx.lineWidth = Math.max(0.7, u(0.7));
    ctx.stroke();

    // ② 钥孔：`circle r=1.15 fill #9C4A2F`（24 视图的孔只有 1.15，不是 3.1）
    const k = P(KX, KY);
    ctx.beginPath();
    ctx.arc(k[0], k[1], u(1.15), 0, TAU);
    ctx.fillStyle = '#9C4A2F';
    ctx.fill();

    // ③ 环上一点壁土反光（24 视图 (10.6,10.8) r≈0.65）
    const g = P(10.6, 10.8);
    ctx.beginPath();
    ctx.arc(g[0], g[1], u(0.65), 0, TAU);
    ctx.fillStyle = 'rgba(227,210,180,0.55)';
    ctx.fill();
    return;
  }

  if (kind === 'gate' || kind === 'gateOpen') {
    /**
     * 门的细节 —— **所有坐标走 `V()`**（`(v−24)/24`），不走 `u()`。
     *
     * `u(v) = v/24*half` 是按"以 0 为原点"写的，只适合半径和线宽；
     * 而门的位置是 (12, 6.8)…(20) 这种绝对坐标，用 `u()` 会整体偏半个图标
     * （实测：门缝金线飘到门外面，成了一条悬空竖线）。
     */
    const P = (x: number, y: number): [number, number] => {
      const [ux, uy] = V(x, y);
      return [ux * half, uy * half];
    };

    if (kind === 'gate') {
      // 门缝：`MARKS.door` 的 `M12 6.8 L12 20`，`stroke-width 0.95` / dash 6/1.4。
      // 放装饰层才够细 —— 进几何会被笔触描成粗线，把门切成两条（读作栅栏）。
      ctx.save();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([u(6), u(1.4)]);
      const a = P(12, 6.8);
      const b = P(12, 20);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.strokeStyle = 'rgba(201,155,63,0.90)';
      ctx.lineWidth = Math.max(0.8, u(0.95));
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // 门环：`circle cx=14.7 cy=13.4 r=0.95 fill #C99B3F`
      const h = P(14.7, 13.4);
      ctx.beginPath();
      ctx.arc(h[0], h[1], u(0.95), 0, TAU);
      ctx.fillStyle = '#C99B3F';
      ctx.fill();

      // 门上一点受光（`MARKS.door` 的 `M7.6 19 L9.2 16.2`）
      const l0 = P(7.6, 19);
      const l1 = P(9.2, 16.2);
      ctx.beginPath();
      ctx.moveTo(l0[0], l0[1]);
      ctx.lineTo(l1[0], l1[1]);
      ctx.strokeStyle = 'rgba(240,215,180,0.22)';
      ctx.lineWidth = Math.max(0.8, u(0.9));
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      // 开的门：中缝 + 两侧共三道沥金暖光（`MARKS['door-open']`：
      // `M12 5.8 L12 19.4` 宽 1.35，`M10.2/13.8 6.4 L19` 宽 0.8）
      ctx.save();
      ctx.lineCap = 'round';
      const line = (x: number, y0: number, y1: number, w: number, al: number) => {
        const a = P(x, y0);
        const b = P(x, y1);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.strokeStyle = `rgba(246,231,184,${al})`;
        ctx.lineWidth = Math.max(0.8, u(w));
        ctx.stroke();
      };
      line(12, 5.8, 19.4, 1.35, 0.90);
      line(10.2, 6.4, 19, 0.8, 0.40);
      line(13.8, 6.4, 19, 0.8, 0.40);
      ctx.restore();
    }
    return;
  }
};

// ────────────────────────────── 棋面刻纹 · 六字纹 ──────────────────────────────

/**
 * 六字纹：月 / 梅 / 浪 / 山 / 云 / 星。
 *
 * 设计稿的原话是"格面刻纹（已铺格内），魏碑感钝笔线刻 + 颗粒；线宽 1.6 不许细过发丝"。
 * 也就是说它不是**图标**，是**墙角的花纹** —— 每块空墙皮上都有一枚，
 * 用钝刀浅浅划进去的。
 *
 * 所以它只在**还没上色的格**上出现：铺过矿彩的格，纹样被颜料盖住了。
 * 这也正好是这套盘的叙事 —— 空盘是一面刻满纹样的旧墙，走一路铺一路色。
 */
type Motif = (c: CanvasRenderingContext2D, half: number) => void;

/**
 * 六字纹的坐标抄自设计稿 **`GLYPHS`（48 视图）**，所以这里走 `V48`
 * （分母 24）而不是 `V`（分母 12，给 24 视图的格内标用）。
 *
 * 半径行用的是 `(r / 24) * h` —— 与 `V48` 同一套分母，本来就对，
 * 改的时候不要跟着 `V` 一起改成 `/12`，否则月牙的半径会大一倍、
 * 整枚纹样撑破格子（铺满格子的纹样会被读成"图案"而不是"刻痕"）。
 */

const MOTIFS: ReadonlyArray<{ ink: string; draw: Motif }> = [
  // 月：两个同心弧围出的月牙（外弧 15.5 / 内弧 12.5）
  {
    ink: '#5E4A2E',
    draw: (c, h) => {
      const [cx, cy] = V48(31, 24);
      c.beginPath();
      c.arc(cx * h, cy * h, (15.5 / 24) * h, -Math.PI / 2, Math.PI / 2, true);
      c.arc(cx * h, cy * h, (12.5 / 24) * h, Math.PI / 2, Math.PI * 1.5, false);
      c.closePath();
      c.stroke();
    },
  },
  // 梅：四瓣 + 心
  {
    ink: '#7A3B28',
    draw: (c, h) => {
      for (const [x, y, r] of [[24, 16, 4.2], [15, 26, 4.2], [33, 26, 4.2], [24, 35, 4.2], [24, 25.5, 2]] as const) {
        const [ux, uy] = V48(x, y);
        c.beginPath();
        c.arc(ux * h, uy * h, (r / 24) * h, 0, TAU);
        c.stroke();
      }
    },
  },
  // 浪：两道叠浪（T 是前一个控制点的反射）
  {
    ink: '#3E5E72',
    draw: (c, h) => {
      for (const y of [22, 31]) {
        const [x0, y0] = V48(6, y);
        const [c1x, c1y] = V48(13, y - 9);
        const [x1, y1] = V48(24, y);
        const [c2x, c2y] = V48(35, y + 9);
        const [x2, y2] = V48(42, y);
        c.beginPath();
        c.moveTo(x0 * h, y0 * h);
        c.quadraticCurveTo(c1x * h, c1y * h, x1 * h, y1 * h);
        c.quadraticCurveTo(c2x * h, c2y * h, x2 * h, y2 * h);
        c.stroke();
      }
    },
  },
  // 山：三峰
  {
    ink: '#4A5E3E',
    draw: (c, h) => {
      const p = p48([[5, 37], [18, 13], [27, 27], [32, 19], [43, 37]]);
      c.beginPath();
      c.moveTo(p[0][0] * h, p[0][1] * h);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * h, p[i][1] * h);
      c.closePath();
      c.stroke();
    },
  },
  // 云：一朵卷云
  {
    ink: '#5E4A2E',
    draw: (c, h) => {
      const q = (b: readonly [number, number], d: readonly [number, number]) => {
        const [bx, by] = V48(b[0], b[1]);
        const [dx, dy] = V48(d[0], d[1]);
        c.quadraticCurveTo(bx * h, by * h, dx * h, dy * h);
      };
      const [sx, sy] = V48(12, 32);
      c.beginPath();
      c.moveTo(sx * h, sy * h);
      q([9, 22], [18, 24]);
      q([19, 15], [29, 18]);
      q([39, 16], [37, 26]);
      q([43, 28], [39, 33]);
      const [lx, ly] = V48(14, 33);
      c.lineTo(lx * h, ly * h);
      q([8, 34], [12, 32]);
      c.closePath();
      c.stroke();
    },
  },
  // 星：五角
  {
    ink: '#8A6A28',
    draw: (c, h) => {
      const p = p48([
        [24, 8], [28, 20], [40, 20], [30.5, 27.5], [34, 39],
        [24, 32], [14, 39], [17.5, 27.5], [8, 20], [20, 20],
      ]);
      c.beginPath();
      c.moveTo(p[0][0] * h, p[0][1] * h);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * h, p[i][1] * h);
      c.closePath();
      c.stroke();
    },
  },
];

/**
 * 在空墙皮上刻一枚纹样。
 *
 * 尺寸取格的 0.46、线宽 1.9/48 —— 和设计稿的 `svg 38px / stroke 1.9` 同比例。
 * 不透明度 0.40：刻痕是"浅"的，全不透明会变成印上去的花纸。
 */
function drawEngrave(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  gx: number,
  gy: number,
  walk: boolean,
): void {
  const m = MOTIFS[(((gx * 2 + gy * 3) % MOTIFS.length) + MOTIFS.length) % MOTIFS.length];
  const size = s * 0.46;
  ctx.save();
  ctx.translate(cx, cy);
  // 墨色跟着格态走：未铺是淡土块（纹样用深赭刻痕），
  // 已铺是矿彩色块（底色沉下去了，刻痕要**提亮**才看得见）。
  // 设计稿「棋面纹样·六字纹」：「格面刻纹（**已铺格内**）」
  // 与使用说明「只落未铺/已铺普通格」—— 两态都画，只是墨色不同。
  ctx.strokeStyle = walk ? 'rgba(246,231,200,0.60)' : m.ink;
  // 文档给的是 `opacity .5`（`<div class="mark" style="opacity:.5">`）
  ctx.globalAlpha = 0.50;
  // 文档「线宽 1.6 不许细过发丝」—— 之前写 1.9，偏粗一档
  ctx.lineWidth = Math.max(1, size * (1.6 / 48));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  m.draw(ctx, size / 2);
  ctx.restore();
}

// ────────────────────────────── 矿物颗粒 ──────────────────────────────

/**
 * 铺一层砂。
 *
 * 共用的 256 颗粒贴图是**1 像素一块**的细砂：贴在 750 宽的屏幕上像一层雾。
 * 壁土要的是"粗颗粒"，所以除了一比一那层，再叠一层放大的 —— `scale` 会
 * 把 pattern 本身也放大，砂粒从 1px 变成 2~3px，远看才是砂浆墙而不是噪点滤镜。
 */
function sandGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
  zoom = 1,
): void {
  if (w <= 0 || h <= 0 || alpha <= 0) return;
  if (zoom === 1) {
    fillGrain(ctx, x, y, w, h, alpha);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(zoom, zoom);
  fillGrain(ctx, 0, 0, w / zoom, h / zoom, alpha);
  ctx.restore();
}

// ────────────────────────────── 背景 ──────────────────────────────

/**
 * 暖土壁。
 *
 * 三件事让它像"一面墙"而不是一块土黄色：
 * 1. `radial-gradient(130% 110% at 30% 20%)` —— 光源仍然只有左上那一个（和棋子同源）；
 * 2. 两层颗粒（细 + 粗），中间那层被画框盖着，就不白铺；
 * 3. 远山只剩影、左上角一截飞天飘带 —— 壁画的"画"已经剥掉了，只剩构图。
 *
 * 尘埃（6 粒缓慢上浮）是唯一动的东西：墙面是死的，光里的尘是活的。
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox, now = 0): void {
  const { x, y, w, h } = box;

  const g = ctx.createRadialGradient(
    x + w * 0.3, y + h * 0.2, 0,
    x + w * 0.3, y + h * 0.2, Math.max(w, h) * 1.05,
  );
  g.addColorStop(0, K.pageHi);
  g.addColorStop(0.55, K.pageMid);
  g.addColorStop(1, K.pageLo);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  drawRidges(ctx, box);
  drawRibbon(ctx, box);

  // 颗粒只铺在画框上下的两条带里：中间那一大块被画框盖着，铺了也是白花
  const frameTop = BOARD_TOP;
  const frameBot = BOARD_TOP + BOARD_CARD_W;
  const bands: Array<[number, number]> = [
    [y, Math.min(frameTop, y + h) - y],
    [Math.max(frameBot, y), y + h - Math.max(frameBot, y)],
  ];
  for (const [by, bh] of bands) {
    sandGrain(ctx, x, by, w, bh, 0.62);
    sandGrain(ctx, x, by, w, bh, 0.34, 2.6);
  }

  drawDust(ctx, box, now);

  // 壁面亮度呼吸 **0.98~1.02 / 周期 6s**（设计稿 TOKEN 表「背景常驻 8–14s 循环」：
  // 尘埃 8~14 秒一圈、壁画亮度呼吸 6s）。
  //
  // 幅度取 0.02（= 设计稿的 1.02 − 1.00），换算到这一层半透明叠色的 alpha
  // 大约是 0.02 × 0.6 —— 因为叠一层 `rgba(色, a)` 并不会让底层亮度线性涨 a。
  // 早先给 0.013 偏淡，实测在土黄壁面上几乎看不出在动。
  const breath = Math.sin(now / 955) * 0.020;
  if (Math.abs(breath) > 0.0008) {
    ctx.fillStyle = breath > 0 ? `rgba(255,244,220,${breath * 0.62})` : `rgba(74,48,20,${-breath * 0.62})`;
    ctx.fillRect(x, y, w, h);
  }
}

/** 淡远山：两道只剩影的脊线，贴在页面下半（盘底下那片空）。 */
function drawRidges(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  const { x, y, w, h } = box;
  const layers: Array<[number, number, string]> = [
    [0.70, 0.075, 'rgba(122,92,52,0.085)'],
    [0.79, 0.055, 'rgba(104,76,42,0.065)'],
  ];
  for (const [base, amp, color] of layers) {
    const y0 = y + h * base;
    ctx.beginPath();
    ctx.moveTo(x, y0 + h * amp * 0.4);
    // 五个峰：手画的山没有等距的，所以峰位带一点抖动（固定的，不会游）
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const px = x + w * t;
      const peak = Math.sin(t * Math.PI * 3.1 + base * 7) * 0.5 + 0.5;
      const py = y0 - h * amp * peak * (0.5 + hash(i * 3.7 + base) * 0.6);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** 左上角一截飞天飘带：壁画的构图还在，画已经剥没了。 */
function drawRibbon(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 两笔：一笔宽的做带身，一笔细的做带尾
  ctx.strokeStyle = 'rgba(150,74,42,0.15)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-14, 30);
  ctx.bezierCurveTo(48, 6, 108, 62, 172, 34);
  ctx.bezierCurveTo(212, 16, 238, 56, 262, 44);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(150,74,42,0.10)';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-14, 46);
  ctx.bezierCurveTo(54, 26, 96, 76, 158, 50);
  ctx.bezierCurveTo(196, 34, 220, 68, 246, 62);
  ctx.stroke();

  // 带尾的一粒飘带结
  ctx.beginPath();
  ctx.arc(150, 47, 4.4, 0, TAU);
  ctx.fillStyle = 'rgba(150,74,42,0.13)';
  ctx.fill();
  ctx.restore();
}

/** 尘埃：6 粒，8~14 秒一圈缓慢上浮，横向 ±8px 漂移。 */
function drawDust(ctx: CanvasRenderingContext2D, box: DesignBox, now: number): void {
  const { x, y, w, h } = box;
  for (let i = 0; i < 6; i++) {
    const period = 9000 + hash(i * 4.1) * 5000;
    const phase = ((now + hash(i * 7.9) * period) % period) / period;
    // 从下往上：0 在底部，1 到顶
    const py = y + h * (1.02 - phase * 1.08);
    const px = x + w * (0.08 + hash(i * 2.3) * 0.84) + Math.sin(now / 3200 + i * 1.7) * w * 0.012;
    const r = 2 + hash(i * 9.4) * 3.2;
    // 上下两端淡出：尘是从墙里浮出来的，不该在画框边"突然出现"
    const fade = Math.min(1, Math.min(phase, 1 - phase) * 6);
    const a = 0.16 * fade;
    if (a <= 0.004) continue;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.4);
    g.addColorStop(0, `rgba(160,110,50,${a})`);
    g.addColorStop(1, 'rgba(160,110,50,0)');
    ctx.beginPath();
    ctx.arc(px, py, r * 2.4, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// ────────────────────────────── 壁面画框 ──────────────────────────────

/**
 * 每边两处剥落缺口：`[沿边位置 0..1, 缺口深度（相对该边方向的短边）]`。
 *
 * 缺口位置是**写死的**，不用随机：画框每帧必须同形，否则它会"呼吸"，
 * 而且关卡之间同一个缺口会跳位置 —— 玩家不会说"这墙真旧"，会说"这屏在抖"。
 */
const BITE = {
  top: [[0.19, 0.020], [0.63, 0.014]],
  right: [[0.24, 0.016], [0.70, 0.021]],
  bottom: [[0.27, 0.018], [0.71, 0.013]],
  left: [[0.31, 0.015], [0.76, 0.019]],
} as const;

/** 四角切一个斜口：剥落的墙不会留着 90° 的直角。 */
const CORNER = 16;

/**
 * 画框轮廓：矩形 + 每边两处缺口 + 四角斜切。
 *
 * 用多边形而不是 `roundRect` —— 这一套的"旧"全在边上。
 * 圆角会立刻把它变成一张卡片，而它应该是一块**墙皮**。
 */
function framePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const span = w * 0.026;
  ctx.beginPath();
  ctx.moveTo(x + CORNER, y);

  // 上边（左→右）
  for (const [u, d] of BITE.top) {
    const cx = x + u * w;
    const dy = d * h;
    ctx.lineTo(cx - span, y);
    ctx.lineTo(cx - span * 0.45, y + dy * 0.45);
    ctx.lineTo(cx + span * 0.15, y + dy);
    ctx.lineTo(cx + span * 0.7, y + dy * 0.3);
    ctx.lineTo(cx + span, y);
  }
  ctx.lineTo(x + w - CORNER, y);
  ctx.lineTo(x + w, y + CORNER);

  // 右边（上→下）
  for (const [u, d] of BITE.right) {
    const cy = y + u * h;
    const dx = d * w;
    ctx.lineTo(x + w, cy - span);
    ctx.lineTo(x + w - dx * 0.4, cy - span * 0.4);
    ctx.lineTo(x + w - dx, cy + span * 0.15);
    ctx.lineTo(x + w - dx * 0.3, cy + span * 0.65);
    ctx.lineTo(x + w, cy + span);
  }
  ctx.lineTo(x + w, y + h - CORNER);
  ctx.lineTo(x + w - CORNER, y + h);

  // 下边（右→左）：缺口按 u 降序遍历
  for (let i = BITE.bottom.length - 1; i >= 0; i--) {
    const [u, d] = BITE.bottom[i];
    const cx = x + u * w;
    const dy = d * h;
    ctx.lineTo(cx + span, y + h);
    ctx.lineTo(cx + span * 0.4, y + h - dy * 0.4);
    ctx.lineTo(cx - span * 0.2, y + h - dy);
    ctx.lineTo(cx - span * 0.7, y + h - dy * 0.35);
    ctx.lineTo(cx - span, y + h);
  }
  ctx.lineTo(x + CORNER, y + h);
  ctx.lineTo(x, y + h - CORNER);

  // 左边（下→上）
  for (let i = BITE.left.length - 1; i >= 0; i--) {
    const [u, d] = BITE.left[i];
    const cy = y + u * h;
    const dx = d * w;
    ctx.lineTo(x, cy + span);
    ctx.lineTo(x + dx * 0.45, cy + span * 0.35);
    ctx.lineTo(x + dx, cy - span * 0.2);
    ctx.lineTo(x + dx * 0.4, cy - span * 0.7);
    ctx.lineTo(x, cy - span);
  }
  ctx.lineTo(x, y + CORNER);
  ctx.closePath();
}

/**
 * 壁面画框。
 *
 * 底色比页面**深半档**：画框是"另一块墙"，它得比周围的墙旧一点，
 * 不然盘面会化进背景，格子在哪儿都看不出来。
 * 四道工序照设计稿 `.mb-dunhuang`：外影 → 壁面 → 上下内影 → 褪色土红边。
 */
function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const card = cardOf(layout);
  const { x, y, w, h } = card;

  // ① 外影：`0 10px 30px` 的一记，暖色（不是黑）—— 土墙上没有黑影子
  ctx.save();
  ctx.shadowColor = 'rgba(96,60,24,0.34)';
  ctx.shadowBlur = 54;
  ctx.shadowOffsetY = 18;
  framePath(ctx, x, y, w, h);
  ctx.fillStyle = '#C4A878';
  ctx.fill();
  ctx.restore();

  // ② 壁面：158° 三停，比页面暗一档。差得不够时，满盘淡土格会整片化在墙里
  framePath(ctx, x, y, w, h);
  const body = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
  body.addColorStop(0, '#D8C193');
  body.addColorStop(0.55, '#C9AE7C');
  body.addColorStop(1, '#B79A68');
  ctx.fillStyle = body;
  ctx.fill();

  // ③ 内影：上 `inset 0 2px 12px`、下 `inset 0 -6px 18px`
  ctx.save();
  framePath(ctx, x, y, w, h);
  ctx.clip();
  const topIn = ctx.createLinearGradient(0, y, 0, y + 30);
  topIn.addColorStop(0, 'rgba(120,80,40,0.22)');
  topIn.addColorStop(1, 'rgba(120,80,40,0)');
  ctx.fillStyle = topIn;
  ctx.fillRect(x, y, w, 30);
  const botIn = ctx.createLinearGradient(0, y + h - 44, 0, y + h);
  botIn.addColorStop(0, 'rgba(120,80,40,0)');
  botIn.addColorStop(1, 'rgba(120,80,40,0.18)');
  ctx.fillStyle = botIn;
  ctx.fillRect(x, y + h - 44, w, 44);
  // 壁面自己的砂
  sandGrain(ctx, x, y, w, h, 0.5);
  sandGrain(ctx, x, y, w, h, 0.28, 2.4);
  ctx.restore();

  // ④ 褪色土红边线：贴着缺口走，所以线也是破的
  framePath(ctx, x, y, w, h);
  ctx.strokeStyle = 'rgba(150,74,42,0.40)';
  ctx.lineWidth = 2.6;
  ctx.stroke();
}

// ────────────────────────────── 棋子 ──────────────────────────────

/**
 * 棋盘块：`[148° 三停, 上唇白光, 下唇内影, 轮廓色, 轮廓线宽, 斑驳强度]`。
 *
 * 五条配方逐条对齐设计稿 `.mp` 系（54 CSS 的色块）：
 * `.mp` 石绿 / `.mp.pale` 淡土 / `.mp.red` 朱砂 / 石青 / `.mp` 冷版石青。
 */
interface Paste {
  ramp: readonly [string, string, string];
  /** `inset 0 1px 1px rgba(255,245,220,.35)` 的 alpha */
  hi: number;
  /** `inset 0 -3px 7px` 的收尾色 */
  foot: string;
  /** 轮廓色。未铺格「只留轮廓」全靠它 */
  edge: string;
  /** 轮廓线宽（相对棋子边长） */
  edgeW: number;
  /** 斑驳：颜料被水浸过的那一层不匀 */
  blotch: number;
  /**
   * 渐变的形状：默认 148° 斜向线性（设计稿 `linear-gradient(148deg, …)`）。
   *
   * `'radial'` 是**给传送门用的**：设计稿那一格是
   * `radial-gradient(72% 72% at 50% 46%, #2E4166, #22334F 56%, #16233A)` ——
   * 一个**向内收的漩涡**，中心稍亮、边缘沉下去。
   *
   * 斜向线性给不出漩涡感：同一条 148° 的斜带铺在深靛上，读起来只是
   * "一块被照亮的三角"；而传送门要的是"中心有源、四周收进暗影"。
   */
  radial?: boolean;
}

const PASTES: readonly Paste[] = [
  /**
   * 0 · 未铺普通格 = **石绿**。
   *
   * 设计稿裸 `.mp`：`linear-gradient(148deg, #6E9580, #56786A 55%, #456055)`
   *
   * ## 这里曾经搞反了一对 class（2026-11-19 像素闸门抓到）
   *
   * 早先写的是 `#ECDCB8 → #DAC59A → #C6AC80`（淡土黄），而那个色值是设计稿
   * **`.mp.pale`** 的 —— `.mp.pale` 只用于机制格（起点/终点/按下/线头/钥匙/门），
   * 是那些格子底下的"纸面"。普通格用的是裸 `.mp`，石绿。
   *
   * 后果：出图跟基线比，丹青未铺格均值 Δ **104**（全盘最大的单项偏差）。
   * 并排一看就是"米黄 vs 石绿"，但只盯着代码看很难发现 ——
   * 两个色值都是设计稿里真实存在的，只是**挂错了 class**。
   */
  { ramp: ['#6E9580', '#56786A', '#456055'], hi: 0.32, foot: 'rgba(30,25,15,0.30)', edge: 'rgba(44,64,54,0.42)', edgeW: 0.012, blotch: 0.10 },
  /**
   * 1 · 机制格的"纸面" = 淡土黄。
   *
   * 设计稿 `.mp.pale`：`linear-gradient(148deg, #E8D6B0, #D2BC8E 55%, #BFA176)`
   * 起点/终点/钥匙/门/按下/线头铺这一层，机制标压在上面。
   * 它与石绿普通格形成"上过色的纸 vs 没动过的墙"的对比。
   */
  { ramp: ['#E8D6B0', '#D2BC8E', '#BFA176'], hi: 0.40, foot: 'rgba(120,80,30,0.16)', edge: 'rgba(124,88,48,0.30)', edgeW: 0.014, blotch: 0.10 },
  // 2 · 朱砂
  // 朱砂（`.mp.red`：`linear-gradient(148deg, #B5472E, #8F3220 55%, #713A20)`）
  //
  // 早先写 `#B86A44 → #8A4626` —— G 通道高了 35，整格偏**橙**（像陶土，不像朱砂）。
  // 设计稿这个红是"刚研开的朱砂"，红得发闷、不带橙。
  { ramp: ['#B5472E', '#8F3220', '#713A20'], hi: 0.28, foot: 'rgba(40,18,8,0.32)', edge: 'rgba(84,38,18,0.44)', edgeW: 0.012, blotch: 0.10 },
  // 3 · 石青
  { ramp: ['#6D89A6', '#48627E', '#3A4F66'], hi: 0.30, foot: 'rgba(16,26,40,0.32)', edge: 'rgba(34,50,70,0.44)', edgeW: 0.012, blotch: 0.10 },
  // 4 · 冰砖：石青的冷版，比周围亮一档（设计稿「比周围冷 8°」）
  // 冰砖（`.mp.m-ice`：`linear-gradient(148deg, #6E93AE, #4A6E8A 55%, #3A5A74)`）
  //
  // 早先写 `#96B4CC → #55768F` —— 整体亮了 30~40。设计稿的"比普通格亮一档"
  // 只是**一档**，不是发白；`#6E93AE` 仍在石青的色域里，只是比石绿格冷。
  // 亮过头就变成"冰砖是白瓷"，和整盘矿物色脱节。
  { ramp: ['#6E93AE', '#4A6E8A', '#3A5A74'], hi: 0.46, foot: 'rgba(20,45,65,0.35)', edge: 'rgba(230,245,255,0.50)', edgeW: 0.013, blotch: 0.06 },
  // 5 · 冰砖（已踩过）：冷度不减，暗回来，和走过的路同调
  // 冰砖（已踩过）：比未踩暗一档，冷度不减。设计稿没给这一档的色值
  // （它把"踩过"画成整格压暗），所以按未踩的三段各降约 12% 明度推算。
  { ramp: ['#5F8199', '#3F5F77', '#324E65'], hi: 0.38, foot: 'rgba(16,34,54,0.38)', edge: 'rgba(200,226,244,0.34)', edgeW: 0.013, blotch: 0.07 },
  // 6 · 传送门：**深靛漩底**（设计稿 `.mp.m-portal` 的
  //     `radial-gradient(72% at 50% 46%, #2E4166, #22334F 56%, #16233A)`）。
  //
  //     这一档是使用说明「常见误用」里点名的那个病：
  //     「传送门做成石绿 → 和石绿格融为一体（此病已治：深靛漩底 + 石青环 + 沥金芯）」。
  //     所以它**不能**走 `pasteFor` 的六色轮换 —— 石绿格和石青格就在旁边，
  //     同色系一贴上去，玩家分不出"这是传送门"还是"这一格被涂过"。
  //     深靛是全盘唯一的冷暗色，一眼就跳出来。
  { ramp: ['#2E4166', '#22334F', '#16233A'], hi: 0.30, foot: 'rgba(12,20,38,0.45)', edge: 'rgba(130,172,210,0.50)', edgeW: 0.014, blotch: 0.12, radial: true },
  // 7 · 石障的格面底（`.mp.m-stone`：`linear-gradient(148deg, #A2664A, #8A5236 55%, #6B4526)`）
  //
  //    石障不是"墙上贴一块石头"，是**这一格被一块赭岩占住了**。
  //    格面底提供边界（读完知道这是整整一格）和深度（石头比格面更暗、更靠前）。
  //    没有它，那块八边形岩会浮在墙皮上读作贴纸。
  { ramp: ['#A2664A', '#8A5236', '#6B4526'], hi: 0.28, foot: 'rgba(45,22,5,0.42)', edge: 'rgba(60,32,14,0.50)', edgeW: 0.012, blotch: 0.14 },
];

/** 石障格面在 `PASTES` 里的下标（`drawCell` 的 BLOCK 分支用）。 */
const STONE_PASTE = 7;

/** 棋子轮廓的三种「手切口」（设计稿 `clip-path` 的五点多边形，逐条抄）。 */
const SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0.030, 0.000], [0.972, 0.018], [1.000, 0.962], [0.038, 1.000], [0.000, 0.078]],
  [[0.000, 0.028], [0.958, 0.000], [0.982, 0.986], [0.056, 0.958], [0.020, 0.108]],
  [[0.044, 0.008], [0.980, 0.034], [0.966, 0.972], [0.000, 0.960], [0.012, 0.046]],
];

/**
 * 棋子轮廓：**圆角五边形**（不是尖角）。
 *
 * ## 为什么必须倒圆
 *
 * `SHAPES` 抄的是设计稿的 `clip-path: polygon(3% 0, 97% 2%, 100% 96%, 4% 100%, 0 8%)`
 * —— 那是**五个尖角**。早先直接 `lineTo` 连起来，画出来就是一块正方形
 * （五个角的偏移最多 4%，在 101px 的格子上只有 4px，看不太出来，
 * 于是整盘读作"一堆方砖"）。
 *
 * 但设计稿的 `.mp` 同时有 `border-radius: 11px`（54px 的格子，占 20%）。
 * CSS 里这两者是**叠加**的：先按 radius 把盒子做成圆角矩形，再用 clip-path
 * 裁出不规则边 —— 结果是一块"**四角圆润、边缘略歪**"的碎片，
 * 正是"从壁面上剥下来的一片"该有的样子。
 *
 * 所以这里把每个角倒圆：沿两条邻边各退回 `r`，用二次贝塞尔过角点连接。
 * 半径取 `s * 0.20`（对应设计稿 11/54 = 0.204）。
 *
 * `r` 用**格宽比例**而不是绝对像素，换盘大小时间角的观感一致。
 */
function traceShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  shape: number,
): void {
  const pts = SHAPES[shape % SHAPES.length];
  const n = pts.length;
  // 圆角半径：设计稿 11/54 ≈ 0.204。上限 `s*0.28` 防止小盘上圆角过大糊成椭圆
  const rad = s * 0.20;

  const P = (i: number): [number, number] => [
    x + pts[(i + n) % n][0] * s,
    y + pts[(i + n) % n][1] * s,
  ];

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const cur = P(i);
    const prev = P(i - 1);
    const next = P(i + 1);
    // 从当前角往两条邻边各退 rad（退的长度按边长等比截断，短边不越过中点）
    const lenPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    const lenNext = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    const rPrev = Math.min(rad, lenPrev * 0.45);
    const rNext = Math.min(rad, lenNext * 0.45);

    const a: [number, number] = [
      cur[0] + ((prev[0] - cur[0]) / lenPrev) * rPrev,
      cur[1] + ((prev[1] - cur[1]) / lenPrev) * rPrev,
    ];
    const b: [number, number] = [
      cur[0] + ((next[0] - cur[0]) / lenNext) * rNext,
      cur[1] + ((next[1] - cur[1]) / lenNext) * rNext,
    ];
    if (i === 0) ctx.moveTo(a[0], a[1]);
    else ctx.lineTo(a[0], a[1]);
    // 二次贝塞尔以角点为控制点 —— 角被"磨"掉，剩下的弧就是圆角
    ctx.quadraticCurveTo(cur[0], cur[1], b[0], b[1]);
  }
  ctx.closePath();
}

/**
 * 棋子贴片缓存。
 *
 * 一格 = 一次渐变 + 两次颗粒填充 + 二十几粒砂 + 四道内影，11×11 的盘每帧
 * 就是七八百次绘制。棋子尺寸一关内恒定、配色只有六种、轮廓只有三种 ——
 * 烘成 18 张就够，每格只剩一次 `drawImage`。
 *
 * 超采样 2× 是必须的：贴片按设备像素画，再被 `drawImage` 缩回设计像素，
 * 一比一会糊掉轮廓上那 1px 的磕边 —— 而那正是"破"的全部。
 */
const sprites = new Map<string, HTMLCanvasElement>();

function pieceSprite(s: number, vi: number, shape: number): HTMLCanvasElement {
  const key = `${Math.round(s)}|${vi}|${shape}`;
  const hit = sprites.get(key);
  if (hit) return hit;

  const paste = PASTES[vi];
  const pad = Math.ceil(s * 0.24);
  const box = s + pad * 2;
  const ss = 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(box * ss);
  cv.height = Math.ceil(box * ss);
  const c = cv.getContext('2d');
  if (!c) return cv;
  c.scale(ss, ss);
  c.translate(pad, pad);

  // ① 接触影：色块是**贴在**墙上的，影要糊、要贴身。
  //    第一版为了"落地"又叠了一层偏移的实心形，结果那圈棱角分明的暗边
  //    把每一格都读成一张浮起来的卡片 —— 影只能给一次，而且必须散开
  c.save();
  traceShape(c, 0, 0, s, shape);
  c.shadowColor = 'rgba(104,66,26,0.46)';
  c.shadowBlur = s * 0.055;
  c.shadowOffsetY = s * 0.026;
  c.fillStyle = paste.ramp[1];
  c.fill();
  c.restore();

  // ② 面 + 颗粒 + 斑驳 + 倒角（全部裁在轮廓里）
  c.save();
  traceShape(c, 0, 0, s, shape);
  c.clip();

  let ramp: CanvasGradient;
  if (paste.radial) {
    // 传送门：`radial-gradient(72% 72% at 50% 46%, #2E4166, #22334F 56%, #16233A)`
    // 圆心偏上（46%），范围 72% —— 亮心在上半、暗边往下沉，读作一个"口"。
    // 用 `createRadialGradient` 的椭圆要靠 scale，这里直接把半径取 `s * 0.72`，
    // 上下差靠圆心 0.46 的偏移表达，视觉上等价。
    const rx = s * 0.5;
    const ry = s * 0.46;
    ramp = c.createRadialGradient(rx, ry, 0, rx, ry, s * 0.72);
    ramp.addColorStop(0, paste.ramp[0]);
    ramp.addColorStop(0.56, paste.ramp[1]);
    ramp.addColorStop(1, paste.ramp[2]);
  } else {
    const ang = (148 * Math.PI) / 180;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const L = (Math.abs(dx) + Math.abs(dy)) * s * 0.5;
    ramp = c.createLinearGradient(
      s / 2 - dx * L, s / 2 - dy * L,
      s / 2 + dx * L, s / 2 + dy * L,
    );
    ramp.addColorStop(0, paste.ramp[0]);
    ramp.addColorStop(0.55, paste.ramp[1]);
    ramp.addColorStop(1, paste.ramp[2]);
  }
  c.fillStyle = ramp;
  c.fillRect(-s * 0.1, -s * 0.1, s * 1.2, s * 1.2);

  // 矿物颗粒：细砂一遍 + 粗砂一遍。缺了这两层，色块就只是"纯色方块"
  sandGrain(c, -s * 0.1, -s * 0.1, s * 1.2, s * 1.2, 0.95);
  sandGrain(c, -s * 0.1, -s * 0.1, s * 1.2, s * 1.2, 0.55, 2.2);

  // 斑驳：左上被水洗淡、右下积尘。
  // 两个圆要**压扁并转个角度** —— 正圆读出来是"水渍"，椭圆才读作"颜料不匀"
  if (paste.blotch > 0) {
    c.save();
    c.translate(s * 0.32, s * 0.26);
    c.rotate(-0.55);
    c.scale(1.5, 0.92);
    const l = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.66);
    l.addColorStop(0, `rgba(255,248,228,${paste.blotch * 0.62})`);
    l.addColorStop(0.55, `rgba(255,248,228,${paste.blotch * 0.24})`);
    l.addColorStop(1, 'rgba(255,248,228,0)');
    c.fillStyle = l;
    c.fillRect(-s * 1.2, -s * 1.2, s * 2.4, s * 2.4);
    c.restore();

    c.save();
    c.translate(s * 0.80, s * 0.84);
    c.rotate(0.42);
    c.scale(1.35, 0.95);
    const d = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.62);
    d.addColorStop(0, `rgba(52,30,12,${paste.blotch * 0.62})`);
    d.addColorStop(1, 'rgba(52,30,12,0)');
    c.fillStyle = d;
    c.fillRect(-s * 1.2, -s * 1.2, s * 2.4, s * 2.4);
    c.restore();
  }

  // 二十几粒砂：颗粒贴图是均匀的，真正让"矿物"成立的是偶尔冒出来的粗粒
  for (let i = 0; i < 22; i++) {
    const hx = hash(vi * 7.3 + i * 3.1 + shape * 1.7);
    const hy = hash(vi * 5.7 + i * 8.3 + shape * 2.9);
    const light = hash(i * 2.7 + vi * 1.3) > 0.45;
    c.beginPath();
    c.arc(hx * s, hy * s, 0.5 + hash(i * 9.1 + shape) * s * 0.013, 0, TAU);
    c.fillStyle = light ? 'rgba(255,246,224,0.18)' : 'rgba(48,28,10,0.16)';
    c.fill();
  }

  // 上唇：色片没有"倒角"。只给左上一段见光，向右淡出 ——
  // 整条通亮的白线会立刻把色块读成按钮（本套第一版就是栽在这里）
  const lip = c.createLinearGradient(0, 0, s, 0);
  lip.addColorStop(0, `rgba(255,245,220,${paste.hi})`);
  lip.addColorStop(0.52, `rgba(255,245,220,${paste.hi * 0.40})`);
  lip.addColorStop(1, 'rgba(255,245,220,0)');
  c.fillStyle = lip;
  c.fillRect(0, 0, s, Math.max(1.1, s * 0.016));

  // 下唇：色片的下沿压出的一道窄影。要窄 —— 宽成一整条"底边收暗"就是按钮了
  const foot = c.createLinearGradient(0, s * 0.88, 0, s);
  foot.addColorStop(0, 'rgba(0,0,0,0)');
  foot.addColorStop(1, paste.foot);
  c.globalAlpha = 0.78;
  c.fillStyle = foot;
  c.fillRect(0, s * 0.88, s, s * 0.12);
  c.globalAlpha = 1;

  // 右下角一小片积尘，让明暗不对称
  const dust = c.createRadialGradient(s * 0.94, s, 0, s * 0.94, s, s * 0.66);
  dust.addColorStop(0, paste.foot);
  dust.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = 0.5;
  c.fillStyle = dust;
  c.fillRect(s * 0.36, s * 0.36, s * 0.64, s * 0.64);
  c.globalAlpha = 1;
  c.restore();

  // ③ 磕边：轮廓上一道暗线。色块比墙低半毫米，边界是阴影不是亮线
  traceShape(c, 0, 0, s, shape);
  c.strokeStyle = paste.edge;
  c.lineWidth = Math.max(1, s * paste.edgeW);
  c.stroke();

  /**
   * ④ **沥金缘**（只有已铺的朱砂格有）—— 设计稿 `.mp.m-walked`：
   *
   * ```text
   * 0 0 0 1px rgba(201,155,63,.35)     ← 1px 金线，压在最外沿
   * 0 0 12px rgba(201,155,63,.14)      ← 一圈极淡的外辉
   * ```
   *
   * 这条金线是"这条路已经描过"的**第二重信号**：朱砂底说的是"这一格铺过了"，
   * 金缘说的是"沥金线从这里走过"。少了它，已铺格只是一块红砖 ——
   * 而路线本身是沥金的，格子的边不跟上，线和块就接不上。
   *
   * 宽度取 `s * 0.015`（≈ 1.5px @ 101 格），比磕边暗线细一半：
   * 金是"压"上去的一层，不是描边，粗了就变成相框。
   *
   * `vi === 2` 正是朱砂档（`pasteFor` 现在恒返回 2）。
   */
  if (vi === 2) {
    traceShape(c, 0, 0, s, shape);
    c.strokeStyle = 'rgba(201,155,63,0.35)';
    c.lineWidth = Math.max(1, s * 0.015);
    c.stroke();
    // 外辉：贴片有 pad 余量，画在轮廓外一点点才不会被裁
    traceShape(c, 0, 0, s, shape);
    c.strokeStyle = 'rgba(201,155,63,0.14)';
    c.lineWidth = Math.max(2, s * 0.030);
    c.stroke();
  }

  sprites.set(key, cv);
  return cv;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  vi: number,
  shape: number,
): void {
  const pad = Math.ceil(s * 0.24);
  ctx.drawImage(pieceSprite(s, vi, shape), x - pad, y - pad, s + pad * 2, s + pad * 2);
}

/**
 * 已铺格的颜色 —— **一律朱砂**（`PASTES[2]`）。
 *
 * ## 为什么不再三色轮换
 *
 * 早先这里是 `1 + (gx*2+gy) % 3`，在石绿 / 朱砂 / 石青之间轮换，
 * 理由是"三种矿彩明度带一样，整盘读作错落的马赛克"。
 *
 * 但设计稿把这件事说得很死：
 *
 * > **已铺 · 朱砂格** —— 沥金线走过，**整格罩一层朱砂** + 沥金缘 1px
 * > ——「这条路已经描过」。
 *
 * 盘面速览里唯一走过的格也是 `red m-walked`，全稿没有第二种已铺色。
 * 这套盘的叙事是「空盘是一面刻满纹样的旧墙，**走一路铺一路朱砂**」，
 * 不是"走一路刷成彩虹"。三色轮换会让路线看起来像**装饰性马赛克**，
 * 玩家读不出"这条就是我刚走过的那条"——而那正是这一屏唯一要传达的事。
 *
 * 保留 `gx` / `gy` 两个参数是为了签名稳定（调用点、测试都在用），
 * 将来若要按区域微调明度还用得上。
 */
function pasteFor(gx: number, gy: number): number {
  void gx;
  void gy;
  return 2;
}

// ────────────────────────────── 赭石岩块 ──────────────────────────────

/**
 * 石障：一块赭石。
 *
 * 逐条照设计稿的 `stone` 图标：一个八边形 + 三个面 + 三道层理。
 * 它在这套里的作用不是"挡路"，是**反衬矿彩** —— 全盘唯一没有颜料的东西，
 * 让旁边那些绿红蓝看起来真的是"磨出来的色"。
 */
function drawRock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  idx: number,
): void {
  const u = s * 0.5;
  // 八个角各错一点。石头没有一条边是准的 —— 正八边形读出来就是"磨过的宝石"
  const base: ReadonlyArray<readonly [number, number]> = [
    [-0.708, 0.250], [-0.542, -0.458], [-0.042, -0.708], [0.625, -0.500],
    [0.792, 0.125], [0.458, 0.708], [-0.375, 0.750], [-0.708, 0.417],
  ];
  const body: Array<[number, number]> = base.map(([a, b], i) => {
    const k = 1 + (hash(idx * 6.7 + i * 2.1) - 0.5) * 0.055;
    const jx = (hash(idx * 3.3 + i * 5.9) - 0.5) * 0.022;
    const jy = (hash(idx * 8.1 + i * 4.7) - 0.5) * 0.022;
    return [cx + (a * k + jx) * u, cy + (b * k + jy) * u] as [number, number];
  });

  const poly = (pts: ReadonlyArray<readonly [number, number]>) => {
    ctx.beginPath();
    ctx.moveTo(cx + pts[0][0] * u, cy + pts[0][1] * u);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0] * u, cy + pts[i][1] * u);
    ctx.closePath();
  };
  const traceBody = () => {
    ctx.beginPath();
    ctx.moveTo(body[0][0], body[0][1]);
    for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
    ctx.closePath();
  };

  // ① 接触影：石头是**压在**墙上的，影要重、要低。第一版那圈 0.26 太轻，
  //    石头看起来是浮着的，像一颗摆件
  ctx.save();
  const sh = ctx.createRadialGradient(cx, cy + u * 0.60, u * 0.10, cx, cy + u * 0.60, u * 1.02);
  sh.addColorStop(0, 'rgba(84,50,18,0.40)');
  sh.addColorStop(0.72, 'rgba(84,50,18,0.20)');
  sh.addColorStop(1, 'rgba(84,50,18,0)');
  ctx.beginPath();
  ctx.ellipse(cx, cy + u * 0.60, u * 1.02, u * 0.34, 0, 0, TAU);
  ctx.fillStyle = sh;
  ctx.fill();
  ctx.restore();

  // ② 石体 + 三个面：全部裁在轮廓里，所以面与轮廓错开也不会溢出。
  //    三个面的明度差只有 0.16 —— 差到 0.3 就变成切面，像宝石
  ctx.save();
  traceBody();
  ctx.clip();

  const g = ctx.createLinearGradient(cx - u * 0.7, cy - u * 0.8, cx + u * 0.8, cy + u * 0.8);
  g.addColorStop(0, '#AE7350');
  g.addColorStop(0.45, '#A2664A');
  g.addColorStop(1, '#93603F');
  ctx.fillStyle = g;
  ctx.fillRect(cx - u * 1.2, cy - u * 1.2, u * 2.4, u * 2.4);

  // 三个面照设计稿给**实色**：左上受光、右上背光、底面最暗。
  // 这一版之前把它们做成半透明叠加（怕"宝石感"），结果是石头没有面、
  // 只剩一团赭黄 —— 石头之所以是石头，恰恰因为它是被劈开的。
  //
  // 但 0.72 而不是 1：87px 的格上，纯色面 + 硬边会读成"纸折的盒子"；
  // 留三成底子透上来，三个面才是**同一块石头上的**三个面
  const faces: Array<[ReadonlyArray<readonly [number, number]>, string]> = [
    [[[-0.542, -0.458], [-0.042, -0.708], [0.125, -0.208], [-0.292, 0.042]], 'rgba(192,128,85,0.62)'],
    [[[0.125, -0.208], [0.625, -0.500], [0.792, 0.125], [0.375, 0.250]], 'rgba(138,82,54,0.52)'],
    [[[-0.708, 0.250], [-0.375, 0.750], [0.458, 0.708], [0.375, 0.250]], 'rgba(107,69,38,0.46)'],
  ];
  for (const [pts, color] of faces) {
    poly(pts);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // 统一光：整块石头再过一道 148° 的斜光，再压一层薄薄的暗。
  //
  // 设计稿在三个面之上还盖了一层 32% 的黑色噪点（`fill="#000" filter=url(#gr)`）——
  // 那一层才是"三个面属于同一块石头"的原因。少了它，三个面各自为政，
  // 87px 的格上读出来是"三个色块拼成的折纸"
  const lit = ctx.createLinearGradient(cx - u * 0.8, cy - u * 0.9, cx + u * 0.9, cy + u * 0.9);
  lit.addColorStop(0, 'rgba(255,232,200,0.04)');
  lit.addColorStop(0.5, 'rgba(48,24,6,0.06)');
  lit.addColorStop(1, 'rgba(48,24,6,0.20)');
  ctx.fillStyle = lit;
  ctx.fillRect(cx - u * 1.2, cy - u * 1.2, u * 2.4, u * 2.4);
  ctx.fillStyle = 'rgba(40,22,8,0.08)';
  ctx.fillRect(cx - u * 1.2, cy - u * 1.2, u * 2.4, u * 2.4);

  sandGrain(ctx, cx - u, cy - u, u * 2, u * 2, 0.9);
  sandGrain(ctx, cx - u, cy - u, u * 2, u * 2, 0.5, 2.3);

  // ③ 层理：三道，照设计稿的坐标（14,22→30,18 / 16,31→32,27 / 20,36→31,33.5）。
  // 上两道重、最下一道轻 —— 石头是"一层层压出来的"，越往下越糊
  const strata: Array<[readonly [number, number], readonly [number, number], number, number]> = [
    [[14, 22], [30, 18], 0.55, 1.4],
    [[16, 31], [32, 27], 0.42, 1.2],
    [[20, 36], [31, 33.5], 0.35, 1.0],
  ];
  ctx.lineCap = 'round';
  for (const [a, b, alpha, w] of strata) {
    const [ax, ay] = V48(a[0], a[1]);
    const [bx, by] = V48(b[0], b[1]);
    ctx.beginPath();
    ctx.moveTo(cx + ax * u, cy + ay * u);
    ctx.lineTo(cx + bx * u, cy + by * u);
    ctx.strokeStyle = `rgba(60,35,10,${alpha})`;
    ctx.lineWidth = Math.max(1, (w / 24) * u);
    ctx.stroke();
  }

  // 崩口：石头上零星的几个小凹坑
  for (let i = 0; i < 5; i++) {
    const a = hash(idx * 9.3 + i * 1.9) * TAU;
    const r = u * (0.24 + hash(idx * 5.1 + i * 3.3) * 0.60);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(0.6, s * 0.010), 0, TAU);
    ctx.fillStyle = 'rgba(48,26,8,0.26)';
    ctx.fill();
  }

  // ④ 受光棱：光从左上打来，只提最上面那一段，且很轻
  ctx.beginPath();
  ctx.moveTo(body[7][0], body[7][1]);
  ctx.lineTo(body[0][0], body[0][1]);
  ctx.lineTo(body[1][0], body[1][1]);
  ctx.lineTo(body[2][0], body[2][1]);
  ctx.strokeStyle = 'rgba(255,226,186,0.16)';
  ctx.lineWidth = Math.max(1.2, s * 0.013);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // ⑤ 轮廓：比色块的磕边稍重一档，因为石头比颜料厚
  traceBody();
  ctx.strokeStyle = 'rgba(58,30,10,0.46)';
  ctx.lineWidth = Math.max(1.1, s * 0.012);
  ctx.stroke();

  void idx;
}

// ────────────────────────────── 格 ──────────────────────────────

function drawCell(g: CellGeom): void {
  const { ctx, cell, x, y, walk, type, gx, gy, idx } = g;
  // 槽位 → 色块：内缩半个间距
  const inset = BOARD_GAP / 2;
  const s = cell - inset * 2;
  // 轮廓变体按格号轮：相邻两格的手切口不一样，整盘才像"一块块切出来的"
  const shape = idx % SHAPES.length;

  if (type === CoverCell.BLOCK) {
    /**
     * 石障 = **赭石格面 + 一块八边形岩**，两层。
     *
     * 设计稿 `.mp.m-stone` 给的是格面：
     * ```text
     * linear-gradient(148deg, #A2664A, #8A5236 55%, #6B4526) + 颗粒 0.5
     * ```
     * 然后才在上面叠 `ICONS.stone` 那一块八边形岩。
     *
     * 早先这里只画了石头本体、没有格面底 —— 结果那块岩直接浮在墙皮上，
     * 周围没有"这一格被占住"的边界，玩家读到的是"墙上贴了一块石头贴纸"，
     * 而不是"这一格是块挡路的岩"。格面底也在提供**深度**：
     * 石头比格面更暗、更靠前，两层一起才有"从墙里凸出来"的立体。
     *
     * 用的是 `PASTES` 里新加的赭石档（`STONE` 常量），不走六色轮换 ——
     * 石障的色和它上面那块岩必须同源。
     */
    drawPiece(ctx, x + inset, y + inset, s, STONE_PASTE, shape);
    drawRock(ctx, x + inset + s / 2, y + inset + s / 2, s * 0.94, idx);
    return;
  }
  if (type === CoverCell.ICE) {
    // 冰砖：石青冷块。踩过之后暗回来（不然"走过"这件事在冰上读不出来）
    drawPiece(ctx, x + inset, y + inset, s, walk ? 5 : 4, shape);
    return;
  }
  if (type === CoverCell.PORTAL) {
    // 传送门：**深靛漩底**（PASTES[6]），不参与六色轮换。
    // 它已经是"走到了这一格"，不该再叠一层"已铺"的颜料 —— 那会把漩底盖掉。
    drawPiece(ctx, x + inset, y + inset, s, 6, shape);
    return;
  }
  /**
   * 普通格 / 机制格分两档底色：
   *
   * - 普通格（BRICK）：未铺 = `PASTES[0]` 石绿；已铺 = `PASTES[2]` 朱砂
   * - 机制格（起点/终点/单向/星屑/钥匙/门）：底色是 `PASTES[1]` **淡土黄**
   *
   * ## 为什么机制格要单独一档（2026-11-19 闸门抓到）
   *
   * 设计稿里这些状态写的是 `.mp.pale`（`#E8D6B0` 淡土黄），
   * 机制标压在这层"纸面"上；而裸 `.mp`（石绿）是没人动过的墙。
   * 两者是「已经贴了标记的纸」vs「一片空墙」的区别。
   *
   * 早先一律用 `PASTES[0]`，导致起点/终点/钥匙/门全是石绿 ——
   * 与基线比，这几项均值 Δ 从 49 一路涨到 89（越修越差，因为底色跑偏了）。
   */
  const MECH_CELLS = new Set<number>([
    CoverCell.START, CoverCell.END, CoverCell.ONEWAY,
    CoverCell.SHARD, CoverCell.KEY, CoverCell.GATE,
  ]);
  const baseIdx = walk ? pasteFor(gx, gy) : (MECH_CELLS.has(type) ? 1 : 0);
  drawPiece(ctx, x + inset, y + inset, s, baseIdx, shape);

  // 六字纹样：**只落普通格**（未铺 / 已铺都画），机制格一律净面。
  //
  // 这是使用说明「格纹纪律」那条：
  // 「非普通格（起点/终点/起手按下/线头/单向/星屑/钥匙/门/传送门/石障等
  //   带机制标的格）底部不叠任何装饰纹 —— 六字纹样不进机制格，
  //   机制标是格内唯一读点；纹样叠在标上会糊住标记」。
  //
  // 早先这里是 `!walk && type === BRICK` —— 把**已铺格**排掉了，
  // 而设计稿「棋面纹样」明写「格面刻纹（**已铺格内**）」：
  // 刻纹本来是"这块墙皮上还留着旧刻痕"的意思，铺过色之后它才更像"旧刻痕"，
  // 未铺时反而只是一块空墙。所以两态都要画，靠墨色区分（见 `drawEngrave`）。
  if (type === CoverCell.BRICK) {
    drawEngrave(ctx, x + inset + s / 2, y + inset + s / 2, s, gx, gy, walk);
  }
}

// ────────────────────────────── 沥粉堆金 ──────────────────────────────

function strokeLine(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  width: number,
  color: string,
  dx = 0,
  dy = 0,
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + dx, pts[0].y + dy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y + dy);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * 沥粉堆金。
 *
 * 这一套的路径和天青的"光迹"是两个东西：光迹是**浮在釉上的一道光**
 * （细、亮、无影），沥粉是**从墙上堆起来的一条泥线**（粗、钝、有影）。
 * 所以画序是「影在下、金在中、光在上」——
 *
 * 1. 远光：凸线在墙面上散开的一层暖；
 * 2. 下沿影：往**右下**错 `0.032 格` 的一记暗金 —— 这一道就是"厚度"的全部。
 *    往正下错是错不了的：竖直段上它整根被金体盖住，只有端头会露馅；
 * 3. 金体：`0.126 格` 宽（比天青的光迹粗一倍多，泥线本来就是钝的）；
 * 4. 上沿受光：`-0.028 格` 的一道光，偏心之后在竖直段上落在左侧；
 * 5. 高光芯：`-0.040 格` 的一根细亮线；
 * 6. 线身颗粒：金泥里没磨开的那几粒砂。
 */
/**
 * 沥粉堆金的光迹。
 *
 * ## 两条时序（设计稿 TOKEN 表「连径 420ms · 沥线」）
 *
 * 1. **高光线滞后 60ms 跟上** —— 天青是 80，鸣沙是 60。差的这 20ms 是材质：
 *    瓷上的描金是"笔尖再压一遍"，土壁上的沥粉是"同一笔往前推"，
 *    所以贴得更紧。
 * 2. **辉光在 30% 处脉冲至 0.85 再衰减到 0.45** —— 天青是 0.8/0.42，
 *    鸣沙略高一点：土壁比瓷面吃光，辉光要更亮才看得见。
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  cell: number,
  now: number,
  grow = 1,
): void {
  if (pts.length < 2) return;

  // 辉光：30% 处到顶 0.85，之后落到 0.45 并保持（不是恒亮 ——
  // 恒亮的话这条线会像一根灯管）
  const glowP =
    grow < 0.3
      ? (grow / 0.3) * 0.85
      : 0.85 - ((grow - 0.3) / 0.7) * (0.85 - 0.45);
  strokeLine(ctx, pts, cell * 0.30, `rgba(190,132,50,${(0.13 * glowP) / 0.85})`);
  // 影往**右下**错，不是往下错。往下错在竖直段上会被金体整根盖住 ——
  // 第一版就是这样，一条竖线看上去是平的，只有两个端头露了馅。
  // 影要**宽而淡**：窄而深的影是"圆柱的明暗交界"，宽而淡才是"压在墙上的影"
  strokeLine(ctx, pts, cell * 0.152, 'rgba(112,66,22,0.26)', cell * 0.030, cell * 0.030);
  strokeLine(ctx, pts, cell * 0.126, K.gold);
  // 受光：**不再压白芯**。一根从 0.62 到 0.92 不透明的白色细线，在浅土壁上
  // 读出来是镀铬的管子 —— 金属的反光是一条硬白线，泥金不会。
  // 现在只留一道偏左上的暖金，靠线身的颗粒去说"没磨开的砂"
  // 受光：**滞后 60ms** 跟上主线。换算成"生长进度"要看这一笔总长多久
  // （一格 ≈ 1.75 格宽毫秒，`motion.grow`），所以 60ms ≈ 60/(1.75×cell)。
  const lag = Math.min(0.5, 60 / Math.max(120, cell * 1.75));
  const hiT = Math.max(0, grow - lag);
  if (hiT > 0.002) {
    const hiPts = truncatePts(pts, hiT);
    if (hiPts.length >= 2) {
      ctx.save();
      ctx.globalAlpha *= 0.55;
      strokeLine(ctx, hiPts, cell * 0.044, K.goldHi, -cell * 0.024, -cell * 0.024);
      ctx.restore();
    }
  }

  // 线身颗粒：沿每一段撒，位置由段号定（每帧同值）
  const step = cell * 0.13;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const jx = (hash(i * 7.1 + k * 3.3) - 0.5) * cell * 0.05;
      const jy = (hash(i * 5.3 + k * 9.7) - 0.5) * cell * 0.05;
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * t + jx, a.y + (b.y - a.y) * t + jy, Math.max(0.7, cell * 0.011), 0, TAU);
      // 三粒一明两暗：亮的那粒是"金泥里没磨开的金砂"，暗的是凹处。
      // 只有暗粒时，线身读起来是脏的；一明两暗才是"粗糙的金属"
      ctx.fillStyle = k % 3 === 0 ? 'rgba(255,240,200,0.22)' : 'rgba(110,68,22,0.30)';
      ctx.fill();
    }
  }

  // 起点那一粒（设计稿 SVG 两端的 `circle r=5`）
  const dot = Math.max(2.2, cell * 0.048);
  ctx.beginPath();
  ctx.arc(pts[0].x, pts[0].y, dot, 0, TAU);
  const dg = ctx.createRadialGradient(pts[0].x - dot * 0.3, pts[0].y - dot * 0.3, 0, pts[0].x, pts[0].y, dot);
  dg.addColorStop(0, '#F4D68C');
  dg.addColorStop(1, '#A8781F');
  ctx.fillStyle = dg;
  ctx.fill();

  // 线头：沥金笔停处那一小汪金，微微呼吸
  const head = pts[pts.length - 1];
  const pulse = 0.72 + 0.28 * Math.sin(now / 620);
  const hg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, cell * 0.26);
  hg.addColorStop(0, `rgba(255,240,206,${0.34 * pulse})`);
  hg.addColorStop(0.5, `rgba(201,155,63,${0.14 * pulse})`);
  hg.addColorStop(1, 'rgba(201,155,63,0)');
  ctx.beginPath();
  ctx.arc(head.x, head.y, cell * 0.26, 0, TAU);
  ctx.fillStyle = hg;
  ctx.fill();
}

// ────────────────────────── 抵达 · 爆闪 ──────────────────────────

/**
 * 抵达终点的爆闪（设计稿「抵达 · 爆闪 / ARRIVE BURST」）。
 *
 * ## 和天青是同一个动作、两种材质
 *
 * 形状完全一样：**八芒射线 + 外实环 + 内虚环 + 芯点**。
 * 差别只在两处，而且都由"这一套是什么做的"决定：
 *
 * 1. **配色**：天青是鎏金 `#F2DCA8`/`#C9A45C`，鸣沙是沥金 `#F0C868`/`#C99B3F`
 *    （土壁上没有那种冷调的金，金色在这里是暖的、偏橙）；
 * 2. **外环是"干笔"的**：设计稿明写「沥金外实环（**干笔**）」——
 *    土壁上的线从来不是完美的圆，是一笔刷过去的、中间有断口。
 *    所以这里用 `dash` 给环留三处缺口，天青那边是实线。
 *
 * ## 时长
 *
 * 420ms（和天青同一档，设计稿两套都是"全盘最亮的一帧，之后归于安静"）。
 */
function drawArriveBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  elapsed: number,
): void {
  const MS = 420;
  if (elapsed < 0 || elapsed >= MS) return;
  const t = elapsed / MS;
  const k = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
  const ease = k * k;
  const half = size / 2;
  // 和 `endpoint` 的终点环同一档（半径 8.6 单位 = 0.31 格）
  const u = (size * 0.31) / 8.6 / 12;

  ctx.save();
  ctx.translate(cx, cy);

  // ① 沥金辉光
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, half * 1.15);
  glow.addColorStop(0, `rgba(240,200,104,${0.50 * k})`);
  glow.addColorStop(0.42, `rgba(201,155,63,${0.20 * k})`);
  glow.addColorStop(1, 'rgba(201,155,63,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, half * 1.15, 0, TAU);
  ctx.fill();

  // ② 八芒射线：贴环的短芒（r 7.8→11），芒尖落在格内
  const RAY_IN = half * 0.62;
  const RAY_OUT = half * (0.66 + 0.26 * Math.min(1, k * 2.2));
  ctx.strokeStyle = `rgba(240,200,104,${0.92 * ease})`;
  ctx.lineWidth = Math.max(1, size * 0.028);
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = Math.cos(a);
    const si = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(c * RAY_IN, si * RAY_IN);
    ctx.lineTo(c * RAY_OUT, si * RAY_OUT);
    ctx.stroke();
  }

  // ③ 外实环：**干笔**（三处断口）。土壁上的圆从来不是完美的圆
  ctx.save();
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([half * 0.30, half * 0.055]);
  ctx.beginPath();
  ctx.arc(0, 0, 8.6 * u, 0, TAU);
  ctx.strokeStyle = `rgba(240,200,104,${0.85 * k})`;
  ctx.lineWidth = Math.max(1.6, size * 0.032);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// ────────────────────────────── 主题 ──────────────────────────────

/** 土壁上的款：赭石钝笔 + 朱砂面。 */
const PAL_GROUND: GlyphPalette = {
  ink: '#3A2410', accent: '#B5472E', chip: '#E9B49C', deep: 'rgba(90,28,12,0.85)',
};
/** 单向箭：一笔朱砂。勾线比磕边细一半（设计稿 1.1 / 48），粗了就成剪纸。 */
const PAL_ARROW: GlyphPalette = {
  ink: '#3A2410', accent: '#B5472E', chip: '#E3D2B4',
  deep: 'rgba(90,30,15,0.55)', edgeW: 0.5,
};
/** 星屑：贴金箔的星，全盘最亮的一点金。 */
const PAL_STAR: GlyphPalette = {
  ink: '#3A2410', accent: '#D9A745', chip: '#FFF0C8',
  deep: 'rgba(120,80,20,0.50)', edgeW: 0.45,
};
/**
 * 钥匙：**土红** `#9C4A2F`（`MARKS.key` / `ICONS.key` 都是这个色）。
 *
 * 这里原来写的是沥金 `#C99B3F` —— 金和土红在土黄格面上都"偏暖"，
 * 乍看差不多，实测渲出来钥匙几乎融进格面（一个淡黄糊块）。
 * 设计稿「机关格」那条 hint 写得很明确：
 * 「钥匙走**土红**、门走赭石+沥金、传送门走石绿」。
 * 土红是这一族里唯一的偏紫红，它才是钥匙的身份色。
 */
const PAL_KEY: GlyphPalette = {
  ink: '#5C2A16', accent: '#9C4A2F', chip: '#E3D2B4', deep: 'rgba(70,30,12,0.85)',
};
/** 门：赭石。 */
const PAL_GATE: GlyphPalette = {
  ink: '#3A2410', accent: '#A0552F', chip: '#E8C6A8', deep: 'rgba(74,30,12,0.85)',
};
/**
 * 门 · **开**：两片门板是赭石，中间那块才是沥金暖光。
 *
 * 一枚图标里两种材质，`accent` 只能给一种：
 * - `deep` = 两片门板（赭石，和闭门同一材质，只是受光更多）；
 * - `accent` = 门内涌出的暖金。
 *
 * 都用 accent 的话，门板会被染成和光一样的橙，整枚糊成一块"帐篷"
 * （实测就是这样：读作"一个梯形"，看不出是两扇门）。
 */
const PAL_GATE_OPEN: GlyphPalette = {
  ink: 'rgba(90,50,16,0.55)',
  accent: 'rgba(226,181,88,0.55)',
  chip: 'rgba(246,231,184,0.92)',
  deep: '#4E3018',
  edgeW: 0.6,
};
/**
 * 传送门：**石青环 + 沥金芯**（设计稿 `MARKS['portal-a']`）。
 *
 * 不是石绿。使用说明「常见误用」明确写了：
 * 「传送门做成石绿 → 和石绿格融为一体（此病已治：深靛漩底 + 石青环 + 沥金芯）」。
 *
 * 三层色各有分工：
 * - `deep`（深靛）= 环的暗边，压在深靛底上仍能看出环的厚度；
 * - `accent`（石青 `#7FA8C4`）= 主环；
 * - `chip`（沥金 `#F0C868`）= 芯点，全盘唯一一个金色小点。
 *
 * `lineW` 0.55：环是闭合的，钝笔 0.26 会把双环糊成一团。
 */
const PAL_PORTAL: GlyphPalette = {
  ink: '#22334F', accent: '#7FA8C4', chip: '#F0C868',
  deep: 'rgba(18,28,46,0.85)', lineW: 0.55,
};
/**
 * 冰砖：石青六边晶。
 *
 * 面是**实填**的石青 —— 上一版把它画成"只刻线"（怕和格子的蓝撞），
 * 结果是一圈白线糊在蓝块上，读成字母「N」。参考设计稿：它是一整块
 * 比周围深的青玉，靠顶面/右侧面和三道分水线说清"这是晶体"。
 */
const PAL_ICE: GlyphPalette = {
  ink: '#EAF4FF', accent: '#4A6E8A', chip: '#EAF4FF',
  deep: 'rgba(20,45,65,0.55)', edgeW: 0.6,
};

/** 印文用的衬线（与 HUD 同族；复制一份，别让渲染层反向依赖 UI）。 */
const SEAL_FONT = '"Songti SC", "STSong", SimSun, Georgia, serif';

/**
 * 通关 · 石章落壁（设计稿 `.anim-seal` + `wallShake`）。
 * 和黏土的圆朱印是两个动作：
 * 圆印是"显影"（缩放 1.7→0.96→1），石章是**自由落体**（-70 → +3 → -3 → 0）。
 * 从高处砸下来的东西会**回弹一次**再停 —— 全主题只有这一处允许回弹。
 *
 * 320ms、石顿缓动 `(.34,1.56,.64,1)`：那个 1.56 就是过冲（先越过再弹回）。
 */
function drawSealStamp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  elapsed: number,
): void {
  if (elapsed < 0) return;
  // `size` 进来的是"盘面宽度的 25%"（圆朱印的直径）。方石章要小一号：
  // 设计稿印 64 / 棋子 54 = 1.19，按这个比例，方印的边长是格的 1.2 倍
  size *= 0.66;
  const u = Math.min(1, elapsed / 320);

  let dy: number;
  let rot: number;
  let sc: number;
  let alpha: number;
  /**
   * ## 落定后**不回正**，停在 −3°
   *
   * 设计稿 `sealDrop` 的 keyframes 是 `-8° → -2° → -1° → 0°`，最后一帧
   * 把印摆正了，只有印文（`.seal .chao`）单独歪 2°。
   *
   * 但结算页那枚印是**整个章歪 3°**（`hud.ts` 的 `ctx.rotate(-3°)` 包住
   * 印盒和印文一起），两处并排看就是"结算页歪、通关动效正" ——
   * 同一个"过"，一个像手盖的、一个像打印的。
   *
   * 现在把终点挪到 −3°：轨迹整体保留原来的形状（`-8 → -5 → -4 → -3`），
   * 只是不再收回到 0。下落时照样从斜到接近正，但**始终留着那道歪**，
   * 和结算页完全同角度。
   */
  if (u < 0.55) {
    const k = u / 0.55;
    // 前 55% 落完全程：三次方缓入 → 越接近墙越快
    const e = Math.pow(k, 2.2);
    dy = (-1.094 + 1.141 * e) * size;
    rot = -8 + 3 * e;
    sc = 1.15 - 0.19 * e;
    alpha = Math.min(1, k * 3.2);
  } else if (u < 0.72) {
    const k = (u - 0.55) / 0.17;
    dy = (0.047 - 0.094 * k) * size;
    rot = -5 + 1 * k;
    sc = 0.96 + 0.06 * k;
    alpha = 1;
  } else {
    const k = (u - 0.72) / 0.28;
    dy = (-0.047 + 0.047 * k) * size;
    rot = -4 + 1 * k;
    sc = 1.02 - 0.02 * k;
    alpha = 1;
  }

  const half = (size / 2) * sc;
  const r = half * 0.31; // 设计稿 10 / 64

  ctx.save();
  ctx.globalAlpha = alpha;

  // 接触影：土墙上没有黑影子。印还没落定时不给影（在半空里有影就假了）
  if (dy > -size * 0.2) {
    const sh = ctx.createRadialGradient(cx, cy + half * 0.9, 0, cx, cy + half * 0.9, half * 1.45);
    sh.addColorStop(0, 'rgba(88,40,16,0.34)');
    sh.addColorStop(0.6, 'rgba(88,40,16,0.13)');
    sh.addColorStop(1, 'rgba(88,40,16,0)');
    ctx.beginPath();
    ctx.ellipse(cx, cy + half * 0.9, half * 1.45, half * 0.42, 0, 0, TAU);
    ctx.fillStyle = sh;
    ctx.fill();
  }

  ctx.translate(cx, cy + dy);
  ctx.rotate((rot * Math.PI) / 180);

  // 印面：155° 三停（设计稿 `.seal` 的 linear-gradient）
  const g = ctx.createLinearGradient(-half, -half, half * 0.62, half);
  g.addColorStop(0, '#C24A30');
  g.addColorStop(0.55, '#A93A24');
  g.addColorStop(1, '#8F3220');
  ctx.beginPath();
  roundRect(ctx, -half, -half, half * 2, half * 2, r);
  ctx.fillStyle = g;
  ctx.fill();

  // 印泥的厚：上沿一道受光、下沿吃掉。走 clip，不描边 ——
  // 一圈亮边会把方印封成一个凸起的按钮
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, -half, -half, half * 2, half * 2, r);
  ctx.clip();
  const hi = ctx.createLinearGradient(0, -half, 0, -half * 0.45);
  hi.addColorStop(0, 'rgba(255,220,190,0.35)');
  hi.addColorStop(1, 'rgba(255,220,190,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(-half, -half, half * 2, half * 0.55);
  const lo = ctx.createLinearGradient(0, half * 0.4, 0, half);
  lo.addColorStop(0, 'rgba(70,25,8,0)');
  lo.addColorStop(1, 'rgba(70,25,8,0.40)');
  ctx.fillStyle = lo;
  ctx.fillRect(-half, half * 0.4, half * 2, half * 0.6);
  // 石章的斑：朱砂不是平涂的
  for (let i = 0; i < 9; i++) {
    const a = hash(i * 7.7) * TAU;
    const rr = half * (0.2 + hash(i * 3.1) * 0.78);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, half * (0.02 + hash(i * 5.3) * 0.05), 0, TAU);
    ctx.fillStyle = `rgba(70,20,8,${0.10 + hash(i * 9.2) * 0.12})`;
    ctx.fill();
  }
  ctx.restore();

  /**
   * 印文「过」：衬线 900。
   *
   * **这里不再单独旋转**。设计稿给印文加了 `.chao { rotate(-2deg) }`，
   * 那是在"印盒回正"的前提下做的补偿 —— 盒子正、字微歪，读作手盖的印。
   *
   * 现在印盒本身就停在 −3°，字再歪 −2° 就是**绝对 −5°**，一眼能看出"字在盒里
   * 是歪着放的"，像排版错了。所以让字跟着盒走，整体就是 −3°，
   * 和结算页那枚印（`ctx.rotate(-3°)` 包住盒和字）完全同角度。
   */
  const fs = size * 0.47;
  ctx.save();
  ctx.font = `900 ${fs}px ${SEAL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,240,225,0.92)';
  ctx.fillText('过', 0, fs * 0.04);
  ctx.restore();
  ctx.restore();
}

export const MINGSHA_THEME = composeTheme({
  id: 'mingsha',
  name: '鸣沙丹青',
  tagline: '千年壁上的矿物色',
  unlock: { type: 'milestone', value: 60 },
  chrome: CHROME,
  legend: LEGEND,
  legendMarks: LEGEND_MARKS,
  swatches: SWATCHES,
  // 切页是"墙被抹开"，不是"两片玻璃叠化"（设计稿 480ms · 沥线 · 禁 opacity）
  wipe: { from: '#B99B6C', to: '#8B6A43', edge: 'rgba(40,22,8,0.40)' },
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    // 进场时砖块要从盘沿上方掉进来 —— 裁到卡片上，砖块才不会飘在盘外的墙上
    clip(ctx, layout) {
      const c = cardOf(layout);
      framePath(ctx, c.x, c.y, c.w, c.h);
      ctx.clip();
    },
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(190,132,50,0.20)', core: K.goldHi, hot: K.goldPale },
    hintColor: K.goldLit,

    /**
     * 按压：设计稿 `pressDown` 220ms 压到 0.93、`ringOut` 380ms 从 0.6 长到 1.9。
     *
     * 和天青的差别不在数字而在**语义**：天青的环是瓷面上的一圈水痕，
     * 贴着棋子散开就停；这一圈是掐起来的**土**，会一直扬到隔壁格上。
     */
    press: {
      down: 120,
      ring: 380,
      from: 0.6,
      to: 1.9,
      scale: 0.93,
      color: 'rgba(185,120,45,0.75)',
      width: 0.046,
    },

    glyph: {
      style: 'mineral',
      pal: PAL_GROUND,
      palFor: (type, state) => {
        if (type === CoverCell.ONEWAY) return PAL_ARROW;
        if (type === CoverCell.SHARD) return PAL_STAR;
        if (type === CoverCell.KEY) return PAL_KEY;
        if (type === CoverCell.GATE) return state?.wasOpen ? PAL_GATE_OPEN : PAL_GATE;
        if (type === CoverCell.PORTAL) return PAL_PORTAL;
        if (type === CoverCell.ICE) return PAL_ICE;
        return PAL_GROUND;
      },
      // 不要底盘：设计稿的机制是直接"画在壁面上的"，一个浅圆底会变成 64 个白点
      back: '',
      backEdge: 'transparent',
      backR: 0.26,
      // **36/64 = 0.5625** —— 设计稿「伍·使用说明」写明的格内标尺寸：
      // 「24px viewBox / 格内渲染 36px」。棋格稿面是 64px，所以比例是 0.5625。
      // 早先给 0.48（凭"矿彩重、图标别压过色块"的感觉），偏小一档 ——
      // 28px 灰度测试能过，但正盘上读起来像"格子里的一枚小痣"。
      scale: 36 / 64,
      // 五角星顶满画布，缩到 0.9 才和钥匙/门同重
      scaleFor: (type: number) => (type === CoverCell.SHARD ? 0.9 : 1),
      // 石障由 `cell` 画成一整块带三个面的石头了，别再叠一层线稿；
      // 起终点由 `endpoint` 整块接管（那里是藻井心和朱印，不是"款"）
      /**
       * 不画格内标的四类格。**冰砖是第四类** —— 这一条容易漏，因为它长得像"有标"。
       *
       * 设计稿的两个地方都说明冰砖**没有格心图标**：
       *
       * 1. `MARKS`（24 视图，格内标）里**根本没有 `ice` 这个键** ——
       *    十个键是 start/end/trail/arrow/key/door/door-open/portal-a/portal-b/arrive。
       *    冰不在其中，因为它是「地形」不是「标」。
       * 2. 盘面格态卡的调用是 `makeMP('m-ice')`，**没有传 `mark` 参数**；
       *    上面那个六边晶只出现在 `ICONS`（48 视图图鉴）里，给玩家"看说明书"用。
       *
       * 使用说明也把这件事归进「材质纹理例外」：
       * 「矿物颗粒、**冰砖的石青晶面**、传送门的深靛漩底是材质本体，不算装饰纹」
       * —— 也就是说冰砖那一整格**就是**材质本身（石青渐变 + 颗粒），
       * 格心不需要再放一件读点。
       *
       * 早先这里把 `ICONS.ice` 的六边晶当格内标贴了上去，于是石青块上
       * 多了一个深色六边形 —— 既不是设计稿的样子，又和"机制格只有一件读点"
       * 冲突（冰砖的读点是**整块比周围亮**，不是那枚晶）。
       */
      skip: [CoverCell.BLOCK, CoverCell.START, CoverCell.END, CoverCell.ICE],
      shapes: MS_SHAPES,
      decor: MS_DECOR,
      // 「格内永远不落字」：星阶靠星数、传送门靠实虚 —— 都不写数字角标
      noCornerNumber: true,
/**
 * 状态变体：设计稿的 13 式里有 5 组是**同一机制的两个/三个形态**，
 * 它们不能靠"按类型整条替换"区分（类型整关不变），只能按**运行时状态**选。
 *
 * | 设计稿 | 怎么选中 | 
 * |---|---|---|
 * | `star1` / `star2` / `star3` | `cellGroup` 就是第几颗星（1/2/3 阶） |
 * | `door` / `door-open` | `keysHeld` 里有对应分组 = 已拿到钥匙 |
 * | `portal-a` / `portal-b` | 同组里 `idx` 最小的是入口（A），另一个是出口（B） |
 *
 * 三条都不是"看这一格自己的字段"，而是看**整个盘面**：
 * 星阶要看分组号、门要看钥匙持有、传送门要看同组的另一格在哪 ——
 * 所以回调收到的是 `board` 和 `st`，而不只是一个 cell。
 */
      /**
       * 状态变体（设计稿「格内标 · 全形态大图」13 式）。
       *
       * 三处会变，和天青是同一套逻辑，只是配色换矿物族：
       * - **星屑阶数**：`group` 就是第几颗（一星 / 双星并列 / 三星品字）；
       * - **门开闭**：拿到对应钥匙之后，门从"赭石门扉"变成"两片洞开 + 沥金暖光"；
       * - **传送门进/出口**：同组里 idx 最小的是入口（实环），另一个是出口（虚环）。
       */
      variant: ({ type, group, idx, board, st }) => {
        if (type === CoverCell.SHARD) return { key: starVariant(group) };
        if (type === CoverCell.GATE) return { key: st.keysHeld.has(group) ? 'gateOpen' : 'gate' };
        if (type === CoverCell.PORTAL) {
          return { key: portalEntrance(board.grid, group) === idx ? 'portalA' : 'portalB' };
        }
        return undefined;
      },
    },

    /**
     * 动效：沙落 / 沥线 / 石顿三族（设计稿「动效系统」）。
     *
     * 这一套的每一格都要「落下来」—— 墙面上的色块是贴上去的。
     * 天青不给这段参数，它的东西是浮在釉上的，掉下来就变成贴纸了。
     */
    motion: {
      /**
       * 进场 · **落壁**（设计稿「伍·初始界面」）。
       *
       * 参数逐条照抄那一章：
       * - 每格坠落 **420ms**（`FALL = 420`）：重力段加速、触底段沉降。
       *   早先给 280 —— 太快，像"啪一下出现"，读不出"从壁顶贴下来"。
       * - 行内左→右 **30ms** 错峰（`CHIP_STAGGER = 30`）。
       * - 行间 **220ms**（`ROW_GAP = 220`）：上行落定、静一瞬、再落下行。
       *   早先只给 30 —— 五行几乎同时落，整盘读成"一块板砸下来"，
       *   而设计稿要的是"残片一行一行贴回去"。
       * - 整盘 **≤ 1.7s**（5 行：4×220 + 7×30 + 420 = 1510ms，正好在框内）。
       *
       * `sweep` 是**大盘封顶**：设计稿「大盘 >12×8 时错峰压到 18ms，总时长封顶 2.4s」。
       * 这里给 2400 —— 不是"压缩到 2.4s"，而是"绝不越过 2.4s"，由 kit 等比压 `step`/`row`。
       * 早先 720 是错的：11×11 的盘上会把排期压成一团，行序直接看不出来。
       *
       * `lift` 0.58 格 ≈ 设计稿 `chipFall` 的起落高度（从格上沿外贴下来）。
       */
      enter: {
        ms: 420, step: 30, row: 220, lift: 0.58, swell: 1.06, sweep: 2400,
        // 末行落定：**全盘沙光脉冲 420ms**（暖金从盘底漫起）+ 土埙一记。
        // 设计稿「亮·沙光收尾」明写 420ms；土埙由 `main` 在揭幕结束时播
        //（`audio.chime()` → 鸣沙的土埙，见 `voice.ts` 的 `MINGSHA.chime`）。
        pulse: { ms: 420, color: '#F6E2B2', alpha: 0.26 },
      },
      // 落子 260ms：升起 16/54 个棋子、胀 14%、触底扬 4 粒尘
      drop: { ms: 260, lift: 16 / 54, swell: 1.14, dust: 4 },
      // 铺满：48ms 一粒（步进在 main 的波次里），末粒全盘沙光脉冲
      settle: { ms: 260, dust: 2, pulse: { ms: 180, color: '#F6E2B2', alpha: 0.20 } },
      /**
       * 沥金连径的速度：**每格 92ms**（`grow` 的单位是"每像素毫秒"）。
       *
       * 设计稿 `drawLine` 是 460px 走 420ms，即 **1.095 px/ms**。
       * 一格 101px 按那个速度是 92ms —— 手划过去，线基本"贴着手"。
       *
       * 早先写 1.75（每格 177ms），比设计稿慢了近一倍：拖一条五六格的路要
       * 一秒多，线头明显落在手指后面，"跟手"这件事就没了。
       */
      grow: 0.91,
      // 盖印 320ms，175ms 触底，整面墙抖 ±3px（3/54 个棋子）
      /**
       * 盖印 320ms（设计稿「盖印 · 石章落壁」）、墙抖 3/54 格、落印在末粒后 175ms。
       *
       * `size` 现在是**卡宽比例**（不再是"几个棋子"）：
       * `0.29 × 662 ≈ 192` —— 和结算页那枚印（`SEAL_S = 192`）同尺寸。
       *
       * 早先写 1.65（"1.65 个棋子"），5×6 的盘上算出来 167px 勉强够大，
       * 但 11×11 上只剩 91px —— 同一个"过"字，大盘上突然缩水一半。
       * 印是盖在**整面墙**上的落款，跟的是墙面，不是砖块。
       */
      seal: { ms: 320, at: 175, shake: 3 / 54, size: 0.29 },
    },

    winSeal: drawSealStamp,
    // 抵达那一帧：终点格爆闪（八芒 + 干笔外环 + 沥金辉光）
    arrive: drawArriveBurst,

    hint(ctx, p, cell, i) {
      const inset = cell * 0.10;
      ctx.save();
      ctx.setLineDash(i === 0 ? [] : [cell * 0.13, cell * 0.09]);
      ctx.beginPath();
      roundRect(
        ctx,
        p.x - cell / 2 + inset,
        p.y - cell / 2 + inset,
        cell - inset * 2,
        cell - inset * 2,
        cell * 0.14,
      );
      ctx.strokeStyle = K.goldLit;
      ctx.lineWidth = i === 0 ? Math.max(3, cell * 0.068) : Math.max(1.8, cell * 0.040);
      ctx.stroke();
      ctx.restore();
    },

    head(ctx, p, cell, now) {
      const r = cell * 0.098;
      const pulse = 0.74 + 0.26 * Math.sin(now / 340);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
      g.addColorStop(0, `rgba(255,240,206,${0.40 * pulse})`);
      g.addColorStop(0.45, `rgba(201,155,63,${0.16 * pulse})`);
      g.addColorStop(1, 'rgba(201,155,63,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.2, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();

      const bg = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      bg.addColorStop(0, K.goldPale);
      bg.addColorStop(0.62, K.goldHi);
      bg.addColorStop(1, '#A8781F');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fillStyle = bg;
      ctx.fill();
    },

    endpoint(ctx, kind, p, cell) {
      /**
       * 起终点照设计稿「路径标 · PATH MARKS」重做：
       *
       * - **起点·朱砂印**：朱砂厚笔双圈（`dash 9.5/1.6` 的**干笔缺口**）
       *   + 实心菱印。设计稿原话「起点是**钤印**，不是几何符号」——
       *   所以是"盖上去的一方印"，不是同心圆。
       * - **终点·沥金环**：外实环（干笔 dash）+ 内虚环 + 芯点。
       *   和沥金走线**同一材质** —— 它是一条线的归处，不是另一件东西。
       *
       * 早先起点是"藻井心"（土红圈 + 金圈 + 金豆）、终点是"朱印「土」"。
       * 两处都不对：设计稿把**朱印给了起点**（起手落笔处钤一方印），
       * 而终点必须和线同色 —— 线是金的，归处也该是金的。
       * 朱印留给通关那一下的"过"（那是落款，不是地点）。
       */
      const r = cell * 0.30;
      const u = r / 8; // 24 视图 1 单位
      const RED = '#B5472E';
      const RED_LIT = '#D4643F';
      const GOLD = '#C99B3F';
      const GOLD_LIT = '#E8CE96';

      if (kind === 'start') {
        // ① 外圈：干笔（dash 9.5/1.6 → 换算到周长）
        ctx.save();
        if (typeof ctx.setLineDash === 'function') {
          ctx.setLineDash([9.5 * u, 1.6 * u]);
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.strokeStyle = RED;
        ctx.lineWidth = Math.max(2, 2.3 * u);
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        // ② 第二圈：更细、错开半像素，读作"厚笔两侧的毛边"
        ctx.save();
        if (typeof ctx.setLineDash === 'function') {
          ctx.setLineDash([7 * u, 3.4 * u]);
        }
        ctx.beginPath();
        ctx.arc(p.x - 0.3 * u, p.y - 0.4 * u, r, 0, TAU);
        ctx.strokeStyle = RED_LIT;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(0.7, 0.8 * u);
        ctx.stroke();
        ctx.restore();

        // ③ 实心菱印：暗影 + 朱面 + 上沿受光
        const dia = (dy: number) => {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 3.9 * u + dy);
          ctx.lineTo(p.x + 3.9 * u, p.y + dy);
          ctx.lineTo(p.x, p.y + 3.9 * u + dy);
          ctx.lineTo(p.x - 3.9 * u, p.y + dy);
          ctx.closePath();
        };
        dia(0.45 * u);
        ctx.fillStyle = 'rgba(90,30,15,0.50)';
        ctx.fill();
        dia(0);
        ctx.fillStyle = RED;
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = 0.5;
        dia(-0.45 * u);
        ctx.fillStyle = RED_LIT;
        ctx.fill();
        ctx.restore();
        return;
      }

      // 终点 · 沥金环：外实环（干笔）+ 内虚环 + 芯点
      const R = 8.6 * u;
      ctx.save();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([10 * u, 1.8 * u]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, TAU);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = Math.max(1.8, 2.1 * u);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // 错开的细亮环（`translate(-0.3,-0.4)`，0.75 宽）
      ctx.save();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([8 * u, 3.4 * u]);
      ctx.beginPath();
      ctx.arc(p.x - 0.3 * u, p.y - 0.4 * u, R, 0, TAU);
      ctx.strokeStyle = GOLD_LIT;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(0.6, 0.75 * u);
      ctx.stroke();
      ctx.restore();

      // 内虚环（dash 2.8/2.1）
      ctx.save();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([2.8 * u, 2.1 * u]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.1 * u, 0, TAU);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = Math.max(1, 1.15 * u);
      ctx.stroke();
      ctx.restore();

      // 芯点
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.75 * u, 0, TAU);
      ctx.fillStyle = GOLD_LIT;
      ctx.fill();
    },
  },
});
