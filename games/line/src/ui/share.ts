/**
 * 分享海报生成 + 分享文案。
 */
import { roundRect } from '../render/board';
import { COLORS } from './hud';
import { paintSkin, skinById } from '../render/skins';
import { platform } from '../platform';

/** 分享文案池。 */
const COPY_POOL = [
  '我卡在第 {lv} 关，你能连过去吗？',
  '这关我重来 {undos} 次，你呢？',
  '敢不敢试试我的皮肤？',
  '第 {lv} 关，我不信你过得去',
];

/**
 * 生成分享文案。
 *
 * @param levelIdx 关号
 * @param undos   重来次数（cover 模式的对比维度）
 */
export function shareCopy(levelIdx: number, undos: number): string {
  const tpl = COPY_POOL[Math.floor(Math.random() * COPY_POOL.length)];
  return tpl.replace('{lv}', String(levelIdx)).replace('{undos}', String(undos));
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
 * 分享海报只需要关号与盘面尺寸。
 *
 * cover 模式的关卡对象跟经典模式结构不同（没有 `grid: Cell[][]`），
 * 所以这里定义一个最小接口，两种模式都能喂。
 */
export interface PosterLevel {
  idx: number;
  w: number;
  h: number;
}

/**
 * 生成分享海报。
 *
 * @param level  关卡信息
 * @param skinId 皮肤 id
 * @param undos  重来次数（cover 模式是唯一有区分度的成绩）
 * @param nickname 昵称
 */
export function renderPoster(level: PosterLevel, skinId: string, undos: number, nickname: string): PosterCanvas {
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
  ctx.fillText(shareCopy(level.idx, undos), 375, 740);

  // 成绩：重来次数（cover 模式步数恒定，比步数没意义）
  ctx.fillStyle = COLORS.text;
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillText(undos === 0 ? '一次都没重来' : `我重来了 ${undos} 次`, 375, 810);

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
