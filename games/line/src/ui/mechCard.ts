/**
 * 机制首见说明卡。
 *
 * ## 与「适龄提示」同一套卡片，但**不拦操作**
 *
 * 适龄提示是合规模态（必须点掉）；这张是**可忽略的悬层**：
 * 玩家可以直接开始拖线，卡会在他第一步之后自动淡出。
 *
 * 为什么这么做：玩家在关卡里遇到卡，第一反应是"试一试"，
 * 而不是"读完再玩"。强制他点"我知道了"才准动手，是把教学成本
 * 转成了怒气 —— 尤其当他只是随手点进来的。
 *
 * ## 位置在盘面之上、HUD 之下
 *
 * 压在棋盘上方三分之一处：不挡起点终点（两端通常在盘外圈），
 * 也挡不到盘底那排按钮。玩家一边读一边能看见盘。
 */
import { DESIGN_W } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedWidth, type Button } from './hud';
import type { MechCard } from '../game/mechIntro';

const P = {
  ink: '#EDE7DA',
  inkSoft: 'rgba(185,178,164,0.92)',
  gold: '#D4AF6A',
  bg: 'rgba(16,28,23,0.94)',
  border: 'rgba(212,175,106,0.34)',
} as const;

/**
 * 卡片尺寸。
 *
 * 高度按内容推：标题 74 + 两行（132 / 172）+ 底部提示（h-26）。
 * 236 时提示行与第二行说明只差 38，读起来像挤在一起；
 * 252 给到 54，才是一段呼吸。
 */
const CARD = { w: 640, h: 236, r: 28 };

/**
 * 卡片的纵向位置。
 *
 * ## 为什么在盘面**下半部**
 *
 * 初版放在 y=300（盘面上方那一带），实测把棋盘上半截整个盖住 ——
 * 而单向门、星屑这些机制格常常就在上半部（截图里箭头正好在卡片背后）。
 * 玩家要看的东西被自己刚弹出来的卡片挡住了，这张卡就成了障碍。
 *
 * 挪到 620 之后：只压住盘面下缘一带，起点终点（通常在外圈）基本露着，
 * 而且说明卡在视野下方，读它的时候盘面还在视线上方。
 */
const TOP = 616;

/**
 * 画机制说明卡。
 *
 * @param appear 0..1 出现进度（淡入 + 轻微上浮）
 * @returns 按钮（`mechOk`），点卡片任意位置都关掉
 */
export function drawMechCard(
  ctx: CanvasRenderingContext2D,
  card: MechCard,
  appear: number,
): Button[] {
  const t = Math.max(0, Math.min(1, appear));
  const x = (DESIGN_W - CARD.w) / 2;
  // 上浮 14px：从下方一点点升到位，比"原地淡入"更抓注意力
  const y = TOP + (1 - t) * 14;

  ctx.save();
  ctx.globalAlpha = t;

  // ── 卡片 ──
  roundRect(ctx, x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = P.bg;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── 标题（左侧，带一小段金色引线）──
  ctx.fillStyle = P.gold;
  ctx.fillRect(x + 40, y + 52, 4, 26);
  trackedText(ctx, card.title, x + 58, y + 74, 26, P.ink, 4.4, 600);

  // ── 右上角「新机制」标识 ──
  //
  // 写一句话而不是图标：玩家看到"新机制"三个字就知道**后面会有更多**，
  // 而不是以为这是个一次性教程。
  const tag = '新 机 制';
  const tw = trackedWidth(ctx, tag, 14, 2, 500);
  trackedText(ctx, tag, x + CARD.w - tw - 40, y + 70, 14, P.gold, 2, 500);

  // ── 两行说明 ──
  card.lines.forEach((line, i) => {
    trackedText(ctx, line, x + 40, y + 128 + i * 38, 20, P.inkSoft, 0.8, 400);
  });

  // ── 底部提示：可以不等它 ──
  //
  // 明确说出"可以直接开始"，否则玩家会不确定要不要点一下。
  const hint = '直接开始拖线也可以';
  const hw = trackedWidth(ctx, hint, 15, 1, 400);
  trackedText(ctx, hint, x + (CARD.w - hw) / 2, y + CARD.h - 30, 15, 'rgba(122,116,104,0.95)', 1, 400);

  ctx.restore();

  // 整张卡都是关闭区（点哪都关）
  return [{ x, y, w: CARD.w, h: CARD.h, label: '', kind: 'ghost', id: 'mechOk' }];
}
