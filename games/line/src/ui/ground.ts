/**
 * 大厅底色 —— 「秘色·天青」的案上墨。
 *
 * ## 为什么不再用黏土桌面
 *
 * 旧版全站铺的是「陶土工作台」：奶油色竖向渐变 + 左上大范围暖光。
 * 那套底色是为糖果黏土棋子设计的（暖底托暖件），
 * 一旦棋盘换成墨石 + 青瓷 + 鎏金，暖底立刻变成脏灰 ——
 * 深色卡片浮在一层发亮的米色雾上，怎么调卡片都「不高级」。
 *
 * 定稿七屏的地面是**同一块墨**：近黑的青灰、顶部一线金晕、底部压暗。
 * 页面上的所有材质（石卡、票券、金 CTA）都靠这层暗底才立得住。
 *
 * ## 三条约束
 *
 * 1. **只有渐变，没有纹理**：噪点每帧重绘在微信端是白烧电量；
 *    而且 750 宽下噪点根本看不见，只会让截图显脏。
 * 2. **顶部金晕极淡（≤0.07）**：它是「一盏灯」不是「一束光」，
 *    再亮就会在票券上方压出一条黄边。
 * 3. **必须铺满可视范围**：等比缩放后上下/左右会留白（见 `visibleDesignBox`），
 *    只铺 750×1334 会在屏幕上留下一道接缝。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import type { BackdropBox } from './clay';
import { fillGrain } from '../render/grain';

/** 大厅地面主色（定稿设计稿的 --phone-bg / --well 区间）。 */
export const GROUND = {
  /** 顶部：墨玉偏青 */
  top: '#0F1A16',
  /** 中段：整屏基调 */
  mid: '#0C1310',
  /** 底部：压到近黑，让底栏沉下去 */
  bottom: '#080E0B',
} as const;

/**
 * 画大厅底色。
 * @param box 可视范围（设计坐标），缺省为整块画布
 */
export function drawLobbyGround(ctx: CanvasRenderingContext2D, box?: BackdropBox): void {
  const bx = box?.x ?? 0;
  const by = box?.y ?? 0;
  const bw = box?.w ?? DESIGN_W;
  const bh = box?.h ?? DESIGN_H;

  // 1. 基底：上青下墨
  const g = ctx.createLinearGradient(0, by, 0, by + bh);
  g.addColorStop(0, GROUND.top);
  g.addColorStop(0.52, GROUND.mid);
  g.addColorStop(1, GROUND.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, bw, bh);

  // 2. 顶灯：金晕落在屏幕中线偏上，半径远大于屏宽 —— 只留最亮的一小片
  const hx = bx + bw / 2;
  const hy = by - bh * 0.06;
  const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, bw * 1.15);
  halo.addColorStop(0, 'rgba(212,175,106,0.075)');
  halo.addColorStop(0.45, 'rgba(212,175,106,0.022)');
  halo.addColorStop(1, 'rgba(212,175,106,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(bx, by, bw, bh);

  // 3. 中段一口气：极淡的青瓷反光，避免整屏读作「一块黑」
  const cy = by + bh * 0.30;
  const celadon = ctx.createRadialGradient(hx, cy, 0, hx, cy, bw * 0.72);
  celadon.addColorStop(0, 'rgba(110,158,130,0.055)');
  celadon.addColorStop(1, 'rgba(110,158,130,0)');
  ctx.fillStyle = celadon;
  ctx.fillRect(bx, by, bw, bh);

  // 4. 底部压暗：底栏要能「沉」进地面，而不是浮在渐变上
  const bottom = ctx.createLinearGradient(0, by + bh * 0.58, 0, by + bh);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = bottom;
  ctx.fillRect(bx, by + bh * 0.58, bw, bh * 0.42);

  // 5. 极细颗粒：暗底最怕「塑料感」，一层 5% 的砂把光吃散（设计稿的 feTurbulence）
  fillGrain(ctx, bx, by, bw, bh, 0.05);

  // 6. 左右暗角：竖屏两肋不需要信息，压暗后视线自然收回中间
  for (const side of [0, 1]) {
    const cxx = side === 0 ? bx : bx + bw;
    const vig = ctx.createRadialGradient(cxx, by + bh * 0.42, 0, cxx, by + bh * 0.42, bw * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0.22)');
    vig.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vig;
    ctx.fillRect(bx, by, bw, bh);
  }
}
