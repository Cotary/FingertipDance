import type { BoardLayout } from './layout';

/**
 * 绘制玩家路径连线。
 * 三层结构：外发光 → 糖果主线 → 白色内芯，交叉处点一颗白点（像串起来的糖珠）。
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

  const trace = (): void => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  };

  // 外发光（宽而透，不用 shadowBlur，逐帧更省）
  trace();
  ctx.strokeStyle = glow;
  ctx.lineWidth = cell * 0.30;
  ctx.stroke();

  // 主线：竖向糖果渐变
  trace();
  const g = ctx.createLinearGradient(0, pts[0].y, 0, pts[pts.length - 1].y);
  g.addColorStop(0, '#7ED957');
  g.addColorStop(0.5, color);
  g.addColorStop(1, '#B388FF');
  ctx.strokeStyle = g;
  ctx.lineWidth = cell * 0.18;
  ctx.stroke();

  // 白色内芯
  trace();
  ctx.strokeStyle = 'rgba(255,255,255,0.70)';
  ctx.lineWidth = cell * 0.06;
  ctx.stroke();

  // 转折点糖珠
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, cell * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
