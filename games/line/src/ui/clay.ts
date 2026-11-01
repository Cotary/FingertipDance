/**
 * 黏土原语层 —— 「黏土工坊 / Clay Studio」。
 *
 * 与旧的 `draw.ts` 的**根本区别**（这是黏土 vs 塑料的分水岭）：
 *
 * | | draw.ts（糖果夜空） | clay.ts（黏土工坊） |
 * |---|---|---|
 * | 轮廓 | 完美圆 / 精确圆角矩形 | 半径带固定 seed 抖动的手捏轮廓 |
 * | 体积 | 沿法线的平滑渐变 | **2~3 个同心不规则色块叠成硬边色阶** |
 * | 高光 | 一条 30% 高的锐利高光条 | 大面积低 alpha 哑光反光 |
 * | 投影 | 同形偏移（硬边） | 多层同形错位叠出软边 |
 *
 * 三条硬规则（违反任何一条就会退回塑料感）：
 * 1. 轮廓不许是完美的 —— 一律走 `rrectPts()` / `discPts()`，半径抖动 ±0.6%
 * 2. 体积不许用平滑渐变 —— 色阶边界必须是硬的（用 clip + 缩放路径实现）
 * 3. 高光不许锐利 —— 只能是柔光斑，禁止出现高光条
 *
 * 所有形状都是"确定性不规则"：同一 seed 每帧得到同一轮廓，不会抖动闪烁。
 */

import { DESIGN_W, DESIGN_H } from '../render/layout';
import { fillGrain } from '../render/grain';

// ────────────────────────────── 色板 ──────────────────────────────

/** 一种黏土色的四个色阶层。 */
export interface ClayColor {
  /** 主色（受光面） */
  base: string;
  /** 亮面（色阶最上） */
  light: string;
  /** 暗面（色阶最下） */
  dark: string;
  /** 深凹槽（描边 / 压印） */
  shade: string;
}

/**
 * 黏土色轮。四个色阶缺一不可：
 * 少了 `dark` 就没有体积，少了 `light` 就是一块死色。
 */
export const CLAY = {
  terracotta: { base: '#E07A4F', light: '#F2A882', dark: '#B4552F', shade: '#8A3D1E' },
  mint: { base: '#7FBFA0', light: '#A9D9C1', dark: '#55917A', shade: '#386B57' },
  mustard: { base: '#E0B33C', light: '#F4D278', dark: '#AE861F', shade: '#7F5F12' },
  blue: { base: '#6C8AA6', light: '#9AB2C8', dark: '#4A637A', shade: '#33485B' },
  cream: { base: '#F7EADA', light: '#FFFBF3', dark: '#DCC6AC', shade: '#B49A7C' },
  rose: { base: '#D96A6A', light: '#F09E9E', dark: '#A74444', shade: '#7C2C2C' },
  /**
   * 棋盘底板。
   * 砖块是「压进板子的凹坑」，板子必须比砖**亮一档** ——
   * 板子一深，砖就成了浮在板上的小方块，整块棋盘读作「一堆骰子」。
   */
  board: { base: '#8CA6BA', light: '#B4C9D9', dark: '#6B8799', shade: '#4F6776' },
  /** 比底板再深一号：阻挡块用 */
  boardDark: { base: '#44596A', light: '#5E7A8C', dark: '#2F404E', shade: '#22303A' },
  /** 星球表面的大陆（低饱和绿，压在蓝球上不刺眼） */
  land: { base: '#A6CBAF', light: '#D4E8D8', dark: '#779E86', shade: '#52795C' },
  /** 面板上的一块浅沙色内凹块（数据胶囊用） */
  sand: { base: '#E7D0B4', light: '#F5E3CB', dark: '#C9AE8E', shade: '#A88C6C' },
  /** 锁住的节点：比球体更深，才能从球上「浮」出来 */
  lockTile: { base: '#3C5163', light: '#54708A', dark: '#28394A', shade: '#1C2833' },
  /** 衬纸白：贴在深色件上的留白边（起终点圆片的衬圈） */
  paper: { base: '#FFFBF3', light: '#FFFFFF', dark: '#E6D8C6', shade: '#C2B09A' },
  /** 凹槽：进度条的槽、任何要「挖进底面」的长条。比沙色深两档，浅底上才读得出 */
  groove: { base: '#8E7053', light: '#A98B6C', dark: '#6E543B', shade: '#553F2A' },
  /**
   * 陈列台：一块烧过的深陶板。
   * 彩色皮肤压在浅底上会互相打架，深陶底才托得住 —— 但必须偏**暖**，
   * 用蓝灰（boardDark）会和皮肤的冷色撞成一片脏。
   */
  stage: { base: '#5A4436', light: '#7A5F4C', dark: '#3D2C21', shade: '#281C14' },
} as const satisfies Record<string, ClayColor>;

export type ClayKey = keyof typeof CLAY;

/** 黏土工坊的界面色（浅底 + 深可可墨）。 */
export const CLAY_UI = {
  /** 页面底：暖陶土 */
  bg: '#E3C9AE',
  bgTop: '#EFDCC8',
  bgBottom: '#CFAF92',
  /** 陶土板（棋盘、面板） */
  board: '#5E7A8C',
  boardDark: '#44596A',
  /** 文字 */
  ink: '#4A3327',
  inkSoft: '#8A6F58',
  /** 反白字（深色底上） */
  onDark: '#FFF6E9',
} as const;

export const CLAY_FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

// ────────────────────────────── 抖动的确定性 ──────────────────────────────

/** 确定性伪随机：同一 (seed, i) 永远同一个值。 */
function h1(seed: number, i: number): number {
  const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// ────────────────────────────── 轮廓生成 ──────────────────────────────

export type Pt = [number, number];

/**
 * 圆片的抖动手捏轮廓（顺时针）。
 * @param segs 强制顶点数（默认按半径自适应）
 * @param angleJitter 顶点**角度**的抖动比例（相对 1/segs 的角距）。
 *   只抖半径会让形状变成「规则多边形」—— 手撕的东西边长和角都不均。
 */
export function discPts(
  cx: number,
  cy: number,
  r: number,
  seed: number,
  jitter = 0.006,
  segs?: number,
  angleJitter = 0,
): Pt[] {
  const n = segs ?? Math.max(26, Math.min(52, Math.round(r * 0.48)));
  const step = (Math.PI * 2) / n;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2 + angleJitter * step * (h1(seed, i + 500) - 0.5);
    const rr = r * (1 + (h1(seed, i) - 0.5) * 2 * jitter);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

/**
 * 圆角矩形的抖动手捏轮廓（顺时针，从右上角开始）。
 * 每条直边 6 点、每个圆角 4 点，共 40 点 —— 在 100px 尺度下足够平滑，
 * 但保留"不是机器切的"的微手感。
 */
export function rrectPts(x: number, y: number, w: number, h: number, radius: number, seed: number, jitter = 0.006): Pt[] {
  const rr = Math.max(0, Math.min(radius, w / 2, h / 2));
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pts: Pt[] = [];
  const lineN = 6;
  const arcN = 4;

  const push = (px: number, py: number) => pts.push([px, py]);

  // 上直边 → 左到右
  for (let i = 0; i < lineN; i++) push(x + rr + ((w - 2 * rr) * i) / lineN, y);
  // 右上角
  for (let i = 0; i < arcN; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / arcN);
    push(x + w - rr + Math.cos(a) * rr, y + rr + Math.sin(a) * rr);
  }
  // 右直边
  for (let i = 0; i < lineN; i++) push(x + w, y + rr + ((h - 2 * rr) * i) / lineN);
  // 右下角
  for (let i = 0; i < arcN; i++) {
    const a = (Math.PI / 2) * (i / arcN);
    push(x + w - rr + Math.cos(a) * rr, y + h - rr + Math.sin(a) * rr);
  }
  // 下直边
  for (let i = 0; i < lineN; i++) push(x + w - rr - ((w - 2 * rr) * i) / lineN, y + h);
  // 左下角
  for (let i = 0; i < arcN; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / arcN);
    push(x + rr + Math.cos(a) * rr, y + h - rr + Math.sin(a) * rr);
  }
  // 左直边
  for (let i = 0; i < lineN; i++) push(x, y + h - rr - ((h - 2 * rr) * i) / lineN);
  // 左上角
  for (let i = 0; i < arcN; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / arcN);
    push(x + rr + Math.cos(a) * rr, y + rr + Math.sin(a) * rr);
  }

  // 沿"中心 → 顶点"方向抖动
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i][0] - cx;
    const dy = pts[i][1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = (h1(seed, i) - 0.5) * 2 * jitter * Math.min(w, h);
    pts[i][0] += (dx / len) * k;
    pts[i][1] += (dy / len) * k;
  }
  return pts;
}

/** 把点数组描成路径（可整体偏移 / 以 (cx,cy) 为心缩放）。 */
export function tracePts(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  dx = 0,
  dy = 0,
  scale = 1,
  cx?: number,
  cy?: number,
): void {
  const ox = cx ?? 0;
  const oy = cy ?? 0;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = ox + (pts[i][0] - ox) * scale + dx;
    const py = oy + (pts[i][1] - oy) * scale + dy;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * 软投影：同一轮廓按比例错位叠 3 层。
 * 因为每层偏移量不同，边缘会自然形成"只有最外层覆盖"的稀薄区 → 视觉上就是模糊，
 * 不需要 `shadowBlur`（微信端逐像素很贵）。
 */
export function softShadow(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  depth: number,
  alpha = 0.09,
  cx?: number,
  cy?: number,
): void {
  ctx.fillStyle = `rgba(74,51,39,${alpha})`;
  for (let i = 3; i >= 1; i--) {
    const k = i / 3;
    tracePts(ctx, pts, 0, depth * k, 1 + 0.012 * k, cx, cy);
    ctx.fill();
  }
}

/**
 * 指压痕：手指按过黏土留下的浅沟。
 *
 * 每道沟用两条弧 —— 沟底暗、上唇亮，两像素的错位就够读出「凹」。
 * 单画暗弧会像划痕（凸），单画亮弧会像贴纸（平），必须成对。
 *
 * 只在面积够大的块上画（调用方把关）：一块 60px 的砖上出现指痕，
 * 尺度就崩了 —— 观者会把它读成砖上的脏污，而不是捏它的手。
 */
export function clayPress(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  seed: number,
  alpha = 1,
): void {
  const n = 3 + Math.round(h1(seed, 7) * 3); // 3~6 道
  const base = Math.min(w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = h1(seed, 20 + i) * Math.PI * 2;
    // 落点偏外圈：捏的时候手指在边上，中间反而是掌心压平的
    const dist = 0.34 + h1(seed, 40 + i) * 0.28;
    const px = cx + Math.cos(a) * w * 0.5 * dist;
    const py = cy + Math.sin(a) * h * 0.5 * dist;
    const rad = base * (0.13 + h1(seed, 60 + i) * 0.15);
    const span = 0.55 + h1(seed, 80 + i) * 1.0;
    const mid = h1(seed, 100 + i) * Math.PI * 2;
    const lw = Math.max(1.2, base * 0.024);

    ctx.strokeStyle = `rgba(74,51,39,${0.06 * alpha})`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(px, py + 1.1, rad, mid - span / 2, mid + span / 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,255,255,${0.09 * alpha})`;
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.arc(px, py - 1.0, rad, mid - span / 2, mid + span / 2);
    ctx.stroke();
  }
}

// ────────────────────────────── 主原语：黏土块 / 黏土球 ──────────────────────────────

/** #RRGGBB 的相对亮度（0~1）。用来让颗粒层自动适配深浅底色。 */
function hexLum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

/**
 * 颗粒层的强度随底色走。
 *
 * 同一个 alpha 下，浅色大面（奶油卡片）上的颗粒会读成「脏」，深色件上又几乎看不见 ——
 * 所以亮底压到 0.3，暗底放到 0.55。这不是调参偷懒，是暗底本身就要更多颗粒才出质感。
 */
function grainAlphaFor(c: ClayColor): number {
  return 0.20 + (1 - hexLum(c.base)) * 0.40;
}

export interface ClayOpts {
  /** 软投影深度（px）。0 = 不画投影（平贴的） */
  depth?: number;
  /** 亮面色阶的相对位移量，默认 0.10（高度比例） */
  hi?: number;
  /** 轮廓抖动幅度，默认 0.006 */
  jitter?: number;
  /**
   * 强制轮廓顶点数。默认按半径自动取（26~52，够圆滑）。
   * 给「大陆」这类需要**大块面**的形状传 8~12：顶点一多，同样的抖动
   * 就从「手撕的纸片」退化成「碎锯齿」。
   */
  segs?: number;
  /** 顶点角度抖动比例（0~1，相对角距）。只给大陆这类手撕形状用。 */
  angleJitter?: number;
  /** 折角磨钝的描边宽度（px）。折线形状配这个，尖角才会被「手抹平」。 */
  round?: number;
  /** 是否画亮面 */
  lit?: boolean;
  /**
   * 大块平板（≥300px）。
   * 亮面的常规做法是「缩到 90% 的同形」，在 396 的样品板上会变成一块突兀的中央亮斑；
   * 打开这个开关后亮面几乎满幅，只留一圈窄色阶 —— 读作「一整块料的受光」，不是「贴了块亮片」。
   */
  plate?: boolean;
}

/**
 * 黏土块：软投影 → 暗部整体 → 主色（上移）→ 亮面（clip + 缩放，硬边）→ 哑光反光。
 *
 * 注意"主色上移"这一层：它是黏土感的来源 —— 底边会露出一条 `dark`，
 * 看起来像黏土块被压扁后边缘挤出的一圈，而不是渐变的暗。
 */
export function clayBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  c: ClayColor,
  seed: number,
  opts: ClayOpts = {},
): void {
  const jitter = opts.jitter ?? 0.006;
  const pts = rrectPts(x, y, w, h, radius, seed, jitter);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const depth = opts.depth ?? 8;

  if (depth > 0) softShadow(ctx, pts, depth, 0.085, cx, cy);

  // 暗部：整体形状
  ctx.fillStyle = c.dark;
  tracePts(ctx, pts);
  ctx.fill();

  // 主色：上移 + 微缩，底边露出一条 dark。
  // 上限 11px：h*0.05 在 380 高的大块上会露出 19px 的深色横带，读作「一条黑边」而不是厚度。
  const lift = Math.max(1.5, Math.min(h * 0.05, 11));
  ctx.fillStyle = c.base;
  tracePts(ctx, pts, 0, -lift, 0.992, cx, cy);
  ctx.fill();

  if (opts.lit === false) {
    // `lit` 只该关掉**亮面**，不该连材质一起关掉。
    // 大块（≥28000，皮肤页的样品板就是这个尺寸）靠颗粒和指压痕才不像一张色卡；
    // 小块跳过是因为几十个格子各画一遍颗粒太贵，而且小尺寸上一颗砂就是一块脏点。
    if (w * h >= 28000) {
      fillGrain(ctx, x, y, w, h, grainAlphaFor(c));
      clayPress(ctx, cx, cy, w, h, seed);
    }
    return;
  }

  // 亮面：clip 后画缩放的同形，边界是硬的 → 硬边色阶
  ctx.save();
  tracePts(ctx, pts, 0, -lift, 0.992, cx, cy);
  ctx.clip();

  const hiShift = (opts.hi ?? 0.10) * h;
  ctx.fillStyle = c.light;
  tracePts(ctx, pts, -w * 0.015, -lift - hiShift, opts.plate ? 0.985 : 0.90, cx, cy);
  ctx.fill();

  // 哑光反光：大范围、低 alpha、两圈
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.20, cy - h * 0.26, w * 0.30, h * 0.22, -0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.16, cy - h * 0.30, w * 0.44, h * 0.30, -0.42, 0, Math.PI * 2);
  ctx.fill();

  // 表面质感：砂粒（细）→ 指压痕（中）。顺序不能反 —— 指痕是压在砂面上的。
  // 小件跳过：< 26px 上一颗砂粒就是一整块脏点。
  if (Math.min(w, h) >= 26) fillGrain(ctx, x, y, w, h, grainAlphaFor(c));
  if (w * h >= 28000) clayPress(ctx, cx, cy, w, h, seed);
  ctx.restore();
}

/** 黏土球 / 黏土圆片。结构同 clayBlock，只是轮廓换成抖动圆。 */
export function clayDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  c: ClayColor,
  seed: number,
  opts: ClayOpts = {},
): void {
  const jitter = opts.jitter ?? 0.010;
  const pts = discPts(cx, cy, r, seed, jitter, opts.segs, opts.angleJitter);
  const depth = opts.depth ?? 7;
  const round = opts.round ?? 0;

  /**
   * 填一层同形色阶。
   * `round > 0` 时用完色圆头描边把折角的尖磨钝 —— 捏过的黏土没有尖角，
   * 那圈同色描边就是「手抹过去」的痕迹。折线本身保持不变。
   */
  const fillRing = (color: string, dx: number, dy: number, sc: number): void => {
    tracePts(ctx, pts, dx, dy, sc, cx, cy);
    ctx.fillStyle = color;
    ctx.fill();
    if (round > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = round;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  };

  if (depth > 0) softShadow(ctx, pts, depth, 0.085, cx, cy);

  fillRing(c.dark, 0, 0, 1);

  const lift = Math.max(1.5, r * 0.09);
  fillRing(c.base, 0, -lift, 0.988);

  if (opts.lit === false) {
    // 圆片同理：`lit` 只关亮面，材质照画。小圆点上颗粒等于长麻子，只在够大时补
    if (r >= 56) fillGrain(ctx, cx - r, cy - r, r * 2, r * 2, grainAlphaFor(c));
    return;
  }

  ctx.save();
  tracePts(ctx, pts, 0, -lift, 0.988, cx, cy);
  ctx.clip();

  ctx.fillStyle = c.light;
  tracePts(ctx, pts, -r * 0.03, -lift - (opts.hi ?? 0.16) * r, 0.86, cx, cy);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.26, cy - r * 0.34, r * 0.34, r * 0.24, -0.42, 0, Math.PI * 2);
  ctx.fill();

  if (r >= 14) fillGrain(ctx, cx - r, cy - r, r * 2, r * 2, grainAlphaFor(c));
  ctx.restore();
}

/**
 * 黏土凹坑 —— 压进板子里的一个坑。
 *
 * 和 `clayBlock` 的差别只有一条：**光的方向被翻转**。
 * - 凸起：底边露 `dark`（厚度），亮面在上 → 读作「堆在板上」
 * - 凹坑：上沿露 `dark`（内阴影），亮唇在下 → 读作「压进板里」
 *
 * 棋盘的空格砖必须用它：走过的是凸起、没走过的是凹坑，
 * 一眼能看出这条路被「填」过了 —— 这比给砖换颜色更省事，也更像真实材料。
 */
export function clayInset(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  c: ClayColor,
  seed: number,
  opts: ClayOpts = {},
): void {
  const pts = rrectPts(x, y, w, h, radius, seed, opts.jitter ?? 0.005);
  const cx = x + w / 2;
  const cy = y + h / 2;
  // 下沉量就是这个坑的深度感来源，超过 8px 会读成「一个洞」而不是「一个格子」
  const sink = Math.max(1.2, Math.min(h * 0.055, 8));

  ctx.save();
  tracePts(ctx, pts);
  ctx.clip();

  // 坑壁：整块铺暗色，之后被坑底盖掉，只在上沿留一圈 = 内阴影
  ctx.fillStyle = c.dark;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

  // 坑底：整体下沉 + 微缩，四周留出暗环
  ctx.fillStyle = c.base;
  tracePts(ctx, pts, 0, sink, 0.985, cx, cy);
  ctx.fill();

  // 下沿受光的亮唇：再往下推一段，被 clip 裁掉后只剩底边一条
  ctx.fillStyle = c.light;
  tracePts(ctx, pts, 0, sink + h * 0.13, 0.90, cx, cy);
  ctx.fill();

  if (opts.lit !== false) fillGrain(ctx, x, y, w, h, grainAlphaFor(c));
  ctx.restore();
}

/** 五角星的抖动手捏轮廓（顺时针）。 */
export function starPts(cx: number, cy: number, r: number, seed: number, jitter = 0.008): Pt[] {
  const pts: Pt[] = [];
  const inner = r * 0.47;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const base = i % 2 === 0 ? r : inner;
    const rr = base * (1 + (h1(seed, i) - 0.5) * 2 * jitter);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

/** 黏土星：暗底 + 主色上移 + 亮面。用于星级、里程碑。 */
export function clayStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  c: ClayColor,
  seed: number,
  opts: ClayOpts = {},
): void {
  const pts = starPts(cx, cy, r, seed, opts.jitter ?? 0.008);
  const depth = opts.depth ?? 5;

  if (depth > 0) softShadow(ctx, pts, depth, 0.085, cx, cy);

  ctx.fillStyle = c.dark;
  tracePts(ctx, pts);
  ctx.fill();

  const lift = Math.max(1.2, r * 0.10);
  ctx.fillStyle = c.base;
  tracePts(ctx, pts, 0, -lift, 0.975, cx, cy);
  ctx.fill();

  if (opts.lit === false) {
    // 圆片同理：`lit` 只关亮面，材质照画。小圆点上颗粒等于长麻子，只在够大时补
    if (r >= 56) fillGrain(ctx, cx - r, cy - r, r * 2, r * 2, grainAlphaFor(c));
    return;
  }

  ctx.save();
  tracePts(ctx, pts, 0, -lift, 0.975, cx, cy);
  ctx.clip();
  ctx.fillStyle = c.light;
  tracePts(ctx, pts, -r * 0.06, -lift - (opts.hi ?? 0.20) * r, 0.72, cx, cy);
  ctx.fill();
  ctx.restore();
}

// ────────────────────────────── 通用小零件 ──────────────────────────────

/**
 * 黏土锁：一枚压在格子上的小挂锁（锁体 + 锁梁）。
 * 地图 / 皮肤 / 我的 三处皮肤墙共用，避免各写一套画法导致形状不一致。
 */
export function clayLock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale = 1,
  c: ClayColor = CLAY.cream,
): void {
  const bw = 24 * scale;
  const bh = 20 * scale;
  const r = bw * 0.30;
  const by = cy - bh * 0.28;

  // 锁体
  clayBlock(ctx, cx - bw / 2, by, bw, bh, r, c, 941, { depth: 3 * scale, hi: 0.10, jitter: 0.004 });

  // 锁梁：粗半圆，压在锁体上沿
  ctx.strokeStyle = c.shade;
  ctx.lineWidth = 4.5 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, by + 1, bw * 0.27, Math.PI, 0);
  ctx.stroke();

  // 锁孔
  ctx.fillStyle = c.shade;
  ctx.beginPath();
  ctx.arc(cx, by + bh * 0.48, 2.6 * scale, 0, Math.PI * 2);
  ctx.fill();
}

// ────────────────────────────── 文字 ──────────────────────────────

export interface ClayTextOpts {
  weight?: number;
  align?: CanvasTextAlign;
  /** middle / top / bottom，内部统一映射到 alphabetic */
  baseline?: 'middle' | 'top' | 'bottom';
  fill?: string;
  /** 描边色，默认用深凹槽色 */
  outline?: string;
  /** 描边宽度，默认 size × 0.14 */
  outlineWidth?: number;
  /** 是否画凸起投影，默认 true */
  emboss?: boolean;
}

/**
 * 压进黏土里的字：深色描边 + 文字填色 + 下方 1 道暗投影。
 * 不用 `textBaseline='middle'`（与 SVG central 视觉位置不一致，会导致预览和真机偏移），
 * 一律 alphabetic + 手动补偿。
 */
export function clayText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: ClayTextOpts = {},
): void {
  const base = opts.baseline ?? 'middle';
  const dy = base === 'middle' ? size * 0.36 : base === 'top' ? size * 0.88 : -size * 0.12;
  const weight = opts.weight ?? 800;

  ctx.font = `${weight} ${size}px ${CLAY_FONT}`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';

  if (opts.emboss !== false) {
    ctx.fillStyle = 'rgba(74,51,39,0.22)';
    ctx.fillText(text, x, y + dy + Math.max(1.5, size * 0.06));
  }

  const ow = opts.outlineWidth ?? size * 0.14;
  if (ow > 0) {
    ctx.strokeStyle = opts.outline ?? 'rgba(74,51,39,0.55)';
    ctx.lineWidth = ow;
    ctx.strokeText(text, x, y + dy);
  }

  ctx.fillStyle = opts.fill ?? '#FFFBF3';
  ctx.fillText(text, x, y + dy);
}

// ────────────────────────────── 背景 ──────────────────────────────

/**
 * 陶土背景：暖色竖向渐变 + 左上暖光 + 底部暗角。
 * 不画星星 —— 黏土工坊是"桌面棚拍"，不是夜空。
 */
export function clayBackdrop(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
  g.addColorStop(0, CLAY_UI.bgTop);
  g.addColorStop(0.55, CLAY_UI.bg);
  g.addColorStop(1, CLAY_UI.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 左上暖光
  const lg = ctx.createRadialGradient(DESIGN_W * 0.20, DESIGN_H * 0.14, 0, DESIGN_W * 0.20, DESIGN_H * 0.14, DESIGN_W * 0.95);
  lg.addColorStop(0, 'rgba(255,247,229,0.42)');
  lg.addColorStop(0.5, 'rgba(255,247,229,0.10)');
  lg.addColorStop(1, 'rgba(255,247,229,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 底部暗角
  const dg = ctx.createLinearGradient(0, DESIGN_H * 0.62, 0, DESIGN_H);
  dg.addColorStop(0, 'rgba(120,88,62,0)');
  dg.addColorStop(1, 'rgba(120,88,62,0.30)');
  ctx.fillStyle = dg;
  ctx.fillRect(0, DESIGN_H * 0.62, DESIGN_W, DESIGN_H * 0.38);

  // 起伏：背景不是一张平纸，是搭出来的。
  // 只有竖向渐变 + 一处暖光时，整屏读作「一个色块」；补 4 处大范围柔光/柔暗，
  // 才有棚拍背景纸那种缓慢的明暗流动。全部走径向渐变，边界不许出现。
  const blobs: Array<[number, number, number, [number, number, number], number]> = [
    // 相对 x, 相对 y, 相对半径, 颜色, 中心 alpha
    [0.16, 0.20, 0.52, [255, 247, 229], 0.26],
    [0.88, 0.40, 0.40, [255, 247, 229], 0.14],
    [0.66, 0.74, 0.46, [146, 106, 74], 0.10],
    [0.06, 0.88, 0.34, [146, 106, 74], 0.12],
  ];
  for (const [bx, by, br, [r, g2, b], a] of blobs) {
    const cx = DESIGN_W * bx;
    const cy = DESIGN_H * by;
    const rad = DESIGN_W * br;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    bg.addColorStop(0, `rgba(${r},${g2},${b},${a})`);
    bg.addColorStop(0.55, `rgba(${r},${g2},${b},${a * 0.16})`);
    bg.addColorStop(1, `rgba(${r},${g2},${b},0)`);
    ctx.fillStyle = bg;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
}
