/**
 * Cover 模式 v3：连线渲染。
 *
 * ## 与经典模式连线的差异
 *
 * 1. **冰块滑行段**：一次移动消耗多格，线要一次画过去，
 *    并且视觉上要能看出「这段是滑过去的」（叠一层冰蓝）。
 * 2. **传送门跳跃**：路径可能从 A 跳到 B（几何上不相邻），
 *    这时画一段「跳跃弧线」而不是直线。
 *
 * ## 2026-11-08 修的一个致命 bug
 *
 * 旧 `segmentPath` 的 else 分支里写的是 `cur = { cells: [cell], kind }` ——
 * **丢了 `prev`**，于是每个相邻步都被切成「只有一个格」的段，
 * 而所有绘制循环都有 `if (seg.cells.length < 2) continue`，
 * 结果一条线都画不出来，只剩每格一颗「转折珠」。
 *
 * 线上看到的是「一盘点」：方向、顺序、走到哪，全部读不出来。
 * 现在改成按「这一步怎么走的」合并，**每段至少 2 格**；
 * 转折珠也只在真转弯处出现（旧版每格一颗，11×11 就是一盘麻子）。
 */
import { cellType, CoverCell } from '../core/cover/v3/types';
import type { BoardLayout } from './layout';

/** 路径的一段（拍平索引序列，按走过顺序）。 */
export interface TrailSegment {
  /** 这一段的格（拍平索引）；至少 2 格 */
  cells: number[];
  /** 这一段是怎么走的 */
  kind: 'walk' | 'ice' | 'portal';
}

/** 一次移动的种类：进入冰块就滑行；几何上不相邻就是传送。 */
function stepKind(prev: number, next: number, w: number, grid: Uint8Array): TrailSegment['kind'] {
  const dx = Math.abs((prev % w) - (next % w));
  const dy = Math.abs(Math.floor(prev / w) - Math.floor(next / w));
  if (dx + dy !== 1) return 'portal';
  return cellType(grid[prev]) === CoverCell.ICE ? 'ice' : 'walk';
}

/**
 * 把路径切成段。
 *
 * 切分依据是**这一步的 kind**（不是上一段的 kind）：
 *   - 几何相邻且起点不是冰 → 普通行走
 *   - 几何相邻且起点是冰   → 冰块滑行
 *   - 几何不相邻          → 传送门跳跃（每段固定 2 格）
 *
 * 每段都带着相邻两格（`cells: [prev, next]` 起步），
 * 所以「段至少 2 格」是**构造保证**，不靠调用方再判一次。
 */
export function segmentPath(path: number[], w: number, grid: Uint8Array): TrailSegment[] {
  const out: TrailSegment[] = [];
  if (path.length < 2) return out;

  let cur: TrailSegment = { cells: [path[0], path[1]], kind: stepKind(path[0], path[1], w, grid) };
  for (let i = 2; i < path.length; i++) {
    const kind = stepKind(path[i - 1], path[i], w, grid);
    // 传送是「一跳」，不能和任何东西合并
    if (kind === cur.kind && kind !== 'portal') {
      cur.cells.push(path[i]);
    } else {
      out.push(cur);
      cur = { cells: [path[i - 1], path[i]], kind };
    }
  }
  out.push(cur);
  return out;
}

/** 一条黏土连线需要的三个色阶。 */
export interface TrailClay {
  base: string;
  dark: string;
  light: string;
}

/**
 * 绘制 cover 路径连线。
 *
 * 四层体积语言与经典模式一致（压痕 → 侧暗 → 主色 → 亮芯），
 * 冰块段额外叠一层冰蓝高光以示滑行。
 */
export function drawCoverTrail(
  ctx: CanvasRenderingContext2D,
  path: number[],
  w: number,
  grid: Uint8Array,
  layout: BoardLayout,
  c: TrailClay,
): void {
  if (path.length < 2) return;
  const { cell, originX, originY } = layout;

  const at = (idx: number): { x: number; y: number } => ({
    x: originX + (idx % w) * cell + cell / 2,
    y: originY + Math.floor(idx / w) * cell + cell / 2,
  });

  const segments = segmentPath(path, w, grid);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /** 按层描所有「走得过去」的段（传送段由虚线弧单独处理）。 */
  const strokeAll = (color: string, width: number, dy = 0): void => {
    ctx.save();
    ctx.translate(0, dy);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const seg of segments) {
      if (seg.kind === 'portal') continue;
      ctx.beginPath();
      seg.cells.forEach((idx, i) => {
        const p = at(idx);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
    ctx.restore();
  };

  // ① 压痕 → ② 侧暗 → ③ 主色 → ④ 亮芯（整体上移，模拟光从上方）
  strokeAll('rgba(74,51,39,0.20)', cell * 0.30);
  strokeAll(c.dark, cell * 0.215);
  strokeAll(c.base, cell * 0.175, -cell * 0.020);
  strokeAll(c.light, cell * 0.048, -cell * 0.020);

  // ⑤ 冰块段：叠一层冰蓝，视觉上区分「滑过去的」
  for (const seg of segments) {
    if (seg.kind !== 'ice') continue;
    ctx.save();
    ctx.translate(0, -cell * 0.024);
    ctx.strokeStyle = 'rgba(216,238,252,0.72)';
    ctx.lineWidth = cell * 0.075;
    ctx.beginPath();
    seg.cells.forEach((idx, i) => {
      const p = at(idx);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // ⑥ 传送门跳跃：虚线弧（线从 A 抬起来落到 B）
  for (const seg of segments) {
    if (seg.kind !== 'portal') continue;
    const a = at(seg.cells[0]);
    const b = at(seg.cells[1]);
    ctx.save();
    ctx.setLineDash([cell * 0.13, cell * 0.11]);
    ctx.strokeStyle = c.base;
    ctx.lineWidth = cell * 0.085;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - cell * 0.38, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  // ⑦ 转折点：小黏土珠，**只在真转弯处**
  //
  // 旧版每个中间格都画一颗，11×11 走满时是 120 颗麻子，整条线糊成一条珠链。
  // 判据：前后两步方向不同才算转弯（同排 / 同列直行不画）。
  const dirOf = (a: number, b: number): number => {
    const dx = (b % w) - (a % w);
    const dy = Math.floor(b / w) - Math.floor(a / w);
    if (Math.abs(dx) + Math.abs(dy) !== 1) return -1; // 传送跳跃
    if (dx === 1) return 3;
    if (dx === -1) return 2;
    return dy === 1 ? 1 : 0;
  };

  for (let i = 1; i < path.length - 1; i++) {
    const dIn = dirOf(path[i - 1], path[i]);
    const dOut = dirOf(path[i], path[i + 1]);
    if (dIn < 0 || dOut < 0) continue; // 跳跃的两端不画珠
    if (dIn === dOut) continue; // 直行

    const p = at(path[i]);
    const r = cell * 0.062;
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.arc(p.x, p.y + r * 0.35, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.arc(p.x - r * 0.25, p.y - r * 0.30, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
