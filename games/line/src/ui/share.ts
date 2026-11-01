/**
 * 分享海报生成 + 分享文案。
 */
import { roundRect } from '../render/board';
import { COLORS } from './hud';
import { paintSkin, skinById } from '../render/skins';
import type { LevelData } from '../core/levelTable';
import { platform } from '../platform';

/** 分享文案池。 */
const COPY_POOL = [
  '我卡在第 {lv} 关，你能连过去吗？',
  '这关我用了 {steps} 步，你呢？',
  '敢不敢试试我的皮肤？',
  '第 {lv} 关，我不信你过得去',
];

/**
 * 生成分享文案。
 */
export function shareCopy(levelIdx: number, steps: number): string {
  const tpl = COPY_POOL[Math.floor(Math.random() * COPY_POOL.length)];
  return tpl.replace('{lv}', String(levelIdx)).replace('{steps}', String(steps));
}

/** 离屏 canvas 类型（兼容微信 offscreen 与浏览器 canvas）。 */
interface PosterCanvas {
  width: number;
  height: number;
  getContext: (type: '2d') => CanvasRenderingContext2D | null;
  toDataURL?: (type: string) => string;
}

/**
 * 创建离屏 canvas（平台分支）。
 */
function createPosterCanvas(): PosterCanvas {
  if (platform.name === 'wechat') {
    const wx = (globalThis as { wx?: { createOffscreenCanvas?: (o: { type: '2d'; width: number; height: number }) => PosterCanvas } }).wx;
    const off = wx?.createOffscreenCanvas?.({ type: '2d', width: 750, height: 1334 });
    if (off) return off;
  }
  const c = document.createElement('canvas');
  c.width = 750;
  c.height = 1334;
  return c;
}

/**
 * 绘制分享海报到离屏 canvas。
 */
export function renderPoster(level: LevelData, skinId: string, steps: number, nickname: string): PosterCanvas {
  const canvas = createPosterCanvas();
  const ctx = canvas.getContext('2d')!;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 750, 1334);
  bg.addColorStop(0, '#141824');
  bg.addColorStop(1, '#1E2436');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 750, 1334);

  const skin = skinById(skinId);

  // 顶部标题
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`第 ${level.idx} 关`, 375, 120);

  // 皮肤预览（用真实棋盘片段 5×5）
  const pvSize = 420;
  const pvX = (750 - pvSize) / 2;
  const pvY = 240;
  const cell = pvSize / 5;
  for (let gy = 0; gy < 5; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      const idx = gy * 5 + gx;
      const size = cell - 6;
      paintSkin(ctx, skin, pvX + gx * cell + 3, pvY + gy * cell + 3, size, size, idx + 1, 0);
    }
  }

  // 文案
  ctx.fillStyle = COLORS.yellow;
  ctx.font = '600 38px system-ui, sans-serif';
  ctx.fillText(shareCopy(level.idx, steps), 375, 740);

  // 步数
  ctx.fillStyle = COLORS.text;
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillText(`我的步数 ${steps}`, 375, 810);

  // 昵称
  ctx.fillStyle = COLORS.subText;
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillText(nickname || '我', 375, 870);

  // 底部 CTA
  ctx.fillStyle = COLORS.blue;
  roundRect(ctx, 175, 1080, 400, 100, 50);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('来试试看', 375, 1130);

  return canvas;
}
