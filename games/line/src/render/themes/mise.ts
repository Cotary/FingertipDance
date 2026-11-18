/**
 * 「秘色·天青」· 釉面轴（主题矩阵 01 · 默认旗舰）。
 *
 * ## 为什么是秘色
 *
 * 原型是宋瓷汝窑（"雨过天青云破处"）——中国文化语境里最高级的质感符号。
 * 隐喻是**博物馆展柜**：墨石暗面上摆着刚出窑的青瓷棋子，
 * 玩家连出的路径是全屏唯一发光的东西——一条**鎏金缮线**。
 *
 * ## 三根骨头（抽掉颜色也成立）
 *
 * 1. **釉面三层，不多不少。** 每颗棋子只有：釉面渐变 → 扫光高光 → 冰裂细纹。
 *    多一层就脏，质感是减法。灰度下看到的是「一片片有弧面的釉」，
 *    不是「网格里的色块」。
 * 2. **一器一光。** 全画面只有一个光源：左上 35°。釉面高光、投影（右下 12°）、
 *    盘沿明暗全部服从它。统一光源是真实感和平面感的分水岭。
 * 3. **金贵如缮。** 金色覆盖 ≤8%：只给路径和端点的款。金缮的价值在"少而准"——
 *    金线一出现就是焦点，满盘都是金就什么都不算了。
 *
 * ## 和「金缮瓷盘」的分界
 *
 * kintsugi 是「冷白瓷片 + 碎缝填金」（器物轴：裂→修）；
 * mise 是「青釉棋子 + 金缮光迹」（釉面轴：暗展柜里的一条光路）。
 * 灰度下也分得开：kintsugi 是白面马赛克，mise 是暗底上的浮雕釉块。
 */
import { BOARD_GAP, cardOf, type BoardLayout } from '../layout';
import { roundRect } from '../board';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { fillGrain } from '../grain';
import type { GlyphDecor, GlyphPalette, GlyphShapes } from './glyphs';
import type { LegendKind, LegendMark } from './types';
import { arcPts, composeTheme, portalEntrance, truncatePts, type CellGeom, type Pt } from './kit';

// ────────────────────────────── 色板 ──────────────────────────────

const K = {
  /** 页面底色（设计稿游戏内 = 平涂墨玉） */
  page: '#0E1815',
  /** 墨石：展柜暗面（背景 / 底板） */
  stoneDeep: '#080D0B',
  stone: '#0E1713',
  stoneLit: '#1B2C24',
  /** 青釉：未铺（浅）/ 已铺（深）/ 影 */
  glazePale: '#DCE7DC',
  glazePaleTop: '#EDF3EA',
  glazePaleFoot: '#B7CBBB',
  glazeDeep: '#4F7A66',
  glazeDeepTop: '#6E9E82',
  glazeDeepFoot: '#2D5245',
  glazePool: 'rgba(38,74,58,0.26)',
  /** 鎏金：缮线 / 款 / 高光 */
  gold: '#B89045',
  goldLit: '#F2DCA8',
  goldHot: '#FFF6DC',
  goldDeep: '#8A6B3C',
  /** 朱砂：唯一的红，只给终点头款 */
  seal: '#C04B33',
  sealDeep: '#8E3424',
  /** 冰：更亮、更透（占「亮」的生态位） */
  ice: '#C2DAD6',
  iceLit: '#EAF5F2',
  iceDeep: '#7FA8A0',
  /** 墨：刻线 / 描边 */
  inkLine: '#1D332A',
} as const;

const CHROME: ThemeChrome = {
  // 关号胶囊：墨石底 + 纸色字——展柜里的一枚标签，不是又一个 UI 块
  pill: '#16241D', pillInk: '#EDE7DA',
  // 主按钮是全 UI 唯一的金（与盘面光迹同源）
  primary: '#C9A227', primaryInk: '#2A2114',
  ghost: '#22382E', ghostInk: '#C5BFAF',
  ink: '#EDE7DA', inkSoft: 'rgba(197,191,175,0.72)',
  // 微文案另给一档：#7A7468 就是设计稿的 --i500。
  // 底注 / 图例名用 inkSoft 会亮到和读数抢眼 —— 那两行是"注"，该退到背景里
  inkDim: '#7A7468',
  groove: 'rgba(10,18,14,0.55)', fill: '#D4AF6A',
};

/** 暗格上的款：浅釉线 + 金 */
const LIGHT_PAL: GlyphPalette = {
  // 米白要带一点暖：设计稿的款是 `rgba(255,240,210,.85)`（不是纯白）。
  // 纯白在暖金 + 墨绿里是唯一的"冷点"，整盘会显得有点凉
  ink: 'rgba(255,240,210,0.85)',
  accent: '#F2DCA8',
  chip: '#F2EEE6',
  deep: 'rgba(12,22,18,0.86)',
};
/** 石面上的款：只比石面亮一点点的刻痕 */
const STONE_PAL: GlyphPalette = {
  ink: 'rgba(150,178,162,0.26)',
  accent: 'rgba(120,150,134,0.22)',
  chip: 'rgba(255,255,255,0.06)',
  deep: 'rgba(0,0,0,0.4)',
};

/**
 * 冰砖上的款：**白色**。
 *
 * 设计稿 `.pc.frost .glyph svg { stroke: rgba(255,255,255,.8); stroke-width: 1.5 }`
 * —— 霜青是整盘最亮的一块，深色线压上去会读成"写上去的字"；
 * 白线才是**冰里的裂纹**（光从冰里透出来，不是笔画的）。
 */
const FROST_PAL: GlyphPalette = {
  ink: 'rgba(255,255,255,0.80)',
  accent: 'rgba(214,236,242,0.50)',
  chip: 'rgba(255,255,255,0.90)',
  deep: 'rgba(255,255,255,0.35)',
};

/**
 * 钥匙上的款：**朱印红**。
 *
 * 「五色族里唯一不用金的机关」—— 这是设计稿给钥匙的一条硬规矩。
 * 金色只许出现在箭坯与星屑上（金贵如缮，多一处就廉价一处）。
 * 朱红是这一套的第二把颜色，正好给"开门"这件有因果的事。
 */
const KEY_PAL: GlyphPalette = {
  ink: '#B4463A',
  accent: '#B4463A',
  chip: '#D9614A',
  deep: 'rgba(122,42,32,0.55)',
  edgeW: 0.5,
};

/**
 * 门上的款：**玄墨**。
 *
 * 门扉是玄墨的（比背景暗一档），只有门缝和门环是鎏金 ——
 * 那道金缝是"这里能开"的唯一暗示。门本身不能是金：
 * 它不是藏品，是一块挡路的东西。
 */
const GATE_PAL: GlyphPalette = {
  ink: 'rgba(255,255,255,0.12)',
  accent: '#1B211D',
  chip: '#C9A45C',
  deep: 'rgba(0,0,0,0.6)',
  edgeW: 0.6,
};

/**
 * 门开之后：**门板还是玄墨，中间透天青**。
 *
 * 这是整套里唯一一枚"两种材质"的图标，所以 `deep` / `accent` 的分工必须写清：
 * - `deep` = 两片门板（玄墨，比闭门略亮一点点 —— 开了，受光更多）；
 * - `accent` = 门内涌出的青光；
 * - `chip` = 光柱最亮的那道芯。
 *
 * 两个 alpha 必须**拉开**：格子本身已经是浅青（`GLAZE_OPEN`），
 * 中间那块光若还是 0.34 的青，就和格面一个颜色、整枚糊掉（实测如此）。
 * 所以门板压到近乎纯墨、中间压到 0.62 的青 —— 差得够大才看得出"两片 + 一个洞"。
 */
const GATE_OPEN_PAL: GlyphPalette = {
  ink: 'rgba(31,54,44,0.55)',
  accent: 'rgba(96,158,136,0.62)',
  chip: 'rgba(226,246,238,0.95)',
  /** 门板：玄墨（比闭门亮一档，因为开了） */
  deep: '#1A241F',
  edgeW: 0.6,
};


/** 稳定伪随机（同一格每帧必须同值，否则釉面会闪）。 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ────────────────────── 机制图标 · 五枚器物 ──────────────────────

/**
 * 秘色天青的机制件几何（设计稿 壹·图标系统，48 视图）。
 *
 * ## 为什么不复用默认线稿
 *
 * 默认的 `GLYPHS` 是"一支笔画的符号"——箭头是一根杆加一个折角，
 * 五套里三套都长这样。但天青的纪律是**「机制件是展柜里的一件件器物」**：
 * 箭头必须是**鎏金箭坯**（实心、有厚度、錾刻暗线），星必须是
 * **深釉嵌金星**（不是金格上画一颗黑星），冰必须是**六边晶**（不是一道斜坡）。
 *
 * 所以这五枚整条替换几何，其余（钥匙 / 门 / 起终点）仍走默认线稿 ——
 * 它们本来就是"錾在釉面上的款"，线稿正是对的。
 */
const MS48 = (x: number, y: number): [number, number] => [(x - 24) / 24, (y - 24) / 24];

function mpts(list: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  return list.map(([x, y]) => MS48(x, y));
}

/**
 * **24 视图** → 单位空间：`(v − 12) / 12`。
 *
 * 与 `MS48` 的区别就是视图大小：`MS48` 是 `(v − 24) / 24`（48 视图，给图例用）。
 * 两个混用是这一轮最大的坑 —— 24 视图的画布中心在 12，按 24 减会整体偏半个图，
 * 图形被推到格心右下，边缘还被裁掉（实测：门的拱顶缺一块、钥匙飘出格）。
 */
const U24 = (x: number, y: number): [number, number] => [(x - 12) / 12, (y - 12) / 12];

function m24(list: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  return list.map(([x, y]) => U24(x, y));
}


/**
 * 箭坯轮廓。
 *
 * 设计稿 `M5 21.2 … L42 24 …` 画的是**朝右**的箭（尖端在 x=42）。
 * 但 `drawGlyph` 只按 `DIR` 旋转：`DIR.UP` 是零度，所以几何必须**朝上**，
 * 否则单向门朝上时箭会横着。这里把设计稿的点绕中心转 −90°：
 * `(dx,dy) → (dy,−dx)`，杆落在下方、尖在正上。
 */
const ARROW_BODY: Array<[number, number]> = mpts([
  [5, 21.2], [27, 21.2], [27, 14], [42, 24], [27, 34], [27, 26.8], [5, 26.8],
].map(([x, y]) => {
  const dx = x - 24;
  const dy = y - 24;
  return [24 + dy, 24 - dx] as [number, number];
}));


/**
 * 星屑的火花形（设计稿 `MARKS` 的 `SPARK`，24 视图 → 这里换算成 48）。
 *
 * 设计稿的星屑**不是五角星**，是一枚四芒的火花（`M12 5.2 C…`，上下左右
 * 各一个长芒、腰收得很细）。五角星读作"评分"，四芒火花才读作"一粒碎金"。
 */
function sparkPts(scale = 1, dx = 0, dy = 0): Array<[number, number]> {
  // 24 视图的 SPARK 控制点（对称的四段二次曲线，这里用折线逼近：
  // 格内尺寸下 8 个点的多边形与曲线在 28px 上无法分辨）
  const ring: Array<[number, number]> = [
    [12, 5.2], [12.9, 10.6], [18.8, 12], [12.9, 13.4],
    [12, 18.8], [11.1, 13.4], [5.2, 12], [11.1, 10.6],
  ];
  return ring.map(([x, y]) => {
    const ux = (x - 12) / 12;
    const uy = (y - 12) / 12;
    // 24 视图的 1 单位 = half/12；这里 `scale` 用来做二阶/三阶的缩小
    return [ux * scale + dx, uy * scale + dy] as [number, number];
  });
}

/**
 * 格内标几何 —— 严格照设计稿 **`MARKS`（24 viewBox，格心小印）** 抄。
 *
 * ## 这一版修正的同一个方法论错误
 *
 * 上一版这些形状全部照 `ICONS`（48 viewBox 的**器物大图**）画。
 * 使用说明把这件事写成了**最常见的误用**：
 *
 * > 把 48px 机制图标直接贴进棋格当机关 → 图标细节按 28px 灰度校过，
 * > 贴格里**比例失衡、抢刻纹**。
 *
 * 两层资产岗位不同：
 *
 * | 层 | 资产 | 视图 | 用在哪 |
 * |---|---|---|---|
 * | L1 | `ICONS` | 48 | 图鉴 / 教程 / HUD（"看说明书"） |
 * | L2 | `MARKS` | 24 | **棋盘格心**（"看棋盘"），格内渲染 36px |
 *
 * 两套必须分开，文档那句"机制图标和格内标混用同一份 SVG → 线宽、留白、
 * 光位都不同，必须分两套"就是针对这个。
 *
 * ## 键的映射
 *
 * | 设计稿 `MARKS` | 这里 | 差异要点 |
 * |---|---|---|
 * | `arrow` + 四向 | `arrow` | 24 视图的箭**本来就朝上**（尖端 y=3.8），不再旋转 |
 * | `star1/2/3` | `star`/`star2`/`star3` | 四芒火花，一/双/品字 |
 * | `key` | `key` | 环 r=3.7（不是 48 视图的 8.2）+ 内孔 1.15 + 柄 + 双齿 |
 * | `door` / `door-open` | `gate` / `gateOpen` | 圆拱 `A6.8 6.8` |
 * | `portal-a` / `portal-b` | `portalA` / `portalB` | **同心**三环（不是错开的一对） |
 *
 * 起终点不走这里（`start` / `end` / `trail` 由 `endpoint` / `head` 整块接管），
 * `arrive` 由 `arrive` 钩子接管。
 */
export const MISE_SHAPES: GlyphShapes = {
  // 单向：金箭坯（`MARKS.arrow`：`M12 3.8 L19 12 … L5 12 Z`）
  //
  // **不旋转**：24 视图的箭尖端在 y=3.8，本来就朝上；
  // `DIR_ROT` 是"基准朝上"的映射，再转一次就成朝左了。
  arrow: [
    {
      k: 'poly',
      pts: m24([
        [12, 3.8], [19, 12], [15.4, 12], [15.4, 20], [8.6, 20], [8.6, 12], [5, 12],
      ]),
      fill: true,
      stroke: true,
    },
  ],

  // 星屑一阶：四芒火花（`SPARK`，24 视图）
  star: [{ k: 'poly', pts: sparkPts(), fill: true, stroke: true }],
  // 二阶：双星并列（`translate(±3.4) scale(0.72)`）
  //
  // 偏移用 `/12`：`sparkPts` 返回的是**单位空间**坐标（1 = half = 24 视图的 12），
  // 所以 24 视图的 3.4 单位 = 3.4/12。写 `/24` 只有一半，双星会挤成一团。
  star2: [
    { k: 'poly', pts: sparkPts(0.72, -3.4 / 12, 0), fill: true, stroke: true },
    { k: 'poly', pts: sparkPts(0.72, 3.4 / 12, 0), fill: true, stroke: true },
  ],
  // 三阶：三星品字（上 0/−3.8，下 ±3.9/+2.8，scale 0.62）
  star3: [
    { k: 'poly', pts: sparkPts(0.62, 0, -3.8 / 12), fill: true, stroke: true },
    { k: 'poly', pts: sparkPts(0.62, -3.9 / 12, 2.8 / 12), fill: true, stroke: true },
    { k: 'poly', pts: sparkPts(0.62, 3.9 / 12, 2.8 / 12), fill: true, stroke: true },
  ],

  // 冰砖：六边晶（24 视图 `M6 5 L19 7.5 …`，`MARKS` 里没有冰 —— 冰是"地形"不是"标"，
  // 所以照 `ICONS.ice` 的外轮廓缩到 24 视图）
  ice: [
    { k: 'poly', pts: m24([[12, 2.5], [20, 7.5], [20, 16.5], [12, 21.5], [4, 16.5], [4, 7.5]]), fill: true, stroke: true },
    { k: 'line', pts: m24([[12, 2.5], [12, 21.5]]) },
    { k: 'line', pts: m24([[4, 7.5], [20, 16.5]]) },
    { k: 'line', pts: m24([[20, 7.5], [4, 16.5]]) },
  ],

  // 传送门 A（入口）：**同心**三环 + 芯点（`MARKS['portal-a']`）
  //
  // 同心是刻意的：它说的是"这是一个口"，不是"两个环"。
  // 48 视图的 `ICONS.portal` 才是错开的一对 —— 上一版就是照那个画的，
  // 贴进 36px 的格心会读成"两个相扣的圈"（甚至像眼镜）。
  portalA: [
    { k: 'circle', cx: 0, cy: 0, r: 7.6 / 24, stroke: true },
    { k: 'circle', cx: 0, cy: 0, r: 3.6 / 24, stroke: true },
    { k: 'circle', cx: 0, cy: 0, r: 1.3 / 24, fill: true },
  ],
  // 传送门 B（出口）：同结构但**虚线**（dash 3.2/2.6），内环虚、中缝一道竖线
  portalB: [
    { k: 'circle', cx: 0, cy: 0, r: 7.6 / 24, stroke: true, dash: [3.2 / 24, 2.6 / 24] },
    { k: 'circle', cx: 0, cy: 0, r: 3.6 / 24, stroke: true, dash: [2 / 24, 1.8 / 24] },
    { k: 'line', pts: [[0, -3.6 / 24], [0, 3.6 / 24]] },
  ],

  // 钥匙：朱印钥坯（`MARKS.key`）—— 环 r=3.7 + 内孔 1.15 + 柄 + 双齿
  //
  // 24 视图的环只有 r=3.7（48 视图是 8.2）。环要**镂空**：
  // 实心圆会被 porcelain 填成一团红饼（读作放大镜镜片）。
  key: [
    { k: 'circle', cx: (8.4 - 12) / 24, cy: (8.4 - 12) / 24, r: 3.7 / 24, stroke: true },
    { k: 'circle', cx: (8.4 - 12) / 24, cy: (8.4 - 12) / 24, r: 1.15 / 24, fill: true },
    { k: 'line', pts: m24([[11.1, 11.1], [18.4, 18.4]]) },
    { k: 'line', pts: m24([[15.2, 15.2], [13.2, 17.2]]) },
    { k: 'line', pts: m24([[17.2, 17.2], [15.2, 19.2]]) },
  ],

  // 门 · 闭：圆拱 + 门板（`MARKS.door`：`M5.2 20 L5.2 9 A6.8 6.8 0 0 1 18.8 9 L18.8 20 Z`）
  //
  // 拱必须是**一条闭合路径**：拆成"弧 + 竖线"会被每段描边，读作栅栏。
  // 门缝的金线与门环在 `MISE_DECOR` 里补（几何里放会被描成粗线，把门切成两条）。
  gate: [
    {
      k: 'poly',
      pts: [
        ...m24([[5.2, 20], [5.2, 9]]),
        ...arcPts(5.2, 9, 18.8, 9, 6.8, 0, 1, 10).slice(1).map(([x, y]) => U24(x, y)),
        ...m24([[18.8, 9], [18.8, 20]]),
      ],
      fill: true,
      stroke: true,
    },
  ],
  // 门 · 开：两片洞开 + 中间透光（`MARKS['door-open']`）
  //
  // `sweep=0` 才是**向外鼓**（圆弧外缘）。给 sweep=1 会内凹，
  // 两片合成"关着的双开门"。
  gateOpen: [
    {
      k: 'poly',
      pts: [
        ...m24([[2.2, 20], [2.2, 9.6]]),
        ...arcPts(2.2, 9.6, 8.2, 4.7, 6.8, 0, 0, 8).slice(1).map(([x, y]) => U24(x, y)),
        ...m24([[8.2, 4.7], [8.2, 20]]),
      ],
      fill: true,
      stroke: true,
      tone: 'deep',
    },
    {
      k: 'poly',
      pts: [
        ...m24([[21.8, 20], [21.8, 9.6]]),
        ...arcPts(21.8, 9.6, 15.8, 4.7, 6.8, 0, 1, 8).slice(1).map(([x, y]) => U24(x, y)),
        ...m24([[15.8, 4.7], [15.8, 20]]),
      ],
      fill: true,
      stroke: true,
      tone: 'deep',
    },
    // 门内涌出的天青光
    { k: 'poly', pts: m24([[8.2, 20], [8.2, 5.4], [15.8, 5.4], [15.8, 20]]), fill: true, tone: 'accent' },
  ],
};


/**
 * 星阶：`cellGroup` 就是"第几颗星"。
 *
 * 设计稿的三阶不是"星多画几颗当装饰"，是**规则**：星屑必须按 1→2→3
 * 顺序经过。所以阶数必须能一眼看出来 —— 数字角标被明令禁止
 * （「格内永远不落字」），只能靠**星数**递进。
 *
 * `group` 从 0 起，取模 3 防脏数据越界。
 */
function starVariant(group: number): string {
  return ['star', 'star2', 'star3'][((group % 3) + 3) % 3];
}

/**
 * 五枚器物的细节层（设计稿 SVG 里那些"多出来的两笔"）。
 *
 * 设计稿每一枚都有三层结构 —— **本体 / 亮边 / 暗边**，加上一道材质线。
 * 少了这三层，实心箭坯就是一块黄方块、冰晶就是一块蓝六边：
 * 「一器一光」的全部内容都在错开的那 1.3px 上。
 */
export const MISE_DECOR: GlyphDecor = (ctx, kind, parts, half) => {
  const trace = (pts: Array<[number, number]>) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  if (kind === 'arrow') {
    // 箭坯的厚度（`MARKS.arrow`）：
    // ① `translate(0.35,0.55)` 的暗影，② `#F2DCA8` 亮边错位，③ 錾刻暗线。
    //
    // 偏移量按 **24 视图**：`half` 对应 24 视图的 12 单位，
    // 所以 1 个单位 = `half/12`。上一版按 `/24` 写（48 视图），
    // 错位只有应有的**一半**，箭几乎看不出厚度。
    const u = half / 12;
    // ① 暗影：整块往右下错 0.35/0.55（`MARKS.arrow` 第一层）
    trace(parts[0].k === 'poly' ? (parts[0].pts as Array<[number, number]>) : []);
    ctx.save();
    ctx.translate(u * 0.35, u * 0.55);
    ctx.globalAlpha *= 0.50;
    ctx.fillStyle = '#785824';
    ctx.fill();
    ctx.restore();
    // ② 亮边：往左上错 0.55（受光面在左上）
    trace(parts[0].k === 'poly' ? (parts[0].pts as Array<[number, number]>) : []);
    ctx.save();
    ctx.translate(-u * 0.55, -u * 0.55);
    ctx.globalAlpha *= 0.45;
    ctx.fillStyle = '#F2DCA8';
    ctx.fill();
    ctx.restore();
    // ③ 錾刻暗线：坯身上一道痕（`M12 9 L12 17` 的竖痕，24 视图）
    ctx.beginPath();
    ctx.moveTo(0, u * (9 - 12));
    ctx.lineTo(0, u * (17 - 12));
    ctx.strokeStyle = 'rgba(90,66,30,0.50)';
    ctx.lineWidth = Math.max(0.8, u * 0.8);
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }

  if (kind === 'star') {
    // 金星的折光（`MARKS.star1` 的 `M11.5 9.5 L12.6 13 L12 14.6`，24 视图）。
    // 有一笔就"亮"，没有就只是一块黄漆。
    const u = half / 12;
    ctx.beginPath();
    ctx.moveTo(u * -0.5, u * -2.5);
    ctx.lineTo(u * 0.6, u * 1);
    ctx.lineTo(0, u * 2.6);
    ctx.strokeStyle = '#FFF3D6';
    ctx.globalAlpha *= 0.85;
    ctx.lineWidth = Math.max(0.9, u * 0.65);
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }

  if (kind === 'ice') {
    // 顶面受光：左上那一小片更亮的白（24 视图 `M12 2.5 L20 7.5 L12 12 Z`）
    const u = half / 12;
    ctx.beginPath();
    ctx.moveTo(0, u * -9.5);
    ctx.lineTo(u * 8, u * -4.5);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    return;
  }

  if (kind === 'portalA' || kind === 'portalB' || kind === 'portal') {
    // 传送门（`MARKS['portal-a']` / `portal-b`）—— **同心**三环。
    //
    // 上一版照 48 视图的 `ICONS.portal` 画了错开的一对环：那是"器物大图"，
    // 贴进 36px 格心会读成"两个相扣的圈"。格心只有那么大，同心才有"一个口"的整体感。
    const u = half / 12;
    const dash = kind === 'portalB';

    // ① 外环亮边：`stroke #C9BEE8 / width 0.7 / translate(-0.3,-0.4) / opacity .7`
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.setLineDash === 'function') {
      if (dash) ctx.setLineDash([u * 3.2, u * 2.6]);
      else ctx.setLineDash([]);
    }
    ctx.arc(u * -0.3, u * -0.4, u * 7.6, 0, Math.PI * 2);
    ctx.strokeStyle = '#C9BEE8';
    ctx.globalAlpha = 0.70;
    ctx.lineWidth = Math.max(0.7, u * 0.7);
    ctx.stroke();
    ctx.restore();

    // ② 内环（r=3.6）：A 实线、B 虚线（dash 2/1.8）
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.setLineDash === 'function') {
      if (dash) ctx.setLineDash([u * 2, u * 1.8]);
      else ctx.setLineDash([]);
    }
    ctx.arc(0, 0, u * 3.6, 0, Math.PI * 2);
    ctx.strokeStyle = '#C9BEE8';
    ctx.globalAlpha = dash ? 0.80 : 0.85;
    ctx.lineWidth = Math.max(0.8, u);
    ctx.stroke();
    ctx.restore();

    // ③ 出口的中缝一道竖线（`M12 8.4 L12 15.6`，opacity .5）
    if (dash) {
      ctx.beginPath();
      ctx.moveTo(0, u * -3.6);
      ctx.lineTo(0, u * 3.6);
      ctx.strokeStyle = '#C9BEE8';
      ctx.globalAlpha = 0.50;
      ctx.lineWidth = Math.max(0.8, u);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    return;
  }

  if (kind === 'key') {
    // 朱印钥的细节（`MARKS.key`，**24 视图**）。
    //
    // 上一版用的是 48 视图的坐标（环 r=8.2、中心 17），而几何已改 24 视图
    // （环 r=3.7、中心 8.4）—— 两套混用会让这几笔全飘到图形外。
    const u = half / 12;
    const KX = 8.4;
    const KY = 8.4;

    // ① 环的亮边：`stroke #D9614A / width 0.7 / translate(-0.3,-0.35) / opacity .6`
    ctx.beginPath();
    ctx.arc(u * (KX - 12 - 0.3), u * (KY - 12 - 0.35), u * 3.7, 0, Math.PI * 2);
    ctx.strokeStyle = '#D9614A';
    ctx.globalAlpha = 0.60;
    ctx.lineWidth = Math.max(0.7, u * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ② 钥孔：`circle r=1.15 fill #C4574A`
    ctx.beginPath();
    ctx.arc(u * (KX - 12), u * (KY - 12), u * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = '#C4574A';
    ctx.fill();
    return;
  }

  if (kind === 'gateOpen') {
    // 门内透光（`MARKS['door-open']`，24 视图）：
    // 中缝 `M12 5.8 L12 19.4` 宽 1.3，两侧 `M10.2/13.8 6.4 L19` 宽 0.8。
    //
    // 三条线不放几何：porcelain 会按 0.14 half 描它们（≈3.4 单位），
    // 三道那么粗的竖线挤在门洞里，整扇门糊成一块浅色板。
    const u = half / 12;
    ctx.save();
    ctx.lineCap = 'round';
    const line = (x: number, y0: number, y1: number, w: number, a: number) => {
      ctx.beginPath();
      ctx.moveTo(u * (x - 12), u * (y0 - 12));
      ctx.lineTo(u * (x - 12), u * (y1 - 12));
      ctx.strokeStyle = `rgba(205,238,224,${a})`;
      ctx.lineWidth = Math.max(0.8, u * w);
      ctx.stroke();
    };
    line(12, 5.8, 19.4, 1.3, 0.85);
    line(10.2, 6.4, 19, 0.8, 0.40);
    line(13.8, 6.4, 19, 0.8, 0.40);
    ctx.restore();
    return;
  }

  if (kind === 'gate') {
    // 门的细节（`MARKS.door`，24 视图）：
    // 门缝 `M12 6.8 L12 20` 宽 0.9，门环 `circle 14.7 13.4 r=0.95`，
    // 两条门板侧线 `M7.4 20 L7.4 10.2` / `M16.6 20 L16.6 10.2` 宽 0.8。
    //
    // 门缝不放几何：porcelain 会描成 0.14 half（≈3.4 单位）—— 一根粗中线
    // 把门板切成左右两条，整扇门读作"栅栏"。
    const u = half / 12;
    const P = (x: number, y: number): [number, number] => [u * (x - 12), u * (y - 12)];

    // ① 门缝：鎏金细线
    const a = P(12, 6.8);
    const b = P(12, 20);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = '#C9A45C';
    ctx.globalAlpha *= 0.85;
    ctx.lineWidth = Math.max(0.8, u * 0.9);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha /= 0.85;

    // ② 门环
    const h = P(14.7, 13.4);
    ctx.beginPath();
    ctx.arc(h[0], h[1], u * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#C9A45C';
    ctx.fill();

    // ③ 门板侧线（两条很淡的白，读作"板缝"）
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = Math.max(0.8, u * 0.8);
    for (const x of [7.4, 16.6]) {
      const p0 = P(x, 20);
      const p1 = P(x, 10.2);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    return;
  }

  if (kind === 'gate') {
    // 门缝：一道**细**鎏金线（设计稿 `M24 12 L24 42`，宽 1.6/48）。
    //
    // 放进几何会被 porcelain 描成 0.14 half（6.7 单位）—— 一根粗中线
    // 把门板切成左右两条，整扇门读作"栅栏"。缺的正是这 4 倍宽度差。
    ctx.beginPath();
    ctx.moveTo(0, half * (-12 / 24));
    ctx.lineTo(0, half * (18 / 24));
    ctx.strokeStyle = '#C9A45C';
    ctx.lineWidth = Math.max(0.8, half * (1.6 / 48));
    ctx.lineCap = 'round';
    ctx.stroke();
    // 地面横线
    ctx.beginPath();
    ctx.moveTo(half * (-15 / 24), half * (18 / 24));
    ctx.lineTo(half * (15 / 24), half * (18 / 24));
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(0.9, half * (1.2 / 48));
    ctx.stroke();
    return;
  }
};

// ────────────────────────────── 背景 ──────────────────────────────

/**
 * 展柜底板：设计稿的游戏内底色是**一张平涂的墨玉**（#0E1815）。
 *
 * 没有渐变、没有光斑、没有颗粒。以前这里有一束「展柜灯」+ 60 粒石屑，
 * 但把设计稿的 03 屏放大到 1:1 就能看到：页面是纯色，所有纵深都由
 * **卡片自己**给（卡比页亮一档 + 内影 + 金线）。页面一花，卡片就退成一块贴图。
 *
 * ## 唯一允许它动的东西：6s 呼吸
 *
 * 设计稿 TOKEN 表最后一行：「背景常驻 · 6s 呼吸 · 釉面亮度 0.98–1.02 缓慢呼吸；
 * 可连格金缘 1.8s 明暗交替；**无浮尘、无粒子**」。
 *
 * 所以这里只有一层**整屏极淡的暖光**在缓慢起伏，**没有任何粒子和噪点**。
 * 幅度必须压到 ±2%：这层每帧都在动，多一个百分点就变成"画面在闪"，
 * 而设计稿要的是"这面墙在呼吸"—— 你盯着看十秒才会察觉它在动。
 */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  box: DesignBox,
  now = 0,
): void {
  ctx.fillStyle = K.page;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  // 6s 一个来回（设计稿 `6s linear`）。这里给 6000ms 周期，
  // 但用 sin 而不是 linear —— CSS 的 linear 在 infinite 循环里
  // 到端点会"折"一下，肉眼能看见一次顿；sin 是连续可导的。
  const b = Math.sin((now / 6000) * Math.PI * 2) * 0.02; // −0.02 .. +0.02
  // 亮度 1 附近 ↔ 一层极淡的暖金（正半周）或极淡的墨（负半周）。
  // 只叠一层半透明，不插值页面底色 —— 插值会把 #0E1815 抬灰，
  // 那是"蒙了层雾"，不是"呼吸"。
  if (b > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(212,175,106,${b * 0.55})`;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  } else {
    ctx.fillStyle = `rgba(0,0,0,${-b * 0.8})`;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
}

// ────────────────────────────── 展柜卡片 ──────────────────────────────

/**
 * 棋盘卡片（展柜）。
 *
 * 结构照设计稿的 `.board-well` 一层层落：
 * 外投影 → 卡体（175° 压暗）→ 顶部青光 → 上/下内影 → 冷青卡沿 → 内缩金线 → 颗粒。
 *
 * 为什么卡片不能比页面亮太多：青瓷棋子本身已经很暗（未铺是深釉），
 * 卡片一亮，棋子就变成「贴在亮板上的暗块」；卡片只比页面亮 **两档**、
 * 靠内影把自己压成「凹进去的柜子」，棋子才像**摆在里面**。
 */
function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const card = cardOf(layout);
  const { x, y, w, h } = card;
  const r = 36;

  // ── 外投影：设计稿 0 40px 90px rgba(0,0,0,.55)。
  //    canvas 只用一次模糊：投影落在平涂页面上，太实像贴纸、太虚会浮起来
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.62)';
  ctx.shadowBlur = 64;
  ctx.shadowOffsetY = 20;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = '#101B16';
  ctx.fill();
  ctx.restore();

  // ── 卡体：设计稿 `linear-gradient(158deg, #16241E, #0F1915 60%, #16241E)`
  //
  // 注意**首尾同色**：卡片四边一样亮、中间最暗，读起来才是一个"凹陷的展柜"。
  // 老版把末段压到 #0C1512（比页面 #0E1815 还黑），卡片下半截直接化进背景，
  // 只剩上沿一条边 —— 于是整块盘看起来"没有底"。
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  const body = ctx.createLinearGradient(x, y, x + w * 0.375, y + h * 0.927);
  body.addColorStop(0, '#16241E');
  body.addColorStop(0.60, '#0F1915');
  body.addColorStop(1, '#16241E');
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  ctx.clip(); // 卡片路径还挂在 ctx 上

  // ── 内影：设计稿 `inset 0 3px 18px rgba(0,0,0,.55)` +
  //    `inset 0 -8px 20px rgba(0,0,0,.35)`。18/20 的模糊半径落到 2 倍图上
  //    是 36/40 —— 第一版写 48/56 且底部给到 .45，卡片上下各黑掉一条宽带，
  //    盘面等于是沉在一个坑里。
  const topIn = ctx.createLinearGradient(0, y, 0, y + 42);
  topIn.addColorStop(0, 'rgba(0,0,0,0.55)');
  topIn.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topIn;
  ctx.fillRect(x, y, w, 42);
  const botIn = ctx.createLinearGradient(0, y + h - 56, 0, y + h);
  botIn.addColorStop(0, 'rgba(0,0,0,0)');
  botIn.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = botIn;
  ctx.fillRect(x, y + h - 56, w, 56);
  ctx.restore();

  // ── 卡沿：冷青 1px（设计稿 border rgba(147,179,162,.1)）。
  //    卡片和页面只差 1~2 个色阶，全靠这根发丝分出"里 / 外"
  ctx.beginPath();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = 'rgba(147,179,162,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── 石面颗粒：5.5%。它是「石头」和「纯色渐变」的全部区别
  fillGrain(ctx, x, y, w, h, 0.055);
}

// ────────────────────────────── 格 ──────────────────────────────

/**
 * 一格釉的六种面色。
 *
 * 从设计稿的 `.pc` 系（03 屏）搬来：每个面色都是
 * `radial-gradient(120% 110% at 30% 22%, 亮, 中 48%, 暗)` ——
 * 圆心偏左上，所以整片读起来是**一个朝左上的穹顶**，不是一块平色。
 *
 * 亮／暗两态：
 * - 未铺 `pale`：暗一档、再压 0.82 透明度（釉还没被点过，是"生"的）
 * - 已铺 `lit`：亮一档（点过之后像被灯照到）
 *
 * 这个方向是设计稿定的（`.pc` = 已铺 / `.pc.pale` = 未铺）。
 * 反过来的话，满盘开局就是一片亮绿，金色光迹就没地方发光了。
 */
/**
 * 一片釉的配方 —— 逐条对齐 `2026-11-15-秘色天青-质感音效Demo.html` 的
 * `.piece.pale` / `.piece.deep`。
 *
 * ## 为什么推倒重来
 *
 * 上一版是照「定稿 Demo」的 `.pc` 量的：暗青格 + 一条横向光带。
 * 一起摆到质感 Demo 旁边就露馅了 —— 那边的棋子是**亮青釉**，而我们的是
 * 一片暗绿方格：整盘没有一处比盘底亮得起来，读作"格子纸"而不是"瓷器"。
 *
 * ## 一颗棋子的四层（缺一层就不是瓷）
 *
 * 1. **147° 五停渐变**：左上 #D5E3D8 → 右下 #4F7A66。
 *    方向性是"弧面"的全部 —— 纯色/径向渐变都读成平片。
 * 2. **27%/19% 的径向白光**（118% 尺寸，46% 处收干净）：
 *    光源只有一个，且落点偏左上。
 * 3. **118° 的整片 glint**：左上 0.22 白 → 34% 透明 → 右下 0.10 黑。
 *    这不是"高光"，是**釉面的反光层**——描的是整块曲面，不是一滴光。
 * 4. **开片**：三根折线，每根画两遍（深绿 0.30 / 白 0.34 错位 0.5,0.6）。
 *    双线才有"刻痕两侧一明一暗"的立体感，单线只是一道划痕。
 */
/**
 * 釉面规格 —— **逐字照抄设计稿的 CSS**，不做任何换算。
 *
 * ## 为什么不再用 `ramp + sheen + foot` 那套
 *
 * 之前的结构是"5 段线性 + 一个高光强度 + 一个底影色"。它是从 CSS
 * **推导**出来的，每推导一步就掉一层：
 *
 * - 侧壁色被抽成全局常量（`rgba(22,52,40,.92)`），于是 frost 要的
 *   **蓝灰侧壁** `rgba(112,152,172,.80)` 永远对不上，stone 要的
 *   **近黑侧壁** `rgba(8,11,9,.96)` 也不存在；
 * - `rgba(255,255,255,.72)` 的高光被折成 `sheen: 0.62`；
 * - `rgba(96,140,162,.40)` 的底内暗被折成 `rgba(40,84,78,0.28)`。
 *
 * CSS 的 `rgb()` 和 canvas 的 `fillStyle` 是**同一套 RGB**。同一个值，
 * 两种技术画出来必须一致 —— 所以这里直接存设计稿的原值，
 * `drawTile` 负责按 CSS 的语义摆它们（角度、位置、尺寸都照 CSS 的字面）。
 *
 * 每个字段后面都注了它对应设计稿的哪一条 `box-shadow` / `background`。
 */
interface Glaze {
  /**
   * 面渐变：设计稿 `linear-gradient(147deg, c1 0%, c2 28%, …)`。
   *
   * `deg` 是 CSS 角度（0 = 向上，顺时针）。`stops` 是 `[色, 位置0..1]`。
   * 照抄，不改角度也不改停靠点。
   */
  face: { deg: number; stops: ReadonlyArray<readonly [string, number]> };
  /**
   * 左上径向高光：`radial-gradient(38% 30% at 23% 15%, COLOR, transparent 72%)`。
   *
   * `at` 是圆心（格宽/格高的比例），`size` 是半径（同比例），
   * `fade` 是"透明"的停靠点。
   */
  hi: { color: string; at: readonly [number, number]; size: readonly [number, number]; fade: number };
  /**
   * 右下径向转暗：`radial-gradient(120% 120% at 85% 90%, COLOR, transparent 58%)`。
   *
   * 有的格没有这一层（pale 有 `rgba(16,40,30,.46)`，stone 是 `rgba(0,0,0,.55)`）。
   */
  dim?: { color: string; at: readonly [number, number]; size: readonly [number, number]; fade: number };
  /**
   * 整片 glint：`linear-gradient(118deg, #fff .30 0%, #fff .08 16%, transparent 32%,
   * transparent 68%, #000 .14 100%)`。
   *
   * 不是高光，是**釉面反光层**。`null` = 这类格没有（石障"无釉面"）。
   */
  glint: ReadonlyArray<readonly [string, number]> | null;
  /**
   * 胎厚侧壁：`0 3px 0 near` + `0 5px 0 far`（`box-shadow` 的模糊为 0）。
   *
   * **每格自己的颜色**，这是立体感的根：
   * pale 是深绿两层，frost 是蓝灰两层，stone 是近黑两层。
   */
  wall: { near: string; far: string };
  /**
   * 倒角棱：`inset 1.5px 1.5px 0 hi` + `inset -1.5px -1.5px 0 lo`。
   *
   * `null` = 这一格不做倒角（设计稿里没有这两条 inset 的格）。
   */
  bevel: { hi: string; lo: string } | null;
  /**
   * 顶内高光：`inset 0 2px 7px COLOR`（`pale` 有，`stone` 没有）。
   */
  insetHi?: string;
  /**
   * 底内暗：`inset 0 -8px 18px COLOR`。
   */
  insetLo?: string;
  /**
   * 缘光：`0 0 0 1px rgba(…)` + `0 0 NNpx rgba(…)`。
   *
   * 设计稿用它标"这一格是什么身份"（金=星屑/单向、朱=钥匙、紫=传送门…）。
   * `null` = 没有缘光。
   */
  rim: { line: string; glow?: string } | null;
  /** 开片浓度倍率（设计稿各格 crackle 的 opacity 不同）。0 = 不画。 */
  crack: number;
}

/**
 * ══════════════════════════════════════════════════════════════════
 * 色板 · **逐字照抄设计稿 CSS**（2026-11-16-秘色天青）
 * ══════════════════════════════════════════════════════════════════
 *
 * 变量表（设计稿 `:root`）：
 * `--c050:#E4EDE6 --c100:#D5E3D8 --c200:#B8CFC0 --c300:#93B3A2 --c400:#6E9180`
 * `--c500:#4F7A66 --c600:#2E5444 --c700:#1D3A2E`
 * 主色 `#D4AF6A`（鎏金）、`#C4574A`（朱印）、`#8B7EC8`（暮紫）
 *
 * 每一条都注了它抄自设计稿的哪一行，可以直接逐字核对。
 * **不许换算、不许推导、不许凭感觉微调。**
 */

// ── 公共层：`.pc .glint`（所有釉面格共用这一层反光）──
const GLINT: ReadonlyArray<readonly [string, number]> = [
  ['rgba(255,255,255,0.30)', 0],
  ['rgba(255,255,255,0.08)', 0.16],
  ['rgba(255,255,255,0)', 0.32],
  ['rgba(255,255,255,0)', 0.68],
  ['rgba(0,0,0,0.14)', 1],
];

// ── 各机制格共用的"淡青釉 + 一圈色标"侧壁/倒角/内影 ──
//    （设计稿里 oneway/key-cell/door-cell/door-open/portal 都只有 box-shadow，
//      background 全部继承 `.pc.pale`）
const WALL_PALE = { near: 'rgba(22,52,40,0.92)', far: 'rgba(10,26,19,0.95)' };
const BEVEL_PALE = { hi: 'rgba(255,255,255,0.42)', lo: 'rgba(20,52,40,0.60)' };
const INSET_HI_PALE = 'rgba(255,255,255,0.30)';
const INSET_LO_PALE = 'rgba(20,52,40,0.55)';

/**
 * 未铺 · 淡青釉（`.pc.pale` + `.t-final`）
 *
 * ```css
 * background:
 *   radial-gradient(38% 30% at 23% 15%, rgba(255,255,255,0.85), rgba(255,255,255,0) 72%),
 *   radial-gradient(120% 120% at 85% 90%, rgba(16,40,30,0.46), rgba(16,40,30,0) 58%),
 *   linear-gradient(147deg, var(--c100) 0%, var(--c200) 28%, var(--c300) 55%,
 *                   var(--c400) 80%, var(--c500) 100%);
 * box-shadow:
 *   0 3px 0 rgba(22,52,40,.92), 0 5px 0 rgba(10,26,19,.95),
 *   0 2px 4px rgba(0,0,0,.5), 0 12px 22px rgba(0,0,0,.38), 0 28px 52px rgba(0,0,0,.30),
 *   inset 1.5px 1.5px 0 rgba(255,255,255,.42), inset -1.5px -1.5px 0 rgba(20,52,40,.60),
 *   inset 0 2px 7px rgba(255,255,255,.30), inset 0 -8px 18px rgba(20,52,40,.55),
 *   inset 0 0 0 1px rgba(255,255,255,.10);
 * ```
 */
const GLAZE_PALE: Glaze = {
  face: {
    deg: 147,
    stops: [['#D5E3D8', 0], ['#B8CFC0', 0.28], ['#93B3A2', 0.55], ['#6E9180', 0.8], ['#4F7A66', 1]],
  },
  hi: { color: 'rgba(255,255,255,0.85)', at: [0.23, 0.15], size: [0.38, 0.30], fade: 0.72 },
  dim: { color: 'rgba(16,40,30,0.46)', at: [0.85, 0.90], size: [1.2, 1.2], fade: 0.58 },
  glint: GLINT,
  wall: WALL_PALE,
  bevel: BEVEL_PALE,
  insetHi: INSET_HI_PALE,
  insetLo: INSET_LO_PALE,
  rim: { line: 'rgba(255,255,255,0.10)' },
  crack: 0.42,
};

/**
 * 已铺 · 深釉（`.pc.deep`）—— 走过之后沉入深青，金缘 1px + 微辉光。
 *
 * ```css
 * linear-gradient(147deg, var(--c500) 0%, var(--c600) 42%, var(--c700) 100%)
 * 0 3px 0 rgba(7,16,11,.95), 0 5px 0 rgba(4,10,7,.98)
 * 0 0 0 1px rgba(212,175,106,.28), 0 0 26px rgba(212,175,106,.14)
 * ```
 */
const GLAZE_DEEP: Glaze = {
  face: {
    deg: 147,
    stops: [['#4F7A66', 0], ['#2E5444', 0.42], ['#1D3A2E', 1]],
  },
  hi: { color: 'rgba(255,255,255,0.40)', at: [0.23, 0.15], size: [0.38, 0.30], fade: 0.72 },
  dim: { color: 'rgba(0,0,0,0.52)', at: [0.85, 0.90], size: [1.2, 1.2], fade: 0.58 },
  glint: GLINT,
  wall: { near: 'rgba(7,16,11,0.95)', far: 'rgba(4,10,7,0.98)' },
  bevel: { hi: 'rgba(255,255,255,0.24)', lo: 'rgba(0,0,0,0.55)' },
  insetHi: 'rgba(255,255,255,0.15)',
  insetLo: 'rgba(0,0,0,0.52)',
  rim: { line: 'rgba(212,175,106,0.28)', glow: 'rgba(212,175,106,0.14)' },
  crack: 0.34,
};

/**
 * 石障 · 墨石（`.pc.stone`）—— **全盘唯一"无釉面"的格**。
 *
 * ```css
 * radial-gradient(38% 30% at 23% 15%, rgba(255,255,255,0.16), … 72%)
 * radial-gradient(120% 120% at 85% 90%, rgba(0,0,0,0.55), … 58%)
 * linear-gradient(150deg, #3C423E 0%, #232925 52%, #12160F 100%)
 * 0 3px 0 rgba(8,11,9,.96), 0 5px 0 rgba(4,6,5,.98)
 * inset 1.5px 1.5px 0 rgba(255,255,255,.14), inset -1.5px -1.5px 0 rgba(0,0,0,.60)
 * inset 0 -9px 20px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.05)
 * ```
 *
 * 三处"没有"是刻意的，不是漏了：
 * - **没有 glint**（设计稿不给 `.glint` 那一层）—— 它是死物，不反光；
 * - **没有 `inset 0 2px 7px`**（顶内高光）—— 石头顶部不泛亮；
 * - **没有缘光**（只有 `inset 0 0 0 1px rgba(255,255,255,.05)`，那是 1px 白线不是彩色缘）。
 *
 * 侧壁是**近黑**两层，不是深绿 —— 这是它和普通格在立体上的分界。
 */
const GLAZE_STONE: Glaze = {
  face: {
    deg: 150,
    stops: [['#3C423E', 0], ['#232925', 0.52], ['#12160F', 1]],
  },
  hi: { color: 'rgba(255,255,255,0.16)', at: [0.23, 0.15], size: [0.38, 0.30], fade: 0.72 },
  dim: { color: 'rgba(0,0,0,0.55)', at: [0.85, 0.90], size: [1.2, 1.2], fade: 0.58 },
  glint: null,
  wall: { near: 'rgba(8,11,9,0.96)', far: 'rgba(4,6,5,0.98)' },
  bevel: { hi: 'rgba(255,255,255,0.14)', lo: 'rgba(0,0,0,0.60)' },
  insetLo: 'rgba(0,0,0,0.55)',
  rim: { line: 'rgba(255,255,255,0.05)' },
  crack: 0,
};

/**
 * 冰砖 · 霜面（`.pc.frost`）
 *
 * ```css
 * radial-gradient(38% 30% at 23% 15%, rgba(255,255,255,0.72), … 72%)
 * radial-gradient(120% 120% at 85% 90%, rgba(80,130,155,0.35), … 58%)
 * linear-gradient(147deg, rgba(214,236,242,0.62), rgba(160,200,214,0.42) 60%,
 *                 rgba(120,170,190,0.36))
 * 0 3px 0 rgba(112,152,172,.80), 0 5px 0 rgba(74,112,132,.85)
 * inset 1.5px 1.5px 0 rgba(255,255,255,.80), inset -1.5px -1.5px 0 rgba(96,140,162,.55)
 * inset 0 2px 7px rgba(255,255,255,.55), inset 0 -8px 16px rgba(96,140,162,.40)
 * 0 0 0 1px rgba(255,255,255,.35), 0 0 20px rgba(190,225,240,.25)
 * ```
 *
 * **两处最容易做错的地方**：
 * 1. 侧壁是**蓝灰** `rgba(112,152,172,.80)`，不是深绿 —— 这是"冰"的厚度色。
 *    之前侧壁色被抽成全局常量（深绿），所以冰块底下永远压着一道绿边。
 * 2. 面渐变本身**是半透的**（`.62/.42/.36`），叠在盘面上才是"透"的。
 *    之前我把 alpha 提成不透明，透感全丢。
 */
const GLAZE_FROST: Glaze = {
  face: {
    deg: 147,
    stops: [
      ['rgba(214,236,242,0.62)', 0],
      ['rgba(160,200,214,0.42)', 0.60],
      ['rgba(120,170,190,0.36)', 1],
    ],
  },
  hi: { color: 'rgba(255,255,255,0.72)', at: [0.23, 0.15], size: [0.38, 0.30], fade: 0.72 },
  dim: { color: 'rgba(80,130,155,0.35)', at: [0.85, 0.90], size: [1.2, 1.2], fade: 0.58 },
  glint: GLINT,
  wall: { near: 'rgba(112,152,172,0.80)', far: 'rgba(74,112,132,0.85)' },
  bevel: { hi: 'rgba(255,255,255,0.80)', lo: 'rgba(96,140,162,0.55)' },
  insetHi: 'rgba(255,255,255,0.55)',
  insetLo: 'rgba(96,140,162,0.40)',
  rim: { line: 'rgba(255,255,255,0.35)' },
  crack: 1.15, // EXP: 保持原样
};

/**
 * 星屑 · 深釉嵌金星（`.pc.star`）—— **底色与 `.pc.deep` 一致**，只是缘光更亮。
 *
 * ```css
 * box-shadow 前 8 条与 deep 相同，只是最后两条：
 *   0 0 0 1px rgba(212,175,106,.30), 0 0 18px rgba(212,175,106,.14)
 * ```
 * 注意：设计稿的 `.pc.star` **只写 box-shadow、没有写 background**，
 * 所以底色取自 `.pc.pale` 或 `.pc.deep`（格态卡用的是 `deep star`）。
 */
const GLAZE_STAR: Glaze = {
  ...GLAZE_DEEP,
  rim: { line: 'rgba(212,175,106,0.30)', glow: 'rgba(212,175,106,0.14)' },
};

/** 星屑格上的款：**金色浮雕**。填金、描深金边，与"深釉嵌金"同一句话。 */
const STAR_PAL: GlyphPalette = {
  ink: '#2A1D08', accent: '#E3C170', chip: '#FFF3C9',
  deep: 'rgba(120,86,20,0.85)', lineW: 0.9,
};

/**
 * 钥匙 · 朱印钥（`.pc.key-cell`）—— 底色同 `.pc.pale`，缘光是**朱印**。
 *
 * ```css
 * 0 0 0 1px rgba(196,87,74,.26), 0 0 16px rgba(196,87,74,.12)
 * ```
 * 设计稿明写"五色族里唯一不用金的机关"，所以缘光不是金。
 */
const GLAZE_KEY: Glaze = {
  ...GLAZE_PALE,
  rim: { line: 'rgba(196,87,74,0.26)', glow: 'rgba(196,87,74,0.12)' },
};

/**
 * 单向 · 箭坯（`.pc.oneway`）—— 底色同 `.pc.pale`，缘光是**淡金**。
 *
 * ```css
 * 0 0 0 1px rgba(212,175,106,.22), 0 0 14px rgba(212,175,106,.1)
 * ```
 */
const GLAZE_DARK: Glaze = {
  ...GLAZE_PALE,
  rim: { line: 'rgba(212,175,106,0.22)', glow: 'rgba(212,175,106,0.10)' },
};

/**
 * 门 · 开（`.pc.door-open`）—— 底色同 `.pc.pale`，缘光是**天青**。
 *
 * ```css
 * 0 0 0 1px rgba(150,205,185,.32), 0 0 22px rgba(150,205,185,.2)
 * ```
 */
const GLAZE_OPEN: Glaze = {
  ...GLAZE_PALE,
  rim: { line: 'rgba(150,205,185,0.32)', glow: 'rgba(150,205,185,0.20)' },
};

/**
 * 传送门（`.pc.portal-a, .pc.portal-b`）—— 底色同 `.pc.pale`，缘光是**暮紫**。
 *
 * ```css
 * 0 0 0 1px rgba(139,126,200,.32), 0 0 18px rgba(139,126,200,.18)
 * ```
 */
const GLAZE_VIOLET: Glaze = {
  ...GLAZE_PALE,
  rim: { line: 'rgba(139,126,200,0.32)', glow: 'rgba(139,126,200,0.18)' },
};


/** 投影 / 外发光贴片缓存（键：边长 + 圆角 + 金边强度）。 */
const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * 三层外投影（设计稿 `.piece.pale` 的 box-shadow）：
 * `0 1px 2px .16` / `0 7px 15px .22` / `0 20px 38px .18`。
 *
 * 为什么烘贴片而不是每帧 `ctx.shadowBlur`：一格三次高斯模糊，11×11 的盘
 * 就是 300+ 次/帧，低端机直接掉到个位数帧率。棋子尺寸一关内恒定，
 * 烘一张永远复用，每格只剩一次 drawImage。
 *
 * 每画完一层就用 `destination-out` 把本体挖掉：贴片里只留**露在棋子外面**
 * 的那圈影子。不挖的话影子会糊在釉面上，整颗棋子发灰 —— 而釉面恰恰是亮的。
 */
function shadowSprite(s: number, r: number, g: Glaze): HTMLCanvasElement {
  // 缓存键必须带上全部会影响像素的字段 —— 侧壁/缘光改成逐格不同之后，
  // 只按 (尺寸, 圆角, 强度) 缓存会把 frost 和 pale 混成同一张贴片
  const key = `${Math.round(s)}|${Math.round(r)}|${g.wall.near}|${g.wall.far}|${g.rim?.line ?? ''}|${g.rim?.glow ?? ''}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  /**
   * 换算基准：设计稿的棋子是 **64px**（`.pc { width: 64px }`）。
   *
   * 早先这里写 80 —— 那是"532 的盘、6×5、gap 10"倒推出来的约数，
   * 而 CSS 里明写 64。差 25% 意味着**所有立体量都做薄了一档**：
   * 侧壁 5px 变成 4px、环境影 52px 变成 41px，整盘读作"薄片"而不是"瓷片"。
   */
  const k = s / 64;
  const pad = Math.ceil(s * 0.72);
  const box = s + pad * 2;
  const ssr = 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(box * ssr);
  cv.height = Math.ceil(box * ssr);
  const c = cv.getContext('2d');
  if (c) {
    c.scale(ssr, ssr);
    /**
     * 缘光：`0 0 0 1px rgba(...)` + `0 0 NNpx rgba(...)`。
     *
     * 设计稿用它是标"这一格是什么身份"：
     * 深釉 `rgba(212,175,106,.28)` 金、钥匙 `rgba(196,87,74,.26)` 朱、
     * 门开 `rgba(150,205,185,.32)` 天青、传送门 `rgba(139,126,200,.32)` 紫。
     * 两段都**逐字来自 `Glaze.rim`**，不再乘任何系数。
     */
    if (g.rim?.glow) {
      c.save();
      c.shadowColor = g.rim.glow;
      c.shadowBlur = 44 * k;
      c.fillStyle = '#000';
      c.beginPath();
      roundRect(c, pad, pad, s, s, r);
      c.fill();
      c.restore();
    }
    /**
     * **胎厚侧壁**：`0 3px 0 釉壁` + `0 5px 0 暗唇`。
     *
     * 这是整盘立体感的**根**。设计稿「立体读法」第一条就是它，
     * 而这一层和下面那三级贴地影是两回事：
     *
     * - **侧壁是实色**（模糊 0）：像 CSS 的 `0 3px 0`，是一块**挤出体** ——
     *   看得见"瓷片有多厚"。少了它，格子就只是一张贴在板上的色纸；
     * - **贴地影是模糊的**：那是"落在台面上的影子"，说的是"离地多高"。
     *
     * 只有影子没有侧壁，格子会读成"一张飘着的卡片"。
     */
    /**
     * 侧壁的两层颜色**逐格来自 `Glaze.wall`**（`0 3px 0` + `0 5px 0`）：
     *
     * | 格 | near（3px） | far（5px） |
     * |---|---|---|
     * | 淡青釉 | `rgba(22,52,40,.92)` 深绿 | `rgba(10,26,19,.95)` 更深 |
     * | 冰砖 | `rgba(112,152,172,.80)` **蓝灰** | `rgba(74,112,132,.85)` 更蓝 |
     * | 墨石 | `rgba(8,11,9,.96)` 近黑 | `rgba(4,6,5,.98)` 更黑 |
     *
     * 早先这里写死成淡青釉那对深绿 —— 于是冰块底下永远压着一道绿边，
     * 石头也没有自己的近黑侧壁。侧壁是"瓷片有多厚"的唯一表达，
     * 颜色错了，那一格就不属于这个材质。
     */
    const walls: Array<[number, string]> = [
      // 先画远的（暗唇），再画近的（釉壁），后者盖住前者上沿
      [5, g.wall.far],
      [3, g.wall.near],
    ];

    /**
     * 三级贴地影（设计稿 `0 2px 4px` / `0 12px 22px` / `0 28px 52px`）。
     *
     * 早先给的是 1/2、7/15、20/38 —— 偏移和模糊都偏小，
     * 于是影子紧贴着侧壁，读不出"离台面有多高"。按设计稿的数值放大。
     */
    const layers: Array<[number, number, number]> = [
      [2, 4, 0.50],
      [12, 22, 0.38],
      [28, 52, 0.30],
    ];
    for (const [dy, blur, a] of layers) {
      c.save();
      c.shadowColor = `rgba(0,0,0,${a})`;
      c.shadowBlur = blur * k;
      c.shadowOffsetY = dy * k;
      c.fillStyle = '#000';
      c.beginPath();
      roundRect(c, pad, pad, s, s, r);
      c.fill();
      c.restore();
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      roundRect(c, pad, pad, s, s, r);
      c.fill();
      c.restore();
    }

    /**
     * 侧壁**只在所有影子之后画一次**。
     *
     * 早先它被塞在影子循环里（每层影子挖完洞就重画一遍）——
     * 三层影子下来，同一道侧壁叠了 **3 次**。
     * `rgba(112,152,172,.80)` 叠三次，alpha 推到 ≈0.99，
     * 颜色也被反复加亮：frost 的整格因此比设计稿亮 30~60，
     * 蓝通道偏得最多（侧壁就是蓝灰的）。
     *
     * 挖洞的目的是"只留影子、不留实体"，所以侧壁必须在**挖完之后**补，
     * 但只补**一次** —— 它是一块挤出体，不是可以层层叠加的半透明层。
     */
    /**
     * **侧壁只能画在格子本体之外**（下沿以下的那一截）。
     *
     * 早先直接 `roundRect(pad, pad+dy, s, s)` 填充 —— 那是一个**和格子同样大**
     * 的形状，只是往下挪了 `dy`。结果它覆盖了格子内部除顶部 `dy` 以外的全部区域，
     * 等于给整颗棋子刷了一层 `rgba(112,152,172,.80)` 的侧壁色。
     *
     * 实测后果：frost 整格偏蓝偏亮 30~65（侧壁就是蓝灰）；
     * pale 的深绿侧壁也把釉面压暗了一点（角落 Δ22~28）。
     *
     * 正确做法：先把**格子本体**挖掉，再画侧壁 —— 只留露在下面的那一条弧。
     * 这样侧壁才是"瓷片的厚度"，而不是"覆盖整个面的色层"。
     */
    for (const [wdy, wcolor] of walls) {
      c.save();
      // 裁掉格子本体：只有露在外面的部分才画
      c.beginPath();
      c.rect(0, 0, box, box);
      roundRect(c, pad, pad, s, s, r);
      c.clip('evenodd');
      c.fillStyle = wcolor;
      c.beginPath();
      roundRect(c, pad, pad + wdy * k, s, s, r);
      c.fill();
      c.restore();
    }
  }
  spriteCache.set(key, cv);
  return cv;
}

/**
 * 一片釉：投影 → 147° 釉色 → 左上白光 → 整片 glint → 开片 → 倒角 →（深釉）金边。
 *
 * 画序不能动。glint 必须在开片**之前**：反光是一层贴在弧面上的膜，
 * 开片是釉下的裂（cool 的时候才裂开），把膜压在上面才是物理顺序；
 * 反过来裂纹会被提亮成"金色的缝"，读作描边。
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  r: number,
  g: Glaze,
  seed: number,
  alpha = 1,
  engrave?: (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void,
  /**
   * 是否画**冰裂开片**。
   *
   * 使用说明「格纹纪律」：「**非普通格底部不叠任何暗纹** —— 冰裂细纹、划花刻纹
   * 都不进，机制标是格内唯一读点；暗纹叠在标上会糊住标记」。
   *
   * 只有两类格该有开片：
   * - 普通格（未铺 / 已铺）—— 走完整五层叠序；
   * - **冰砖** —— 文档明写「冰砖是唯一例外：霜裂细纹是它的材质本体，不算装饰纹」。
   *
   * 其余机制格（星屑 / 钥匙 / 门 / 传送门 / 单向 / 始末点）一律净面。
   * 默认 true，由调用方按格类型关掉。
   */
  showCrack = true,
): void {
  const cx = x + s / 2;
  const cy = y + s / 2;

  // ── 投影
  if (alpha > 0.02) {
    const pad = Math.ceil(s * 0.72);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(shadowSprite(s, r, g), x - pad, y - pad, s + pad * 2, s + pad * 2);
    ctx.restore();
  }

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = alpha;

  /**
   * ── 面渐变：**逐字照抄** `linear-gradient(<deg>, …)`
   *
   * CSS 的角度从 +y（to top）起顺时针量，所以方向向量是 `(sin θ, −cos θ)`。
   * `deg` 和 `stops` 都直接来自 `Glaze.face`，这里不做任何改写。
   */
  const td = (g.face.deg * Math.PI) / 180;
  const dx = Math.sin(td);
  const dy = -Math.cos(td);
  /**
   * CSS 的渐变线长度 = `|w·sinθ| + |h·cosθ|`（整条线的长度，不是半长）。
   *
   * 端点 = 中心 ± 方向 × (L/2)。早先写的 `L = (|sin|+|cos|)·s/2` 再
   * `cx ± dx·L`，实际端点间距只有 `2·|sin|·0.692s = 0.75s`，
   * 而正确的应该是 `1.38s` —— **渐变线短了 45%**。
   *
   * 后果：格子（边长 `s`）只落在渐变的前 55%，
   * 也就是永远取不到后半段的深色，整格系统性**偏亮**。
   * frost 实测偏亮 40~60 就是这个原因（它的 3 个停靠点跨度大，缺掉后半段最明显）。
   */
  const L = (Math.abs(dx) + Math.abs(dy)) * s;
  const ramp = ctx.createLinearGradient(cx - dx * L * 0.5, cy - dy * L * 0.5, cx + dx * L * 0.5, cy + dy * L * 0.5);
  for (const [color, at] of g.face.stops) ramp.addColorStop(at, color);
  ctx.beginPath();
  roundRect(ctx, x, y, s, s, r);
  ctx.fillStyle = ramp;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, s, s, r);
  ctx.clip();


  /**
   * ── 左上径向高光：**照抄** `radial-gradient(<sx>% <sy>% at <x>% <y>%, COLOR, transparent <fade>%)`
   *
   * `size` 是半轴（相对格宽），`at` 是圆心（相对格宽）。`fade` 是"变透明"的停靠点。
   * 一个圆角矩形格子上，`38% 30%` 的椭圆是扁的（横长竖短）——
   * 这正是"一整片斜着受光的弧面"，而不是"一颗圆光斑"。
   *
   * 早先这里写死 `27%/19%`、半径 `1.18×0.46`、颜色由 `sheen` 折出来，
   * 三处都和设计稿不同（设计稿是 `23%/15%`、`38% 30%`、`rgba(255,255,255,.85)`）。
   */
  {
    const hx = x + s * g.hi.at[0];
    const hy = y + s * g.hi.at[1];
    const rx = s * g.hi.size[0];
    const ry = s * g.hi.size[1];
    /**
     * canvas 没有"椭圆径向渐变"，标准做法是**在变换后的坐标系里建圆渐变**：
     * 先 `translate` + `scale(1, ry/rx)`，再画半径 `rx` 的圆 ——
     * 圆在设备空间里就被压成 `rx × ry` 的椭圆，渐变也跟着一起压。
     *
     * 这里必须用**矩阵变换**而不是"先画圆再缩放图层"：
     * 后者会把 `addColorStop` 的插值也一起拉长，导致边缘衰减比 CSS 快/慢。
     */
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(1, ry / rx);
    const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    sheen.addColorStop(0, g.hi.color);
    // CSS 的 `transparent 72%`：72% 之后全是透明，且 0→72% 之间是**线性**插值
    sheen.addColorStop(g.hi.fade, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.restore();
  }

  /**
   * ── 右下径向转暗：**照抄** `radial-gradient(<sx>% <sy>% at <x>% <y>%, COLOR, transparent <fade>%)`
   *
   * 设计稿的釉面是**两层径向**：左上凸起受光、右下远端背光。一凸一凹才"隆起"。
   * 颜色也是逐格不同 —— 浅釉格是 `rgba(16,40,30,.46)`（偏绿），
   * 深釉格是 `rgba(0,0,0,.52)`（纯黑），冰砖是 `rgba(80,130,155,.35)`（偏蓝）。
   * 早先这里用一个 `0.52 × (sheen/0.34) × 0.62` 的公式折，三种格的色相全丢了。
   */
  if (g.dim) {
    const dxp = x + s * g.dim.at[0];
    const dyp = y + s * g.dim.at[1];
    // CSS 的 `120% 120%` 就是**半轴等于 1.2 倍格宽**，不需要再折半。
    // 早先这里多乘了 0.5 —— 那是"换算残留"，让转暗范围缩了一半，
    // 结果一整片釉面比设计稿亮（实测 frost 偏亮 40~70）。
    const rx = s * g.dim.size[0];
    const ry = s * g.dim.size[1];
    ctx.save();
    ctx.translate(dxp, dyp);
    ctx.scale(1, ry / rx);
    const dim = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    dim.addColorStop(0, g.dim.color);
    dim.addColorStop(g.dim.fade, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = dim;
    ctx.fill();
    ctx.restore();
  }

  if ((globalThis as any).__EXP_ONLY_FACE) { ctx.restore(); ctx.restore(); return; }

  // ── 整片 glint：`linear-gradient(118deg, #fff .22, #fff .06 18%,
  //    transparent 34%, transparent 72%, #000 .10)`
  //
  //    这一层是"釉"和"塑料片"的分界：它描的是整个曲面（左上亮到右下暗），
  //    而不是在顶部点一颗光斑。少它 → 棋子读作贴纸；多它（当高光用）→ 读作玻璃珠。
  // 颜色与停靠点直接来自 `Glaze.glint`（`null` = 这一格没有反光层，比如石障）
  if (g.glint) {
    const gd = (118 * Math.PI) / 180;
    const gx = Math.sin(gd);
    const gy = -Math.cos(gd);
    const GL = (Math.abs(gx) + Math.abs(gy)) * s * 0.5;
    const gl = ctx.createLinearGradient(cx - gx * GL, cy - gy * GL, cx + gx * GL, cy + gy * GL);
    for (const [color, at] of g.glint) gl.addColorStop(at, color);
    ctx.fillStyle = gl;
    ctx.fillRect(x, y, s, s);
  }

  // ── 开片：三根折线 × 两遍。
  //    深线压、白线提、错位 0.5/0.6 —— 裂缝两侧一明一暗才是"裂"，单线只是划痕。
  //
  //    `showCrack === false` 时整段跳过：机制格是净面（见参数说明）。
  //    用 `if` 包住而不是把 `crack` 置 0 —— 置 0 仍会画三条 alpha=0 的路径，
  //    每帧白白多六次 stroke（11×11 的盘上就是七百多次）。
  const dark = 0.30 * g.crack;
  const light = 0.34 * g.crack;
  const cw = Math.max(0.5, s * 0.0069);
  const hw = Math.max(0.4, s * 0.00475);
  for (let i = 0; showCrack && i < 3; i++) {
    let px = hash(seed * 11.3 + i * 7.7);
    let py = hash(seed * 13.9 + i * 4.3);
    ctx.beginPath();
    ctx.moveTo(x + px * s, y + py * s);
    for (let k = 0; k < 3; k++) {
      px += (hash(seed * 3.7 + i * 5.1 + k * 1.7) - 0.5) * 0.46;
      py += (hash(seed * 5.9 + i * 2.3 + k * 2.9) - 0.35) * 0.42;
      ctx.lineTo(x + px * s, y + py * s);
    }
    ctx.strokeStyle = `rgba(46,84,68,${dark})`;
    ctx.lineWidth = cw;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.save();
    ctx.translate(s * 0.006, s * 0.0075);
    ctx.strokeStyle = `rgba(255,255,255,${light})`;
    ctx.lineWidth = hw;
    ctx.stroke();
    ctx.restore();
  }

  // ── 划花刻纹
  //
  //    设计稿的五层叠序里它在**扫光之后、倒角之前**：纹样是"刻进釉里"的，
  //    所以它要压在冰裂与扫光之上（刻痕比釉面高一层才看得见），
  //    又要被最后那道倒角受光压住（否则刻痕会浮在片子外面）。
  //    放早了会被 glint 洗掉一半，放晚了会盖过格子自己的边缘。
  if (engrave) engrave(ctx, x, y, s);

  // ── 倒角
  //
  //    上唇是 `inset 0 1px 0` —— 一根**硬线**，不是渐变。
  //    用渐变会变成"顶上刷了一道白雾"，整盘读作软糖（老版栽在这里）。
  /**
   * **一圈 chamfer**：左上白棱 + 右下暗棱（设计稿 `inset 1.5px 1.5px 0` /
   * `inset -1.5px -1.5px 0`）。
   *
   * 这是"瓷片被磨过的边"：光从左上来，朝左上的棱受光（白），朝右下的背光（暗）。
   * 两者都**硬边、模糊 0** —— 用渐变会变成整圈发白，读作软糖。
   *
   * ## 为什么用"描边 + 线性渐变做 alpha"而不是切两个半区
   *
   * 第一版把上下半区各 `clip` 一次、分别描白 / 描暗。问题在圆角处：
   * 矩形的裁剪边和圆角咬不上，左右两侧各留一道**竖直的接缝**
   * （实测：每格左边一条亮线，像贴歪的纸）。
   *
   * 现在改成：描一整圈，颜色用**沿 135° 的线性渐变**从上到下由暗转透明，
   * 于是同一条棱自然"上半白、下半暗"，没有任何裁剪边。
   * 这比切半区更接近 CSS 的 `inset 1.5px 1.5px 0` 观感 ——
   * CSS 的 inset 阴影本来就是"整圈 + 方向偏移"，不是"切一半"。
   */
  /**
   * ── 倒角棱：`inset 1.5px 1.5px 0 hi` + `inset -1.5px -1.5px 0 lo`
   *
   * 这两个 inset 的语义是"整圈 + 方向偏移"：白的那条压在左上，暗的那条压在右下。
   * 实现用**沿 135° 的线性渐变描一整圈**：左上半边自然吃到 `hi`、
   * 右下半边吃到 `lo`，不需要切两个半区（切半区会在圆角处留竖直缝）。
   *
   * 颜色直接来自 `Glaze.bevel`，不乘系数。`null` = 这一格没有倒角。
   *
   * 宽度：CSS 的 `1.5px` 是 64px 棋子上的，按 `s/64` 换算才是同一个视觉厚度
   * （这是"尺寸换算"不是"颜色换算" —— 颜色一字不改）。
   */
  if (g.bevel) {
    const bevel = Math.max(1, s * (1.5 / 64));
    const bdx = x + s * 0.5;
    const bdy = y + s * 0.5;
    const bl = s * 0.75;
    const bev = ctx.createLinearGradient(bdx - bl * 0.7, bdy - bl * 0.7, bdx + bl * 0.7, bdy + bl * 0.7);
    bev.addColorStop(0, g.bevel.hi);
    // 中段过渡到 lo：CSS 没有中间的"透明段"，两条 inset 在 45° 处换手
    bev.addColorStop(0.5, g.bevel.lo);
    bev.addColorStop(1, g.bevel.lo);
    ctx.beginPath();
    roundRect(ctx, x + bevel * 0.5, y + bevel * 0.5, s - bevel, s - bevel, Math.max(1, r - bevel * 0.5));
    ctx.strokeStyle = bev;
    ctx.lineWidth = bevel;
    ctx.stroke();
  }

  /**
   * ── 顶内高光：`inset 0 2px 7px <insetHi>`（设计稿里有这条的才是亮釉格）。
   *
   * 做法：从顶边往下铺一段渐变，`2px` 是偏移、`7px` 是模糊半径。
   * 模糊用"从色到透明"的渐变近似 —— canvas 没有内阴影滤镜。
   * **石障没有这一条**（`insetHi` 未定义），所以它顶部不泛亮。
   */
  if (g.insetHi) {
    const sp = s * (2 / 64);
    const bh = s * (7 / 64);
    const ih = ctx.createLinearGradient(0, y + sp, 0, y + sp + bh);
    ih.addColorStop(0, g.insetHi);
    ih.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ih;
    ctx.fillRect(x, y, s, sp + bh);
  }

  /**
   * ── 底内暗：`inset 0 -8px 18px <insetLo>`
   *
   * 从底边往上铺 8px 偏移 + 18px 模糊。这一层是"格子坐在台面上、
   * 底沿被台面吃掉"的读法，不是装饰。
   */
  if (g.insetLo) {
    const sp = s * (8 / 64);
    const bh = s * (18 / 64);
    const lo = ctx.createLinearGradient(0, y + s - sp - bh, 0, y + s);
    lo.addColorStop(0, 'rgba(0,0,0,0)');
    lo.addColorStop(1, g.insetLo);
    ctx.fillStyle = lo;
    ctx.fillRect(x, y + s - sp - bh, s, sp + bh);
  }

  ctx.restore(); // clip

  /**
   * ── 缘光线：`0 0 0 1px <rim.line>`
   *
   * 这是设计稿标"这一格是什么身份"的最外一圈（金/朱/天青/紫/白）。
   * 画在 clip 外面，因为它压在格子轮廓上、略微出界。
   */
  if (g.rim) {
    ctx.beginPath();
    roundRect(ctx, x - 0.75, y - 0.75, s + 1.5, s + 1.5, r + 0.75);
    ctx.strokeStyle = g.rim.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore(); // alpha
}

/**
 * 墨石：不可走的死物。哑光、层理、只受一点点光。
 *
 * 它存在的意义是**反衬釉面**：盘上唯一没有穹顶的东西，让釉更像釉。
 *
 * 三件事让它成立（早先只画了一个十几像素的暗多边形，在底板上一片糊）：
 *
 * 1. **接触阴影**：石头是压进板里的，先给一层椭圆暗影，它才"落地"；
 * 2. **两个面**：亮面（左上）与暗面（右下）用一条折线分开 ——
 *    单色多边形读作"洞"，两色才读作"块"；
 * 3. **棱线只在上缘**：光从左上来，受光的只有朝左上的那三条边。
 */
// ────────────────────────── 抵达 · 爆闪 ──────────────────────────

/**
 * 抵达终点的爆闪（设计稿「抵达 · 爆闪 / ARRIVE BURST」）。
 *
 * ## 全盘最亮的一帧
 *
 * 设计稿的原话是「全盘最亮的一帧，1.2s 后归于安静」。它出现在**线头碰到终点**
 * 的那一瞬 —— 之后才开始从终点反向点亮全路径，最后才是落印。
 * 所以这一下的作用是"宣告到了"，不是"庆祝赢了"。两者的差别在于**长度**：
 * 它只有 420ms 就退干净，中间不留任何余韵。
 *
 * ## 四件事叠在一起（设计稿 `MARKS.arrive`）
 *
 * 1. **八芒射线**：45° 一组，长 3.2、宽 1.3、圆头。**只有八根**——
 *    十二根以上就变成"太阳"，八芒才是"迸发"。
 * 2. **外实环** r=8.6（金）+ **内虚环** r=5.1（金，dash 2.6/2.2）+ **芯点** r=1.8。
 *    和终点标记同一个几何 —— 爆闪是终点标记"炸开"的那一瞬，不是另一枚图形。
 * 3. **格子的放大**：整颗棋子 scale 1.08（`transform: scale(1.08)`）。
 *    1.08 是**上限**：再大就会盖住邻格，读作"这一格跳出来了"而不是"亮了"。
 * 4. **辉光**：`0 0 42px` 的金，峰值 alpha 0.5。
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
  // 起势 12%、余下 88% 退干净：迸发是"一瞬间"，不是"渐亮渐暗"
  const k = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
  const ease = k * k;
  const r = size / 2;
  /**
   * 24 视图 → 像素的换算档。
   *
   * 终点标记（`endpoint`）里用的是 `cell * 0.30 / 8`，即半径 8 对应 0.30 格。
   * 爆闪要盖住那枚标记，所以用同一档：`u = size * 0.30 / 8 / 12`。
   * 早先按 `r / 12`（半径 12 = 半格）算，射线顶到 11u ≈ 0.46 格，
   * 直接压到邻格上了 —— 而设计稿的 8 根芒是贴在环外的短芒，不出格。
   */
  const u = (size * 0.30) / 8 / 12;

  ctx.save();
  ctx.translate(cx, cy);

  // ① 辉光：铺在一切之下的一团暖金。用径向渐变而不是 shadowBlur ——
  //    这个函数每帧只在 420ms 内调一次，但盘上可能同时有几处（多终点？不会），
  //    总之手绘渐变比改 shadow 状态便宜，也不会污染后续绘制
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
  glow.addColorStop(0, `rgba(242,220,168,${0.50 * k})`);
  glow.addColorStop(0.42, `rgba(212,175,106,${0.20 * k})`);
  glow.addColorStop(1, 'rgba(212,175,106,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
  ctx.fill();

  // ② 八芒射线：**以格宽为基准**，不绕 24 视图。
  //
  // 设计稿里射线的位置是 r 7.8→11（24 视图，画布半径 12），
  // 也就是占到格子半径的 0.65~0.92。换算到 `size/2`：0.325~0.46 个 size。
  // 直接按这个比例画，芒尖落在格子边缘**内侧**，不出格。
  const half = size / 2;
  const RAY_IN = half * 0.62;
  const RAY_OUT = half * (0.66 + 0.26 * Math.min(1, k * 2.2));
  ctx.strokeStyle = `rgba(242,220,168,${0.92 * ease})`;
  ctx.lineWidth = Math.max(1, size * 0.026);
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

  // ③ 外环：**和终点标记同半径**（8.6 单位 = 0.30 格），但更亮更粗。
  //
  // 半径必须严格对齐终点自己那圈 —— 差一点就成了"双圈套双圈"，
  // 实测读作一团糊金。同半径叠上去只是"让它亮起来"，那正是爆闪要的。
  ctx.beginPath();
  ctx.arc(0, 0, 8.6 * u, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(242,220,168,${0.85 * k})`;
  ctx.lineWidth = Math.max(1.6, 2.2 * u);
  ctx.stroke();

  // ④ **不再叠内虚环 + 芯点**。
  //
  // 设计稿的 `MARKS.arrive` 是"独立一枚标记"（用在展示页里，底下没有终点），
  // 而盘上这一格**本来就有终点标记**（外实环 + 内虚环 + 芯点）。
  // 两套叠在一起 = 双圈套双圈，实测读成一团糊金，而且会盖掉终点本来的款。
  // 爆闪只出"多出来的部分"：一圈更亮的外环 + 八芒 + 辉光。
  ctx.restore();
}

// ────────────────────────── 朱印落纸 ──────────────────────────

/**
 * 通关的印：一枚**圆形朱印**，从上方砸下来。
 *
 * ## 为什么是圆的，而鸣沙是方的
 *
 * 同一个动作，两种器物：鸣沙是**石章**（方、重、砸进墙里，墙跟着抖），
 * 天青是**瓷印**（圆、轻、落在绢上，只有一层朱砂压痕）。
 * 形状不是装饰 —— 方章说的是"盖住了这段路"，圆印说的是"落款"。
 *
 * ## 轨迹照设计稿 `sealDrop`
 *
 * `-70px / rot(-12°) / scale(1.14)` → `+3px / rot(-8.6°) / .97`（55% 触底）
 * → `-3px / rot(-8.2°) / 1.015`（72% 回弹）→ `0 / rot(-8°) / 1`。
 * 那 −8° 的微斜是**关键**：正着落的印是"排版元素"，歪 8° 才是"手盖的"。
 */
function drawSealStamp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  elapsed: number,
): void {
  const MS = 320;
  if (elapsed < 0 || elapsed >= MS + 900) return;
  const t = Math.min(1, Math.max(0, elapsed / MS));

  // ── 姿态：三段（下落 / 触底 / 回弹）
  let dy: number;
  let rot: number;
  let k: number;
  let alpha: number;
  if (t < 0.55) {
    const u = t / 0.55;
    const e = 1 - (1 - u) * (1 - u) * (1 - u); // 釉落：前段快
    dy = -70 * (size / 132) * (1 - e) + 3 * (size / 132) * e;
    rot = -12 + 3.4 * e;
    k = 1.14 + (0.97 - 1.14) * e;
    alpha = Math.min(1, u * 2.2);
  } else if (t < 0.72) {
    const u = (t - 0.55) / 0.17;
    dy = 3 * (size / 132) * (1 - u) + -3 * (size / 132) * u;
    rot = -8.6 - 0.4 * u;
    k = 0.97 + 0.045 * u;
    alpha = 1;
  } else {
    const u = (t - 0.72) / 0.28;
    dy = -3 * (size / 132) * (1 - u);
    rot = -8.2 + 0.2 * u;
    k = 1.015 - 0.015 * u;
    alpha = 1;
  }

  const r = size / 2;
  ctx.save();
  ctx.translate(cx, cy + dy);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(k, k);
  ctx.globalAlpha = alpha;

  // ── 印泥：三层（外晕 / 主体 / 内圈）。
  //    外晕是"纸吸掉的一圈"，没有它，红圆就是贴上去的一块色
  const halo = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.5, 0, 0, r * 1.06);
  halo.addColorStop(0, 'rgba(192,75,51,0.30)');
  halo.addColorStop(1, 'rgba(192,75,51,0)');
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.06, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  const body = ctx.createRadialGradient(-r * 0.34, -r * 0.36, r * 0.08, 0, 0, r);
  body.addColorStop(0, '#D25B40');
  body.addColorStop(0.55, K.seal);
  body.addColorStop(1, K.sealDeep);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();

  // 边：外圈一道更深的唇 —— 印是"压"下去的，边缘比中间吃墨更多
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(142,52,36,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.055);
  ctx.stroke();

  /**
   * 印文：一个「过」字。这是整个游戏唯一一次写出"结束"。
   *
   * ## 字号按**圆的内切方形**算，不是按直径
   *
   * 天青的印是**圆**的（瓷印），而丹青是方的（石章）。两者能放下多大的字
   * 完全不同：方印的字可以占到边长 0.47 左右，圆印只能占到它的**内切方形**
   * —— 边长 `size/√2 ≈ 0.707 size`，再留一圈印边，实际可用约 `0.55 size`。
   *
   * 早先写 `r * 1.30`（= `0.65 size`）：那个比例是照**方印**给的，
   * 套到圆印上字的对角落到 `0.92 size` —— 远远超出 `0.707 size` 的圆面，
   * "过"的四个角（横的右端、辶的底弯）会顶到圆边外。
   * 81px 的时候看不出来（整体就小，糊在一起），
   * 放大到 192px 之后这个溢出就一眼可见。
   *
   * `r * 1.12 = 0.56 size`：字面对角 `0.79 size`，落在内切方形里，
   * 四周还留约 0.1 size 的印边 —— 和结算页那个 192 的印（字 96 = 0.5 size）同量级。
   */
  ctx.fillStyle = 'rgba(255,236,224,0.94)';
  ctx.font = `900 ${Math.round(r * 1.12)}px ${SEAL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('过', 0, r * 0.04);

  ctx.restore();
}

/** 印文用的字族：宋体优先（篆意的骨），退到系统黑体 */
const SEAL_FONT =
  '"Songti SC","STSong","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif';

function drawStone(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, idx: number): void {
  const r = s * 0.44;

  // 八边形带抖动（不是圆也不是方 —— 自然的碎石）
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2 + hash(idx * 3.7) * 0.35;
    const rr = r * (0.90 + hash(idx * 2.3 + i * 1.9) * 0.16);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  // ① 接触阴影：压进板里的一圈
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.22, r * 0.96, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();
  ctx.restore();

  // ② 石体：左上受光、右下背光
  trace();
  const g = ctx.createLinearGradient(cx - r * 0.8, cy - r * 0.9, cx + r * 0.7, cy + r);
  g.addColorStop(0, '#31443A');
  g.addColorStop(0.42, '#1D2C24');
  g.addColorStop(1, '#0A120E');
  ctx.fillStyle = g;
  ctx.fill();

  // ③ 亮面：左上一片（按顶点切一半，不是再画一个圆）
  ctx.save();
  trace();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.1, cy - r * 1.1);
  ctx.lineTo(cx + r * 1.1, cy - r * 1.1);
  ctx.lineTo(cx + r * 1.1, cy - r * 0.10);
  ctx.lineTo(cx - r * 1.1, cy - r * 0.55);
  ctx.closePath();
  ctx.fillStyle = 'rgba(150,178,160,0.10)';
  ctx.fill();
  ctx.restore();

  // ④ 层理：两道短痕。石头是「压出来的」，不是「长出来的」
  ctx.strokeStyle = 'rgba(3,7,5,0.55)';
  ctx.lineWidth = Math.max(1, s * 0.020);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy - r * 0.14);
  ctx.lineTo(cx + r * 0.12, cy + r * 0.02);
  ctx.lineTo(cx + r * 0.52, cy - r * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.34, cy + r * 0.30);
  ctx.lineTo(cx + r * 0.28, cy + r * 0.42);
  ctx.stroke();

  // ⑤ 受光棱：只左上三段。死物也有光，只是光到棱为止
  ctx.beginPath();
  ctx.moveTo(pts[6][0], pts[6][1]);
  ctx.lineTo(pts[7][0], pts[7][1]);
  ctx.lineTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.strokeStyle = 'rgba(158,186,168,0.22)';
  ctx.lineWidth = Math.max(1.2, s * 0.016);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, x, y, walk, type, gx, gy, idx } = g;
  const cx = x + cell / 2;
  const cy = y + cell / 2;

  // 槽位 → 棋子：内缩半个间距（设计稿 7 CSS）
  const inset = BOARD_GAP / 2;
  const s = cell - inset * 2;
  // 圆角 10/31 ≈ 0.32 —— 比常见卡片圆得多，接近"瓷片"而不是"按钮"
  const r = Math.max(6, s * 0.272);
  const seed = gx * 37.9 + gy * 21.3 + 1;

  if (type === CoverCell.BLOCK) {
    /**
     * 石障 = **整格墨石釉面 + 一块八边形原石**，两层。
     *
     * 设计稿的格态卡是 `makePC('stone', null, 61)` —— `cls='stone'` 会带上
     * `.pc.stone` 的**整格底色**（`linear-gradient(150deg, #3C423E, #232925, #12160F)`）
     * 和它自己的近黑侧壁，然后才在上面画那块原石。
     *
     * 早先这里只调了 `drawStone()` 就 return —— 格面是空的，
     * 墨石直接浮在盘面上，四周露出一圈底板（用户截图里那些"空白的地方"）。
     * 那不是"少了一块石头"，是**石障自己这一格的釉面没画**。
     */
    drawTile(ctx, x + inset, y + inset, s, r, GLAZE_STONE, seed, 1, undefined, false);
    drawStone(ctx, cx, cy, s * 0.94, idx);
    return;
  }

  // 机制格有自己的色相（设计稿：门/单向=石板青，传送=暮紫，星=鎏金，钥=铜，冰=霜青），
  // 但明度带与"生釉"一致 —— 整盘得是同一批出窑的器物，不能有哪一格发暗
  switch (type) {
    case CoverCell.ICE:
      /**
       * 冰砖：**霜裂 + 一枚划花刻纹，但没有格内标**。
       *
       * 设计稿的格态卡是 `makePC('frost', 'moon', 66)`：
       * - `cls='frost'` → 霜裂细纹（材质本体，`showCrack` 保持 true）；
       * - 第 2 个参数是 **`glyphName`**，画进 `.glyph` 层 —— 那是**六字纹样**层；
       * - 第 4 个参数 `markName` **没传** → `.mark` 层（格内标）是空的。
       *
       * 而 `makePC` 内部 `clean = isSpecial && !isFrost`：冰砖 `isFrost=true`
       * 且无 `markName`，所以 `clean=false` —— 霜裂和纹样**两样都画**。
       *
       * 也就是说冰砖是"有材质纹、有装饰纹、唯独没有机制标"的格。
       * 它的读点是**整块比周围亮一档 + 霜裂**，不是格心那枚冰晶。
       *
       * 这里纹样按 `motifOf` 轮换（和普通格同一套规则）：格态卡里恒传 `'moon'`
       * 只是"这一张示例用哪一品"，盘面上几十块冰砖都长同一枚反而机械。
       */
      drawTile(ctx, x + inset, y + inset, s, r, GLAZE_FROST, seed, walk ? 0.94 : 1, (c, tx, ty, ts) => {
        drawEngrave(c, tx + ts / 2, ty + ts / 2, ts, gx, gy, GLAZE_FROST);
      });
      return;
    case CoverCell.SHARD:
      // 星屑：**净面**（格纹纪律）—— 深釉 + 一枚金星，不叠冰裂
      drawTile(ctx, x + inset, y + inset, s, r, GLAZE_STAR, seed, 1, undefined, false);
      return;
    case CoverCell.KEY:
      // 钥匙：**净面** —— 朱印色钥坯是唯一的读点
      drawTile(ctx, x + inset, y + inset, s, r, GLAZE_KEY, seed, 1, undefined, false);
      return;
    case CoverCell.PORTAL:
      // 传送门：**净面** —— 深靛漩底 + 同心环是主体，
      // 冰裂是"瓷釉开片"，压在暮紫上会读成脏点
      drawTile(ctx, x + inset, y + inset, s, r, GLAZE_VIOLET, seed, 1, undefined, false);
      return;
    case CoverCell.ONEWAY:
      // 单向：**净面** —— 石板青 + 金箭坯，不叠冰裂
      drawTile(ctx, x + inset, y + inset, s, r, GLAZE_DARK, seed, 1, undefined, false);
      return;
    case CoverCell.GATE:
      // 门：关着是石板青，**开着是天青透光**（设计稿 `door-open` 的
      // `0 0 22px rgba(150,205,185,.20)` —— 整颗棋子比周围亮一档）。
      // 只换图标不换格面色的话，开着的门在盘上还是一块暗石板，
      // 玩家得凑近看图标才知道"这扇已经过了"。
      drawTile(ctx, x + inset, y + inset, s, r, g.variant === 'gateOpen' ? GLAZE_OPEN : GLAZE_DARK, seed, 1, undefined, false);
      return;
    default:
      break;
  }

  // 普通格：没走过 = 生釉（亮青），走过 = 深釉 + 金边
  //
  // **走过变深**，不是变亮。设计稿的规矩是"铺格"：铺过的格是烧成了的那一颗，
  // 更沉、更暗，边上一圈金 —— 金线正压在它上面，一深一亮才读得出路线。
  // 反过来（走过变亮）会让整盘往白里推，金线在金格上就没处可去了。
  //
  // 划花刻纹**两态都刻**（设计稿的"同一纹·两态对照"）：
  // 未铺是深青刻纹、已铺是浅青刻纹。只刻未铺的话，走过之后那一片会变得
  // 完全平 —— 玩家会以为刻纹是"可走的标记"，而它其实只是格子的身份。
  const glaze = walk ? GLAZE_DEEP : GLAZE_PALE;

  // **刻纹只给普通格（BRICK）**。
  //
  // 使用说明「格纹纪律」：「非普通格（起点/终点/起手按下/线头/单向/星屑/钥匙/
  // 门/传送门/石障等带机制标的格）底部不叠任何暗纹」。
  //
  // 起点 / 终点虽然也是"可走的普通格"（`CoverCell.START/END` 的注释就这么写），
  // 但它们**带机制标**（金圈 + 菱 / 金双圈 + 芯点），所以属于"非普通格"。
  // 早先这里无条件传了刻纹回调 —— 起点格的金环底下透出一枚月纹，
  // 终点格的金环底下透出一枚浪纹，两层叠在一起读作"糊了"。
  if (type === CoverCell.BRICK) {
    drawTile(ctx, x + inset, y + inset, s, r, glaze, seed, 1, (c, tx, ty, ts) => {
      drawEngrave(c, tx + ts / 2, ty + ts / 2, ts, gx, gy, glaze);
    });
  } else {
    drawTile(ctx, x + inset, y + inset, s, r, glaze, seed);
  }
}

// ────────────────────────── 划花九品 ──────────────────────────

/**
 * 格面刻纹（设计稿 壹·"划花九品"）。
 *
 * ## 为什么不是装饰，而是"读盘"的一部分
 *
 * 盘面 90% 的注视落在这里。没有刻纹时，一整片**同色的圆角方块**在灰度下
 * 是一张网纹纸 —— 玩家分不出"这一格和那一格"；有了刻纹，每格才有"这一片
 * 是月、那一片是浪"的身份，也才看得见自己走过哪几片。
 *
 * ## 三条纪律（设计稿原文）
 *
 * 1. **双线立体**：暗刻槽在下，受光边 `translate(0.5,0.6)` 在上 ——
 *    单线只是一道划痕，双线才是"刻进去的槽"。
 * 2. **只用 round cap / round join**，禁锐角飞白。
 * 3. **纹样压在冰裂之上、扫光之下**（画序见 `drawTile` 的 `engrave` 参数）。
 *
 * 坐标取自设计稿的 24 视图，这里换算到格心为原点、`h = s/2` 的像素空间，
 * 所以线宽按 `s` 走 —— 换格子大小时刻纹不会"变粗"。
 */
type Motif = (c: CanvasRenderingContext2D, h: number) => void;

/** 24 视图 → 单位坐标（原点移到格心）。 */
const U = (x: number, y: number): [number, number] => [(x - 12) / 12, (y - 12) / 12];

/** 24 视图路径 → 单位坐标点列。 */
function upath(pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  return pts.map(([x, y]) => U(x, y));
}

/** 折线（不闭合）。 */
function poly(c: CanvasRenderingContext2D, h: number, pts: Array<[number, number]>, close = false): void {
  c.beginPath();
  c.moveTo(pts[0][0] * h, pts[0][1] * h);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] * h, pts[i][1] * h);
  if (close) c.closePath();
  c.stroke();
}

/**
 * SVG 的 `A r r 0 large sweep x y` → Canvas 的 `arc(圆心, 起止角)`。
 *
 * 为什么需要这一步：设计稿的纹样全是 SVG 路径，而 "A"（椭圆弧）给的是
 * **终点**，不是圆心 —— Canvas 只认圆心。硬把角度凑成"看起来像"，
 * 月的两段弧就会凑成两片同心圆（上一版就是这样，月牙变成了一道括号）。
 *
 * 换算取自 SVG 规范的「端点 → 圆心」一节（φ=0 的圆，不是椭圆）：
 * 圆心落在弦的垂直平分线上，偏移量由半径与弦长决定。
 * `large` / `sweep` 两个 flag 决定取哪一侧、往哪个方向画。
 */
function arcTo(
  c: CanvasRenderingContext2D,
  h: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  large: 0 | 1,
  sweep: 0 | 1,
): void {
  const p1x = U(x1, y1)[0] * h;
  const p1y = U(x1, y1)[1] * h;
  const p2x = U(x2, y2)[0] * h;
  const p2y = U(x2, y2)[1] * h;
  let rr = r * (h / 12);

  // 弦半长
  const hx = (p1x - p2x) / 2;
  const hy = (p1y - p2y) / 2;
  const d2 = hx * hx + hy * hy;
  // 弦比直径还长时 SVG 会把半径撑大，否则无解
  if (d2 > rr * rr) rr = Math.sqrt(d2);
  const mid = Math.sqrt(Math.max(0, rr * rr - d2)) / Math.sqrt(Math.max(1e-9, d2));
  // large XOR sweep → 圆心在弦的另一侧
  const s = large !== sweep ? 1 : -1;
  const cx = s * mid * hy + (p1x + p2x) / 2;
  const cy = -s * mid * hx + (p1y + p2y) / 2;

  const a0 = Math.atan2(p1y - cy, p1x - cx);
  const a1 = Math.atan2(p2y - cy, p2x - cx);
  c.arc(cx, cy, rr, a0, a1, sweep === 0);
}

/**
 * 九品：月 / 梅 / 浪 / 山 / 云 / 鱼 / 竹 / 叶 / 星。
 *
 * 每格只刻**一主纹**，留白 ≥ 40% —— 三成到五成格面有东西就够，
 * 满格画满会退成一张花纹布。
 */
const NINE: ReadonlyArray<{ key: string; draw: Motif }> = [
  // 月：设计稿 `M15.5 5.2 A8 8 0 1 0 15.5 18.8 A6.4 6.4 0 1 1 15.5 5.2 Z`。
  //
  // 两段弧的圆心**不在同一点**上，月牙就是这么来的：
  // 外弧大半径、缺口朝左；内弧回到起点，把中间那一块挖掉。
  // 硬把角度凑成"看起来像"只会得到两片同心圆 —— 月牙就成了一道括号。
  {
    key: 'moon',
    draw: (c, h) => {
      c.beginPath();
      c.moveTo(U(15.5, 5.2)[0] * h, U(15.5, 5.2)[1] * h);
      arcTo(c, h, 15.5, 5.2, 15.5, 18.8, 8, 1, 0);
      arcTo(c, h, 15.5, 18.8, 15.5, 5.2, 6.4, 1, 1);
      c.closePath();
      c.stroke();
    },
  },
  // 梅：六瓣环 + 心。花瓣是"点"不是"圈"—— 五瓣梅花的花瓣小而圆
  {
    key: 'plum',
    draw: (c, h) => {
      const r = (2 / 12) * h;
      for (const [x, y] of [[12, 12], [12, 5.6], [17.8, 9.6], [15.6, 16.6], [8.4, 16.6], [6.2, 9.6]] as const) {
        const [ux, uy] = U(x, y);
        c.beginPath();
        c.arc(ux * h, uy * h, r, 0, Math.PI * 2);
        c.stroke();
      }
    },
  },
  // 浪：两道反向叠浪
  {
    key: 'wave',
    draw: (c, h) => {
      for (const y of [10, 15.6]) {
        const [x0, y0] = U(3, y);
        const [c1x, c1y] = U(6, y - 2.6);
        const [c2x, c2y] = U(9, y + 2.6);
        const [x1, y1] = U(12, y);
        const [c3x, c3y] = U(15, y - 2.6);
        const [c4x, c4y] = U(18, y + 2.6);
        const [x2, y2] = U(21, y);
        c.beginPath();
        c.moveTo(x0 * h, y0 * h);
        c.bezierCurveTo(c1x * h, c1y * h, c2x * h, c2y * h, x1 * h, y1 * h);
        c.bezierCurveTo(c3x * h, c3y * h, c4x * h, c4y * h, x2 * h, y2 * h);
        c.stroke();
      }
    },
  },
  // 山：双峰 + 一轮日
  {
    key: 'mount',
    draw: (c, h) => {
      poly(c, h, upath([[2.5, 18.5], [9, 8], [13, 13.6], [15.6, 10], [21.5, 18.5]]), true);
      const [sx, sy] = U(17.6, 6.4);
      c.beginPath();
      c.arc(sx * h, sy * h, (1.6 / 12) * h, 0, Math.PI * 2);
      c.stroke();
    },
  },
  // 云：设计稿 `M6.5 17.5 A4.2 4.2 0 1 1 7.2 9.2 A5.4 5.4 0 0 1 17.4 9.8
  //        A3.9 3.9 0 1 1 17.8 17.5 Z` —— 三团弧接成的一朵。
  // 每段都是"从上一段终点画到本段终点"的圆弧，**不是**在固定圆心上画角度，
  // 所以必须走 `arcTo`；否则三团弧会各转各的，接不上。
  {
    key: 'cloud',
    draw: (c, h) => {
      c.beginPath();
      c.moveTo(U(6.5, 17.5)[0] * h, U(6.5, 17.5)[1] * h);
      arcTo(c, h, 6.5, 17.5, 7.2, 9.2, 4.2, 1, 1);
      arcTo(c, h, 7.2, 9.2, 17.4, 9.8, 5.4, 0, 1);
      arcTo(c, h, 17.4, 9.8, 17.8, 17.5, 3.9, 1, 1);
      c.closePath();
      c.stroke();
    },
  },
  // 鱼：梭形身 + 三角尾。眼不画 —— 24 视图下 0.9px 的实心点会糊成一块脏
  {
    key: 'fish',
    draw: (c, h) => {
      const [x0, y0] = U(4, 12);
      const [c1x, c1y] = U(7, 7);
      const [c2x, c2y] = U(13, 7);
      const [x1, y1] = U(17, 12);
      const [c3x, c3y] = U(13, 17);
      const [c4x, c4y] = U(7, 17);
      c.beginPath();
      c.moveTo(x0 * h, y0 * h);
      c.bezierCurveTo(c1x * h, c1y * h, c2x * h, c2y * h, x1 * h, y1 * h);
      c.bezierCurveTo(c3x * h, c3y * h, c4x * h, c4y * h, x0 * h, y0 * h);
      c.stroke();
      poly(c, h, upath([[17, 12], [21, 8.4], [21, 15.6]]), true);
    },
  },
  // 竹：两竿 + 两道节
  {
    key: 'bamboo',
    draw: (c, h) => {
      poly(c, h, upath([[9, 3], [9, 21]]));
      poly(c, h, upath([[15, 3], [15, 21]]));
      poly(c, h, upath([[9, 8.4], [15, 8.4]]));
      poly(c, h, upath([[9, 14], [15, 14]]));
    },
  },
  // 叶：柳叶 + 一条中脉
  {
    key: 'leaf',
    draw: (c, h) => {
      const [x0, y0] = U(12, 3);
      const [c1x, c1y] = U(18, 8);
      const [c2x, c2y] = U(18, 16);
      const [x1, y1] = U(12, 21);
      const [c3x, c3y] = U(6, 16);
      const [c4x, c4y] = U(6, 8);
      c.beginPath();
      c.moveTo(x0 * h, y0 * h);
      c.bezierCurveTo(c1x * h, c1y * h, c2x * h, c2y * h, x1 * h, y1 * h);
      c.bezierCurveTo(c3x * h, c3y * h, c4x * h, c4y * h, x0 * h, y0 * h);
      c.stroke();
      poly(c, h, upath([[12, 6.5], [12, 17.5]]));
    },
  },
  // 星：五角。刻纹版的星比机制图标的星更瘦（内径 0.42 → 0.40 太接近，
  // 这里放宽到 0.44 并缩小整体），否则空盘上会有一片"没点亮的星屑"
  {
    key: 'star',
    draw: (c, h) => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? 8.4 : 3.7;
        const [ux, uy] = U(12 + Math.cos(a) * rr, 12 + Math.sin(a) * rr);
        pts.push([ux, uy]);
      }
      poly(c, h, pts, true);
    },
  },
];

/**
 * 刻纹的墨色：**跟着底色走**。
 *
 * 设计稿只给了两极（未铺 `rgba(29,58,46,.62)` / 已铺 `rgba(212,227,216,.72)`），
 * 但盘上还有鎏金、霜青、暮紫三种色相的格 —— 拿深青刻在金格上是"发绿的脏点"，
 * 拿浅青刻在霜面上等于没画。所以按 `Glaze` 反查一档：暗釉用浅刻、浅釉用深刻。
 */
interface Enamel {
  /** 暗刻槽（下） */
  cut: string;
  /** 受光边（上，`translate(.5,.6)`） */
  lift: string;
}

/** 解析 `#hex` / `rgb()` / `rgba()` 的相对亮度（0..255），解析失败返回 128。 */
function lumaOfColor(c: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  }
  const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
  if (rgb) {
    return 0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3]);
  }
  return 128;
}

function enamelFor(g: Glaze): Enamel {
  // 用第一停的明度判"这片釉是浅是深"。170 是分界：
  // 浅釉（>170）上的刻痕必须是暗的，深釉上必须是亮的
  // 取面渐变的第一停，解析 `#hex` / `rgb(…)` / `rgba(…)` 三种写法
  // —— 冰砖的第一停现在是 `rgba(214,236,242,0.62)`（照抄设计稿的半透），
  // 只认 `#hex` 会退化成默认值，把冰砖判成"深釉"。
  const lum = lumaOfColor(g.face.stops[0][0]);
  if (lum > 170) {
    // 浅釉（霜青 / 鎏金 / 铜）：压一道暗刻，再在下方提一道极弱的高光 ——
    // 高光在**下面**是因为浅底上的"凸起"读作反光，凹槽的受光边在槽的下沿
    return { cut: 'rgba(29,58,46,0.62)', lift: 'rgba(255,255,255,0.40)' };
  }
  // 深釉（生青 / 深青 / 暮紫 / 石板）：浅刻 + 下方一道更深的槽
  return { cut: 'rgba(212,227,216,0.72)', lift: 'rgba(12,26,20,0.42)' };
}

/** 一格该刻哪一品。按格坐标轮换 —— 相邻两格不同纹，整盘才不会成花纹布。 */
function motifOf(gx: number, gy: number): Motif {
  return NINE[(((gx * 2 + gy * 3) % NINE.length) + NINE.length) % NINE.length].draw;
}

/** 在格内刻一品：暗槽 + 受光边（双线立体）。 */
function drawEngrave(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  gx: number,
  gy: number,
  g: Glaze,
): void {
  const m = motifOf(gx, gy);
  const enamel = enamelFor(g);
  // 主纹占格面 ≤ 55%：设计稿是 64px 的格衬 34px 的纹（0.531），
  // 这里 `h` 是半宽 → 0.26 恰好对上
  const h = s * 0.26;
  // 线宽：设计稿 `stroke-width:1.7` 是 24 视图里的数，而纹样在 64px 的格上
  // 占 34px（scale 34/24）→ 实际落笔 1.7×34/24 = 2.41px，即 0.0376 格。
  // 先前按 1.7/31 写，粗了一半多，刻纹在白釉上糊成了一道描边
  const lw = Math.max(1, s * 0.0376);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ① 暗刻槽：主导线。纹样的"形"全靠这一道
  ctx.strokeStyle = enamel.cut;
  ctx.lineWidth = lw;
  m(ctx, h);

  // ② 受光边：错开 0.5/0.6（设计稿的 `translate(0.5,0.6)`，按 31 的格换算成比例）
  ctx.save();
  ctx.translate(s * 0.016, s * 0.019);
  ctx.strokeStyle = enamel.lift;
  ctx.lineWidth = Math.max(0.6, lw * 0.72);
  m(ctx, h);
  ctx.restore();

  ctx.restore();
}

// ────────────────────────────── 金缮光迹 ──────────────────────────────

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  width: number,
  color: string,
  dx = 0,
  dy = 0,
): void {
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
 * 金缮光迹：暗缝 → 辉光 → 金体 → 亮金 → 高光线 → 转折金珠。
 *
 * ## 设计稿的三条时序（TOKEN 表「连径 520ms · 缮线」）
 *
 * 1. **主线匀速生长**（`dashoffset` 460 → 0，`cubic-bezier(.4,0,.2,1)`）。
 * 2. **高光线滞后 80ms 跟上** —— 高光不是"和主线一起长"，是描金笔
 *    第二遍压上去的那一道。所以按 `grow` 落后一个固定量再截断。
 * 3. **辉光在 30% 处脉冲「至 0.8，再衰减到 0.42」** ——
 *    它是"描过去时笔尖一亮，然后落回去"，不是恒亮。恒亮的话，
 *    金线会像一根灯管。
 *
 * ## 五层的分工
 *
 * 暗缝在下（描金的凹槽）、辉光一层、金体、亮金、最上面是高光线。
 * **只给一层辉光**：老版叠了两层（0.29@.10 + 0.19@.22），中间那条比设计稿的
 * 芯亮一倍，整条线就读成"金胶带"而不是"一道光"。
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  cell: number,
  now: number,
  grow = 1,
): void {
  if (pts.length < 2) return;

  // 线宽照设计稿的四个 SVG 值（`glow 11 / shadow 10 / line 6 / hi 1.6`，
  // 画在 24 视图、最终铺到 64px 的棋子上）：
  //
  //   11 → 11/64 = 0.172 格
  //   10 → 0.156 格
  //    6 → 0.094 格   ← **主线只有这里**
  //  1.6 → 0.025 格
  //
  // 早先按 0.31 / 0.155 / 0.062 写（那是"槽位 38 CSS"的换算），
  // 按 64 的棋子算全部粗了近一倍 —— 主线 0.155 格 = 10px，读作"金管"而不是"一道光"。
  const GLOW = cell * 0.172;
  const CORE = cell * 0.094;
  const HI = cell * 0.025;

  // ── ① 暗缝：金线下面那道槽（设计稿 `shadow 10`，translate(0,1.5) 偏下）。
  //    金线是**嵌进**釉面的 —— 没有这一道，它就成了浮在格子上的一条亮线
  strokePath(ctx, pts, cell * 0.156, 'rgba(24,44,34,0.30)', 0, cell * 0.023);

  // ── ② 辉光：30% 处脉冲到 0.8，之后衰减到 0.42（设计稿 `giltPulse`）
  //
  //    `grow` 是这一笔堆到哪了。用它当"描到哪儿"的进度：
  //    辉光跟着笔尖走，峰值出现在 30%，然后落回 0.42 并保持。
  const pulse =
    grow < 0.3
      ? (grow / 0.3) * 0.80 // 0 → 0.8（30% 处到顶）
      : 0.80 - ((grow - 0.3) / 0.7) * (0.80 - 0.42); // 0.8 → 0.42
  strokePath(ctx, pts, GLOW, `rgba(212,175,106,${(0.45 * pulse) / 0.8})`);

  // ── ③ 金体 + ④ 亮金：主线 6，亮金是它的 40%（芯）
  strokePath(ctx, pts, CORE, K.gold);
  strokePath(ctx, pts, CORE * 0.40, K.goldLit);

  // ── ⑤ 高光线：**滞后 80ms**。
  //
  //    80ms 换算成"生长进度"要看这一笔总长多久：一格 ≈ 1.2 格宽毫秒
  //    （`motion.grow`），所以 80ms ≈ 80 / (1.2 × cell) 的进度。
  //    这条线只画到 `grow - lag` 的位置 —— 主线已经推过去了，高光还在后面追。
  const lag = Math.min(0.5, 80 / Math.max(120, cell * 1.2));
  const hiT = Math.max(0, grow - lag);
  if (hiT > 0.002) {
    const hiPts = truncatePts(pts, hiT);
    if (hiPts.length >= 2) {
      ctx.save();
      // 整条线往上偏半像素 —— 光从左上打来，金脊在偏上那侧
      ctx.translate(0, -Math.max(0.5, cell * 0.010));
      strokePath(ctx, hiPts, Math.max(1, HI), 'rgba(255,246,220,0.58)');
      ctx.restore();
    }
  }

  // ── ⑥ 转折金珠：**r=4.2**（设计稿明的数，按 64 的棋子 → 0.066 格）。
  //
  //    只在**已堆到**的拐角上出现：没堆到的地方先有珠子，就成了"路上的金点"，
  //    读作"这一格已经走过"，而线还没到。
  const reached = Math.max(1, Math.round(grow * (pts.length - 1)));
  for (let i = 1; i < reached && i < pts.length - 1; i++) {
    if (hash(i * 7.3) < 0.40) continue;
    const p = pts[i];
    const off = (hash(i * 13.9) - 0.5) * cell * 0.14;
    ctx.beginPath();
    ctx.arc(p.x + off, p.y - cell * 0.055, Math.max(1.4, cell * 0.066), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,246,220,0.52)';
    ctx.fill();
  }

  // ── ⑦ 线头光晕：描金笔停处积起的一粒热金
  const head = pts[pts.length - 1];
  const beat = 0.72 + 0.28 * Math.sin(now / 560);
  const hg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, cell * 0.30);
  hg.addColorStop(0, `rgba(255,246,222,${0.38 * beat})`);
  hg.addColorStop(0.5, `rgba(233,204,138,${0.14 * beat})`);
  hg.addColorStop(1, 'rgba(233,204,138,0)');
  ctx.beginPath();
  ctx.arc(head.x, head.y, cell * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = hg;
  ctx.fill();
}


// ────────────────────── 图例记号（与盘面同形） ──────────────────────

/**
 * 图例上的七枚记号。
 *
 * ## 为什么必须自己画
 *
 * 图例是"这个世界有哪几种东西"的索引，记号必须**和盘面上那一枚同形状**。
 * 用通用那套会出事：它的冰面是"一道斜坡"，压在天青的霜青片上是一块糊；
 * 它的箭是"一根杆加折角"，而盘上的箭是实心箭坯 —— 图例和盘面对不上，
 * 图例就等于没画。
 *
 * 坐标全在 **48 视图**（和 `MISE_SHAPES` 同一个空间），按 `sw / 48` 缩，
 * 所以可以直接复用设计稿的路径数据。
 */
const mark48 =
  (draw: (c: CanvasRenderingContext2D) => void): LegendMark =>
  (c, cx, cy, sw, ink) => {
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

const path48 = (c: CanvasRenderingContext2D, pts: Array<[number, number]>, close = true) => {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  if (close) c.closePath();
};

/** 48 视图的走廊，用来把单位坐标的几何搬进图例。 */
const to48 = (pts: Array<[number, number]>): Array<[number, number]> =>
  pts.map(([x, y]) => [24 + x * 24, 24 + y * 24] as [number, number]);

const MISE_LEGEND: Partial<Record<LegendKind, LegendMark>> = {
  // 单向：实心箭坯（与盘上同一块坯）
  arrow: mark48((c) => {
    path48(c, to48(ARROW_BODY));
    c.fill();
  }),
  // 星屑：四芒火花
  star: mark48((c) => {
    path48(c, to48(sparkPts()));
    c.fill();
  }),
  // 冰砖：六边晶 + 三条分水线
  ice: mark48((c) => {
    c.lineWidth = 2.2;
    path48(c, to48(mpts([[24, 5], [40, 15], [40, 33], [24, 43], [8, 33], [8, 15]]).map(([x, y]) => [x * 24 + 24, y * 24 + 24])));
    c.stroke();
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(24, 5);
    c.lineTo(24, 43);
    c.moveTo(8, 15);
    c.lineTo(40, 33);
    c.moveTo(40, 15);
    c.lineTo(8, 33);
    c.stroke();
  }),
  // 石障：墨石八边（与盘上同一轮廓）
  rock: mark48((c) => {
    path48(c, [[7, 30], [11, 13], [23, 7], [39, 12], [43, 27], [35, 41], [15, 42], [7, 34]]);
    c.fill();
  }),
  // 钥匙：朱印钥坯
  key: mark48((c) => {
    c.lineWidth = 3.4;
    c.beginPath();
    c.arc(16.8, 16.8, 7.4, 0, Math.PI * 2);
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
  // 门：玄墨门扉 + 鎏金门缝
  gate: mark48((c) => {
    path48(c, [[10.4, 40], [10.4, 18], [37.6, 18], [37.6, 40]]);
    c.lineWidth = 2.2;
    c.stroke();
    c.beginPath();
    c.moveTo(24, 13.6);
    c.lineTo(24, 40);
    c.lineWidth = 1.6;
    c.stroke();
  }),
  // 传送门：双环（入口实环 —— 图例只给一枚，给"这一对"的入口）
  portal: mark48((c) => {
    c.lineWidth = 3;
    c.beginPath();
    c.arc(24, 24, 15.2, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(24, 24, 7.2, 0, Math.PI * 2);
    c.stroke();
  }),
};

// ────────────────────────────── 主题 ──────────────────────────────

export const MISE_THEME = composeTheme({
  id: 'mise',
  name: '秘色天青',
  tagline: '雨过天青云破处',
  unlock: { type: 'free', value: 0 },
  chrome: CHROME,
  legendMarks: MISE_LEGEND,
  /**
   * 转场：**釉光抹开**（设计稿「页面/弹层不淡入，用『釉水抹开』揭示」）。
   *
   * 边是**直的**（`kind: 'glaze'`），因为釉面被刮过留下的是刀口，不是崩口；
   * 一条 42px 的竖直高光带领先幕身 60ms 扫过去，幕身跟着退。
   * 「永远不用纯 opacity 渐变 —— 那是玻璃的语言，不是釉的语言。」
   */
  wipe: { kind: 'glaze', ms: 520, from: '#1D3A2E', to: '#0F1915' },
  /**
   * 触感五档（设计稿 · 触感 · 试一试）。
   *
   * 和默认那组的差别都在"材质"上：瓷是**脆**的（落子 8 短促），
   * 玉磬是**长**的（铺满三段 30ms 的停顿，手指能数出"叮——叮——"），
   * 印落纸是**沉**的（45 一击到底）。统一成"震一下"就等于告诉手指
   * 这五件事没有区别。
   */
  haptics: { step: 8, trail: 20, settle: [15, 30, 15, 30, 25], seal: 45, tap: 5 },
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    // 进场裁切：天青的格子是"原地弹"（settle），位移只有 0.1 格，
    // 本来就不会飞出盘沿。但**放大**到 1.06 时四角会探出卡片圆角 ——
    // 卡片的圆角是 36，四角那一块必须裁掉，否则会看到方形砖的尖角
    clip(ctx, layout) {
      const c = cardOf(layout);
      roundRect(ctx, c.x, c.y, c.w, c.h, 36);
      ctx.clip();
    },
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(212,175,106,0.20)', core: K.goldLit, hot: K.goldHot },
    hintColor: K.goldLit,
    // 可连格的金缘 1.8s 明暗交替（设计稿「背景常驻」那行的第三条）
    hintPulseMs: 1800,

    /**
     * 按压：**120ms** 沉到 94%，金环 500ms 扩到 1.85 倍（设计稿 TOKEN 表）。
     *
     * 120 是设计稿 `:active` 的 transition 时长 —— 按下去那一下必须**立刻**跟手，
     * 200 以上就开始有"迟滞感"。环走 500ms 是另一回事：环是水痕，要有回味。
     * 两者不同步是有意的（`rippleOut` 也是独立 500ms 的 keyframes）。
     *
     * 环从 0.62 起步 —— 比棋子**小**一圈，从棋子里面"透出来"。
     * 从 0.92 起步（旧默认）读作"棋子被箍了一下"，那是弹性，不是涟漪。
     */
    press: {
      down: 120,
      ring: 500,
      from: 0.62,
      to: 1.85,
      // 普通格：按进绒面
      scale: 0.94,
      width: 0.030,
      // **起手格**：拿起来（设计稿「起手抬升」translateY(-3px) scale(1.1)）
      liftScale: 1.1,
      liftDy: -3 / 64,
    },

    /**
     * 动效：一套「釉」应该怎么动。
     *
     * 天青的每个动作都比鸣沙**轻一档、快一档**（沙落 260ms / 天青 240ms）——
     * 因为它的材质是釉：东西不是"落下来堆起"，而是"在釉面上掠过"。
     */
    motion: {
      // 进场 —— 照「质感 Demo 的铺满全盘」：48ms 步进、每格 240ms 原地弹，
      // 末格全盘金光 420ms + 玉磬。天青的釉不会从天上掉，它是渗进槽里的
      /**
       * 进场 · **开窑揭幕**（设计稿「伍·初始界面」）。
       *
       * 参数逐条照那一章：
       * - 每格 **420ms**（"420ms 釉落缓动"）；
       * - 行内左→右错峰 **45ms**；
       * - 行与行之间停 **120ms**（"一行翻完落定，下一行才起"）；
       * - 末行落地：整盘金光脉冲 **420ms** + 玉磬一记（同铺满收尾）。
       *
       * 早先的 240/48/0 是照 `settleGlaze` 抄的 —— 但那个 keyframes 是
       * **铺满级联**用的（规格 240ms），而揭幕是**另一套动作**（420ms）。
       * `row: 0` 更是直接没做行序：所有行同时起，读起来是"整片一起泛上来"，
       * 而不是设计稿要的"像揭窑巾，一行行翻"。
       *
       * ## 与设计稿的**已知差异**（未实现）
       *
       * 设计稿的形态是**翻面**：每格绕横轴 `rotateX 180°`，背面是
       * 「素坯暗面」（玄墨偏褐的陶土面 + 细颗粒 + 中心指压凹痕），
       * 翻到 90° 时有一道 120ms 的翻面高光扫过。
       *
       * 这里用的是 `settle`（原地沉降弹一下）—— 因为 `EnterGate.form`
       * 目前只有 `drop` / `settle` 两种，都不做透视翻转；而且"素坯盖面"
       * 是一整套新资产（一件没画）。**这是缺的，不是对的。**
       * 参数先按文档对齐，形态待补。
       */
      enter: {
        form: 'settle',
        ms: 420,
        step: 45,
        row: 120,
        // 翻面的"落定"没有位移（它原地转），但 `settle` 形态需要一点下沉
        // 才有"落"的读法；取 10/64 —— 与 `settleGlaze` 同量级
        lift: 10 / 64,
        swell: 1.06,
        // 大盘（>12×8）封顶 2.4s（文档「保证整场揭幕 ≤2.4s」）
        sweep: 2400,
        pulse: { ms: 420, color: '#F2DCA8', alpha: 0.22 },
      },
      // 落子 240ms：-16px 起、胀 12%，55% 处过冲 2px 再收平（`dropIn`）
      drop: { ms: 240, lift: 16 / 64, swell: 1.12, dust: 0 },
      // 铺满：48ms 一粒、每格 240ms、末格全盘脉冲
      settle: { ms: 240, dust: 0, lift: 10 / 64, swell: 1.06, pulse: { ms: 420, color: '#F2DCA8', alpha: 0.22 } },
      // 沥金：描金笔走一格要约 1/3 格宽的时间（520ms 走完整条路径）
      grow: 1.2,
      // 末粒 → 玉磬：120ms（设计稿 `N*48 + 120`），比鸣沙的土埙早 48
      winGap: 120,
      // 盖印 320ms、175ms 触底、绢面抖 ±2px（设计稿 `silkShake` 的 2/54 格）
      /**
       * 盖印 320ms、墙抖 2/54 格（比鸣沙轻一档 —— 瓷印磕在釉面上，不是石章砸墙）。
       *
       * `size` 0.29 是**卡宽比例**：`0.29 × 662 ≈ 192`，与结算页的印同尺寸。
       *
       * 早先写 0.8（"0.8 个棋子"），5×6 上只有 81px、11×11 上 44px ——
       * "过"字小到读不出来。当时那句注释写的是"瓷印是落款，不是盖住"，
       * 方向没错，但**量级判断错了**：落款也可以很大，小的是喧宾夺主，
       * 而 81px 的问题是读不清，不是谦让。
       */
      seal: { ms: 320, at: 175, shake: 2 / 54, size: 0.29 },
    },

    winSeal: drawSealStamp,
    // 抵达那一帧：终点格爆闪（八芒 + 双环 + 芯点）。
    // 它宣告「到了」，不是「赢了」—— 只亮 420ms 就退干净，不留余韵
    arrive: drawArriveBurst,

    glyph: {
      style: 'porcelain',
      // 錾刻语言：浅釉勾线 + 鎏金填面。棋子是暗釉，款必须是**浅色**——
      // 旧版的墨绿勾线在暗格上等于没画
      pal: LIGHT_PAL,
      // 亮格（鎏金星屑 / 铜钥匙 / 霜冰）上换墨色：浅线压浅底会整片消失
      palFor: (type, state) => {
        // 五色族分工（设计稿「颜色只从五色族里拿」）：
        // 天青 = 盘面、玄墨 = 石与门、鎏金 = 箭与星、朱印 = 钥匙、
        // 暮紫 = 传送门（全盘唯一的紫）
        if (type === CoverCell.SHARD) return STAR_PAL;
        if (type === CoverCell.KEY) return KEY_PAL;
        if (type === CoverCell.GATE) return state?.wasOpen ? GATE_OPEN_PAL : GATE_PAL;
        if (type === CoverCell.ICE) return FROST_PAL;
        // 石块上的记号只能是**刻痕**：浅色填面会在暗盘上变成一块奶油，
        // 读起来像"可以点的按钮"，而它恰恰是唯一不能走的地方
        if (type === CoverCell.BLOCK) return STONE_PAL;
        return LIGHT_PAL;
      },
      // 不要底盘：设计稿的机制是直接錾在格面上的。
      // 一个浅色圆底在暗盘上会变成 64 个白点，抢掉光迹
      back: '',
      backEdge: 'transparent',
      backR: 0.26,
      terrainAccent: 'rgba(238,242,234,0.70)',
      /**
       * 格内标尺寸 = **36/64 = 0.5625**。
       *
       * 使用说明写得很明确：「24px viewBox / **格内渲染 36px**」，棋格稿面 64px。
       * 早先给 0.46（按"设计稿 inset 22% → 56% 的棋子面"推导），偏小一档。
       */
      scale: 36 / 64,
      /**
       * 各枚的**视觉重量**补偿。
       *
       * 改成 24 视图的 `MARKS` 之后，大部分形状本来就占满 24×24 的画布，
       * 不再需要以前的补偿（上一版为 48 视图写过 SHARD 0.92 / KEY 1.30）。
       * 现在只留两处真正偏的：
       * - 星屑的四芒火花只占中间一圈（外径约 7.8 单位 / 12）；
       * - 钥匙是斜 45° 的一条，包围盒只有方框的对角一半。
       */
      scaleFor: (type: number) => {
        if (type === CoverCell.SHARD) return 1.10;
        if (type === CoverCell.KEY) return 1.18;
        return 1;
      },
      // 墨石已经由 `cell` 画成一整块有阴影、有两个面的石头了，别再叠一层线稿
      /**
       * 起终点由 `endpoint` 整块接管（那里是金单圈+菱 / 金双圈+芯点），
       * 不能再让 `drawMarks` 叠一层通用线稿 —— 通用 `GLYPHS.end` 是
       * **两个方框**（`rect`），压在金环上就是截图里那个"带方块的方框"。
       * 早先漏了这两项，起终点一直是「金圈 + 方框」两层打架。
       */
      /**
       * 不画格内标的三类 + **冰砖**。
       *
       * 冰砖这一条是两个设计稿共同的规矩，但很容易漏：它长得像"有标"的格。
       * 两套的 `MARKS`（24 视图格内标）里**都没有 `ice` 这个键** ——
       * 十个键是 start/end/trail/arrow/key/door/door-open/portal-a/portal-b/arrive。
       * 冰不在其中，因为它是「地形」不是「标」。
       *
       * 那个六边晶只存在于 `ICONS`（48 视图图鉴），供玩家"看说明书"用；
       * 贴进格心就成了设计稿点名的误用：「把 48px 机制图标直接贴进棋格当机关」。
       *
       * 天青的冰砖另有霜裂 + 一枚划花（见 `case CoverCell.ICE`），
       * 但那是**材质纹 + 装饰纹**，不是机制标。
       */
      skip: [CoverCell.BLOCK, CoverCell.START, CoverCell.END, CoverCell.ICE],
      shapes: MISE_SHAPES,
      decor: MISE_DECOR,
      // 「格内永远不落字」：星阶靠星数、传送门靠实虚，都不写数字角标
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
       * 三处会变：
       * - **星屑阶数**：`group` 就是第几颗，1/2/3 阶画 1/2/3 颗火花；
       * - **门开闭**：拿到对应钥匙之后 `keysHeld` 里有这个分组 —— 门从
       *   "玄墨门扉"变成"两片洞开 + 中间的青光"；
       * - **传送门进/出口**：同组里先出现的那个是入口（实环），后一个是出口（虚环）。
       *   规则是"进 A 出 B"，所以必须先按 group 把整盘扫一遍才知道谁是 A。
       */
      variant: ({ type, group, idx, board, st }) => {
        if (type === CoverCell.SHARD) return { key: starVariant(group) };
        if (type === CoverCell.GATE) return { key: st.keysHeld.has(group) ? 'gateOpen' : 'gate' };
        if (type === CoverCell.PORTAL) {
          // 同组里 idx 最小的那个 = **入口**（查缓存表，O(1)）
          return { key: portalEntrance(board.grid, group) === idx ? 'portalA' : 'portalB' };
        }
        return undefined;
      },
    },

    hint(ctx, p, cell, i) {
      const inset = cell * 0.11;
      ctx.save();
      ctx.setLineDash(i === 0 ? [] : [cell * 0.14, cell * 0.10]);
      ctx.beginPath();
      roundRect(ctx, p.x - cell / 2 + inset, p.y - cell / 2 + inset, cell - inset * 2, cell - inset * 2, cell * 0.16);
      ctx.strokeStyle = K.goldLit;
      ctx.lineWidth = i === 0 ? Math.max(2.6, cell * 0.062) : Math.max(1.6, cell * 0.038);
      ctx.stroke();
      ctx.restore();
    },

    head(ctx, p, cell, now) {
      const r = cell * 0.105;
      const pulse = 0.78 + 0.22 * Math.sin(now / 300);
      // 金珠的光
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.4);
      g.addColorStop(0, `rgba(255,246,222,${0.44 * pulse})`);
      g.addColorStop(0.45, `rgba(212,175,106,${0.16 * pulse})`);
      g.addColorStop(1, 'rgba(212,175,106,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // 金珠本体：亮面在左上，暗面在右下
      const bg = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      bg.addColorStop(0, K.goldHot);
      bg.addColorStop(0.62, K.goldLit);
      bg.addColorStop(1, K.goldDeep);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
    },

    endpoint(ctx, kind, p, cell) {
      const r = cell * 0.30;
      /**
       * 起终点照设计稿「格内标 · 全形态大图」：
       *
       * - **起点·起手印**：鎏金单圈 r=8 + 实心菱（24 视图）。**不用三角** ——
       *   三角在暗盘上读作"播放键"，而它要说的是"从这里起手"。
       *   菱是寿山石印的起手纹，一圈一菱，钤在格心。
       * - **终点·终点环**：外实环 r=8.6 + 内虚环 r=5.1 + 芯点。全盘唯一双圈。
       *   早先是朱印 —— 但朱印已经用在"通关落款"上了，盘上再用一次，
       *   两者就分不清"这是终点"还是"这局结束了"。
       *
       * 两者都是**鎏金**：金贵如缮，端点是这条金线的两端，只有它们配金色。
       */
      const gold = '#C9A45C';
      const goldLit = '#F2DCA8';
      const goldDeep = 'rgba(120,88,36,0.5)';
      // 24 视图的 1 单位 = r / 8（因为起点的圈半径 8 对应这里的 r）
      const u = r / 8;

      if (kind === 'start') {
        // ① 外圈：暗边 + 金环 + 左上受光细线（三层才是"环"，一层只是"一个圆"）
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = goldDeep;
        ctx.lineWidth = 2.4 * u;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = gold;
        ctx.lineWidth = 1.8 * u;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x - 0.3 * u, p.y - 0.4 * u, r, 0, Math.PI * 2);
        ctx.strokeStyle = goldLit;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 0.7 * u;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // ② 菱：暗影一枚 + 金面 + 上沿受光
        const dia = (dy: number) => {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 3.8 * u + dy);
          ctx.lineTo(p.x + 3.8 * u, p.y + dy);
          ctx.lineTo(p.x, p.y + 3.8 * u + dy);
          ctx.lineTo(p.x - 3.8 * u, p.y + dy);
          ctx.closePath();
        };
        dia(0.5 * u);
        ctx.fillStyle = goldDeep;
        ctx.fill();
        dia(0);
        ctx.fillStyle = gold;
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = 0.45;
        dia(-0.4 * u);
        ctx.fillStyle = goldLit;
        ctx.fill();
        ctx.restore();
        return;
      }

      // 终点：双圈
      const R = 8.6 * u;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = goldDeep;
      ctx.lineWidth = 2.8 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x - 0.3 * u, p.y - 0.4 * u, R, 0, Math.PI * 2);
      ctx.strokeStyle = goldLit;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 内虚环：虚线（`stroke-dasharray 2.6 2.2`）—— 内环是虚的，
      // 双圈才读作"归处"，两个实环会读成"靶心"
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([2.6 * u, 2.2 * u]);
      // `lineCap` 必须显式设 `butt`：画实体环时设过 `round`，
      // 而 `round` 让每段两端各鼓半个线宽 —— 段 9.9px + 线宽 4.2px 时，
      // 视觉段长 14px、间隔只剩 8.3px，虚线圈糊成"一串分离的方块"。
      ctx.lineCap = 'butt';
      ctx.arc(p.x, p.y, 5.1 * u, 0, Math.PI * 2);
      ctx.strokeStyle = gold;
      ctx.lineWidth = 1.1 * u;
      ctx.stroke();
      ctx.restore();

      // 芯点
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.7 * u, 0, Math.PI * 2);
      ctx.fillStyle = goldLit;
      ctx.fill();
    },
  },
});
