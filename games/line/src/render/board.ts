import type { Level } from '../core/types';
import { CellType } from '../core/types';
import type { BoardLayout } from './layout';

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

export interface Palette {
  block: string;
  brick: string;
  brickLit: string;
  oneway: string;
  start: string;
  end: string;
}

/**
 * 绘制棋盘与所有格子。
 */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  level: Level,
  layout: BoardLayout,
  state: BoardRenderState,
  palette: Palette,
  now: number,
): void {
  const { cell, originX, originY } = layout;
  const gap = Math.max(2, Math.floor(cell * 0.06));
  const size = cell - gap * 2;

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const idx = y * level.w + x;
      const cellData = level.grid[y][x];
      let px = originX + x * cell + gap;
      let py = originY + y * cell + gap;

      // 断线抖动
      if (state.shakeCell === idx && state.shakeAt > 0) {
        const elapsed = now - state.shakeAt;
        if (elapsed < 200) {
          px += Math.sin((elapsed / 200) * Math.PI * 6) * 4;
        }
      }

      drawCell(ctx, cellData.type, cellData.dir, px, py, size, state.lit.has(idx), palette, state.hint.has(idx));
    }
  }
}

/** 绘制单个格子。 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  type: number,
  dir: number,
  x: number, y: number, size: number,
  lit: boolean,
  palette: Palette,
  hinted: boolean,
): void {
  const r = Math.floor(size * 0.18);

  ctx.save();
  switch (type) {
    case CellType.BLOCK: {
      ctx.fillStyle = palette.block;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      // 对角交叉线
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + size * 0.25, y + size * 0.25);
      ctx.lineTo(x + size * 0.75, y + size * 0.75);
      ctx.moveTo(x + size * 0.75, y + size * 0.25);
      ctx.lineTo(x + size * 0.25, y + size * 0.75);
      ctx.stroke();
      break;
    }
    case CellType.BRICK: {
      ctx.fillStyle = lit ? palette.brickLit : palette.brick;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      if (lit) {
        // 顶部高光
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        roundRect(ctx, x + size * 0.12, y + size * 0.1, size * 0.76, size * 0.22, r * 0.5);
        ctx.fill();
      }
      break;
    }
    case CellType.ONEWAY: {
      ctx.fillStyle = palette.oneway;
      roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      drawArrow(ctx, x + size / 2, y + size / 2, size * 0.3, dir, '#FFFFFF');
      break;
    }
    case CellType.START: {
      ctx.fillStyle = palette.start;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case CellType.END: {
      ctx.fillStyle = palette.end;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  if (hinted) {
    ctx.strokeStyle = '#F2C14E';
    ctx.lineWidth = 4;
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, r);
    ctx.stroke();
  }
  ctx.restore();
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
