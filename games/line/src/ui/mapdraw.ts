/**
 * 地图绘制 —— 「一扇望向无尽山径的窗」。
 *
 * 几何与命中在 `mapview.ts`；这里只负责把它画成设计稿 02 屏的样子：
 *
 * ```
 *   关卡地图                                   第 047 关 · 星 96 · 无尽   ← 标题行
 *   ╭──────────────────────────────────────╮
 *   │  ∿∿∿∿ 等高线（纸雕地形）        ∞ 无尽 │   ← 场景卡（圆角 40、金边 .14）
 *   │        ○ 虚圈   ○ 虚圈                │
 *   │        ⚑ 旗 050                       │
 *   │        ● 金珠 047   [你在这里]         │
 *   │        ✓ 勾盘  ✓ 勾盘                 │
 *   │  ✓ 已过关  金珠 当前关  旗 里程碑 …    │   ← 图例（压在卡内底缘）
 *   ╰──────────────────────────────────────╯
 *   ╭──────────────────────────────────────╮
 *   │ 下一里程碑 050 关            还差 3 关 │   ← 脚卡（整卡可点）
 *   ╰──────────────────────────────────────╯
 * ```
 *
 * ## 四条不能破的规矩
 *
 * 1. **卡内裁切**：山径、雾、等高线全部 `clip` 在场景卡里 —— 卡外是「地图之外」，
 *    漏出去一根线就毁了「窗外」的错觉。
 * 2. **一屏一金**：金只给「走过的路 + 当前关」。已过关是玉青，未走是灰虚线。
 * 3. **平的**：节点不做远小近大（纸雕场景没有灭点），四态靠形状与颜色区分。
 * 4. **雾包两端**：上缘与下缘各一层雾，路从雾里来、往雾里去 —— 这就是「无尽」。
 */
import { DESIGN_W } from '../render/layout';
import { mapPalette, mixHex, type MapPalette } from '../render/mapstyle';
import { CLAY_FONT } from './clay';
import { trackedText, trackedWidth, type Button } from './hud';
import { DEBUG_ENABLED } from '../core/debug';
import {
  RAIL, SCENE, SKIN_LEVELS, VIEW_BOTTOM, ROUTE_TOP,
  clamp, levelNear, mapNodePos, nodeRadius, nodeY,
  railGeometry, railYOf, screenYOf, visibleRange,
  type MapViewState,
} from './mapview';

// ────────────────────────────── 小工具 ──────────────────────────────

interface Pt {
  x: number;
  y: number;
}

/** #RRGGBB → rgba()。传入 rgba 原样返回（调用方只对 hex 用它）。 */
function alpha(hex: string, a: number): string {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
  /** 字距（逐字排版）。给了就走衬线带字距的那支笔。 */
  tracking?: number;
}

/**
 * 一行字（默认竖直居中）。
 *
 * 有 `tracking` 时用 `trackedText`（逐字排版，衬线）；
 * 没有时用普通 `fillText`（数字/图标这类不需要字距的）。
 */
function label(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  o: LabelOpts = {},
): void {
  const align = o.align ?? 'center';
  const track = o.tracking ?? 0;
  if (track > 0) {
    const w = trackedWidth(ctx, s, size, track, o.weight ?? 600);
    const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    trackedText(ctx, s, left, y + size * 0.36, size, color, track, o.weight ?? 600);
    return;
  }
  ctx.save();
  ctx.font = `${o.weight ?? 700} ${size}px ${CLAY_FONT}`;
  ctx.textAlign = align;
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
  ctx.lineWidth = 1.6;
  ctx.stroke();
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

/** 三位补零：铜牌编号的刻法（047 / 040）。 */
function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** 徽记色（设计稿固定值，不随主题变：朱砂旗是品牌的一部分）。 */
const SEAL = '#C04B33';
const SEAL_DEEP = '#A63B28';

// ────────────────────────────── 场景卡 ──────────────────────────────

/**
 * 场景卡：底 → 等高线 → 雾 → 地平微光。
 *
 * 卡片不是「一块深色板」，它是**一扇窗**：窗外仍是山，只是被雾遮住了。
 * 所以雾必须画在最后（压住路），而地平微光要透在雾里。
 */
function drawScene(ctx: CanvasRenderingContext2D, p: MapPalette): void {
  const { x, y, w, h } = SCENE;

  // 底：中段偏亮的墨绿（设计稿 radial 90%×80% at 50% 30% + 竖向 well）
  // 设计稿的卡是「上青下墨」（175deg, well → well-deep），不是常见的上暗下亮。
  // 直接用 skyTop..skyBottom 会渲染成反的：山顶黑、山脚亮，像挖了个洞。
  const sceneTop = mixHex(p.skyTop, p.gate, 0.46);
  const sceneMid = mixHex(p.skyTop, p.gate, 0.30);
  const sceneBottom = mixHex(p.skyTop, p.gate, 0.16);
  const base = ctx.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, sceneTop);
  base.addColorStop(0.55, sceneMid);
  base.addColorStop(1, sceneBottom);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  const pool = ctx.createRadialGradient(x + w * 0.5, y + h * 0.3, 10, x + w * 0.5, y + h * 0.3, w * 0.9);
  pool.addColorStop(0, 'rgba(94,138,116,0.16)');
  pool.addColorStop(1, 'rgba(94,138,116,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(x, y, w, h);

  drawContours(ctx, p);

  // 地平微光：右上角一团暖雾，是「路的尽头有光」的唯一暗示
  const hx = x + 548;
  const hy = y + 32;
  const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, 184);
  halo.addColorStop(0, 'rgba(242,220,168,0.12)');
  halo.addColorStop(1, 'rgba(242,220,168,0)');
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(1, 108 / 184);
  ctx.translate(-hx, -hy);
  ctx.fillStyle = halo;
  ctx.fillRect(hx - 184, hy - 184, 368, 368);
  ctx.restore();
}

/**
 * 纸雕等高线：横向长波 + 两道纵向折线。
 *
 * 全部**不动**（设计稿「滚动的是路，不动的是山」）——
 * 一旦让山跟着滚，纵深感会立刻变成「整张图在平移」。
 */
function drawContours(ctx: CanvasRenderingContext2D, p: MapPalette): void {
  const { x, y, w, h } = SCENE;
  const lx = x - 30;
  const rx = x + w + 30;

  ctx.save();
  ctx.lineCap = 'round';
  // 横向：7 条，间距 170，两条一组（主线 .10 / 副线 .06 错位 26）
  for (let i = 0; i < 7; i++) {
    const by = y + 150 + i * 170;
    for (const [dy, a, amp] of [[0, 0.16, 34], [26, 0.085, 26]] as const) {
      ctx.beginPath();
      for (let px = lx; px <= rx; px += 18) {
        const yy = by + dy
          + Math.sin(px * 0.0038 + i * 1.7) * amp
          + Math.sin(px * 0.011 + i * 0.9) * amp * 0.3;
        if (px === lx) ctx.moveTo(px, yy);
        else ctx.lineTo(px, yy);
      }
      ctx.strokeStyle = alpha(p.worldTo ?? p.ink, a);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  // 纵向：两道几乎贯穿全卡的长弯，给横向等高线一点「山体」的支撑
  for (const [cx0, a] of [[x + 150, 0.07], [x + 500, 0.055]] as const) {
    ctx.beginPath();
    for (let py = y - 20; py <= y + h + 20; py += 16) {
      const xx = cx0 + Math.sin(py * 0.0052) * 30 + Math.sin(py * 0.0017) * 18;
      if (py === y - 20) ctx.moveTo(xx, py);
      else ctx.lineTo(xx, py);
    }
    ctx.strokeStyle = alpha(p.worldTo ?? p.ink, a);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

/** 上下缘云雾：雾里是「窗外」，不是空白。 */
function drawMist(ctx: CanvasRenderingContext2D, p: MapPalette): void {
  const { x, y, w, h } = SCENE;
  const deep = mixHex(p.skyTop, '#000000', 0.15);

  const top = ctx.createLinearGradient(0, y, 0, y + 224);
  top.addColorStop(0, alpha(deep, 0.94));
  top.addColorStop(1, alpha(deep, 0));
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, 224);

  // 下缘的雾必须「厚到能垫图例」：露一点红旗下摆，图例就脏了
  const btm = ctx.createLinearGradient(0, y + h - 250, 0, y + h - 30);
  btm.addColorStop(0, alpha(deep, 0));
  btm.addColorStop(0.45, alpha(deep, 0.55));
  btm.addColorStop(0.8, alpha(deep, 0.92));
  btm.addColorStop(1, alpha(deep, 0.99));
  ctx.fillStyle = btm;
  ctx.fillRect(x, y + h - 250, w, 250);
}

/** 右上角的 ∞ / 无 尽：路没有终点。 */
function drawInfinityMark(ctx: CanvasRenderingContext2D): void {
  const cx = SCENE.x + 604;
  const cy = SCENE.y + 64;
  label(ctx, '∞', cx, cy, 42, 'rgba(242,220,168,0.55)', { weight: 500 });
  label(ctx, '无 尽', cx, cy + 36, 17, 'rgba(185,178,164,0.42)', { weight: 500, tracking: 6 });
}

// ────────────────────────────── 路 ──────────────────────────────

/** Catmull-Rom 采样。一屏 15 关约 90 个采样点，足够顺滑。 */
function samplePath(from: number, to: number, scrollY: number, levelCount: number): Pt[] {
  const lo = Math.max(1, from - 1);
  const hi = Math.min(levelCount, to + 1);
  const pts: Pt[] = [];
  for (let i = lo; i <= hi; i++) {
    const p = mapNodePos(i);
    pts.push({ x: p.x, y: screenYOf(p.y, scrollY) });
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

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
    else ctx.lineTo(pts[i].x, pts[i].y);
  }
}

/**
 * 已走 = 一缕金缮（外晕 18 / 金线 7.6 / 亮芯 2.2，设计稿三层）；
 * 未走 = 一串虚点（宽 6，dash 2/18）—— 路还没修到这。
 */
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
    tracePath(ctx, pts);
    ctx.strokeStyle = alpha(p.gold, 0.26);
    ctx.lineWidth = 18;
    ctx.stroke();
    const g = ctx.createLinearGradient(0, 0, SCENE.x + SCENE.w, SCENE.y + SCENE.h);
    g.addColorStop(0, mixHex(p.gold, '#8A6B3C', 0.55));
    g.addColorStop(1, p.gold);
    ctx.strokeStyle = g;
    ctx.lineWidth = 7.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,243,214,0.45)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  const ahead = Math.max(first, st.currentLevel);
  if (last > ahead) {
    const pts = samplePath(ahead, last, st.scrollY, st.levelCount);
    ctx.save();
    ctx.setLineDash([2, 18]);
    tracePath(ctx, pts);
    ctx.strokeStyle = alpha(p.inkSoft, 0.5);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ────────────────────────────── 节点 ──────────────────────────────

/**
 * 节点四态（设计稿实测 ×2）：
 *
 * - 已过关：玉青圆盘 20 + 金勾；
 * - 当前：金珠 26（外晕 54 / 环 38）+ 珠下关号 + 「你在这里」金签；
 * - 未至：虚线虚圈 19，不写关号（写了就是一张表，不是一条路）；
 * - 每 10 关：虚圈 23 + 一面朱砂旗 + 关号。
 */
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
  const r = nodeRadius(idx, y, st);
  const milestone = idx % 10 === 0 && idx > 0;

  // 主题奖励关：右上角一颗小金钻（图例里承诺过，就得真的画出来）
  if (SKIN_LEVELS.includes(idx) && !locked) {
    diamond(ctx, x + r * 0.9, y - r * 0.86, 11, p.gold);
  }

  if (current) {
    // 外晕 → 环 → 珠 → 芯（设计稿四层同心圆）
    ctx.beginPath();
    ctx.arc(x, y, 54, 0, Math.PI * 2);
    ctx.fillStyle = alpha(p.gold, 0.06);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 38, 0, Math.PI * 2);
    ctx.fillStyle = alpha(p.gold, 0.12);
    ctx.fill();

    // 极缓的呼吸：珠子本身不动，只有外晕明暗 3%
    const pulse = (Math.sin(now / 900) + 1) / 2;
    const g = ctx.createRadialGradient(x - 8, y - 10, 3, x, y, r);
    g.addColorStop(0, mixHex(p.current, '#FFFFFF', 0.25));
    g.addColorStop(1, '#B8945A');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = alpha('#F2DCA8', 0.85 + pulse * 0.15);
    ctx.lineWidth = 3.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF3D6';
    ctx.fill();

    // 珠下关号
    //
    // 行距只有 62，关号正好落在 y+62 上。来路接近正下方时，那里站着上一关的
    // 勾盘 —— 数字压绿圈，读起来像渲染出错。这种「竖直段」只在回头弯出现，
    // 出现时把关号挪到珠子**侧面**（和「你在这里」签相反的一侧）。
    const prevX = idx > 1 ? mapNodePos(idx - 1).x : x - 100;
    const vertical = Math.abs(prevX - x) < 26;
    const labelX = vertical ? x + (hereTagOnRight(x, idx) ? -52 : 52) : x;
    const labelY = vertical ? y + 12 : y + 62;
    label(ctx, pad3(idx), labelX, labelY, 26, '#F2DCA8', {
      weight: 700, stroke: 'rgba(14,24,21,0.75)', strokeWidth: 6,
    });
    drawHereTag(ctx, x, y, idx, p);
    return;
  }

  if (milestone) {
    // 旗杆 + 朱砂三角旗（先画旗，珠子压住杆根）
    ctx.beginPath();
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y - 64);
    ctx.strokeStyle = '#D4AF6A';
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 64);
    ctx.lineTo(x + 34, y - 51);
    ctx.lineTo(x, y - 38);
    ctx.closePath();
    const fg = ctx.createLinearGradient(x, y - 64, x + 30, y - 40);
    fg.addColorStop(0, SEAL);
    fg.addColorStop(1, SEAL_DEEP);
    ctx.fillStyle = fg;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = locked ? p.skyTop : p.gate;
    ctx.fill();
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = alpha(p.gold, 0.45);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.restore();

    label(ctx, pad3(idx), x, y + 44, 17, locked ? 'rgba(185,178,164,0.5)' : 'rgba(185,207,192,0.65)', {
      weight: 500, tracking: 3,
    });
    return;
  }

  if (locked) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = mixHex(p.skyTop, p.gate, 0.5);
    ctx.fill();
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(185,178,164,0.32)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    // 调试模式：锁着也能点，加一圈蓝虚线，一眼看出「这些是测试解的」
    if (DEBUG_ENABLED && st.debugUnlockAll) {
      ctx.save();
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = 'rgba(160,210,255,0.75)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  // 已过关：玉青盘 + 金勾
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.gate;
  ctx.fill();
  ctx.strokeStyle = alpha(p.gold, 0.5);
  ctx.lineWidth = 2.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 9, y);
  ctx.lineTo(x - 2, y + 7);
  ctx.lineTo(x + 10, y - 7);
  ctx.strokeStyle = '#F2DCA8';
  ctx.lineWidth = 3.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * 「你在这里」金签的落点。
 *
 * 优先放在来路的**反侧**（不挡路），但那一侧放不下时必须换边 ——
 * 珠子最右能到 x≈593，签再往右就顶出卡片（会被裁掉半张签）。
 *
 * 关号也要躲签，所以这个判定抽出来共用：两边各自算一遍就会打架
 * （签翻到左边、关号也让到左边，数字就被压在签下面）。
 */
function hereTagOnRight(nx: number, idx: number): boolean {
  const prevX = idx > 1 ? mapNodePos(idx - 1).x : nx + 100;
  const wantRight = idx > 1 && prevX < nx;
  const fitsLeft = nx - 30 - 152 >= SCENE.x + 14;
  const fitsRight = nx + 30 + 152 <= SCENE.x + SCENE.w - 14;
  return wantRight ? fitsRight : !fitsLeft;
}

/**
 * 「你在这里」金签：贴在珠子侧面，带一根短引线。
 *
 * 为什么必须在侧面而不是上面：行距只有 62，签高 42 —— 放在正上方会压住
 * 上一关；放在侧面则永远只和「旁边那一列」争空间，而那条路上没有东西。
 */
function drawHereTag(
  ctx: CanvasRenderingContext2D,
  nx: number,
  ny: number,
  idx: number,
  p: MapPalette,
): void {
  const tw = 152;
  const th = 42;
  const flip = hereTagOnRight(nx, idx);
  const tx = flip ? nx + 30 : nx - 30 - tw;
  const ty = ny - th / 2 - 4;

  // 引线：签的内侧下角 → 珠子外缘
  ctx.beginPath();
  if (flip) {
    ctx.moveTo(tx + 6, ty + th - 6);
    ctx.lineTo(nx + 16, ny + 14);
  } else {
    ctx.moveTo(tx + tw - 6, ty + th - 6);
    ctx.lineTo(nx - 16, ny + 14);
  }
  ctx.strokeStyle = alpha(p.gold, 0.45);
  ctx.lineWidth = 2.4;
  ctx.stroke();

  roundRect(ctx, tx, ty, tw, th, th / 2);
  const g = ctx.createLinearGradient(0, ty, 0, ty + th);
  g.addColorStop(0, mixHex(p.gold, '#FFFFFF', 0.35));
  g.addColorStop(1, '#D4AF6A');
  ctx.fillStyle = g;
  ctx.fill();
  label(ctx, '你在这里', tx + tw / 2, ty + th / 2, 20, '#2A2114', { weight: 700, tracking: 4 });
}

// ────────────────────────────── 标题 / 图例 / 脚卡 ──────────────────────────────

/** 标题行：左「关卡地图」，右「第 047 关 · 星 96 · 无尽」。 */
function drawHeader(ctx: CanvasRenderingContext2D, st: MapViewState, first: number, last: number, p: MapPalette): void {
  const currentVisible = st.currentLevel >= first && st.currentLevel <= last;
  const head = currentVisible ? st.currentLevel : levelNear(st.scrollY + (ROUTE_TOP + VIEW_BOTTOM) / 2, st.levelCount);

  let totalStars = 0;
  for (const k of Object.keys(st.stars)) totalStars += st.stars[k] ?? 0;

  label(ctx, '关卡地图', SCENE.x + 4, 62, 34, p.ink, { align: 'left', weight: 600, tracking: 10.88 });
  label(
    ctx,
    `第 ${String(head).padStart(3, '0')} 关 · 星 ${totalStars} · 无尽`,
    SCENE.x + SCENE.w - 4, 62, 20, p.inkSoft,
    { align: 'right', weight: 500, tracking: 4.4 },
  );
}

/**
 * 图例：四项一行，键（✓ / 金珠 / 旗 / ◆）用金，说明用灰。
 *
 * 位置压在卡内底缘 24px —— 设计稿的图例是**卡的一部分**，
 * 不是卡下面的一行小字（那样会被误读成页脚）。
 *
 * 字号自适应：750 宽下四项一行本来刚好，但宋体比 Noto Serif 宽一点，
 * 写死 17 会互相压字。这里从 17 往下试到 14，取第一个排得下的。
 */
function drawLegend(ctx: CanvasRenderingContext2D, p: MapPalette): void {
  const rewards = SKIN_LEVELS.join('/');
  const items: Array<[string, string]> = [
    ['✓', '已过关'],
    ['金珠', '当前关'],
    ['旗', '里程碑 · 每 10 关'],
    ['◆', `主题奖励 ${rewards}`],
  ];
  const gold = '#F2DCA8';
  const grey = p.inkSoft;
  const inner = SCENE.w - 56;
  const minGap = 24;

  let size = 17;
  let track = 2.04;
  let widths: number[] = [];
  for (; size >= 13; size--) {
    track = size * 0.12;
    widths = items.map(([k, v]) => trackedWidth(ctx, k, size, track, 600) + 8 + trackedWidth(ctx, v, size, track, 500));
    if (widths.reduce((a, b) => a + b, 0) + minGap * (items.length - 1) <= inner) break;
  }

  const total = widths.reduce((a, b) => a + b, 0);
  const gap = (inner - total) / (items.length - 1);
  const baseline = SCENE.y + SCENE.h - 24;
  let x = SCENE.x + 28;

  items.forEach(([k, v], i) => {
    label(ctx, k, x, baseline, size, gold, { align: 'left', weight: 600, tracking: track });
    label(ctx, v, x + trackedWidth(ctx, k, size, track, 600) + 8, baseline, size, grey, {
      align: 'left', weight: 500, tracking: track,
    });
    x += widths[i] + gap;
  });
}

/** 脚卡：左「下一里程碑 050 关」+ 右金色大字「还差 3 关」。整卡可点。 */
function drawFoot(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): Button {
  const x = SCENE.x;
  const w = SCENE.w;
  const h = 104;
  const y = SCENE.y + SCENE.h + 24;
  const btn: Button = { x, y, w, h, label: '', kind: 'ghost', id: 'playCurrent' };

  roundRect(ctx, x, y, w, h, 32);
  ctx.fillStyle = 'rgba(212,175,106,0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(212,175,106,0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const next = Math.floor(st.currentLevel / 10) * 10 + 10;
  const left = Math.max(1, next - st.currentLevel);
  const baseline = y + h / 2 + 4;

  // 左：下一里程碑 050 关（数字用金，其余用 i300）
  const tSize = 24;
  const tTrack = 4.3;
  let tx = x + 38;
  label(ctx, '下一里程碑', tx, baseline, tSize, '#B9B2A4', { align: 'left', weight: 500, tracking: tTrack });
  tx += trackedWidth(ctx, '下一里程碑', tSize, tTrack, 500) + 10;
  label(ctx, String(next).padStart(3, '0'), tx, baseline, tSize, '#F2DCA8', { align: 'left', weight: 600, tracking: tTrack });
  tx += trackedWidth(ctx, String(next).padStart(3, '0'), tSize, tTrack, 600) + 10;
  label(ctx, '关', tx, baseline, tSize, '#B9B2A4', { align: 'left', weight: 500, tracking: tTrack });

  // 右：还差 N 关
  label(ctx, `还差 ${left} 关`, x + w - 38, baseline + 2, 38, p.gold, {
    align: 'right', weight: 700, tracking: 3,
  });

  return btn;
}

// ────────────────────────────── 导轨 / 浮标 / 按钮 ──────────────────────────────

/** 导轨：一根几乎看不见的线 + 一颗小金珠。方向跟着地图翻转（上 = 走得远）。 */
function drawRail(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): void {
  const g = railGeometry(st);
  const cx = RAIL.center;

  roundRect(ctx, cx - RAIL.width / 2, g.top, RAIL.width, g.h, RAIL.width / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fill();

  // 当前关的小点（拖远了也能看见自己在哪）
  const cy = railYOf(st.currentLevel, st);
  const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, 16);
  halo.addColorStop(0, alpha(p.gold, 0.5));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - 16, cy - 16, 32, 32);

  const tw = st.scrub ? 18 : 9;
  const tg = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
  tg.addColorStop(0, mixHex(p.gold, '#FFFFFF', 0.18));
  tg.addColorStop(0.5, mixHex(p.gold, '#000000', 0.12));
  tg.addColorStop(1, mixHex(p.gold, '#000000', 0.42));
  roundRect(ctx, cx - tw / 2, g.thumbTop, tw, g.thumbH, tw / 2);
  ctx.fillStyle = tg;
  ctx.fill();

  if (st.scrub) {
    const lv = levelNear(st.scrollY + (ROUTE_TOP + VIEW_BOTTOM) / 2, st.levelCount);
    const cw = 200;
    const ch = 66;
    const bx = SCENE.x + SCENE.w - 40 - cw;
    const by = clamp(g.thumbTop + g.thumbH / 2 - ch / 2, ROUTE_TOP + 8, VIEW_BOTTOM - ch - 8);
    glass(ctx, bx, by, cw, ch, 18, p);
    label(ctx, `第 ${lv} 关`, bx + cw / 2, by + 24, 26, p.ink, { weight: 700 });
    label(ctx, '无尽 · 1 → ∞', bx + cw / 2, by + 48, 16, alpha(p.gold, 0.75), { weight: 500, tracking: 3 });
  }
}

/** 当前关滚出画面时，卡底给一颗「回到当前」。 */
function drawHomePill(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): Button | null {
  const off = screenYOf(nodeY(st.currentLevel), st.scrollY);
  if (off > ROUTE_TOP + 40 && off < VIEW_BOTTOM - 40) return null;

  const w = 176;
  const h = 46;
  const btn: Button = {
    x: SCENE.x + (SCENE.w - w) / 2,
    y: SCENE.y + SCENE.h - 96,
    w, h,
    label: '回到当前',
    kind: 'ghost',
    id: 'mapHome',
  };
  glass(ctx, btn.x, btn.y, w, h, 23, p);
  ctx.beginPath();
  ctx.arc(btn.x + 34, btn.y + h / 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = p.gold;
  ctx.fill();
  label(ctx, '回到当前', btn.x + w / 2 + 12, btn.y + h / 2, 20, p.inkSoft, { weight: 500, tracking: 3 });
  return btn;
}

function drawDebugEntry(ctx: CanvasRenderingContext2D, st: MapViewState, p: MapPalette): Button | null {
  if (!DEBUG_ENABLED || !st.debugUnlockAll) return null;
  const bw = 96;
  const bh = 52;
  const btn: Button = { x: SCENE.x + 16, y: SCENE.y + 16, w: bw, h: bh, label: '调试', kind: 'ghost', id: 'dj:open' };
  glass(ctx, btn.x, btn.y, bw, bh, 18, p);
  label(ctx, '调试', btn.x + bw / 2, btn.y + bh / 2, 20, p.inkSoft, { weight: 600 });
  return btn;
}

function drawToast(ctx: CanvasRenderingContext2D, st: MapViewState, now: number, p: MapPalette): void {
  if (!st.toast || now - st.toastAt >= 1800) return;
  const a = Math.min(1, (1800 - (now - st.toastAt)) / 400);
  ctx.save();
  ctx.globalAlpha = a;
  glass(ctx, SCENE.x + (SCENE.w - 420) / 2, ROUTE_TOP + 40, 420, 70, 24, p);
  label(ctx, st.toast, DESIGN_W / 2, ROUTE_TOP + 75, 24, p.ink, { weight: 600 });
  ctx.restore();
}

// ────────────────────────────── 入口 ──────────────────────────────

/**
 * 绘制地图页。
 *
 * @param themeId 当前装备的棋盘主题 id（空 = 经典黏土），决定这条山径的夜色。
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

  // ── 场景卡：以下全部裁在圆角里 ──
  ctx.save();
  roundRect(ctx, SCENE.x, SCENE.y, SCENE.w, SCENE.h, SCENE.r);
  ctx.clip();

  drawScene(ctx, p);
  drawTrail(ctx, st, first, last, p);

  for (let i = first; i <= last; i++) {
    const pos = mapNodePos(i);
    const y = screenYOf(pos.y, st.scrollY);
    if (y < ROUTE_TOP - 90 || y > VIEW_BOTTOM + 90) continue;
    drawNode(ctx, i, pos.x, y, st, now, p);
  }

  drawMist(ctx, p);
  drawInfinityMark(ctx);
  drawLegend(ctx, p);
  ctx.restore();

  // ── 卡的边：一道极淡金线（设计稿 border 1px rgba(212,175,106,.14)） ──
  roundRect(ctx, SCENE.x, SCENE.y, SCENE.w, SCENE.h, SCENE.r);
  ctx.strokeStyle = 'rgba(212,175,106,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawRail(ctx, st, p);
  drawHeader(ctx, st, first, last, p);

  const out: Button[] = [drawFoot(ctx, st, p)];
  const home = drawHomePill(ctx, st, p);
  if (home) out.push(home);
  const debug = drawDebugEntry(ctx, st, p);
  if (debug) out.push(debug);

  drawToast(ctx, st, now, p);
  return out;
}
