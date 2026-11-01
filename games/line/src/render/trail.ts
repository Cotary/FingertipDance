import type { BoardLayout } from './layout';

/**
 * 绘制玩家路径连线。
 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  path: number[],
  w: number,
  layout: BoardLayout,
  color: string,
  glow: string,
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

  // 外发光
  ctx.strokeStyle = glow;
  ctx.lineWidth = cell * 0.22;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();

  // 主线
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = cell * 0.14;
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();

  // 白色内芯
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = cell * 0.05;
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();

  ctx.restore();
}
