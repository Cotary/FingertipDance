import type { LevelData } from '../core/levelTable';
import { CellType } from '../core/types';
import type { BoardLayout } from './layout';
import { paintSkin, paletteOf, type Skin } from './skins';
import { CLAY, clayBlock, clayDisc, clayInset, clayText, type ClayColor } from '../ui/clay';

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

/**
 * 棋盘配色 —— 黏土版。
 *
 * 页面整体是浅陶土色，棋盘是沉在里面的一块**深灰蓝黏土板**：
 * 深板 + 浅砖才有对比，连线也才压得住。这是浅底方案能成立的关键。
 */
const TILE_BLOCK_EDGE = 'rgba(255,246,233,0.55)';

/** 把皮肤调色板映射成黏土四色阶。 */
function skinClay(p: ReturnType<typeof paletteOf>): ClayColor {
  return { base: p.base, light: p.light, dark: p.dark, shade: p.border };
}

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

  // 棋盘：一块厚黏土板（不是半透明玻璃 —— 黏土是不透明的哑光材料）
  clayBlock(ctx, originX - 18, originY - 18, layout.boardW + 36, layout.boardH + 36, 40, CLAY.board, 77, {
    depth: 16,
    jitter: 0.003,
  });

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
        drawEndpoint(ctx, cx, cy, size / 2, CLAY.mint, '起');
      } else {
        drawEndpoint(ctx, cx, cy, size / 2, CLAY.rose, '终');
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
      // 阻挡：比棋盘更深一号的黏土块，压着一道奶油色叉
      clayBlock(ctx, x, y, size, size, r, CLAY.boardDark, idx + 31, { depth: 3, lit: false, jitter: 0.005 });
      ctx.strokeStyle = TILE_BLOCK_EDGE;
      ctx.lineWidth = Math.max(3, size * 0.072);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + size * 0.32, y + size * 0.32);
      ctx.lineTo(x + size * 0.68, y + size * 0.68);
      ctx.moveTo(x + size * 0.68, y + size * 0.32);
      ctx.lineTo(x + size * 0.32, y + size * 0.68);
      ctx.stroke();
      break;
    }
    case CellType.BRICK: {
      if (lit) {
        // 点亮：一块彩色黏土砖，表面印着皮肤纹理。
        // 纹理以 0.42 半透叠加 —— 全不透明会把黏土的色阶体积整个盖掉，就变回贴纸了。
        clayBlock(ctx, x, y, size, size, r, skinClay(p), idx + 17, { depth: 4, jitter: 0.005 });
        ctx.save();
        roundRect(ctx, x, y, size, size, r);
        ctx.clip();
        ctx.globalAlpha = 0.42;
        paintSkin(ctx, skin, x, y, size, size, idx + 1, now);
        ctx.globalAlpha = 1;
        ctx.restore();
        // 奶油色贴纸边
        ctx.strokeStyle = 'rgba(255,251,243,0.62)';
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
        ctx.stroke();
      } else {
        // 未点亮：压进板子的一个奶油色**凹坑**（可通行，等着被填）
        // 不画亮面色阶 —— 49 格全画会多出上百次 clip，而这层砖本来就不该抢戏
        clayInset(ctx, x, y, size, size, r, CLAY.cream, idx + 3, { lit: false });
      }
      break;
    }
    case CellType.ONEWAY: {
      clayInset(ctx, x, y, size, size, r, CLAY.cream, idx + 5, { lit: false });
      drawArrow(ctx, x + size / 2, y + size / 2, size * 0.27, dir, CLAY.terracotta.dark);
      break;
    }
    case CellType.START:
    case CellType.END: {
      // 只铺砖，圆片延后到 drawEndpoints() 画（避免被连线横穿）
      clayInset(ctx, x, y, size, size, r, CLAY.cream, idx + 7, { lit: false });
      break;
    }
  }

  if (hinted) {
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(now / 260));
    ctx.strokeStyle = `rgba(255,236,140,${pulse.toFixed(2)})`;
    ctx.lineWidth = 4.5;
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, r);
    ctx.stroke();
  }
  ctx.restore();
}

/** 起终点：压进黏土板的一枚手捏圆片。 */
function drawEndpoint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  c: ClayColor,
  label: string,
): void {
  const seed = 900 + label.charCodeAt(0);

  // 衬白：起终点压在深蓝板上，直接上色会「陷」进去。
  // 一圈纸白把它托起来，观者才能一眼找到两端的锚点。
  clayDisc(ctx, cx, cy, r * 0.99, CLAY.paper, seed, { depth: 7, hi: 0.05, jitter: 0.008 });
  clayDisc(ctx, cx, cy, r * 0.895, c, seed + 1, { depth: 4, hi: 0.15 });

  // 「起」「终」笔画密集，必须深色实心、不描边 —— 描边会把内部空隙填死成墨块
  clayText(ctx, label, cx, cy, Math.floor(r * 0.68), {
    fill: '#FFFBF3',
    outline: c.shade,
    outlineWidth: Math.max(2, r * 0.075),
    emboss: false,
  });
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
