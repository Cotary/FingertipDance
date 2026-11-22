/**
 * 冷启动画面。
 *
 * ## 为什么必须有
 *
 * `boot()` 里要串行等四件事：隐私授权 → 登录 → 服务端配置 → 关卡表。
 * 弱网下加起来能有几秒，而这几秒里 `phase === 'loading'` 没有任何绘制分支
 * —— 玩家看到的是**纯色背景一动不动**。小游戏审核对这种「点了没反应」的
 * 判定很直接：加载失败。玩家也一样，会以为游戏卡死然后退出去。
 *
 * 所以这里只做一件事：让屏幕**在动**，并且明确告诉玩家在准备什么。
 * 不显示百分比 —— 四步里三步是网络请求，编一个"37%"比不给更糟。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { trackedText, trackedWidth } from './hud';

/** 与首页同一套定稿色板（墨石底上的玉色字 + 鎏金品牌字）。 */
const C = {
  jade: '#E4EDE6',
  muted: 'rgba(122,116,104,0.85)',
  gold: '#D4AF6A',
} as const;

/** 三点呼吸的周期与相位差（ms）。 */
const DOT_PERIOD = 1200;
const DOT_GAP = 220;

export function drawBootSplash(ctx: CanvasRenderingContext2D, now: number): void {
  const cx = DESIGN_W / 2;

  // ── 品牌字 ──
  //
  // 和首页右上角那行是同一个词。启动页只放它，不放「无尽征途」：
  // 玩家还没进游戏，先给品牌，不给玩法文案。
  const brand = '秘 色 · 天 青';
  const bw = trackedWidth(ctx, brand, 26, 6, 600);
  trackedText(ctx, brand, cx - bw / 2, DESIGN_H * 0.44, 26, C.gold, 6, 600);

  // ── 状态行 ──
  //
  // 文字和三点**各自居中**：把点挂在文字右边会让「正在准备」整体左偏，
  // 和上面的品牌字错开半个字，读起来像是排版没对齐。
  const tip = '正在准备';
  const tw = trackedWidth(ctx, tip, 20, 3.6, 500);
  const tipY = DESIGN_H * 0.44 + 76;
  trackedText(ctx, tip, cx - tw / 2, tipY, 20, C.muted, 3.6, 500);

  // ── 三点呼吸 ──
  //
  // 三个点同相位会在某一瞬间全部熄灭，读起来像"停了"；
  // 错开 220ms 才是连续的一口气。
  const dotR = 5;
  const dotGap = 24;
  const dotsY = tipY + 40;
  const dotsX = cx - dotGap; // 三个点跨 2*gap，居中就是从中点往左退一格
  for (let i = 0; i < 3; i++) {
    const phase = ((now + i * DOT_GAP) % DOT_PERIOD) / DOT_PERIOD;
    // 0 → 1 → 0 的三角波，最暗留 0.18（全灭那一帧会看成掉帧）
    const alpha = 0.18 + 0.82 * (1 - Math.abs(phase * 2 - 1));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.jade;
    ctx.beginPath();
    ctx.arc(dotsX + i * dotGap, dotsY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
