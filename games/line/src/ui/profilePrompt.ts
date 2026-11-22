/**
 * 「完善昵称头像」提示条。
 *
 * ## 为什么不是启动时的授权弹窗
 *
 * 微信 `getUserProfile` 必须由**用户手势**触发 —— 启动时自动调只会失败
 * （或被判成诱导授权）。而且首屏就弹一个"要不要给我们你的头像"，
 * 玩家还没玩过任何东西，凭什么给？
 *
 * 所以做成大厅里的一条**可忽略的提示**：玩家想填就点，不填也能玩。
 *
 * ## 什么时候必须提醒到
 *
 * 两个时机，缺一不可：
 *
 * 1. **刚走完引导、回到大厅** —— 此时他刚体验完，意愿最高
 * 2. **第一次打开分享面板前** —— 分享出去的卡片写着「玩家」而不是他的名字，
 *    这是唯一"不填就会后悔"的地方
 *
 * 第 2 条由 `openSharePanel` 的前置检查负责（见 `main.ts`），
 * 本文件只负责第 1 条那条停留在大厅的提示条。
 *
 * ## 为什么提示条不做成按钮
 *
 * 它压在首页票券下方，做成一个整宽按钮会和「开始游戏」那个金 CTA 抢注意力。
 * 做成一条细提示（左侧小字 + 右侧"去设置"）—— 不点也不碍事。
 */
import { DESIGN_W } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedWidth, type Button } from './hud';

const P = {
  ink: '#E4EDE6',
  muted: 'rgba(122,116,104,0.92)',
  gold: '#D4AF6A',
  bg: 'rgba(212,175,106,0.10)',
  border: 'rgba(212,175,106,0.26)',
} as const;

/** 提示条宽高（y 由调用方按分享条位置反推）。 */
const STRIP = { x: 44, w: DESIGN_W - 88, h: 84 };

/**
 * 画「完善昵称头像」提示条。
 *
 * 只在需要时调用 —— 判断条件在调用方（`profileFilled === false` 且不在引导中）。
 *
 * @returns 按钮（`fillProfile`），不需要显示时调用方不要调用本函数
 */
export function drawProfilePrompt(ctx: CanvasRenderingContext2D, top: number): Button[] {
  const { x, w, h } = STRIP;
  const y = top;

  roundRect(ctx, x, y, w, h, 24);
  ctx.fillStyle = P.bg;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const text = '设个头像昵称，好友才知道是谁在挑战';
  trackedText(ctx, text, x + 26, y + 50, 19, P.muted, 1, 400);

  const action = '去设置';
  const aw = trackedWidth(ctx, action, 19, 2, 600);
  const ax = x + w - aw - 26;
  trackedText(ctx, action, ax, y + 50, 19, P.gold, 2, 600);

  // 只在"去设置"那几个字上响应，整条不点也能划走（不拦手势）
  return [{
    x: ax - 20, y: y + 16, w: aw + 40, h: h - 32,
    label: '', kind: 'ghost', id: 'fillProfile',
  }];
}

/** 提示条矩形（给定上沿）。 */
export function profilePromptRect(top: number) {
  return { ...STRIP, y: top };
}
