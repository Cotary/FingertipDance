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
  /** 棋盘底板：沉在浅色页面里的一块深灰蓝黏土 */
  board: { base: '#5E7A8C', light: '#8AA3B5', dark: '#44596A', shade: '#2F404E' },
  /** 比底板再深一号：阻挡块用 */
  boardDark: { base: '#44596A', light: '#5E7A8C', dark: '#2F404E', shade: '#22303A' },
  /** 星球表面的大陆（低饱和绿，压在蓝球上不刺眼） */
  land: { base: '#A6CBAF', light: '#D4E8D8', dark: '#779E86', shade: '#52795C' },
  /** 面板上的一块浅沙色内凹块（数据胶囊用） */
  sand: { base: '#E7D0B4', light: '#F5E3CB', dark: '#C9AE8E', shade: '#A88C6C' },
  /** 锁住的节点：比球体更深，才能从球上「浮」出来 */
  lockTile: { base: '#3C5163', light: '#54708A', dark: '#28394A', shade: '#1C2833' },
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

/** 圆片的抖动手捏轮廓（顺时针）。 */
export function discPts(cx: number, cy: number, r: number, seed: number, jitter = 0.006): Pt[] {
  const segs = Math.max(26, Math.min(52, Math.round(r * 0.48)));
  const pts: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2 - Math.PI / 2;
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

// ────────────────────────────── 主原语：黏土块 / 黏土球 ──────────────────────────────

export interface ClayOpts {
  /** 软投影深度（px）。0 = 不画投影（平贴的） */
  depth?: number;
  /** 亮面色阶的相对位移量，默认 0.10（高度比例） */
  hi?: number;
  /** 轮廓抖动幅度，默认 0.006 */
  jitter?: number;
  /** 是否画亮面 */
  lit?: boolean;
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

  if (opts.lit === false) return;

  // 亮面：clip 后画缩放的同形，边界是硬的 → 硬边色阶
  ctx.save();
  tracePts(ctx, pts, 0, -lift, 0.992, cx, cy);
  ctx.clip();

  const hiShift = (opts.hi ?? 0.10) * h;
  ctx.fillStyle = c.light;
  tracePts(ctx, pts, -w * 0.015, -lift - hiShift, 0.90, cx, cy);
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
  const pts = discPts(cx, cy, r, seed, jitter);
  const depth = opts.depth ?? 7;

  if (depth > 0) softShadow(ctx, pts, depth, 0.085, cx, cy);

  ctx.fillStyle = c.dark;
  tracePts(ctx, pts);
  ctx.fill();

  const lift = Math.max(1.5, r * 0.09);
  ctx.fillStyle = c.base;
  tracePts(ctx, pts, 0, -lift, 0.988, cx, cy);
  ctx.fill();

  if (opts.lit === false) return;

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

  if (opts.lit === false) return;

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
}
