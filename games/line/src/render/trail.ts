import type { BoardLayout } from './layout';

/** 一条黏土连线需要的三个色阶（从 CLAY.terracotta / CLAY.mustard 取）。 */
export interface TrailClay {
  base: string;
  dark: string;
  light: string;
}

/**
 * 绘制玩家路径连线 —— 黏土版。
 *
 * 三层结构换成「压痕 → 暗层 → 主色（上移）→ 亮芯」，
 * 读起来是一条**挤在黏土板上、被光从上方照到的黏土条**，而不是发光的能量线。
 * 转折处放一颗小黏土珠，呼应手工感。
 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  path: number[],
  w: number,
  layout: BoardLayout,
  c: TrailClay,
): void {
  if (path.length === 0) return;
  const { cell, originX, originY } = layout;

  const pts = path.map((idx) => ({
    x: originX + (idx % w) * cell + cell / 2,
    y: originY + Math.floor(idx / w) * cell + cell / 2,
  }));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const trace = (): void => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  };

  // ① 压痕：线压在黏土板上留下的槽
  trace();
  ctx.strokeStyle = 'rgba(74,51,39,0.20)';
  ctx.lineWidth = cell * 0.30;
  ctx.stroke();

  // ② 暗层：黏土条的侧壁
  trace();
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = cell * 0.205;
  ctx.stroke();

  // ③ 主色 + ④ 亮芯：整体上移，模拟光从上方来
  ctx.save();
  ctx.translate(0, -cell * 0.028);
  trace();
  ctx.strokeStyle = c.base;
  ctx.lineWidth = cell * 0.17;
  ctx.stroke();

  trace();
  ctx.strokeStyle = c.light;
  ctx.lineWidth = cell * 0.055;
  ctx.stroke();
  ctx.restore();

  // 转折点：一颗小黏土珠
  for (let i = 1; i < pts.length - 1; i++) {
    const r = cell * 0.062;
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y + r * 0.35, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.arc(pts[i].x - r * 0.25, pts[i].y - r * 0.30, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
