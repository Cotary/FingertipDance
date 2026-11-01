import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { GAME_THEME, type Theme } from './theme';

/** 游戏内配色（深色）。保留此名以兼容既有引用。 */
export const COLORS = GAME_THEME;

/** 矩形按钮。 */
export interface Button {
  x: number; y: number; w: number; h: number;
  label: string;
  kind: 'primary' | 'secondary' | 'ghost';
  id: string;
}

/**
 * 按「步数 / 理论最短步数」算星级。
 * 阈值必须与后端 server/internal/games/line/stars.go 的 StarOf 一致。
 */
export function starOf(steps: number, shortest: number): number {
  if (shortest <= 0) return 1;
  const ratio = steps / shortest;
  if (ratio <= 1.15) return 3;
  if (ratio <= 1.5) return 2;
  return 1;
}

/**
 * 画一个按钮。
 * @param theme 主题，默认深色游戏主题（既有调用点无需改）
 */
export function drawButton(ctx: CanvasRenderingContext2D, b: Button, pressed: boolean, theme: Theme = COLORS): void {
  const scale = pressed ? 0.96 : 1;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  if (b.kind === 'primary') {
    ctx.fillStyle = theme.blue;
    roundRect(ctx, b.x, b.y, b.w, b.h, 24);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
  } else if (b.kind === 'secondary') {
    ctx.strokeStyle = theme.blue;
    ctx.lineWidth = 2;
    roundRect(ctx, b.x, b.y, b.w, b.h, 24);
    ctx.stroke();
    ctx.fillStyle = theme.blue;
  } else {
    ctx.fillStyle = theme.border;
    roundRect(ctx, b.x, b.y, b.w, b.h, 24);
    ctx.fill();
    ctx.fillStyle = theme.text;
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
  const px = 50, py = 380, pw = DESIGN_W - 100, ph = 660;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, px, py, pw, ph, 24);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.success;
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText(`第 ${levelIdx} 关 通关！`, DESIGN_W / 2, py + 40);

  const stars = starOf(steps, shortest);
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
  const homeBtn: Button = { x: 120, y: py + 570, w: DESIGN_W - 240, h: 64, label: '返回大厅', kind: 'ghost', id: 'home' };

  drawButton(ctx, nextBtn, false);
  drawButton(ctx, shareBtn, false);
  drawButton(ctx, skinBtn, false);
  drawButton(ctx, homeBtn, false);

  return [nextBtn, shareBtn, skinBtn, homeBtn];
}
