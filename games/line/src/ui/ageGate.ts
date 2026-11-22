/**
 * 适龄提示弹层。
 *
 * ## 为什么必须有
 *
 * 微信小游戏审核要求启动时给出**适龄提示**（未成年人保护的一项）。
 * 缺这一块的表现不是崩溃，而是提审被拒 —— 而拒一次要重新排队，
 * 比补一个卡片贵得多。
 *
 * ## 什么时候显示
 *
 * - **首次启动**（本地没有标记）自动弹一次；
 * - 之后从「我的 → 适龄提示」可再次打开。
 *
 * 不做成每次启动都弹：那是一条"每次都要点掉的拦路虎"，
 * 玩家第三次就会开始烦，而合规只要求"给出提示"，没要求"每次确认"。
 *
 * ## 与隐私授权的分工
 *
 * 这里是**信息告知**（不收集任何东西、不需要同意），
 * 真正的隐私授权走 `platform/privacy.ts` 的官方弹窗。
 * 两者不要合并成一个弹层 —— 合规弹窗必须由平台渲染，条款才完整。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedWidth, type Button } from './hud';

/** 色板与 `statsPanel.ts` / `profile.ts` 同源（深瓷底 + 金）。 */
const P = {
  ink: '#E4EDE6',
  muted: '#7A7468',
  gold: '#D4AF6A',
  goldHi: '#FFF3D6',
  cellBg: 'rgba(22,36,30,0.96)',
  cellBorder: 'rgba(147,179,162,0.18)',
} as const;

const CARD = { w: 622, h: 760, r: 36 };
const PAD = 48;

/** 适龄结论。写成常量，方便以后按审核意见改档。 */
export const AGE_RATING = '8+';
export const AGE_LINES = [
  '本游戏为单人益智解谜，适合 8 周岁及以上用户。',
  '未满 16 周岁的未成年人请在家长陪同下使用。',
  '游戏内含广告，点击前会明确提示。',
];

/** 本地「已看过适龄提示」的存储键。 */
export const KEY_AGE_ACK = 'age_gate_ack';

/**
 * 绘制适龄提示弹层。
 *
 * @param hasPrivacy 是否显示「隐私保护指引」入口（只有微信端有原文可打开）
 * @returns 可点击按钮（遮罩 / 我知道了 / 隐私指引）
 */
export function drawAgeGate(ctx: CanvasRenderingContext2D, hasPrivacy: boolean): Button[] {
  const cx = DESIGN_W / 2;
  const x = cx - CARD.w / 2;
  const y = (DESIGN_H - CARD.h) / 2;

  // ── 遮罩：与战绩弹层同一档压暗 ──
  ctx.fillStyle = 'rgba(6,12,9,0.78)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // ── 卡片 ──
  roundRect(ctx, x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = P.cellBg;
  ctx.fill();
  ctx.strokeStyle = P.cellBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── 标题 ──
  centered(ctx, '适 龄 提 示', y + 92, 34, P.ink, 8.2, 600);
  ctx.fillStyle = 'rgba(147,179,162,0.16)';
  ctx.fillRect(x + PAD, y + 122, CARD.w - PAD * 2, 1.5);

  // ── 年龄徽标：一枚金环 + 8+ ──
  //
  // 文字比图形更快被读到，所以把「8+」做成最大的一处，
  // 审核一眼能看到档位，玩家也知道这游戏是给多大的孩子玩的。
  const badgeCY = y + 228;
  ctx.beginPath();
  ctx.arc(cx, badgeCY, 58, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(212,175,106,0.10)';
  ctx.fill();
  ctx.strokeStyle = P.gold;
  ctx.lineWidth = 3;
  ctx.stroke();

  centered(ctx, AGE_RATING, badgeCY + 17, 52, P.goldHi, 2, 600);
  centered(ctx, '周岁及以上', badgeCY + 92, 19, P.muted, 4.2, 400);

  // ── 正文三行 ──
  AGE_LINES.forEach((line, i) => {
    centered(ctx, line, y + 386 + i * 46, 20, P.ink, 1.2, 400);
  });

  const buttons: Button[] = [];

  // ── 隐私指引入口（微信端才有原文可打开）──
  //
  // 位置由「第三行正文 + 一行行距」推出。初版写的是 `y + 500`，
  // 而第三行基线是 `y + 478` —— 只差 22，两条字直接贴在一起
  // （渲染出来「游戏内含广告…」下面紧贴着「《隐私保护指引》」）。
  let linkY = y + 386 + AGE_LINES.length * 46;
  if (hasPrivacy) {
    const label = '《隐私保护指引》';
    const w = trackedWidth(ctx, label, 19, 1.2, 400);
    trackedText(ctx, label, cx - w / 2, linkY, 19, P.gold, 1.2, 400);
    buttons.push({ x: cx - w / 2 - 12, y: linkY - 24, w: w + 24, h: 40, label: '', kind: 'ghost', id: 'ageGatePrivacy' });
  }

  // ── 主按钮 ──
  //
  // 高度与战绩弹层的「关闭」一致（84），位置贴着卡片底部推 ——
  // 上面少一行/多一行都不会把它挤到卡外。
  const bh = 84;
  const by = y + CARD.h - PAD - bh;
  const bw = CARD.w - PAD * 2;
  roundRect(ctx, x + PAD, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(79,122,102,0.92)';
  ctx.fill();

  const okLabel = '我 知 道 了';
  const okW = trackedWidth(ctx, okLabel, 24, 6, 600);
  trackedText(ctx, okLabel, x + PAD + (bw - okW) / 2, by + bh / 2 + 9, 24, '#F2EEE6', 6, 600);
  buttons.push({ x: x + PAD, y: by, w: bw, h: bh, label: '', kind: 'ghost', id: 'ageGateOk' });

  // 遮罩本身也算按钮（点卡外 = 我知道了），与战绩弹层同一个约定
  buttons.push({ x: 0, y: 0, w: DESIGN_W, h: DESIGN_H, label: '', kind: 'ghost', id: 'ageGateOk' });

  return buttons;
}

/** 居中的字距文本（`trackedText` 是左对齐的，居中要自己反推左沿）。 */
function centered(
  ctx: CanvasRenderingContext2D,
  text: string,
  baselineY: number,
  size: number,
  color: string,
  spacing: number,
  weight: number,
): void {
  const w = trackedWidth(ctx, text, size, spacing, weight);
  trackedText(ctx, text, DESIGN_W / 2 - w / 2, baselineY, size, color, spacing, weight);
}
