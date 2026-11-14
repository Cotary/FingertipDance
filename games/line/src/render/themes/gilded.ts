/**
 * 「金线装饰」主题 · 验证渲染。
 *
 * ## 这是什么
 *
 * 不是正式管线，是**设计验证**：按 `docs/连连看/32-棋盘主题.md` 第五节
 * 「秩序轴」的规则，把一张真实关卡画成装饰艺术（Art Deco）风格，
 * 用来回答一个问题 —— 「没有格面、只有线」的棋盘，玩家还读得出进度吗？
 *
 * 因此本文件**完全不碰** `coverBoard.ts` / `coverTrail.ts` / `main.ts`，
 * 只在 `tools/cover-gallery.ts` 里用 `?theme=gilded` 挂上去。
 * 验完要么整块删，要么正式抽成 `BoardTheme` 的一个实现。
 *
 * ## 语法规则（三条，不能破）
 *
 * 1. **没有格面填充**。底板是一整块深翡翠，格子只用 1px 金线暗示。
 *    已走的格才被「认领」—— 铺一层极淡金箔 + 一道金边，进度靠密度读出来。
 * 2. **一切实体用斜线填充**。不可走的石头用 45° 金线网（制图学里「实体」的写法），
 *    不用深色块 —— 深色块在这里会和底板糊在一起。
 * 3. **线是唯一的亮物**。除了线、端点环、机制图标，画面里没有第三种亮度。
 *
 * ## 为什么敢不画格面
 *
 * 未走区域的「格」由金线表达，已走区域由金箔表达，两者明度差 ≥ 12%。
 * 如果实测发现玩家数不清格子，降级方案是给未走格补 3% 暖白填充
 * （`FALLBACK_FILL` 开关，见文件末尾）。
 */

import { cellDir, cellGroup, cellType, CoverCell } from '../../core/cover/v3/types';
import { roundRect } from '../board';
import type { BoardLayout } from '../layout';

/** 盘面（只取绘制需要的三个字段）。 */
export interface GildedBoard {
  w: number;
  h: number;
  grid: Uint8Array;
}

/** 渲染状态（结构上兼容 `CoverRenderState`，但不耦合）。 */
export interface GildedState {
  /** 已铺的格（拍平索引） */
  covered: Set<number>;
  /** 已走过的序列（拍平索引，按顺序） */
  path: number[];
  /** 已拾取的钥匙分组 */
  keysHeld: Set<number>;
  /** 已收集的星星分组 */
  shardsGot: Set<number>;
  /** 下一颗必须收的星星分组（-1 = 没有） */
  shardNext: number;
  /** 提示窗口内的格（拍平索引）；不传就不画 */
  hint?: number[];
}

// ────────────────────────────── 色板 ──────────────────────────────

/**
 * 只有 5 个色值。
 *
 * 装饰艺术的贵气来自**极窄的色域**：一块深绿 + 三档金 + 一个白。
 * 多加一个色就会掉档。
 */
const G = {
  /** 底板（深翡翠） */
  plate: '#0F2E28',
  /** 板沿金线 */
  edge: 'rgba(201,162,39,0.34)',
  /** 格线（极淡） */
  grid: 'rgba(201,162,39,0.24)',
  /** 主金 */
  gold: '#C9A227',
  /** 亮金（已走） */
  lit: '#E8C766',
  /** 高光金（线芯 / 转角） */
  hot: '#FFF0C0',
  /** 已走格的金箔 */
  foil: 'rgba(201,162,39,0.23)',
  /** 已走格的金边 */
  foilEdge: 'rgba(232,199,102,0.62)',
  /** 冰块 */
  frost: 'rgba(168,214,206,0.10)',
  frostEdge: 'rgba(159,211,200,0.72)',
} as const;

/**
 * 兜底方案的色值，**暂不启用**。
 *
 * 如果实测发现「未走区域数不清格子」，在 `drawGrid` 末尾给每个可走格补一层
 * `rgba(255,246,225,0.06)` 的填充即可 —— 几乎看不见，但能把格子从背景里托出来。
 * 先不加：这套的贵气恰恰来自「没有格面」，加了就退回普通棋盘。
 */
const FALLBACK_FILL = 'rgba(255,246,225,0.06)';

// ────────────────────────────── 小工具 ──────────────────────────────

/** 可走区域的并集路径（跳过 VOID）。 */
function unionPath(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  pad: number,
): void {
  const { cell, originX, originY } = layout;
  ctx.beginPath();
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      if (cellType(board.grid[y * board.w + x]) === CoverCell.VOID) continue;
      ctx.rect(originX + x * cell - pad, originY + y * cell - pad, cell + pad * 2, cell + pad * 2);
    }
  }
}

/** 格心。 */
function centerOf(layout: BoardLayout, idx: number, w: number): { x: number; y: number } {
  return {
    x: layout.originX + (idx % w) * layout.cell + layout.cell / 2,
    y: layout.originY + Math.floor(idx / w) * layout.cell + layout.cell / 2,
  };
}

/** 四邻接（不跨行）。 */
function adjacent(a: number, b: number, w: number): boolean {
  const dx = Math.abs((a % w) - (b % w));
  const dy = Math.abs(Math.floor(a / w) - Math.floor(b / w));
  return dx + dy === 1;
}

/** 菱形（转角镶爪）。 */
function diamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string | null,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// ────────────────────────────── 背景 ──────────────────────────────

/**
 * 背景：极深的墨绿 + 一圈内嵌金线画框。
 *
 * 画框是这套语言的「舞台」：没有它，深色底就是一整块虚空，
 * 有了它，盘面才像被摆在厅里而不是漂在黑里。
 */
export function drawGildedBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0B221D');
  bg.addColorStop(0.55, '#0A1D19');
  bg.addColorStop(1, '#06110F');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 顶部一小片更亮的光，像射灯扫过墙面（极淡）
  const lamp = ctx.createRadialGradient(w / 2, -h * 0.12, 0, w / 2, -h * 0.12, h * 0.7);
  lamp.addColorStop(0, 'rgba(232,199,102,0.10)');
  lamp.addColorStop(1, 'rgba(232,199,102,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, w, h);

  // 内嵌画框：双线，外粗内细
  ctx.save();
  ctx.strokeStyle = 'rgba(201,162,39,0.30)';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.strokeStyle = 'rgba(201,162,39,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  // 四角短切口（装饰艺术最省的一招：只做四角，不做整圈）
  ctx.strokeStyle = 'rgba(201,162,39,0.45)';
  ctx.lineWidth = 2;
  const c = 44;
  const o = 16;
  const corners: Array<[number, number, number, number]> = [
    [o, o + c, o, o], [o, o, o + c, o],
    [w - o - c, o, w - o, o], [w - o, o, w - o, o + c],
    [o, h - o - c, o, h - o], [o, h - o, o + c, h - o],
    [w - o - c, h - o, w - o, h - o], [w - o, h - o - c, w - o, h - o],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

// ────────────────────────────── 盘面 ──────────────────────────────

/**
 * 画整张盘面。
 *
 * 顺序：底板 → 冰块/石头/已走金箔 → 格线 → 线 → 转角镶爪
 *       → 线头 → 机制图标 → 端点。
 */
export function drawGildedBoard(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  st: GildedState,
  now: number,
): void {
  drawPlate(ctx, board, layout);
  // 表面先画、格线后画。
  // 反过来的话，17% 的金箔会把格线糊掉 —— 已走区域变成一整块浅色，
  // 玩家在里面数不清格子，而 Cover 要求「铺满」，数不清就等于玩不了。
  drawSurfaces(ctx, board, layout, st);
  drawGrid(ctx, board, layout);
  drawHint(ctx, board, layout, st);
  drawTrail(ctx, board, layout, st);
  drawMarks(ctx, board, layout, st, now);
  drawHead(ctx, board, layout, st);
  drawEndpoints(ctx, board, layout);
}

/** 底板：并集一块深翡翠 + 一道金沿。 */
function drawPlate(ctx: CanvasRenderingContext2D, board: GildedBoard, layout: BoardLayout): void {
  const pad = Math.max(2, layout.cell * 0.03);
  ctx.save();
  unionPath(ctx, board, layout, pad);
  ctx.fillStyle = G.plate;
  ctx.fill();
  ctx.strokeStyle = G.edge;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * 格线：裁进可走区域后，整行整列画 1px 金线。
 *
 * 不逐格描边 —— 相邻两格各描一次会在共享边上叠成 2px，整盘看起来像铁丝网。
 * 整行整列画，共享边只有一条，才是「刻在板上」的线。
 */
function drawGrid(ctx: CanvasRenderingContext2D, board: GildedBoard, layout: BoardLayout): void {
  const { cell, originX, originY } = layout;

  ctx.save();
  unionPath(ctx, board, layout, 0);
  ctx.clip();

  ctx.beginPath();
  for (let x = 1; x < board.w; x++) {
    const px = originX + x * cell;
    ctx.moveTo(px, originY);
    ctx.lineTo(px, originY + board.h * cell);
  }
  for (let y = 1; y < board.h; y++) {
    const py = originY + y * cell;
    ctx.moveTo(originX, py);
    ctx.lineTo(originX + board.w * cell, py);
  }
  ctx.strokeStyle = G.grid;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * 表面层：冰块 / 石头 / 已走格。
 *
 * 石头用 45° 金线填充 —— 制图学里斜线 = 实体，比涂深色更准确，
 * 也更贴合这套「只有线」的语言。
 */
function drawSurfaces(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  st: GildedState,
): void {
  const { cell, originX, originY } = layout;

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const type = cellType(board.grid[idx]);
      if (type === CoverCell.VOID) continue;

      const px = originX + x * cell;
      const py = originY + y * cell;

      // 石头：先压一层近黑，再盖 45° 金线
      if (type === CoverCell.BLOCK) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(px + 1, py + 1, cell - 2, cell - 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(4,10,9,0.85)';
        ctx.fillRect(px, py, cell, cell);
        ctx.beginPath();
        const step = Math.max(6, cell * 0.17);
        for (let k = -cell; k < cell * 2; k += step) {
          ctx.moveTo(px + k, py);
          ctx.lineTo(px + k - cell, py + cell);
        }
        ctx.strokeStyle = 'rgba(201,162,39,0.30)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        // 金边框住，读作「一整块实心料」
        ctx.strokeStyle = 'rgba(201,162,39,0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
        continue;
      }

      // 冰块：淡青 + 虚线边。冰是地面，线要走过去，所以不填满
      if (type === CoverCell.ICE) {
        ctx.fillStyle = G.frost;
        ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
        ctx.save();
        ctx.setLineDash([Math.max(4, cell * 0.10), Math.max(3, cell * 0.07)]);
        ctx.strokeStyle = G.frostEdge;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(px + 3, py + 3, cell - 6, cell - 6);
        ctx.restore();
        // 45° 细网：装饰艺术里「玻璃」的写法，比虚线框更像一层料
        ctx.save();
        ctx.beginPath();
        ctx.rect(px + 3, py + 3, cell - 6, cell - 6);
        ctx.clip();
        ctx.beginPath();
        const istep = Math.max(7, cell * 0.20);
        for (let k = -cell; k < cell * 2; k += istep) {
          ctx.moveTo(px + k, py);
          ctx.lineTo(px + k - cell, py + cell);
        }
        ctx.strokeStyle = 'rgba(159,211,200,0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // 两道斜裂纹，暗示「滑」
        ctx.strokeStyle = 'rgba(159,211,200,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + cell * 0.28, py + cell * 0.26);
        ctx.lineTo(px + cell * 0.44, py + cell * 0.50);
        ctx.lineTo(px + cell * 0.34, py + cell * 0.72);
        ctx.moveTo(px + cell * 0.66, py + cell * 0.22);
        ctx.lineTo(px + cell * 0.58, py + cell * 0.46);
        ctx.stroke();
      }

      // 已走格：金箔 + 金边。这是全图唯一的「填充」，
      // 于是进度天然靠密度读出来 —— 已铺的越多，板越亮
      if (st.covered.has(idx)) {
        ctx.fillStyle = G.foil;
        ctx.fillRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
        ctx.strokeStyle = G.foilEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
      }
    }
  }
}

/**
 * 提示：窗口内 5 格的虚金框。
 *
 * 不用脉动光环（那是黏土的果冻语言）。虚线框在这套里读作「待填的位置」，
 * 和整盘的金线同源，不会多出一种新形状。
 */
function drawHint(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  st: GildedState,
): void {
  if (!st.hint || st.hint.length === 0) return;
  const { cell } = layout;

  ctx.save();
  ctx.setLineDash([Math.max(5, cell * 0.11), Math.max(4, cell * 0.08)]);
  ctx.lineCap = 'butt';
  for (let i = 0; i < st.hint.length; i++) {
    const f = st.hint[i];
    const px = layout.originX + (f % board.w) * cell;
    const py = layout.originY + Math.floor(f / board.w) * cell;
    // 越近越亮：第 0 格是「下一步」
    const a = i === 0 ? 0.95 : Math.max(0.28, 0.72 - i * 0.11);
    ctx.strokeStyle = `rgba(255,240,192,${a.toFixed(2)})`;
    ctx.lineWidth = i === 0 ? Math.max(2, cell * 0.045) : Math.max(1.2, cell * 0.028);
    roundRect(ctx, px + 5, py + 5, cell - 10, cell - 10, 3);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 线：一条亮金 + 转角镶爪。
 *
 * 传送门是「一跳」，几何上不相邻 —— 断线，靠两端的小菱角提示这一段是跳过去的。
 * 不画弧线：在这套直线语言里，弧线是异物。
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  st: GildedState,
): void {
  const { path } = st;
  if (path.length < 2) return;

  const { cell } = layout;
  const width = Math.max(2.5, cell * 0.085);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1) 底衬：一道更宽更暗的金，让线在已走格的金箔上仍有边界
  ctx.beginPath();
  let prev = -1;
  for (const f of path) {
    const p = centerOf(layout, f, board.w);
    if (prev < 0) ctx.moveTo(p.x, p.y);
    else if (adjacent(prev, f, board.w)) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    prev = f;
  }
  ctx.strokeStyle = 'rgba(6,17,15,0.55)';
  ctx.lineWidth = width + 3;
  ctx.stroke();

  // 2) 主金线
  ctx.beginPath();
  prev = -1;
  for (const f of path) {
    const p = centerOf(layout, f, board.w);
    if (prev < 0) ctx.moveTo(p.x, p.y);
    else if (adjacent(prev, f, board.w)) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    prev = f;
  }
  ctx.strokeStyle = G.lit;
  ctx.lineWidth = width;
  ctx.stroke();

  // 3) 芯：一条极细高光，让线读作「金属丝」而不是「荧光笔」
  ctx.beginPath();
  prev = -1;
  for (const f of path) {
    const p = centerOf(layout, f, board.w);
    if (prev < 0) ctx.moveTo(p.x, p.y);
    else if (adjacent(prev, f, board.w)) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    prev = f;
  }
  ctx.strokeStyle = 'rgba(255,240,192,0.55)';
  ctx.lineWidth = Math.max(1, width * 0.22);
  ctx.stroke();

  // 4) 转角镶爪：只在真转弯处放，直行段不放（11×11 每格一颗就是一盘麻子）
  const r = Math.max(2, cell * 0.075);
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    if (!adjacent(a, b, board.w) || !adjacent(b, c, board.w)) continue;
    const d1 = (b % board.w) - (a % board.w) === 0 ? 'v' : 'h';
    const d2 = (c % board.w) - (b % board.w) === 0 ? 'v' : 'h';
    if (d1 === d2) continue;
    const p = centerOf(layout, b, board.w);
    diamond(ctx, p.x, p.y, r, G.hot);
  }

  // 5) 传送跳段的两端，各钉一颗小菱角
  prev = -1;
  for (const f of path) {
    if (prev >= 0 && !adjacent(prev, f, board.w)) {
      const a = centerOf(layout, prev, board.w);
      const b = centerOf(layout, f, board.w);
      diamond(ctx, a.x, a.y, r * 0.9, null, 'rgba(232,199,102,0.8)');
      diamond(ctx, b.x, b.y, r * 0.9, null, 'rgba(232,199,102,0.8)');
    }
    prev = f;
  }

  ctx.restore();
}

/**
 * 线头：双环 —— 外环细、内环实。
 *
 * 装饰艺术的指北针就是这个画法。不用实心白点：
 * 白点是黏土语言（果冻块），放在这里会像贴纸。
 */
function drawHead(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  st: GildedState,
): void {
  if (st.path.length === 0) return;
  const head = st.path[st.path.length - 1];
  const { cell } = layout;
  const p = centerOf(layout, head, board.w);

  ctx.save();
  ctx.fillStyle = 'rgba(6,17,15,0.9)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, cell * 0.26, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = G.hot;
  ctx.lineWidth = Math.max(1.6, cell * 0.035);
  ctx.beginPath();
  ctx.arc(p.x, p.y, cell * 0.26, 0, Math.PI * 2);
  ctx.stroke();

  // 内环 + 一个小十字，指向感
  ctx.strokeStyle = 'rgba(232,199,102,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, cell * 0.13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - cell * 0.13);
  ctx.lineTo(p.x, p.y + cell * 0.13);
  ctx.moveTo(p.x - cell * 0.13, p.y);
  ctx.lineTo(p.x + cell * 0.13, p.y);
  ctx.stroke();
  ctx.restore();
}

// ────────────────────────────── 机制图标 ──────────────────────────────

/** 方向 → 旋转角（雪佛龙默认朝上）。 */
const DIR_ANGLE: Record<number, number> = { 0: 0, 1: Math.PI, 2: -Math.PI / 2, 3: Math.PI / 2 };

/**
 * 机制图标：全部单线，线宽统一 `cell*0.03`。
 *
 * 统一线宽是这套语言能成立的前提 —— 混入第二种线宽，
 * 「同一批模具压出来的」感觉就没了。
 */
function drawMarks(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
  st: GildedState,
  now: number,
): void {
  const { cell } = layout;
  const lw = Math.max(1.2, cell * 0.032);
  const r = cell * 0.24;

  ctx.save();
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const byte = board.grid[idx];
      const type = cellType(byte);
      if (type === CoverCell.BRICK || type === CoverCell.VOID || type === CoverCell.BLOCK) continue;
      if (type === CoverCell.START || type === CoverCell.END) continue;
      if (type === CoverCell.ICE) continue;

      const p = centerOf(layout, idx, board.w);
      const group = cellGroup(byte);

      // 图标底盘：一块硬边的暗色镶座 + 一道细金环。
      // 没有它，金线图标落在已走格的金箔上是金压金，直接消失（实测 707 的门就是这么没的）。
      // 第一版用的是径向柔光，2.2 倍放大后是一团发糊的阴影，读作「脏」——
      // 硬边才是这套的语言：宝石是嵌进去的，不是晕开的。
      ctx.fillStyle = 'rgba(6,17,15,0.74)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(201,162,39,0.32)';
      ctx.lineWidth = 1;
      ctx.stroke();

      switch (type) {
        // 星：四角星芒。下一颗必须收的那个 —— 实心 + 外环 + 微呼吸
        case CoverCell.SHARD: {
          const got = st.shardsGot.has(group);
          const next = !got && st.shardNext === group;
          const pulse = next ? 1 + 0.06 * Math.sin(now / 320) : 1;
          const s = r * (next ? 1.15 : 0.95) * pulse;
          if (got || next) {
            drawStar(ctx, p.x, p.y, s, got ? 'rgba(201,162,39,0.45)' : G.lit);
          } else {
            drawStar(ctx, p.x, p.y, s, null, 'rgba(201,162,39,0.65)');
          }
          if (next) {
            ctx.strokeStyle = 'rgba(255,240,192,0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 1.75, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = lw;
          }
          // 顺序编号：小字号角标，只在足够大的格上放
          if (!got && cell >= 44) {
            ctx.fillStyle = 'rgba(232,199,102,0.85)';
            ctx.font = `500 ${Math.round(cell * 0.20)}px Georgia, serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(group + 1), p.x + s * 0.95, p.y + s * 0.95);
          }
          break;
        }

        // 钥匙：圆环 + 齿杆
        case CoverCell.KEY: {
          const held = st.keysHeld.has(group);
          const c = held ? 'rgba(201,162,39,0.40)' : G.lit;
          ctx.strokeStyle = c;
          ctx.beginPath();
          ctx.arc(p.x - r * 0.45, p.y, r * 0.42, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p.x - r * 0.05, p.y);
          ctx.lineTo(p.x + r * 0.95, p.y);
          ctx.moveTo(p.x + r * 0.62, p.y);
          ctx.lineTo(p.x + r * 0.62, p.y + r * 0.42);
          ctx.moveTo(p.x + r * 0.88, p.y);
          ctx.lineTo(p.x + r * 0.88, p.y + r * 0.34);
          ctx.stroke();
          break;
        }

        // 门：拱 + 锁舌。开着就把锁舌去掉
        case CoverCell.GATE: {
          const locked = !st.keysHeld.has(group);
          ctx.strokeStyle = locked ? G.lit : 'rgba(201,162,39,0.45)';
          ctx.beginPath();
          ctx.moveTo(p.x - r * 0.72, p.y + r * 0.85);
          ctx.lineTo(p.x - r * 0.72, p.y - r * 0.1);
          ctx.arc(p.x, p.y - r * 0.1, r * 0.72, Math.PI, 0);
          ctx.lineTo(p.x + r * 0.72, p.y + r * 0.85);
          ctx.stroke();
          if (locked) {
            ctx.beginPath();
            ctx.moveTo(p.x - r * 0.95, p.y + r * 0.3);
            ctx.lineTo(p.x + r * 0.95, p.y + r * 0.3);
            ctx.stroke();
            diamond(ctx, p.x, p.y + r * 0.3, r * 0.2, G.hot);
          }
          break;
        }

        // 传送门：双环 + 四向刻度
        case CoverCell.PORTAL: {
          const tint = group % 2 === 0 ? G.lit : '#B7D9D2';
          ctx.strokeStyle = tint;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.88, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.46, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            const a = (Math.PI / 2) * k;
            ctx.moveTo(p.x + Math.cos(a) * r * 1.02, p.y + Math.sin(a) * r * 1.02);
            ctx.lineTo(p.x + Math.cos(a) * r * 1.24, p.y + Math.sin(a) * r * 1.24);
          }
          ctx.stroke();
          break;
        }

        // 单向门：一对雪佛龙
        case CoverCell.ONEWAY: {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(DIR_ANGLE[cellDir(byte)] ?? 0);
          ctx.strokeStyle = G.lit;
          for (const off of [-r * 0.34, r * 0.22]) {
            ctx.beginPath();
            ctx.moveTo(-r * 0.62, off + r * 0.42);
            ctx.lineTo(0, off - r * 0.28);
            ctx.lineTo(r * 0.62, off + r * 0.42);
            ctx.stroke();
          }
          ctx.restore();
          break;
        }

        default:
          break;
      }
    }
  }
  ctx.restore();
}

/** 四角星芒（实心 / 空心两用）。 */
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  fill: string | null,
  stroke?: string,
): void {
  const k = s * 0.34; // 腰身收窄程度：越小越尖
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + k, cy - k);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx + k, cy + k);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx - k, cy + k);
  ctx.lineTo(cx - s, cy);
  ctx.lineTo(cx - k, cy - k);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/**
 * 端点：圆 + 内接符号。
 *
 * 起点 = 三角（从这里出发），终点 = 方框（到这里收）。
 * 用符号而不是颜色区分 —— 缩略图和色弱场景下，色相第一个失效。
 */
function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  board: GildedBoard,
  layout: BoardLayout,
): void {
  const { cell } = layout;

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const type = cellType(board.grid[y * board.w + x]);
      if (type !== CoverCell.START && type !== CoverCell.END) continue;

      const p = centerOf(layout, y * board.w + x, board.w);
      const R = cell * 0.30;

      ctx.save();
      ctx.fillStyle = 'rgba(6,17,15,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = G.gold;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = G.hot;
      ctx.lineWidth = Math.max(1.4, cell * 0.034);
      if (type === CoverCell.START) {
        ctx.beginPath();
        ctx.moveTo(p.x + R * 0.34, p.y - R * 0.44);
        ctx.lineTo(p.x + R * 0.34, p.y + R * 0.44);
        ctx.lineTo(p.x - R * 0.38, p.y);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(p.x - R * 0.36, p.y - R * 0.36, R * 0.72, R * 0.72);
      }
      ctx.restore();
    }
  }
}

// ────────────────────────────── 顶部界面 ──────────────────────────────

/**
 * 顶部 / 底部界面：细金线按钮 + 读数 + 一条金进度线。
 *
 * 只为了截图能读成「一个真实屏幕」。正式落地时这套 chrome 应该是全局主题的一部分，
 * 不该从棋盘模块里长出来 —— 所以这里刻意标成「验证用」。
 */
export function drawGildedChrome(
  ctx: CanvasRenderingContext2D,
  opts: { idx: number; name: string; done: number; total: number; w: number; h: number },
): void {
  const { idx, name, done, total, w, h } = opts;
  const serif = 'Georgia, "Times New Roman", serif';

  ctx.save();
  ctx.textBaseline = 'middle';

  // 关卡号：大字号细体
  ctx.textAlign = 'left';
  ctx.fillStyle = '#E8C766';
  ctx.font = `400 52px ${serif}`;
  ctx.fillText(String(idx), 84, 190);

  ctx.fillStyle = 'rgba(232,199,102,0.55)';
  ctx.font = `400 20px ${serif}`;
  ctx.fillText(name.toUpperCase(), 86, 232);

  // 读数：done / total，右对齐
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFF0C0';
  ctx.font = `400 44px ${serif}`;
  ctx.fillText(`${done}`, w - 150, 190);
  ctx.fillStyle = 'rgba(232,199,102,0.45)';
  ctx.font = `400 22px ${serif}`;
  ctx.fillText(`/ ${total}`, w - 86, 196);

  // 一道金进度线（不是糖果胶囊）
  void FALLBACK_FILL;
  const barY = h - 158;
  const barX = 86;
  const barW = w - 172;
  ctx.strokeStyle = 'rgba(201,162,39,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX, barY);
  ctx.lineTo(barX + barW, barY);
  ctx.stroke();

  const pct = total > 0 ? Math.min(1, done / total) : 0;
  ctx.strokeStyle = G.lit;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(barX, barY);
  ctx.lineTo(barX + barW * pct, barY);
  ctx.stroke();
  diamond(ctx, barX + barW * pct, barY, 6, G.hot);

  // 三个按钮：细金框 + 金字，无填充
  const buttons: Array<{ x: number; y: number; w: number; h: number; label: string }> = [
    { x: 40, y: 100, w: 90, h: 60, label: '返回' },
    { x: w - 110, y: 100, w: 90, h: 60, label: '跳过' },
    // 提示：盘面下方居中（游戏内就是这个位置，不是顶栏）
    { x: Math.round((w - 88) / 2), y: barY - 120, w: 88, h: 88, label: '提示' },
  ];
  for (const b of buttons) {
    roundRect(ctx, b.x, b.y, b.w, b.h, 6);
    ctx.strokeStyle = 'rgba(201,162,39,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 内嵌第二道细线，装饰艺术的「双框」
    if (b.w > 70) {
      roundRect(ctx, b.x + 5, b.y + 5, b.w - 10, b.h - 10, 4);
      ctx.strokeStyle = 'rgba(201,162,39,0.18)';
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(232,199,102,0.85)';
    ctx.font = `400 24px ${serif}`;
    ctx.textAlign = 'center';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  }

  ctx.restore();
}
