/**
 * 典藏档主题渲染器。
 *
 * ## 为什么和基础档分开
 *
 * 基础档共用「双色棋盘格 + 单色线」这一套句法，只换词（颜色、纹理、母题）。
 * 典藏档必须换句法 —— 判据只有一条：
 *
 * > **抽掉颜色、只留灰度，还认得出是哪一套吗？**
 *
 * 所以这三套各换一条轴：
 *
 * | 主题 | 轴 | 换掉了什么 |
 * |---|---|---|
 * | 玻璃穹顶 | 材质 | 实心块 → 透光块，一道斜光带横穿 |
 * | 圆格罗盘 | 几何 | 方格 → 圆心，缎带穿过圆心像珠子穿绳 |
 * | 黑曜熔岩 | 光源 | 外照光 → 自发光，黑暗里只有走过的路在燃烧 |
 *
 * ## 一条硬规则
 *
 * **一套主题只能占一条轴。** 占两条就变成特效堆：玻璃 + 发光 + 裂纹 + 描边同时上，
 * 越堆越廉价。所以 `glass` 不许发光，`burn` 不许有材质，`orbit` 不许有背景纹理。
 *
 * ## 性能
 *
 * 底板（含裂纹网、罗盘刻度、光带）每帧重画，但都是几十条线以内；
 * 格子与线是逐格绘制。没有一处用 `filter` 或 `shadowBlur` 做持续动画 ——
 * 只在静态底板和熔岩辉光上用，且层数固定。
 */
import type { BoardLayout } from '../layout';
import { roundRect } from '../board';
import { cellDir, cellGroup, cellType, CoverCell, type Dir } from '../../core/cover/v3/types';
import { drawGlyph, type GlyphKind, type GlyphPalette, type GlyphStyle } from './glyphs';
import type { BoardTheme, DesignBox, ThemeBoard, ThemeChrome, ThemeDrawCtx, ThemeState, ThemeTier, ThemeUnlock } from './types';

/** 三条轴。 */
export type LinearMode = 'glass' | 'orbit' | 'burn';

/** 一套典藏主题的规格。 */
export interface LinearSpec {
  id: string;
  name: string;
  tagline: string;
  tier: ThemeTier;
  unlock: ThemeUnlock;
  mode: LinearMode;

  bg: { base: string; deep: string; accent: string };

  plate: { fill: string; edge: string };

  /** 未走格。 */
  cell: { fill: string; edge: string; radius: number; gap: number };

  /** 已走格。`glow` 只在 burn 用。 */
  walk: { fill: string; edge: string; glow: string };

  trail: { halo: string; core: string; hot: string };

  icon: GlyphPalette & { style: GlyphStyle; back: string; backEdge: string };

  hint: string;
  marker: string;
  /** 界面配色；不传就用黏土默认（深色主题必须传，否则 HUD 读不出来）。 */
  chrome?: ThemeChrome;
}

/** 由规格造一个主题。 */
export function makeLinearTheme(spec: LinearSpec): BoardTheme {
  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    tier: spec.tier,
    unlock: spec.unlock,
    backdrop: (ctx, box) => drawBackdrop(ctx, box, spec),
    board: (c) => drawBoard(c, spec),
    chrome: spec.chrome,
  };
}

// ────────────────────────────── 背景 ──────────────────────────────

function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox, spec: LinearSpec): void {
  const { x, y, w, h } = box;

  const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
  g.addColorStop(0, spec.bg.deep);
  g.addColorStop(0.45, spec.bg.base);
  g.addColorStop(1, spec.bg.deep);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (spec.mode === 'glass') {
    // 一道斜光带：玻璃主题唯一的「特效」，也是它成立的全部理由。
    // 光带必须是**大尺度**的 —— 28px 的格子上做不出真实折射，
    // 只能靠一整片斜光让玩家读出「上面有一层玻璃」。
    ctx.save();
    ctx.translate(x + w * 0.5, y + h * 0.42);
    ctx.rotate(-0.42);
    const band = ctx.createLinearGradient(0, -h * 0.6, 0, h * 0.6);
    band.addColorStop(0, 'rgba(200,230,255,0)');
    band.addColorStop(0.44, 'rgba(200,230,255,0.10)');
    band.addColorStop(0.5, 'rgba(225,242,255,0.20)');
    band.addColorStop(0.56, 'rgba(200,230,255,0.08)');
    band.addColorStop(1, 'rgba(200,230,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-w, -h * 0.6, w * 2, h * 1.2);
    ctx.restore();
  } else if (spec.mode === 'orbit') {
    // 罗盘刻度：同心圆 + 一圈短刻度。克制到几乎看不见，只在边角露出来
    const cx = x + w / 2;
    const cy = y + h * 0.45;
    ctx.strokeStyle = spec.bg.accent;
    for (let i = 1; i <= 3; i++) {
      ctx.lineWidth = i === 1 ? 1.4 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, w * (0.30 + i * 0.17), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r0 = w * 0.64;
      const r1 = r0 + (i % 4 === 0 ? 14 : 6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  } else {
    // 熔岩：底部余晖 + 一张裂纹网。
    // 裂纹用固定种子，每帧一样 —— 每帧重随机会让画面「沸腾」，非常晃眼
    const ember = ctx.createRadialGradient(x + w / 2, y + h, 0, x + w / 2, y + h, w * 0.95);
    ember.addColorStop(0, 'rgba(255,92,26,0.16)');
    ember.addColorStop(0.5, 'rgba(180,40,10,0.06)');
    ember.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ember;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = spec.bg.accent;
    let seed = 0x9e37;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      let px2 = x + rnd() * w;
      let py2 = y + rnd() * h;
      ctx.beginPath();
      ctx.moveTo(px2, py2);
      for (let k = 0; k < 4; k++) {
        px2 += (rnd() - 0.5) * w * 0.22;
        py2 += (rnd() - 0.3) * h * 0.12;
        ctx.lineTo(px2, py2);
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  const v = ctx.createRadialGradient(x + w / 2, y + h * 0.45, w * 0.22, x + w / 2, y + h * 0.45, w * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);
}

// ────────────────────────────── 盘面 ──────────────────────────────

function drawBoard(c: ThemeDrawCtx, spec: LinearSpec): void {
  const { ctx, board, layout, state, now } = c;

  drawPlate(ctx, board, layout, spec);
  drawCells(ctx, board, layout, state, spec, now);
  drawHint(ctx, board, layout, state, spec, now);

  ctx.save();
  if (state.paused) ctx.globalAlpha = 0.5;
  drawTrail(ctx, board, layout, state, spec);
  ctx.restore();

  drawMarks(ctx, board, layout, state, spec);
  drawHead(ctx, board, layout, state, spec, now);
  drawEndpoints(ctx, board, layout, state, spec);
}

function center(layout: BoardLayout, idx: number, w: number): { x: number; y: number } {
  return {
    x: layout.originX + (idx % w) * layout.cell + layout.cell / 2,
    y: layout.originY + Math.floor(idx / w) * layout.cell + layout.cell / 2,
  };
}

function drawPlate(ctx: CanvasRenderingContext2D, board: ThemeBoard, layout: BoardLayout, spec: LinearSpec): void {
  const pad = Math.max(6, layout.cell * 0.24);
  const x = layout.originX - pad;
  const y = layout.originY - pad;
  const w = layout.boardW + pad * 2;
  const h = layout.boardH + pad * 2;
  const r = Math.max(12, layout.cell * 0.46);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = Math.max(12, layout.cell * 0.40);
  ctx.shadowOffsetY = Math.max(5, layout.cell * 0.12);
  ctx.fillStyle = spec.plate.fill;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = spec.plate.edge;
  ctx.lineWidth = Math.max(1.5, layout.cell * 0.032);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();

  // 圆格主题：极淡方格暗纹 + 圆心点。
  // 圆与圆之间没有边界，玩家可能读不出「哪两格相邻」——
  // 而 Cover 要求铺满，读不出相邻等于玩不了。这层暗纹就是保险。
  if (spec.mode === 'orbit') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let gx = 1; gx < board.w; gx++) {
      ctx.beginPath();
      ctx.moveTo(layout.originX + gx * layout.cell, layout.originY);
      ctx.lineTo(layout.originX + gx * layout.cell, layout.originY + layout.boardH);
      ctx.stroke();
    }
    for (let gy = 1; gy < board.h; gy++) {
      ctx.beginPath();
      ctx.moveTo(layout.originX, layout.originY + gy * layout.cell);
      ctx.lineTo(layout.originX + layout.boardW, layout.originY + gy * layout.cell);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  board: ThemeBoard,
  layout: BoardLayout,
  st: ThemeState,
  spec: LinearSpec,
  now: number,
): void {
  const { cell, originX, originY } = layout;

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const byte = board.grid[idx];
      const type = cellType(byte);
      if (type === CoverCell.VOID) continue;

      const cx = originX + x * cell + cell / 2;
      const cy = originY + y * cell + cell / 2;
      const walk = st.covered.has(idx);

      if (spec.mode === 'glass') {
        const gap = cell * spec.cell.gap;
        const box = cell - gap * 2;
        const bx = cx - box / 2;
        const by = cy - box / 2;
        const rr = box * spec.cell.radius;

        if (walk) {
          // 已走 = 被点亮的一格。上层铺暖白，下层仍透出一点底色
          ctx.fillStyle = spec.walk.fill;
          roundRect(ctx, bx, by, box, box, rr);
          ctx.fill();
          ctx.strokeStyle = spec.walk.edge;
          ctx.lineWidth = Math.max(1.2, cell * 0.026);
          ctx.stroke();
        } else {
          // 玻璃块：四档明度，中间最亮、四周暗，读作「一块有厚度的料」
          ctx.fillStyle = spec.cell.fill;
          roundRect(ctx, bx, by, box, box, rr);
          ctx.fill();
          const gl = ctx.createLinearGradient(bx, by, bx + box, by + box);
          gl.addColorStop(0, 'rgba(255,255,255,0.16)');
          gl.addColorStop(0.5, 'rgba(255,255,255,0.04)');
          gl.addColorStop(1, 'rgba(255,255,255,0.00)');
          ctx.fillStyle = gl;
          roundRect(ctx, bx, by, box, box, rr);
          ctx.fill();
          // 上缘亮线：玻璃的「边缘」全靠这一笔，没有它就是一排塑料片
          ctx.strokeStyle = 'rgba(235,248,255,0.30)';
          ctx.lineWidth = Math.max(1, cell * 0.020);
          ctx.beginPath();
          ctx.moveTo(bx + rr * 0.7, by + 1);
          ctx.lineTo(bx + box - rr * 0.7, by + 1);
          ctx.stroke();
          ctx.strokeStyle = spec.cell.edge;
          roundRect(ctx, bx, by, box, box, rr);
          ctx.stroke();
        }
      } else if (spec.mode === 'orbit') {
        const r = cell * 0.40;
        if (walk) {
          ctx.fillStyle = spec.walk.fill;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = spec.walk.edge;
          ctx.lineWidth = Math.max(1.2, cell * 0.028);
          ctx.stroke();
        } else {
          // 空盘只描边：圆格里填满色，整盘会变成一片珠子墙，数不出空位
          ctx.strokeStyle = spec.cell.edge;
          ctx.lineWidth = Math.max(1.2, cell * 0.026);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        // 圆心小点：圆心是「这一格」的唯一锚点，相邻关系靠它读
        ctx.fillStyle = walk ? spec.walk.edge : 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.2, cell * 0.045), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 熔岩：未走格只有一圈几乎看不见的轮廓，已走格自发光
        const gap = cell * spec.cell.gap;
        const box = cell - gap * 2;
        const bx = cx - box / 2;
        const by = cy - box / 2;
        const rr = box * spec.cell.radius;

        if (walk) {
          // 已走 = 一格还在烧的岩浆。
          //
          // 第一版对每格画了四层描边（辉光 / 填充 / 亮边 / 芯），
          // 实拍是一堵橙色网格墙：九宫格相邻的描边首尾相接，和路线完全融在一起，
          // 「铺了多少」根本读不出。改成**内部填充 + 一条细亮边**：
          // 填充表达「这格被认领」，细边只负责让边界不糊。
          const pulse = 0.88 + 0.12 * Math.sin(now / 460 + (x + y) * 0.55);
          ctx.globalAlpha = pulse;
          ctx.fillStyle = spec.walk.fill;
          roundRect(ctx, bx, by, box, box, rr);
          ctx.fill();
          ctx.strokeStyle = spec.walk.edge;
          ctx.lineWidth = Math.max(1.2, cell * 0.055);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = spec.cell.edge;
          ctx.lineWidth = Math.max(1, cell * 0.022);
          roundRect(ctx, bx, by, box, box, rr);
          ctx.stroke();
        }
      }

      // 石头 / 冰：三套主题共用一套地形语言，靠色值区分
      if (type === CoverCell.BLOCK) {
        ctx.fillStyle = spec.icon.deep;
        roundRect(ctx, originX + x * cell + cell * 0.06, originY + y * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = Math.max(1, cell * 0.022);
        for (let k = 1; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo(originX + x * cell + cell * 0.12, originY + y * cell + cell * (0.12 + k * 0.26));
          ctx.lineTo(originX + x * cell + cell * 0.88, originY + y * cell + cell * (0.12 + k * 0.26));
          ctx.stroke();
        }
      }
      if (type === CoverCell.ICE) {
        ctx.fillStyle = 'rgba(200,240,255,0.24)';
        roundRect(ctx, originX + x * cell + cell * 0.05, originY + y * cell + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,240,255,0.55)';
        ctx.lineWidth = Math.max(1, cell * 0.022);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - cell * 0.22, cy + cell * 0.20);
        ctx.lineTo(cx - cell * 0.02, cy - cell * 0.04);
        ctx.lineTo(cx + cell * 0.20, cy + cell * 0.10);
        ctx.stroke();
      }

      if (st.shakeCell === idx && st.shakeAt && now - st.shakeAt < 220) {
        ctx.fillStyle = 'rgba(255,90,70,0.30)';
        roundRect(ctx, originX + x * cell + cell * 0.08, originY + y * cell + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.18);
        ctx.fill();
      }
    }
  }
}

function drawHint(
  ctx: CanvasRenderingContext2D,
  board: ThemeBoard,
  layout: BoardLayout,
  st: ThemeState,
  spec: LinearSpec,
  now: number,
): void {
  const hint = st.hint;
  if (!hint || hint.length === 0) return;
  const { cell } = layout;

  ctx.save();
  for (let i = 0; i < hint.length && i < 5; i++) {
    const p = center(layout, hint[i], board.w);
    const a = i === 0 ? 0.95 : Math.max(0.42, 0.82 - i * 0.12);
    const pulse = i === 0 ? 0.80 + 0.20 * Math.abs(Math.sin(now / 300)) : 1;
    ctx.globalAlpha = a * pulse;
    ctx.strokeStyle = spec.hint;
    ctx.lineWidth = i === 0 ? Math.max(3, cell * 0.075) : Math.max(1.8, cell * 0.040);
    if (spec.mode === 'orbit') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.44, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const inset = cell * 0.11;
      roundRect(ctx, p.x - cell / 2 + inset, p.y - cell / 2 + inset, cell - inset * 2, cell - inset * 2, cell * 0.18);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  board: ThemeBoard,
  layout: BoardLayout,
  st: ThemeState,
  spec: LinearSpec,
): void {
  const path = st.path;
  if (path.length < 2) return;
  const pts = path.map((f) => center(layout, f, board.w));

  const stroke = (width: number, color: string, join: CanvasLineJoin = 'round') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = join;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };

  if (spec.mode === 'glass') {
    stroke(Math.max(8, layout.cell * 0.26), spec.trail.halo);
    stroke(Math.max(4, layout.cell * 0.13), spec.trail.core);
    stroke(Math.max(1.4, layout.cell * 0.045), spec.trail.hot);
  } else if (spec.mode === 'orbit') {
    // 缎带：外描边 + 内亮带。宽度比 family 宽 —— 这是「绳子」不是「笔迹」，
    // 但也不能到格宽：过了 0.4 就变成一条盖住圆心的宽带子，读不出珠子在哪
    stroke(Math.max(10, layout.cell * 0.34), spec.trail.halo);
    stroke(Math.max(6, layout.cell * 0.22), spec.trail.core);
    stroke(Math.max(1.8, layout.cell * 0.07), spec.trail.hot);
  } else {
    // 熔岩：四层辉光。宽度比必须卡死，中间任何一层偏亮就糊成一条橙色香肠
    stroke(Math.max(11, layout.cell * 0.40), spec.trail.halo);
    stroke(Math.max(6, layout.cell * 0.21), spec.trail.core);
    stroke(Math.max(2.6, layout.cell * 0.10), spec.trail.hot);
    stroke(Math.max(1.3, layout.cell * 0.035), '#FFF6E0');
  }

  // 传送跳段：断线 + 两端菱角
  ctx.save();
  ctx.setLineDash([Math.max(5, layout.cell * 0.14), Math.max(7, layout.cell * 0.14)]);
  for (let i = 1; i < pts.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = Math.abs((a % board.w) - (b % board.w));
    const dy = Math.abs(Math.floor(a / board.w) - Math.floor(b / board.w));
    if (dx + dy <= 1) continue;
    stroke(Math.max(3, layout.cell * 0.09), spec.trail.core);
  }
  ctx.restore();
}

function drawMarks(
  ctx: CanvasRenderingContext2D,
  board: ThemeBoard,
  layout: BoardLayout,
  st: ThemeState,
  spec: LinearSpec,
): void {
  const { cell } = layout;
  const glyphSize = cell * 0.50;
  const backR = cell * 0.38;
  const pal: GlyphPalette = {
    ink: spec.icon.ink,
    accent: spec.icon.accent,
    chip: spec.icon.chip,
    deep: spec.icon.deep,
  };

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const byte = board.grid[idx];
      const type = cellType(byte);
      const p = center(layout, idx, board.w);
      const group = cellGroup(byte);

      let kind: GlyphKind | null = null;
      switch (type) {
        case CoverCell.SHARD: kind = 'star'; break;
        case CoverCell.ONEWAY: kind = 'arrow'; break;
        case CoverCell.KEY: kind = 'key'; break;
        case CoverCell.GATE: kind = 'gate'; break;
        case CoverCell.PORTAL: kind = 'portal'; break;
        case CoverCell.START: kind = 'start'; break;
        case CoverCell.END: kind = 'end'; break;
        case CoverCell.BLOCK: kind = 'rock'; break;
        case CoverCell.ICE: kind = 'ice'; break;
        default: break;
      }
      if (!kind) continue;
      const terrain = type === CoverCell.BLOCK || type === CoverCell.ICE;

      let alpha = 1;
      let size = glyphSize;
      if (type === CoverCell.SHARD && st.shardsGot.has(group)) {
        alpha = 0.30;
        size = glyphSize * 0.80;
      }
      if (type === CoverCell.KEY && st.keysHeld.has(group)) {
        alpha = 0.30;
        size = glyphSize * 0.80;
      }
      if (type === CoverCell.GATE && st.keysHeld.has(group)) alpha = 0.50;
      if (type === CoverCell.SHARD && !st.shardsGot.has(group) && st.shardNext === group) {
        size = glyphSize * 1.10;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      if (!terrain && spec.icon.back) {
        ctx.fillStyle = spec.icon.back;
        ctx.beginPath();
        ctx.arc(p.x, p.y, backR, 0, Math.PI * 2);
        ctx.fill();
        if (spec.icon.backEdge !== 'transparent') {
          ctx.strokeStyle = spec.icon.backEdge;
          ctx.lineWidth = Math.max(1, cell * 0.020);
          ctx.stroke();
        }
      }

      drawGlyph(ctx, kind, spec.icon.style, p.x, p.y, size, pal, cellDir(byte) as Dir);

      if ((type === CoverCell.KEY || type === CoverCell.PORTAL) && cell >= 48) {
        ctx.fillStyle = spec.icon.chip;
        ctx.beginPath();
        ctx.arc(p.x + backR * 0.86, p.y + backR * 0.86, backR * 0.40, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = spec.icon.deep;
        ctx.font = `700 ${Math.round(backR * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(group + 1), p.x + backR * 0.86, p.y + backR * 0.88);
      }
      ctx.restore();
    }
  }
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  board: ThemeBoard,
  layout: BoardLayout,
  st: ThemeState,
  spec: LinearSpec,
  now: number,
): void {
  if (st.path.length === 0) return;
  const p = center(layout, st.path[st.path.length - 1], board.w);
  const r = layout.cell * 0.24;
  const pulse = 1 + 0.07 * Math.sin(now / 250);

  ctx.save();
  if (spec.mode === 'burn') {
    // 熔岩的线头是一颗火星：外圈橙光 + 白芯
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
    g.addColorStop(0, 'rgba(255,214,150,0.55)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = spec.marker;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  board: ThemeBoard,
  layout: BoardLayout,
  st: ThemeState,
  spec: LinearSpec,
): void {
  const { cell } = layout;
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const type = cellType(board.grid[idx]);
      if (type !== CoverCell.START && type !== CoverCell.END) continue;
      if (st.covered.has(idx)) continue;

      const p = center(layout, idx, board.w);
      const r = cell * 0.30;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = spec.marker;
      ctx.lineWidth = Math.max(2.2, cell * 0.050);
      if (type === CoverCell.START) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const s = r * 0.94;
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y - s);
        ctx.lineTo(p.x + s, p.y - s);
        ctx.lineTo(p.x + s, p.y + s);
        ctx.lineTo(p.x - s, p.y + s);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
