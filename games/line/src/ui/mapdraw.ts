/**
 * 地图绘制 —— 星空古路。
 *
 * 几何和命中在 `mapview.ts`，这里只负责「看起来像一条通往星穹的路」。
 *
 * ## 三层纵深
 *
 * 1. **天空**：星点按 `scrollY × 0.16` 视差移动，星云几乎不动，远景行星固定。
 *    三层速度不同，滚动时就有了相机在动的错觉。
 * 2. **路面**：沿 Catmull-Rom 采样后左右偏移半个路宽拼成多边形，宽度随
 *    `roadHalfWidth(y)` 收窄 —— 透视发生在几何上，不是缩放一张图。
 * 3. **节点**：`depthScale(y)` 让远端缩到 0.72、近端放到 1.05，配椭圆投影。
 *
 * ## 为什么不再用黏土原语
 *
 * 黏土是「浅色桌面上的实体块」，它的体积感来自亮面 + 下沿暗边。
 * 放到深色夜空里，这套语言会变成一堆发灰的塑料片。这里改用
 * **自发光 + 边缘光 + 投影**：星球、星点、金色符文，都是光而不是块。
 */
import { DESIGN_H, DESIGN_W } from '../render/layout';
import { mapPalette, mixHex, type MapPalette } from '../render/mapstyle';
import { CLAY_FONT } from './clay';
import type { Button } from './hud';
import { DEBUG_ENABLED } from '../core/debug';
import {
  CENTER_X, RAIL, ROUTE_TOP, SKIN_LEVELS, VIEW_BOTTOM, WORLDS, WORLD_ENDS,
  clamp, depthScale, hash, levelNear, mapNodePos, nodeRadius, nodeX, nodeY,
  railGeometry, railYOf, roadHalfWidth, visibleRange, worldOf,
  type MapViewState,
} from './mapview';

// ────────────────────────────── 小工具 ──────────────────────────────

interface Pt {
  x: number;
  y: number;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** #RRGGBB → rgba()。传入 rgba 原样返回（调用方只对 hex 用它）。 */
function alpha(hex: string, a: number): string {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 亮度，用来决定球面上的数字用深色还是浅色。 */
function luminance(hex: string): number {
  if (!hex.startsWith('#')) return 0.5;
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

/** 圆角矩形路径（老 WebView 没有 `ctx.roundRect`）。 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

interface LabelOpts {
  weight?: number;
  align?: CanvasTextAlign;
  stroke?: string;
  strokeWidth?: number;
}

/** 一行字。描边先画、填充后画，压在星球上也读得清。 */
function label(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  o: LabelOpts = {},
): void {
  ctx.save();
  ctx.font = `${o.weight ?? 700} ${size}px ${CLAY_FONT}`;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (o.stroke && (o.strokeWidth ?? 0) > 0) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.strokeWidth ?? 2;
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** 玻璃面板：深色底 + 一道金边 + 顶部一线反光。 */
function glass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  p: MapPalette,
): void {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = p.panel;
  ctx.fill();
  ctx.strokeStyle = p.panelEdge;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1.5));
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 四芒星（星点 / 关卡星星）。 */
function sparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fillStyle = color;
  ctx.fill();
}

function diamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.72, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.72, cy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// ────────────────────────────── 天空 ──────────────────────────────

/**
 * 天空：渐变 + 星云 + 远景行星 + 视差星点。
 *
 * 不画「满天繁星」—— 400 个点会把节点淹没。140 颗里只有 1/13 是四芒星，
 * 其余是 1~2px 的点：远看是星尘，近看才数得清。
 */
function drawSky(ctx: CanvasRenderingContext2D, st: MapViewState, now: number, p: MapPalette): void {
  // 铺到 1400：等比缩放后上下会多出几十像素，只铺 0..1334 会留接缝
  const g = ctx.createLinearGradient(0, -240, 0, 1400);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(0.46, p.skyMid);
  g.addColorStop(1, p.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(-160, -460, DESIGN_W + 320, 2200);

  // 星云：两团大而淡的径向渐变，压在天空上但绝不抢节点
  drawNebula(ctx, 120, 300, 330, p.nebulaA);
  drawNebula(ctx, 640, 760, 300, p.nebulaB);

  // 远景行星：固定在右上，滚动时几乎不动（视差 0.02）
  drawPlanet(ctx, 566, 292 - st.scrollY * 0.02, 116, p);

  // 地平线的微光：让「路的尽头」有个亮处，而不是纯黑
  const glow = ctx.createRadialGradient(CENTER_X, ROUTE_TOP + 60, 20, CENTER_X, ROUTE_TOP + 60, 360);
  glow.addColorStop(0, p.roadGlow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, ROUTE_TOP - 300, DESIGN_W, 660);

  drawStars(ctx, st, now, p);
}

function drawNebula(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(0.55, color.replace(/0\.\d+\)$/, '0.08)'));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** 一组星座：三四颗星 + 细连线。比撒一地碎石安静，也更像「星图」。 */
function drawConstellation(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  accent: string,
  seed: number,
): void {
  const n = 3 + Math.floor(hash(seed * 1.9) * 2);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const ang = hash(seed * 3.1 + i * 5.7) * Math.PI * 2;
    const rr = (18 + hash(seed * 7.3 + i) * 34) * s;
    pts.push({ x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr * 0.7 });
  }

  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
    else ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = alpha(accent, 0.16);
  ctx.lineWidth = 0.9;
  ctx.stroke();

  for (let i = 0; i < pts.length; i++) {
    const r = (1.4 + hash(seed + i * 2.3) * 1.8) * s;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    ctx.fillStyle = alpha(i === 0 ? accent : '#FFFFFF', i === 0 ? 0.55 : 0.30);
    ctx.fill();
  }
}

/** 一颗带环的行星。画得很淡，只在余光里成立。 */
function drawPlanet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  p: MapPalette,
): void {
  ctx.save();
  ctx.globalAlpha = 0.55;

  // 本体：光从左上来
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, mixHex(p.planet, p.ink, 0.22));
  g.addColorStop(0.55, p.planet);
  g.addColorStop(1, p.planetDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 两条淡淡的云带
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = alpha(p.ink, 0.05);
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.22, r * 1.1, r * 0.1, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.3, r * 1.1, r * 0.13, 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 环：从行星背后穿过去，所以先画后半环、再画本体？这里用「整环 + 低透明」
  // 近似 —— 环的正面压在本体上会亮一档，背面被本体挡住，看起来就对。
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.28);
  ctx.strokeStyle = p.planetRing;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.62, r * 0.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = alpha(p.ink, 0.12);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.44, r * 0.25, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 边缘光
  ctx.strokeStyle = alpha(p.ink, 0.18);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r - 0.8, Math.PI * 1.05, Math.PI * 1.72);
  ctx.stroke();

  ctx.restore();
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  now: number,
  p: MapPalette,
): void {
  const span = DESIGN_H + 160;
  const shift = st.scrollY * 0.16;
  // 银河：一条斜穿屏幕的密集星带。没有它，星空就只是「撒了点白点」。
  for (let i = 0; i < 120; i++) {
    const t = hash(i * 7.7 + 2.1);
    const bandY = 760 - t * 560 + (hash(i * 3.3) - 0.5) * 110;
    const y = bandY - shift * 0.06;
    if (y < -20 || y > DESIGN_H + 20) continue;
    const r = 0.5 + hash(i * 9.1) * 1.1;
    ctx.fillStyle = alpha(i % 9 === 0 ? p.starWarm : p.star, 0.10 + hash(i * 4.4) * 0.22);
    ctx.fillRect(t * DESIGN_W, y, r, r);
  }

  for (let i = 0; i < 160; i++) {
    const bx = hash(i * 2.31 + 0.7) * DESIGN_W;
    let by = (hash(i * 3.77 + 1.3) * span - shift) % span;
    if (by < 0) by += span;
    const y = by - 70;

    // 越靠上越暗：远处星点被大气吃掉一部分，纵深感来自这条衰减
    const depth = clamp((y - 40) / (DESIGN_H - 120), 0, 1);
    const twinkle = 0.72 + 0.28 * Math.sin(now / 900 + i * 1.7);
    const a = (0.22 + 0.5 * depth) * twinkle;
    const warm = i % 17 === 0;
    const color = warm ? p.starWarm : p.star;

    if (i % 13 === 0) {
      sparkle(ctx, bx, y, 2.6 + hash(i) * 2.4, alpha(color, a));
    } else {
      const r = 0.7 + hash(i * 5.1) * 1.1;
      ctx.fillStyle = alpha(color, a);
      ctx.fillRect(bx - r / 2, y - r / 2, r, r);
    }
  }
}

// ────────────────────────────── 地形点缀 ──────────────────────────────

/** 浮在路两侧的碎石 / 星尘。剪影 + 一道边缘光，越远越淡。 */
function drawScenery(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  first: number,
  last: number,
  p: MapPalette,
): void {
  for (let idx = first; idx <= last; idx++) {
    const y = nodeY(idx) - st.scrollY;
    if (y < ROUTE_TOP - 120 || y > VIEW_BOTTOM + 120) continue;
    const x = nodeX(idx);
    const w = p.world[worldOf(idx)];
    const a = hash(idx * 3 + 1);
    const b = hash(idx * 7 + 5);
    const side = idx % 2 === 0 ? 1 : -1;
    const s = depthScale(y);

    if (idx % 3 === 0) {
      drawConstellation(ctx, clamp(x + side * (150 + a * 60), 60, 636), y + (b - 0.5) * 76, s, w, idx);
    } else if (idx % 7 === 0) {
      drawShard(ctx, clamp(x + side * (150 + a * 66), 50, 646), y + (b - 0.5) * 70, (7 + a * 8) * s, w, 0.4, idx);
    }
  }
}

function drawShard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  accent: string,
  a: number,
  seed: number,
): void {
  const n = 5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rr = r * (0.62 + hash(seed + i * 3.1) * 0.5);
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr * 0.86;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(9,14,24,${(0.72 * a + 0.2).toFixed(3)})`;
  ctx.fill();
  ctx.strokeStyle = alpha(accent, 0.34 * a);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 朝上的那条棱被远处的光照到
  ctx.beginPath();
  ctx.moveTo(x - r * 0.5, y - r * 0.28);
  ctx.lineTo(x, y - r * 0.92);
  ctx.lineTo(x + r * 0.52, y - r * 0.22);
  ctx.strokeStyle = alpha(accent, 0.55 * a);
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ────────────────────────────── 路 ──────────────────────────────

/** Catmull-Rom 采样。`STEPS` 取 6：一屏 10 关约 80 个采样点，足够顺滑。 */
function samplePath(from: number, to: number, scrollY: number, levelCount: number): Pt[] {
  const lo = Math.max(1, from - 1);
  const hi = Math.min(levelCount, to + 1);
  const pts: Pt[] = [];
  for (let i = lo; i <= hi; i++) {
    const p = mapNodePos(i);
    pts.push({ x: p.x, y: p.y - scrollY });
  }
  if (pts.length < 2) return pts;

  const out: Pt[] = [];
  const STEPS = 6;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < STEPS; k++) out.push(catmull(p0, p1, p2, p3, k / STEPS));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** 沿采样点拼一条带宽度的带子（左右各偏移半宽）。 */
function ribbon(ctx: CanvasRenderingContext2D, pts: Pt[], extra: number, taperEnd = false): void {
  if (pts.length < 2) return;
  const taperFrom = Math.max(2, Math.floor(pts.length * 0.88));
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // 法线：切线逆时针 90°
    const nx = -ty;
    const ny = tx;
    const tail = taperEnd && i >= taperFrom
      ? 1 - 0.58 * ((i - taperFrom) / Math.max(1, pts.length - 1 - taperFrom))
      : 1;
    const w = (roadHalfWidth(pts[i].y) + extra) * tail;
    left.push({ x: pts[i].x + nx * w, y: pts[i].y + ny * w });
    right.push({ x: pts[i].x - nx * w, y: pts[i].y - ny * w });
  }

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
}

/** 一条从远到近由暗到亮的路。 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  first: number,
  last: number,
  p: MapPalette,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const doneEnd = Math.min(last, st.currentLevel - 1);

  if (doneEnd >= first) {
    const pts = samplePath(first, doneEnd, st.scrollY, st.levelCount);

    // 外发光：一条更宽的带子，压低透明度。不用 shadowBlur（移动端极慢）
    ribbon(ctx, pts, 8, true);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = p.roadGlow;
    ctx.fill();
    ctx.restore();

    // 主路面：深色石面，不是一条金带。
    //
    // 实测金色铺满整条路会读成「高速公路」—— 路比节点还亮，主角变配角。
    // 石面压暗、金只留在边缘和符文里，才是「古道」。
    ribbon(ctx, pts, 0, true);
    const g = ctx.createLinearGradient(0, ROUTE_TOP, 0, VIEW_BOTTOM);
    g.addColorStop(0, mixHex(p.road, p.skyMid, 0.72));
    g.addColorStop(0.55, mixHex(p.road, '#1C1408', 0.56));
    g.addColorStop(1, mixHex(p.road, '#241A0C', 0.44));
    ctx.fillStyle = g;
    ctx.fill();

    // 两条边缘线：路的「边」是它像一条路的关键，光有面会读成一条河
    strokeRibbonEdge(ctx, pts, 1, true);
    ctx.strokeStyle = alpha(p.roadEdge, 0.52);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    strokeRibbonEdge(ctx, pts, -1, true);
    ctx.stroke();

    // 横向石缝：每隔一段一道极淡的横线，路面才有「铺出来」的质感
    for (let i = 3; i < pts.length - 3; i += 6) {
      const q = pts[i];
      const prev = pts[i - 1];
      const next = pts[i + 1];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const hw = roadHalfWidth(q.y) * 0.9;
      ctx.beginPath();
      ctx.moveTo(q.x - ty * hw, q.y + tx * hw);
      ctx.lineTo(q.x + ty * hw, q.y - tx * hw);
      ctx.strokeStyle = alpha(p.ink, 0.07);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 中线：虚线金线，整条路的「向导」
    ctx.save();
    ctx.setLineDash([5, 9]);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = alpha(p.rune, 0.38);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // 未走的路：一串没点亮的踏脚石，比虚线更像「路还没修完」
  const ahead = Math.max(first, st.currentLevel);
  if (last > ahead) {
    const pts = samplePath(ahead, last, st.scrollY, st.levelCount);

    // 未修好的路也要「连起来」。只画一串石头的话，锁着的关卡会像
    // 浮在空里的孤岛，整张图读作「路断在这里」。
    ctx.save();
    ctx.setLineDash([3, 11]);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = alpha(p.roadDim, 0.42);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < pts.length; i += 3) {
      const q = pts[i];
      if (q.y < ROUTE_TOP - 20 || q.y > VIEW_BOTTOM + 20) continue;
      const s = depthScale(q.y);
      const w = roadHalfWidth(q.y) * 0.58;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, w, 3.8 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = alpha(p.roadDim, 0.34);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(q.x, q.y - 1.2 * s, w * 0.7, 1.6 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = alpha(p.roadEdge, 0.18);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** 只描一条边（side=1 左 / -1 右）。 */
function strokeRibbonEdge(ctx: CanvasRenderingContext2D, pts: Pt[], side: 1 | -1, taperEnd = false): void {
  const taperFrom = Math.max(2, Math.floor(pts.length * 0.88));
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const tail = taperEnd && i >= taperFrom
      ? 1 - 0.58 * ((i - taperFrom) / Math.max(1, pts.length - 1 - taperFrom))
      : 1;
    const w = roadHalfWidth(pts[i].y) * tail;
    const x = pts[i].x - ty * w * side;
    const y = pts[i].y + tx * w * side;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** 世界地层：一条很淡的横向色带，滚过就换区。 */
function drawWorldTint(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  first: number,
  last: number,
  p: MapPalette,
): void {
  for (let wi = 0; wi < WORLDS.length; wi++) {
    const w = WORLDS[wi];
    if (w.to < first || w.from > last) continue;
    const y0 = nodeY(w.from) - st.scrollY - 220;
    const y1 = nodeY(Math.min(w.to + 1, st.levelCount)) - st.scrollY + 100;
    if (y1 < 0 || y0 > DESIGN_H) continue;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, alpha(p.world[wi], 0));
    g.addColorStop(0.5, alpha(p.world[wi], 0.05));
    g.addColorStop(1, alpha(p.world[wi], 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(0, y0), DESIGN_W, Math.min(DESIGN_H, y1) - Math.max(0, y0));
  }
}

// ────────────────────────────── 世界门 ──────────────────────────────

/**
 * 世界门：一道横跨古道的扁金环，左右各落一根短柱。
 *
 * 这道门改了四版，每版死因都不同（详见 `docs/连连看/36-星空古路地图.md` §五）：
 * 鸟居 → 横梁压在环内文字上，俯视角里没有厚度；
 * 竖椭圆星环 → 环高 184，把前后两关的球整个套进去，读作「一汪水」；
 * 扁环 → 门内提亮过度，读作「玻璃盘」；
 * 现在 → 扁金环（`rx=140·s` / `ry=40·s`）+ 两根短柱 + 世界色刻度点 + 环侧文字。
 *
 * 两条硬约束：
 * 1. **高度只能给 40·s。** 前后两关中心隔 `NODE_STEP=116`，两颗球的下缘/上缘之间
 *    只剩约 44 的空，环再高就会把球吞进去。
 * 2. **门内不能比门外亮。** 内部整体提亮会让眼睛读成透镜；「门里是另一个世界」
 *    只能靠极淡的世界色雾气（alpha 0.08）+ 环内一圈世界色细线。
 */
function drawGate(
  ctx: CanvasRenderingContext2D,
  gi: number,
  gy: number,
  st: MapViewState,
  p: MapPalette,
): void {
  const w = WORLDS[gi + 1];
  const s = depthScale(gy);
  const opened = (DEBUG_ENABLED && st.debugUnlockAll) || st.currentLevel >= w.from;
  const cleared = st.currentLevel > w.to;
  const accent = opened ? p.world[gi + 1] : 'rgba(126,146,176,0.50)';
  const ink = opened ? p.gateInk : 'rgba(214,224,240,0.42)';

  const from = w.from;
  // 一道**扁而宽**的光环，像斜着看过去的拱门。
  //
  // 高度只能给到 40*s：前后两关的中心相距 NODE_STEP=116，两颗球的下缘/上缘之间
  // 只剩约 44 的空。第一版 ry=92，环把两个球整个套进去，读作「一汪水」而不是门；
  // 环顶的罗马数字还被上一关的球压掉。扁环 + 环侧文字才立得住。
  const rx = 140 * s;
  const ry = 40 * s;
  const cx = clamp((nodeX(from - 1) + nodeX(from)) / 2, 34 + rx, 656 - rx);
  // 往上偏一点：让环底落在下一关球心的上方，球画上来时像「球站在门前」。
  const cy = gy - 6 * s;

  ctx.save();

  // 门内的光：只留极淡的一层。给太多会变成「玻璃盘」——内部比外面亮，
  // 眼睛就读成一片透镜，而不是一个可以穿过去的门洞。
  if (opened) {
    const veil = ctx.createRadialGradient(cx, cy, rx * 0.1, cx, cy, rx);
    veil.addColorStop(0, alpha(accent, 0.08));
    veil.addColorStop(0.7, alpha(accent, 0.03));
    veil.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = veil;
    ctx.fill();
  }

  // 外圈光晕
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(opened ? p.gold : '#7E92B0', 0.10);
  ctx.lineWidth = 15 * s;
  ctx.stroke();

  // 主环：金色金属环。上缘亮、下缘暗，环才有转折。
  // 世界色只留给刻度点和环内细线——环本身是「铜」的，才有门框的物质感。
  const ring = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  ring.addColorStop(0, alpha(mixHex(p.gold, '#FFFFFF', 0.45), opened ? 0.95 : 0.34));
  ring.addColorStop(0.5, alpha(p.gold, opened ? 0.88 : 0.30));
  ring.addColorStop(1, alpha(mixHex(p.gold, '#000000', 0.35), opened ? 0.58 : 0.18));
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 6 * s;
  ctx.stroke();

  // 内圈一道细线（世界色）：门里透出来的那点光
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 7 * s, ry - 7 * s, 0, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(opened ? accent : '#7E92B0', opened ? 0.38 : 0.16);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 环上的刻度：十颗，亮起来几颗就是这个世界打了多少。
  //
  // 上一版把进度画成环底一段弧——弧正好从路面横穿过去，被下一关的球挡住大半，
  // 等于没画。刻度点在环的两侧，不会被球盖。
  const fr = opened ? (cleared ? 1 : fillRatio(w, st)) : 0;
  const lit = Math.round(fr * 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * rx;
    const py = cy + Math.sin(a) * ry;
    const on = i < lit;
    ctx.beginPath();
    ctx.arc(px, py, (on ? 2.6 : 1.8) * s, 0, Math.PI * 2);
    ctx.fillStyle = on ? alpha(cleared ? p.gold : accent, 0.92) : 'rgba(160,180,210,0.22)';
    ctx.fill();
  }

  // 两根短柱：单靠一个扁椭圆太像「玻璃盘」，左右各落一根柱子才读成门框。
  for (const side of [-1, 1]) {
    const px = cx + side * rx;
    const ph = 38 * s;
    ctx.beginPath();
    ctx.moveTo(px, cy - 2 * s);
    ctx.lineTo(px, cy + ph);
    ctx.strokeStyle = alpha(mixHex(p.gold, '#000000', 0.25), opened ? 0.72 : 0.28);
    ctx.lineWidth = 6 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 文字移到环外一侧：环里塞不下两行（高只有 80），而且正压在路面上。
  const toRight = cx < CENTER_X + 20;
  const lx = toRight ? cx + rx + 22 : cx - rx - 22;
  const align: CanvasTextAlign = toRight ? 'left' : 'right';

  label(ctx, `${ROMAN[gi + 1]} · ${w.name}`, lx, cy - 12 * s, 24 * s, ink, {
    align,
    weight: 700,
    stroke: 'rgba(0,0,0,0.45)',
    strokeWidth: 3 * s,
  });

  const done = Math.max(0, Math.min(w.to - w.from + 1, st.currentLevel - w.from));
  const right = cleared ? '已通关' : opened ? `${done} / ${w.to - w.from + 1}` : '未开启';
  label(ctx, right, lx, cy + 16 * s, 20 * s, opened ? alpha(p.ink, 0.62) : 'rgba(214,224,240,0.32)', {
    align,
    weight: 700,
    stroke: 'rgba(0,0,0,0.35)',
    strokeWidth: 2.5 * s,
  });

  ctx.restore();
}

function fillRatio(w: (typeof WORLDS)[number], st: MapViewState): number {
  const total = w.to - w.from + 1;
  if (total <= 0) return 0;
  const done = Math.max(0, Math.min(total, st.currentLevel - w.from));
  return done / total;
}

// ────────────────────────────── 节点 ──────────────────────────────

function drawNode(
  ctx: CanvasRenderingContext2D,
  idx: number,
  x: number,
  y: number,
  st: MapViewState,
  now: number,
  p: MapPalette,
): void {
  const current = idx === st.currentLevel;
  const locked = idx > st.currentLevel;
  const star = st.stars[String(idx)] ?? 0;
  const milestone = WORLD_ENDS.includes(idx);
  const accent = p.world[worldOf(idx)];
  const r = nodeRadius(idx, y, st);
  const s = depthScale(y);

  // 投影：所有球都「悬」在路面上方，没有影子就只是贴纸
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.92, r * 0.95, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fill();

  if (locked) {
    // 暗星：深色球 + 一圈冷光边，读作「还没点亮」而不是「这里堵着」
    const g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.36, r * 0.1, x, y, r * 1.02);
    g.addColorStop(0, mixHex(p.locked, p.ink, 0.05));
    g.addColorStop(0.72, p.locked);
    g.addColorStop(1, mixHex(p.locked, '#000000', 0.62));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = alpha(p.lockedRim, 0.62);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.8, Math.PI * 1.02, Math.PI * 1.78);
    ctx.stroke();

    // 调试模式：锁着也能点，加一圈虚线，一眼看出「这些是测试解的」
    if (DEBUG_ENABLED && st.debugUnlockAll) {
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(160,210,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    label(ctx, String(idx), x, y + 0.5, r * 0.62, 'rgba(206,220,240,0.38)', {
      weight: 600,
      stroke: 'rgba(0,0,0,0.35)',
      strokeWidth: 2,
    });
    return;
  }

  if (current) {
    // 当前关：一颗小太阳。光晕 + 两道旋转的环 + 指路的小箭头
    const pulse = (Math.sin(now / 420) + 1) / 2;
    const corona = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.15);
    corona.addColorStop(0, alpha(p.current, 0.34 + pulse * 0.10));
    corona.addColorStop(0.55, alpha(p.current, 0.10));
    corona.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = corona;
    ctx.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);

    // 外环：一道实、一道虚线（虚线慢慢转）
    ctx.strokeStyle = alpha(p.current, 0.35 + pulse * 0.25);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.32 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([4, 10]);
    ctx.lineDashOffset = -(now / 60) % 14;
    ctx.strokeStyle = alpha(p.gold, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 球体
    const g = ctx.createRadialGradient(x - r * 0.36, y - r * 0.42, r * 0.08, x, y, r * 1.05);
    g.addColorStop(0, mixHex(p.current, '#FFFFFF', 0.42));
    g.addColorStop(0.52, p.current);
    g.addColorStop(1, mixHex(p.current, '#2A1B08', 0.42));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // 边缘光
    ctx.strokeStyle = alpha(p.ink, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.9, Math.PI * 1.05, Math.PI * 1.7);
    ctx.stroke();

    label(ctx, String(idx), x, y + 1, r * 0.76, p.currentInk, {
      stroke: alpha(p.ink, 0.30),
      strokeWidth: 2,
    });

    // 上方的小箭头：告诉玩家「从这里往下走」
    const bob = Math.sin(now / 320) * 3.5;
    const ay = y - r - 18 + bob;
    ctx.beginPath();
    ctx.moveTo(x - 9, ay - 8);
    ctx.lineTo(x + 9, ay - 8);
    ctx.lineTo(x, ay + 1);
    ctx.closePath();
    ctx.fillStyle = alpha(p.current, 0.95);
    ctx.fill();
    return;
  }

  // 已通关：一颗有地貌的星球
  //
  // 世界末关再加一圈金环。环分两遍画：**后半圈在球之前、前半圈在球之后**，
  // 这样环是「套」在球上（后圈被球挡住、前圈压在球前面）。
  // 一次画完整椭圆的话，环压在球中间，看起来像在球上划了一刀。
  if (milestone) {
    ctx.strokeStyle = alpha(p.gold, 0.50);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r * 0.36, -0.18, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.44, r * 0.08, x, y, r * 1.06);
  g.addColorStop(0, mixHex(accent, '#FFFFFF', 0.38));
  g.addColorStop(0.55, accent);
  g.addColorStop(1, mixHex(accent, '#05070F', 0.58));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // 两条地貌带（裁剪在球里），每颗星的纹理都不一样
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const tilt = (hash(idx * 1.7) - 0.5) * 0.9;
  ctx.fillStyle = alpha(mixHex(accent, '#05070F', 0.55), 0.30);
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.16, r * 1.1, r * 0.14, tilt, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = alpha(p.ink, 0.12);
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.38, r * 0.9, r * 0.10, tilt * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 边缘光
  ctx.strokeStyle = alpha(p.ink, 0.42);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x, y, r - 0.9, Math.PI * 1.04, Math.PI * 1.74);
  ctx.stroke();

  const ink = luminance(accent) > 0.62 ? '#101318' : '#FFF6E9';
  label(ctx, String(idx), x, y + 0.5, r * 0.68, ink, {
    stroke: alpha('#000000', 0.28),
    strokeWidth: 2,
  });

  // 星级：三颗小四芒星
  if (star > 0) {
    for (let i = 0; i < 3; i++) {
      const on = i < star;
      sparkle(
        ctx,
        x + (i - 1) * (r * 0.52),
        y + r * 1.05,
        r * (on ? 0.17 : 0.12),
        on ? p.gold : 'rgba(255,255,255,0.18)',
      );
    }
  }

  // 皮肤奖励关：右上角一颗金钻
  if (SKIN_LEVELS.includes(idx)) {
    diamond(ctx, x + r * 0.78, y - r * 0.76, 8 * s, p.gold);
    diamond(ctx, x + r * 0.78, y - r * 0.76, 4 * s, alpha('#FFFFFF', 0.8));
  }

  // 世界末关：环的前半圈，压在球的前面
  if (milestone) {
    ctx.strokeStyle = alpha(p.gold, 0.65);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r * 0.36, -0.18, 0, Math.PI);
    ctx.stroke();
  }
}

// ────────────────────────────── 顶栏 / 导轨 / 按钮 ──────────────────────────────

function drawTopBar(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  first: number,
  last: number,
  p: MapPalette,
): void {
  const currentVisible = st.currentLevel >= first && st.currentLevel <= last;
  const head = currentVisible
    ? st.currentLevel
    : levelNear(st.scrollY + (ROUTE_TOP + VIEW_BOTTOM) / 2, st.levelCount);

  // 顶部遮罩：让标题区从星空里「退」出去，但不切一条硬边
  const fade = ctx.createLinearGradient(0, 0, 0, 250);
  fade.addColorStop(0, p.skyTop);
  fade.addColorStop(0.72, p.skyTop);
  fade.addColorStop(1, alpha(p.skyTop, 0));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, DESIGN_W, 250);

  // 返回：小玻璃胶囊
  glass(ctx, 30, 92, 96, 58, 29, p);
  label(ctx, '返回', 78, 121, 19, p.inkSoft, { weight: 600 });

  // 关号胶囊
  const pw = 250;
  const ph = 64;
  glass(ctx, (DESIGN_W - pw) / 2, 84, pw, ph, ph / 2, p);
  ctx.beginPath();
  ctx.arc((DESIGN_W - pw) / 2 + 30, 116, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = p.gold;
  ctx.fill();
  label(ctx, `第 ${head} 关`, DESIGN_W / 2 + 8, 117, 30, p.ink, { weight: 700 });

  // 世界名 + 区间
  const w = WORLDS[worldOf(head)];
  const text = `${w.name}  ${w.from}-${w.to}`;
  const labelY = 182;
  label(ctx, text, DESIGN_W / 2, labelY, 20, p.inkSoft, { weight: 600 });
  ctx.font = `600 20px ${CLAY_FONT}`;
  const tw = ctx.measureText(text).width;
  diamond(ctx, (DESIGN_W - tw) / 2 - 14, labelY - 1, 6, p.world[worldOf(head)]);
}

function drawRail(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): void {
  const g = railGeometry(st);
  const cx = RAIL.center;

  roundRect(ctx, cx - RAIL.width / 2, g.top, RAIL.width, g.h, RAIL.width / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const doneRatio = clamp((railYOf(st.currentLevel, st) - g.top) / g.h, 0, 1);
  if (doneRatio > 0.01) {
    ctx.save();
    roundRect(ctx, cx - RAIL.width / 2, g.top, RAIL.width, g.h, RAIL.width / 2);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, g.top, 0, g.top + g.h);
    grad.addColorStop(0, alpha(p.gold, 0.12));
    grad.addColorStop(1, alpha(p.gold, 0.55));
    ctx.fillStyle = grad;
    ctx.fillRect(cx - RAIL.width / 2, g.top, RAIL.width, g.h * doneRatio);
    ctx.restore();
  }

  let lastTick = -Infinity;
  for (let wi = 1; wi < WORLDS.length; wi++) {
    const ty = railYOf(WORLDS[wi].from, st);
    if (ty - lastTick < 7) continue;
    lastTick = ty;
    roundRect(ctx, cx - RAIL.width / 2 - 2, ty - 1.5, RAIL.width + 4, 3, 1.5);
    ctx.fillStyle = alpha(p.world[wi], 0.85);
    ctx.fill();
  }

  const cy = railYOf(st.currentLevel, st);
  const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, 14);
  halo.addColorStop(0, alpha(p.gold, 0.50));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - 14, cy - 14, 28, 28);

  ctx.beginPath();
  ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
  ctx.fillStyle = p.gold;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const tw = st.scrub ? 22 : 14;
  const tg = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
  tg.addColorStop(0, mixHex(p.gold, '#FFFFFF', 0.30));
  tg.addColorStop(0.5, p.gold);
  tg.addColorStop(1, mixHex(p.gold, '#000000', 0.25));
  roundRect(ctx, cx - tw / 2, g.thumbTop, tw, g.thumbH, tw / 2);
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.strokeStyle = alpha('#FFFFFF', 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, g.thumbTop + g.thumbH * 0.3);
  ctx.lineTo(cx, g.thumbTop + g.thumbH * 0.7);
  ctx.strokeStyle = alpha('#000000', 0.22);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  if (st.scrub) drawScrubLabel(ctx, st, g.thumbTop + g.thumbH / 2, p);
}

function drawScrubLabel(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  thumbMid: number,
  p: MapPalette,
): void {
  const lv = levelNear(st.scrollY + (ROUTE_TOP + VIEW_BOTTOM) / 2, st.levelCount);
  const w = WORLDS[worldOf(lv)];
  const cw = 216;
  const ch = 74;
  const cx = 646 - cw;
  const cy = clamp(thumbMid - ch / 2, ROUTE_TOP + 8, VIEW_BOTTOM - ch - 8);

  glass(ctx, cx, cy, cw, ch, 18, p);
  label(ctx, `第 ${lv} 关`, cx + cw / 2, cy + 27, 28, p.ink, { weight: 700 });
  label(ctx, `${w.name} ${w.from}-${w.to}`, cx + cw / 2, cy + 54, 18, p.world[worldOf(lv)], { weight: 600 });
}

function drawContinueButton(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): Button {
  const w = 340;
  const h = 64;
  const x = (DESIGN_W - w) / 2;
  const y = VIEW_BOTTOM + 6;
  const btn: Button = { x, y, w, h, label: `继续第 ${st.currentLevel} 关`, kind: 'primary', id: 'playCurrent' };

  // 外发光
  roundRect(ctx, x - 4, y - 4, w + 8, h + 8, (h + 8) / 2);
  ctx.fillStyle = alpha(p.gold, 0.14);
  ctx.fill();

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, mixHex(p.gold, '#FFFFFF', 0.42));
  g.addColorStop(0.5, p.gold);
  g.addColorStop(1, mixHex(p.gold, '#000000', 0.18));
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha('#FFFFFF', 0.45);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  label(ctx, `继续第 ${st.currentLevel} 关`, x + w / 2 - 10, y + h / 2, 27, p.currentInk, {
    weight: 700,
  });

  // 右侧箭头
  const ax = x + w - 40;
  ctx.beginPath();
  ctx.moveTo(ax - 6, y + h / 2 - 9);
  ctx.lineTo(ax + 5, y + h / 2);
  ctx.lineTo(ax - 6, y + h / 2 + 9);
  ctx.strokeStyle = alpha(p.currentInk, 0.8);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  return btn;
}

function drawBackButton(ctx: CanvasRenderingContext2D, p: MapPalette): Button {
  const btn: Button = { x: 30, y: 92, w: 96, h: 58, label: '返回', kind: 'ghost', id: 'navHome' };
  glass(ctx, btn.x, btn.y, btn.w, btn.h, 29, p);
  ctx.beginPath();
  ctx.moveTo(btn.x + 22, btn.y + 22);
  ctx.lineTo(btn.x + 14, btn.y + 29);
  ctx.lineTo(btn.x + 22, btn.y + 36);
  ctx.strokeStyle = p.inkSoft;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  label(ctx, '返回', btn.x + 58, btn.y + btn.h / 2, 20, p.inkSoft, { weight: 600 });
  return btn;
}

function drawHomeButton(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  p: MapPalette,
): Button | null {
  const off = nodeY(st.currentLevel) - st.scrollY;
  if (off > ROUTE_TOP + 40 && off < VIEW_BOTTOM - 40) return null;

  const w = 176;
  const h = 46;
  const btn: Button = {
    x: (DESIGN_W - w) / 2,
    y: VIEW_BOTTOM - 60,
    w,
    h,
    label: '回到当前',
    kind: 'ghost',
    id: 'mapHome',
  };
  glass(ctx, btn.x, btn.y, w, h, 23, p);
  ctx.beginPath();
  ctx.arc(btn.x + 30, btn.y + h / 2, 4, 0, Math.PI * 2);
  ctx.fillStyle = p.gold;
  ctx.fill();
  label(ctx, '回到当前', btn.x + w / 2 + 10, btn.y + h / 2, 20, p.inkSoft, { weight: 600 });
  return btn;
}

function drawDebugEntry(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): Button | null {
  if (!DEBUG_ENABLED || !st.debugUnlockAll) return null;
  const bw = 96;
  const bh = 56;
  const btn: Button = { x: DESIGN_W - 30 - bw, y: 92, w: bw, h: bh, label: '调试', kind: 'ghost', id: 'dj:open' };
  glass(ctx, btn.x, btn.y, bw, bh, 18, p);
  label(ctx, '调试', btn.x + bw / 2, btn.y + bh / 2, 20, p.inkSoft, { weight: 600 });
  return btn;
}

function drawToast(ctx: CanvasRenderingContext2D, st: MapViewState, now: number, p: MapPalette): void {
  if (!st.toast || now - st.toastAt >= 1800) return;
  const a = Math.min(1, (1800 - (now - st.toastAt)) / 400);
  ctx.save();
  ctx.globalAlpha = a;
  glass(ctx, DESIGN_W / 2 - 210, 236, 420, 72, 24, p);
  label(ctx, st.toast, DESIGN_W / 2, 272, 24, p.ink, { weight: 600 });
  ctx.restore();
}

// ────────────────────────────── 入口 ──────────────────────────────

/**
 * 绘制地图页。
 *
 * @param themeId 当前装备的棋盘主题 id（空 = 经典黏土），决定这片夜空是哪种夜色。
 * @returns 可点击按钮列表
 */
export function drawMapView(
  ctx: CanvasRenderingContext2D,
  st: MapViewState,
  now: number,
  themeId = '',
): Button[] {
  st.scrollY = clamp(st.scrollY, 0, st.maxScrollY);
  const p = mapPalette(themeId);
  const { first, last } = visibleRange(st.scrollY, st.levelCount);

  drawSky(ctx, st, now, p);
  drawWorldTint(ctx, st, first, last, p);
  drawScenery(ctx, st, first, last, p);
  drawTrail(ctx, st, first, last, p);

  for (let gi = 0; gi < WORLDS.length - 1; gi++) {
    const gy = (nodeY(WORLDS[gi + 1].from - 1) + nodeY(WORLDS[gi + 1].from)) / 2 - st.scrollY;
    if (gy < ROUTE_TOP - 110 || gy > VIEW_BOTTOM + 110) continue;
    drawGate(ctx, gi, gy, st, p);
  }

  for (let i = first; i <= last; i++) {
    const pos = mapNodePos(i);
    const y = pos.y - st.scrollY;
    if (y < ROUTE_TOP - 70 || y > VIEW_BOTTOM + 70) continue;
    // 贴近顶栏时淡出：顶栏遮罩是渐变的，硬画会露出半个「幽灵星球」
    const fade = clamp((y - (ROUTE_TOP + 6)) / 64, 0, 1);
    if (fade <= 0) continue;
    ctx.save();
    ctx.globalAlpha = fade;
    drawNode(ctx, i, pos.x, y, st, now, p);
    ctx.restore();
  }

  // 像素主题：CRT 扫描线。没有它，像素主题的地图只是一张「绿色的图」，
  // 分辨不出它和玻璃/深海的差别。
  if (p.id === 'pixel') {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.055)';
    for (let y = 0; y < DESIGN_H; y += 6) ctx.fillRect(0, y, DESIGN_W, 1.5);
    ctx.restore();
  }

  drawTopBar(ctx, st, first, last, p);
  drawRail(ctx, st, p);

  const out: Button[] = [];
  out.push(drawBackButton(ctx, p));
  out.push(drawContinueButton(ctx, st, p));

  const home = drawHomeButton(ctx, st, p);
  if (home) out.push(home);
  const debug = drawDebugEntry(ctx, st, p);
  if (debug) out.push(debug);

  drawToast(ctx, st, now, p);
  return out;
}
