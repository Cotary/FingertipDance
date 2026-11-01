/**
 * 绘制原语层 —— 卡通视觉的「零件库」。
 *
 * 所有页面必须通过这里画按钮 / 卡片 / 标题，不允许各自 roundRect + fill。
 * 这是「整体风格一致」的强制执行点：
 *   夜空背景 · 果冻按钮 · 玻璃卡片 · 描边标题 · 五角星
 *
 * 投影全部用「显式形状」实现（下移一层的深色同形），
 * 不用 ctx.shadowBlur —— 微信小游戏 canvas 上 shadowBlur 是逐像素开销。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { CANDY, FONT_STACK, THEME, W, type CandyColor } from './theme';

/** 字体简写。 */
export function font(size: number, weight: number = W.bold): string {
  return `${weight} ${Math.round(size)}px ${FONT_STACK}`;
}

/** 把 #RRGGBB 按比例混向目标色，用于生成同族明暗。 */
export function mix(hex: string, to: string, k: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (sh: number): number => {
    const va = (a >> sh) & 255;
    const vb = (b >> sh) & 255;
    return Math.round(va + (vb - va) * Math.max(0, Math.min(1, k)));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ─────────────────────────── 背景 ───────────────────────────

/**
 * 全屏夜空背景：竖向渐变 + 闪烁星点 + 底部两层山影。
 * 只在 frame() 里调用一次，其余页面一概不画背景。
 */
export function nightSky(ctx: CanvasRenderingContext2D, now: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
  g.addColorStop(0, THEME.skyTop);
  g.addColorStop(0.40, THEME.skyMid);
  g.addColorStop(0.80, '#120C3A');
  g.addColorStop(1, THEME.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  drawStars(ctx, now);
  drawRidges(ctx);
}

/** 星点：确定性伪随机，位置固定；只让亮度呼吸。 */
function drawStars(ctx: CanvasRenderingContext2D, now: number): void {
  let s = 20261101;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 72; i++) {
    const x = rnd() * DESIGN_W;
    const y = rnd() * DESIGN_H * 0.82;
    const r = 0.9 + rnd() * 2.0;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(now / 1100 + i * 0.68));
    ctx.fillStyle = `rgba(255,255,255,${(0.16 + tw * 0.52).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 极少数大星带十字光芒，制造「亮星」层次
  let s2 = 777;
  const rnd2 = (): number => ((s2 = (s2 * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 6; i++) {
    const x = rnd2() * DESIGN_W;
    const y = 80 + rnd2() * DESIGN_H * 0.55;
    const a = 0.25 + 0.3 * Math.abs(Math.sin(now / 900 + i));
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, y + 7);
    ctx.stroke();
  }
}

/** 底部山影：两层低对比剪影，给画面重量感。 */
function drawRidges(ctx: CanvasRenderingContext2D): void {
  // 后层
  ctx.fillStyle = mix(THEME.ridge, '#4A3AA0', 0.16);
  ctx.beginPath();
  ctx.moveTo(0, DESIGN_H);
  ctx.lineTo(0, 1120);
  ctx.quadraticCurveTo(120, 1030, 250, 1090);
  ctx.quadraticCurveTo(360, 1136, 470, 1072);
  ctx.quadraticCurveTo(600, 1000, 750, 1090);
  ctx.lineTo(DESIGN_W, 1120);
  ctx.lineTo(DESIGN_W, DESIGN_H);
  ctx.closePath();
  ctx.fill();

  // 前层
  ctx.fillStyle = THEME.ridge;
  ctx.beginPath();
  ctx.moveTo(0, DESIGN_H);
  ctx.lineTo(0, 1200);
  ctx.quadraticCurveTo(150, 1130, 300, 1188);
  ctx.quadraticCurveTo(430, 1238, 560, 1180);
  ctx.quadraticCurveTo(680, 1128, 750, 1196);
  ctx.lineTo(DESIGN_W, 1210);
  ctx.lineTo(DESIGN_W, DESIGN_H);
  ctx.closePath();
  ctx.fill();
}

// ─────────────────────────── 果冻按钮 ───────────────────────────

/** 果冻按钮参数。 */
export interface JellyOpts {
  /** 按下：整体下沉，厚底边收窄 */
  pressed?: boolean;
  /** 圆角，默认取 h/2（胶囊）；方形按钮传小值 */
  radius?: number;
  /** 厚底边高度，默认按高度推算 */
  depth?: number;
  /** 文案 */
  label?: string;
  /** 文案字号，默认按高度推算 */
  fontSize?: number;
  /** 文案色，默认白 */
  labelColor?: string;
  /** 是否画文字描边，默认 true */
  outlined?: boolean;
  /** 自定义顶面渐变（不传则用糖果色三档） */
  gradient?: [string, string, string];
}

/**
 * 果冻按钮：厚底边 + 顶面竖向渐变 + 顶部高光条 + 白描边 + 描边文字。
 * 卡通游戏「按下去是软的」观感全靠这个结构，所有可点元素统一用它。
 */
export function jelly(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: CandyColor,
  opts: JellyOpts = {},
): void {
  const r = opts.radius ?? Math.min(h / 2, 34);
  const depth = opts.depth ?? Math.max(4, Math.round(h * 0.10));
  const sink = opts.pressed ? depth * 0.75 : 0;
  const by = y + sink;
  const visH = h - sink;

  // 厚底边（按钮的「厚度」）
  ctx.fillStyle = c.dark;
  roundRect(ctx, x, by + depth - sink, w, h, r);
  ctx.fill();

  // 顶面
  const grad = opts.gradient;
  const g = ctx.createLinearGradient(0, by, 0, by + visH);
  if (grad) {
    g.addColorStop(0, grad[0]);
    g.addColorStop(0.5, grad[1]);
    g.addColorStop(1, grad[2]);
  } else {
    g.addColorStop(0, c.light);
    g.addColorStop(0.42, c.base);
    g.addColorStop(1, c.base);
  }
  ctx.fillStyle = g;
  roundRect(ctx, x, by, w, visH, r);
  ctx.fill();

  // 顶部高光（只在按钮上半部，clip 保证不出圆角）
  ctx.save();
  roundRect(ctx, x, by, w, visH, r);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  roundRect(ctx, x + w * 0.05, by + visH * 0.09, w * 0.90, visH * 0.36, Math.min(r, visH * 0.3));
  ctx.fill();
  // 底部内侧压暗，强化体积
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(x, by + visH * 0.78, w, visH * 0.22);
  ctx.restore();

  // 边光
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, by + 1, w - 2, visH - 2, r);
  ctx.stroke();

  if (opts.label !== undefined) {
    const fs = opts.fontSize ?? Math.round(visH * 0.42);
    strokeText(ctx, opts.label, x + w / 2, by + visH / 2, fs, {
      fill: opts.labelColor ?? '#FFFFFF',
      // 描边用暗部色：白字压在金/橙上也能读清，同时像贴纸
      stroke: opts.outlined === false ? undefined : c.dark,
      strokeWidth: Math.max(2, fs * 0.14),
    });
  }
}

/**
 * 描边文字：先描边后填色，边角圆润（卡通贴纸感）。
 *
 * 基线用 alphabetic + 手动偏移，而不是 canvas 的 'middle'：
 * canvas 的 middle 与 SVG 的 central 视觉位置不一致，统一用 alphabetic
 * 可让「浏览器实测」与「离线 SVG 预览」完全对齐，避免调完预览又跑偏。
 */
export function strokeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: {
    weight?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
  } = {},
): void {
  const base = opts.baseline ?? 'middle';
  // alphabetic 基线到视觉中心的偏移量（中文字面框约 0.72em 高）
  const dy = base === 'middle' ? size * 0.36 : base === 'top' ? size * 0.88 : base === 'bottom' ? -size * 0.12 : 0;

  ctx.font = font(size, opts.weight ?? W.bold);
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'alphabetic';
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = opts.strokeWidth ?? Math.max(3, size * 0.16);
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, y + dy);
  }
  ctx.fillStyle = opts.fill ?? '#FFFFFF';
  ctx.fillText(text, x, y + dy);
}

// ─────────────────────────── 玻璃卡片 ───────────────────────────

/**
 * 玻璃卡片：半透明白底 + 边光 + 顶部一道更亮的内高光。
 * 用于玩家条、列表行、统计卡、气泡等所有「面」。
 */
export function glass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number = 24,
  opts: { fill?: string; edge?: string; inner?: boolean; shadow?: boolean } = {},
): void {
  if (opts.shadow !== false) {
    ctx.fillStyle = 'rgba(6,3,26,0.35)';
    roundRect(ctx, x, y + 6, w, h, r);
    ctx.fill();
  }
  ctx.fillStyle = opts.fill ?? THEME.glass;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  // 内高光：顶部一条更亮的窄带
  if (opts.inner !== false) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  ctx.strokeStyle = opts.edge ?? THEME.glassEdge;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r);
  ctx.stroke();
}

/** 胶囊徽章：小圆角底 + 居中文字，用于 Lv、皮肤数、关号等。 */
export function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: CandyColor,
  label: string,
  fontSize?: number,
): void {
  const r = h / 2;
  ctx.fillStyle = 'rgba(6,3,26,0.30)';
  roundRect(ctx, x, y + 3, w, h, r);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, c.light);
  g.addColorStop(0.5, c.base);
  g.addColorStop(1, c.base);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  strokeText(ctx, label, x + w / 2, y + h / 2 + 1, fontSize ?? Math.round(h * 0.58), {
    stroke: c.dark,
    strokeWidth: Math.max(2, h * 0.09),
  });
}

// ─────────────────────────── 图形 ───────────────────────────

/** 五角星路径（不填色，仅建路径）。 */
export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, inner: number = 0.46): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : R * inner;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 一颗立体五角星：暗色厚边 + 金色顶面 + 左上高光。 */
export function candyStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  filled: boolean,
): void {
  const on = filled ? CANDY.gold : CANDY.purple;
  const body = filled ? on : { base: 'rgba(255,255,255,0.16)', light: 'rgba(255,255,255,0.24)', dark: 'rgba(255,255,255,0.10)', glow: 'rgba(255,255,255,0.1)' };

  // 厚边
  ctx.save();
  ctx.translate(0, R * 0.12);
  starPath(ctx, cx, cy, R);
  ctx.fillStyle = body.dark;
  ctx.fill();
  ctx.restore();

  // 顶面
  starPath(ctx, cx, cy, R);
  if (filled) {
    const g = ctx.createLinearGradient(cx - R, cy - R, cx + R * 0.4, cy + R);
    g.addColorStop(0, CANDY.gold.light);
    g.addColorStop(0.55, CANDY.gold.base);
    g.addColorStop(1, '#F2A93B');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = body.base;
  }
  ctx.fill();

  // 左上小高光
  if (filled) {
    ctx.save();
    starPath(ctx, cx, cy, R);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.28, cy - R * 0.42, R * 0.30, R * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** 一排三颗星（结算页 / 地图节点用）。 */
export function starRow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  stars: number,
  gap: number = R * 2.5,
): void {
  const startX = cx - gap;
  for (let i = 0; i < 3; i++) {
    // 中间的星略大，形成主次
    const rr = i === 1 ? R * 1.14 : R;
    candyStar(ctx, startX + i * gap, cy - (i === 1 ? R * 0.14 : 0), rr, i < stars);
  }
}

/** 圆形光晕（由内到外淡出），用于星球/当前节点背光。 */
export function halo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 圆角方形图标背板（导航选中态、游戏内小按钮用）。 */
export function jellySquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: CandyColor,
  pressed: boolean = false,
): void {
  jelly(ctx, x, y, w, h, c, { radius: Math.min(w, h) * 0.32, depth: 6, pressed });
}
