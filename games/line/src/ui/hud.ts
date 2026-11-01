import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';

export const COLORS = {
  bg: '#141824',
  bgLight: '#1E2436',
  panel: '#262D42',
  border: '#39415C',
  text: '#E8ECF5',
  subText: '#8A94AD',
  accent: '#E97E6A',
  success: '#5EA94C',
  blue: '#6692F5',
  yellow: '#F2C14E',
  purple: '#9B7BE8',
};

/** 矩形按钮。 */
export interface Button {
  x: number; y: number; w: number; h: number;
  label: string;
  kind: 'primary' | 'secondary' | 'ghost';
  id: string;
}

/**
 * 画一个按钮并返回它是否被点击。
 */
export function drawButton(ctx: CanvasRenderingContext2D, b: Button, pressed: boolean): void {
  const scale = pressed ? 0.96 : 1;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  if (b.kind === 'primary') {
    ctx.fillStyle = COLORS.blue;
    roundRect(ctx, b.x, b.y, b.w, b.h, 24);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
  } else if (b.kind === 'secondary') {
    ctx.strokeStyle = COLORS.blue;
    ctx.lineWidth = 2;
    roundRect(ctx, b.x, b.y, b.w, b.h, 24);
    ctx.stroke();
    ctx.fillStyle = COLORS.blue;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 24);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
  }

  ctx.font = '600 32px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.label, cx, cy);
  ctx.restore();
}

/**
 * 判断点是否落在按钮内。
 */
export function hitButton(b: Button, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** 画 HUD 顶部。 */
export function drawHud(ctx: CanvasRenderingContext2D, levelIdx: number, skinName: string, skinCount: number, totalSkins: number): void {
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`第 ${levelIdx} 关`, DESIGN_W / 2, 110);

  ctx.fillStyle = COLORS.subText;
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`皮肤 ${skinCount}/${totalSkins}`, 40, 160);
  ctx.textAlign = 'right';
  ctx.fillText(skinName, DESIGN_W - 40, 160);
}

/** 画进度条。 */
export function drawProgressBar(ctx: CanvasRenderingContext2D, current: number, total: number): void {
  const x = 40, y = 1040, w = DESIGN_W - 80, h = 16;
  ctx.fillStyle = COLORS.border;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const fillW = Math.max(0, w * ratio);
  if (fillW > 0) {
    ctx.fillStyle = COLORS.blue;
    roundRect(ctx, x, y, fillW, h, 8);
    ctx.fill();
  }

  ctx.fillStyle = COLORS.subText;
  ctx.font = '22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${current} / ${total} 关`, x, y + 28);
}

/** 画通关结算页。 */
export function drawResult(
  ctx: CanvasRenderingContext2D,
  levelIdx: number,
  steps: number,
  shortest: number,
  timeMs: number,
  unlockedSkin: { id: string; name: string } | null,
  progressRatio: number,
): Button[] {
  // 遮罩
  ctx.fillStyle = 'rgba(10,12,20,0.82)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 面板
  const px = 50, py = 380, pw = DESIGN_W - 100, ph = 560;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, px, py, pw, ph, 24);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.success;
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText(`第 ${levelIdx} 关 通关！`, DESIGN_W / 2, py + 40);

  const ratio = shortest > 0 ? steps / shortest : 1;
  const stars = ratio <= 1.15 ? 3 : ratio <= 1.5 ? 2 : 1;
  ctx.fillStyle = COLORS.yellow;
  ctx.font = '40px system-ui, sans-serif';
  ctx.fillText('★'.repeat(stars) + '☆'.repeat(3 - stars), DESIGN_W / 2, py + 110);

  ctx.fillStyle = COLORS.text;
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillText(`步数 ${steps}（最短 ${shortest}）`, DESIGN_W / 2, py + 175);
  ctx.fillText(`用时 ${(timeMs / 1000).toFixed(1)} 秒`, DESIGN_W / 2, py + 215);

  if (unlockedSkin) {
    ctx.fillStyle = COLORS.purple;
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillText(`解锁新皮肤：${unlockedSkin.name}`, DESIGN_W / 2, py + 275);
  }

  ctx.fillStyle = COLORS.subText;
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillText(`进度 ${(progressRatio * 100).toFixed(1)}%`, DESIGN_W / 2, py + 330);

  const nextBtn: Button = { x: 120, y: py + 400, w: DESIGN_W - 240, h: 88, label: '下一关', kind: 'primary', id: 'next' };
  const shareBtn: Button = { x: 120, y: py + 500, w: (DESIGN_W - 260) / 2, h: 64, label: '分享', kind: 'secondary', id: 'share' };
  const skinBtn: Button = { x: 140 + (DESIGN_W - 260) / 2, y: py + 500, w: (DESIGN_W - 260) / 2, h: 64, label: '皮肤', kind: 'secondary', id: 'skins' };

  drawButton(ctx, nextBtn, false);
  drawButton(ctx, shareBtn, false);
  drawButton(ctx, skinBtn, false);

  return [nextBtn, shareBtn, skinBtn];
}
