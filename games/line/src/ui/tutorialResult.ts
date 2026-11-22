/**
 * 引导关的结算页。
 *
 * ## 为什么不用正式关的 `drawResult`
 *
 * 正式结算页要展示「步数 / 最短 / 用时 / 星级 / 解锁皮肤 / 分享」——
 * 这些在引导关**全都没有意义**（引导关不记成绩、不给星、不发皮肤）。
 * 硬套的话屏幕上会出现一排 0 和一个空星槽，新玩家第一眼就看到"我打了 0 分"。
 *
 * 所以这一页只做一件事：**确认他学会了，然后往下一关走**。
 *
 * ## 版式沿用适龄提示
 *
 * 同一套卡片（`P` 色板 + `roundRect` + 半透明描边）、同一个按钮画法。
 * 不新造视觉语言 —— 玩家在启动第一屏见过这个卡片，引导结算再用一次，
 * 两件事在他心里自动归到"系统提示"这一类，不会被当成游戏内容。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedWidth, type Button } from './hud';

const P = {
  ink: '#E4EDE6',
  muted: '#7A7468',
  gold: '#D4AF6A',
  goldHi: '#FFF3D6',
  cellBg: 'rgba(22,36,30,0.96)',
  cellBorder: 'rgba(147,179,162,0.18)',
} as const;

const CARD = { w: 622, h: 640, r: 36 };
const PAD = 48;

export interface TutorialResultState {
  /** 第几步（1..total） */
  step: number;
  total: number;
  /** 这一关的标题（「一条线，铺满它」） */
  title: string;
  /** 这一关教的两行规则（与关卡定义同一份文案） */
  lines: [string, string];
  /** 是否是最后一关 */
  isLast: boolean;
}

/** 居中的字距文本。 */
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

/**
 * 画引导结算。
 *
 * @returns 按钮列表（`tutorialNext` / `tutorialHome`）
 */
export function drawTutorialResult(
  ctx: CanvasRenderingContext2D,
  st: TutorialResultState,
): Button[] {
  const cx = DESIGN_W / 2;
  const x = cx - CARD.w / 2;
  const y = (DESIGN_H - CARD.h) / 2;

  // ── 遮罩：与适龄提示同一档压暗 ──
  ctx.fillStyle = 'rgba(6,12,9,0.78)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // ── 卡片 ──
  roundRect(ctx, x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = P.cellBg;
  ctx.fill();
  ctx.strokeStyle = P.cellBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── 进度 ──
  centered(ctx, `引 导  ${st.step} / ${st.total}`, y + 86, 22, P.muted, 5, 600);

  // ── 学会了的标题 ──
  //
  // 直接用这一关的标题（「一条线，铺满它」）：玩家刚在盘上做过这件事，
  // 看到同一句话会有「啊，原来这叫这个」的确认感。
  // 不用「太棒了！」这种没有信息量的鼓励 —— 那是给三岁小孩的。
  centered(ctx, st.title, y + 170, 38, P.ink, 2, 600);

  // ── 分隔线 ──
  ctx.fillStyle = 'rgba(147,179,162,0.16)';
  ctx.fillRect(x + PAD, y + 208, CARD.w - PAD * 2, 1.5);

  // ── 两行规则复述 ──
  //
  // 复述而不是夸。玩家之后卡住时，脑子里留下的应该是这两句。
  st.lines.forEach((line, i) => {
    centered(ctx, line, y + 272 + i * 44, 21, P.ink, 1.2, 400);
  });

  // ── 三格进度点 ──
  //
  // 比文字更快回答「还有几关」。
  const dotY = y + 396;
  const dotGap = 40;
  const startX = cx - ((st.total - 1) * dotGap) / 2;
  for (let i = 0; i < st.total; i++) {
    const done = i < st.step;
    ctx.beginPath();
    ctx.arc(startX + i * dotGap, dotY, done ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = done ? P.gold : 'rgba(147,179,162,0.28)';
    ctx.fill();
  }

  // ── 主按钮 ──
  const bh = 84;
  const by = y + CARD.h - PAD - bh;
  const bw = CARD.w - PAD * 2;
  roundRect(ctx, x + PAD, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(79,122,102,0.92)';
  ctx.fill();

  const label = st.isLast ? '开 始 征 途' : '下 一 关';
  const lw = trackedWidth(ctx, label, 24, 6, 600);
  trackedText(ctx, label, x + PAD + (bw - lw) / 2, by + bh / 2 + 9, 24, P.goldHi, 6, 600);

  const id = st.isLast ? 'tutorialHome' : 'tutorialNext';
  return [{ x: x + PAD, y: by, w: bw, h: bh, label: '', kind: 'ghost', id }];
}
