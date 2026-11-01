import type { LevelData } from '../core/levelTable';
import { CellType } from '../core/types';
import type { BoardLayout } from './layout';
import { paintSkin, paletteOf, type Skin } from './skins';

export interface BoardRenderState {
  /** 已点亮的格子索引集合 */
  lit: Set<number>;
  /** 当前路径（格子索引序列） */
  path: number[];
  /** 提示高亮的格子 */
  hint: Set<number>;
  /** 断线抖动的格子索引，-1 表示无 */
  shakeCell: number;
  /** 抖动时间戳（ms），0 表示不抖 */
  shakeAt: number;
}

/** 未点亮砖块 / 阻挡块的夜空白，与主题夜空同一族。 */
// 可通行格必须一眼看出边界：0.085 在深色底板上几乎不可见，提到 0.13 + 0.22 边
const TILE_EMPTY = 'rgba(255,255,255,0.13)';
const TILE_EMPTY_EDGE = 'rgba(255,255,255,0.22)';
const TILE_BLOCK = 'rgba(12,7,38,0.94)';
const TILE_BLOCK_EDGE = 'rgba(255,255,255,0.16)';

/**
 * 绘制棋盘与所有格子。
 *
 * 注意 START / END 只在这里铺一层底板，糖果圆片由 `drawEndpoints()` 在连线**之后**叠上去——
 * 连线从格心出发，若圆片先画就会被连线横穿，字被压在下面看不清。
 */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  level: LevelData,
  layout: BoardLayout,
  state: BoardRenderState,
  skin: Skin,
  now: number,
): void {
  const { cell, originX, originY } = layout;
  const gap = Math.max(2, Math.floor(cell * 0.06));
  const size = cell - gap * 2;
  const p = paletteOf(skin);

  // 棋盘底板：把棋盘从夜空中「抬」起来，避免星星透过半透明格子形成噪点
  // 0.62 仍会漏星点，0.80 才真正读作「一块板」
  roundRect(ctx, originX - 14, originY - 14, layout.boardW + 28, layout.boardH + 28, 34);
  ctx.fillStyle = 'rgba(9,5,30,0.80)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  roundRect(ctx, originX - 13, originY - 13, layout.boardW + 26, layout.boardH + 26, 33);
  ctx.stroke();

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const idx = y * level.w + x;
      const c = level.grid[y][x];
      let px = originX + x * cell + gap;
      let py = originY + y * cell + gap;

      // 断线抖动
      if (state.shakeCell === idx && state.shakeAt > 0) {
        const elapsed = now - state.shakeAt;
        if (elapsed < 200) {
          px += Math.sin((elapsed / 200) * Math.PI * 6) * 4;
        }
      }

      drawCell(ctx, c.type, c.dir, px, py, size, state.lit.has(idx), p, skin, now, idx, state.hint.has(idx));
    }
  }
}

/**
 * 叠画起点 / 终点糖果圆片。
 * 必须在 `drawTrail()` **之后**调用：连线从格心出发，圆片后画才能盖住线头、字不被压。
 */
export function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  level: LevelData,
  layout: BoardLayout,
): void {
  const { cell, originX, originY } = layout;
  const gap = Math.max(2, Math.floor(cell * 0.06));
  const size = cell - gap * 2;

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const type = level.grid[y][x].type;
      if (type !== CellType.START && type !== CellType.END) continue;
      const cx = originX + x * cell + gap + size / 2;
      const cy = originY + y * cell + gap + size / 2;
      if (type === CellType.START) {
        drawEndpoint(ctx, cx, cy, size / 2, '#7ED957', '#3E9A2A', '#CDF7B0', '起');
      } else {
        drawEndpoint(ctx, cx, cy, size / 2, '#FF6B6B', '#BE2F2F', '#FFB5B5', '终');
      }
    }
  }
}

/** 绘制单个格子。 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  type: number,
  dir: number,
  x: number,
  y: number,
  size: number,
  lit: boolean,
  p: ReturnType<typeof paletteOf>,
  skin: Skin,
  now: number,
  idx: number,
  hinted: boolean,
): void {
  const r = Math.floor(size * 0.20);

  ctx.save();
  switch (type) {
    case CellType.BLOCK: {
      // 阻挡：近乎黑的实心块 + 白色叉，读作「这里是墙」
      ctx.fillStyle = TILE_BLOCK;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      ctx.strokeStyle = TILE_BLOCK_EDGE;
      ctx.lineWidth = 2;
      roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(3, size * 0.075);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + size * 0.30, y + size * 0.30);
      ctx.lineTo(x + size * 0.70, y + size * 0.70);
      ctx.moveTo(x + size * 0.70, y + size * 0.30);
      ctx.lineTo(x + size * 0.30, y + size * 0.70);
      ctx.stroke();
      break;
    }
    case CellType.BRICK: {
      if (lit) {
        // 点亮：糖果砖块 —— 贴纸描边 + 顶部光泽 + 底部厚度
        ctx.fillStyle = p.border;
        roundRect(ctx, x, y + size * 0.06, size, size, r);
        ctx.fill();

        paintSkin(ctx, skin, x, y, size, size, idx + 1, now);

        // 顶部光泽
        ctx.save();
        roundRect(ctx, x, y, size, size, r);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.26)';
        roundRect(ctx, x + size * 0.10, y + size * 0.08, size * 0.80, size * 0.30, r * 0.8);
        ctx.fill();
        // 底部内侧压暗，做出厚度
        const sh = ctx.createLinearGradient(0, y + size * 0.66, 0, y + size);
        sh.addColorStop(0, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.22)');
        ctx.fillStyle = sh;
        ctx.fillRect(x, y + size * 0.66, size, size * 0.34);
        ctx.restore();

        // 白色贴纸边
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
        ctx.stroke();
      } else {
        // 未点亮：夜空玻璃块（可通行，等待被点亮）
        ctx.fillStyle = TILE_EMPTY;
        roundRect(ctx, x, y, size, size, r);
        ctx.fill();
        ctx.strokeStyle = TILE_EMPTY_EDGE;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
        ctx.stroke();
      }
      break;
    }
    case CellType.ONEWAY: {
      ctx.fillStyle = TILE_EMPTY;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,169,64,0.30)';
      ctx.lineWidth = 2;
      roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
      ctx.stroke();
      drawArrow(ctx, x + size / 2, y + size / 2, size * 0.27, dir, '#FFA940');
      break;
    }
    case CellType.START:
    case CellType.END: {
      // 只铺底板，圆片延后到 drawEndpoints() 画（避免被连线横穿）
      ctx.fillStyle = TILE_EMPTY;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      break;
    }
  }

  if (hinted) {
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(now / 260));
    ctx.strokeStyle = `rgba(255,213,79,${pulse.toFixed(2)})`;
    ctx.lineWidth = 4;
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, r);
    ctx.stroke();
  }
  ctx.restore();
}

/** 起终点：糖果圆片（厚底边 + 竖向渐变 + 高光 + 描边文字）。 */
function drawEndpoint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  base: string,
  dark: string,
  light: string,
  label: string,
): void {
  // 底边
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.12, r, 0, Math.PI * 2);
  ctx.fill();

  // 顶面
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, light);
  g.addColorStop(0.45, base);
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 高光：必须压在圆的上缘。「起」「终」笔画密集，高光落在中部会直接把字洗白。
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.16, cy - r * 0.62, r * 0.40, r * 0.16, -0.30, 0, Math.PI * 2);
  ctx.fill();

  // 白描边
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
  ctx.stroke();

  // 文字：深色实心字，不描边。
  // CJK 密集笔画（起/终）叠一层深色描边只会把内部空隙填死、糊成墨块；
  // 圆片顶面本就偏浅（light 打头），深色字对比足够，也更像「贴纸印刷」而非发光字。
  // 基线走 alphabetic + 手动补偿，与 ui/draw.ts 的 strokeText 保持同一视觉位置。
  const fs = Math.floor(r * 0.62);
  const dy = fs * 0.36;
  ctx.font = `800 ${fs}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = dark;
  ctx.fillText(label, cx, cy + dy);
}

/** 绘制箭头。dir: 0=上 1=下 2=左 3=右 */
export function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, dir: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dir * Math.PI / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.72, r * 0.5);
  ctx.lineTo(-r * 0.72, r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 画圆角矩形路径。 */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
