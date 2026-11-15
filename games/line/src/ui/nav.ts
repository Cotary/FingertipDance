/**
 * 底部导航栏。主页 / 地图 / 主题 / 排行 / 我的 五个 Tab。
 *
 * 定稿版：一条**发丝金线 + 半透墨条**，五个细线图标（描边 1.5 CSS、不填充），
 * 选中项只靠**颜色**（金 → 素纸灰）区分，没有底板、没有翘起的石片。
 *
 * 为什么删掉那块「陶土片」：底栏是全局 chrome，一旦某页内容也是深色石卡，
 * 底栏再压一块亮板就会把视线从内容抢走；导航只需要「在哪」和「能去哪」。
 * 全部 Canvas 绘制，零 DOM。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import type { ThemeChrome } from '../render/themes/types';
import { trackedText, trackedWidth } from './hud';

/** 导航页签。 */
export type NavTab = 'home' | 'map' | 'skins' | 'rank' | 'profile';

/** 全部页签，顺序即显示顺序。 */
export const NAV_TABS: NavTab[] = ['home', 'map', 'skins', 'rank', 'profile'];

/** 每个页签的文案。 */
export const NAV_LABELS: Record<NavTab, string> = {
  home: '主页',
  map: '地图',
  skins: '主题',
  rank: '排行',
  profile: '我的',
};

/** 导航栏高度（设计坐标系）。 */
export const NAV_H = 120;

/** 导航栏顶部 y。 */
export const NAV_TOP = DESIGN_H - NAV_H;

/** 单个页签宽度。 */
export const NAV_ITEM_W = DESIGN_W / NAV_TABS.length;

/** 一个页签的命中矩形。 */
export interface NavHit {
  tab: NavTab;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 计算所有页签的命中矩形。 */
export function navHitAreas(): NavHit[] {
  return NAV_TABS.map((tab, i) => ({
    tab,
    x: i * NAV_ITEM_W,
    y: NAV_TOP,
    w: NAV_ITEM_W,
    h: NAV_H,
  }));
}

/**
 * 判断点击落在哪个页签上。
 * @returns 页签名，没命中返回 null
 */
export function pickNavTab(x: number, y: number): NavTab | null {
  for (const h of navHitAreas()) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.tab;
  }
  return null;
}

/**
 * 绘制底部导航栏。
 * @param active 当前页签
 * @param now 当前时间戳（ms），用于图标动画
 * @param _chrome 保留参数：定稿底栏不再跟随主题换色（chrome 只换棋盘）
 */
export function drawNav(
  ctx: CanvasRenderingContext2D,
  active: NavTab,
  now: number,
  _chrome?: ThemeChrome,
): void {
  // 内容滚到栏下的渐隐：栏是「浮」在内容上的，所以影子朝上
  const fade = ctx.createLinearGradient(0, NAV_TOP - 36, 0, NAV_TOP);
  fade.addColorStop(0, 'rgba(6,10,8,0)');
  fade.addColorStop(1, 'rgba(6,10,8,0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, NAV_TOP - 36, DESIGN_W, 36);

  // 墨条：半透，让地面极缓的明暗还能透上来一点（纯色会像贴了一条胶带）
  ctx.fillStyle = 'rgba(10,16,13,0.82)';
  ctx.fillRect(0, NAV_TOP, DESIGN_W, NAV_H);

  // 顶部发丝金线（1 CSS → 2）
  ctx.fillStyle = 'rgba(212,175,106,0.14)';
  ctx.fillRect(0, NAV_TOP, DESIGN_W, 2);

  navHitAreas().forEach((h, i) => {
    const cx = h.x + h.w / 2;
    const on = h.tab === active;
    const color = on ? '#F2DCA8' : '#7A7468';

    // 未选中项压到 88%：五个栏位都亮着就没有「当前在哪」了
    ctx.save();
    if (!on) ctx.globalAlpha = 0.88;
    drawNavIcon(ctx, h.tab, cx, NAV_TOP + 41, color, on, now + i * 140);
    ctx.restore();

    const label = NAV_LABELS[h.tab];
    trackedText(
      ctx,
      label,
      cx - trackedWidth(ctx, label, 19, 3.8, on ? 600 : 500) / 2,
      NAV_TOP + 97,
      19,
      color,
      3.8,
      on ? 600 : 500,
    );
  });
}

/**
 * 画一个导航图标：设计稿的 24 格线性图标，等比放大到 44。
 *
 * 一律**描边不填充**（fill:none / stroke-width:1.5），圆头端点 ——
 * 实心块在深色底上会糊成一团，细线才撑得住「精致」这两个字。
 */
function drawNavIcon(
  ctx: CanvasRenderingContext2D,
  tab: NavTab,
  cx: number,
  cy: number,
  color: string,
  strong: boolean,
  now: number,
): void {
  // 极轻微的呼吸，避免底栏完全静止（幅度小到不干扰阅读）
  const breath = 1 + Math.sin(now / 900) * 0.012;
  const s = (44 / 24) * breath;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-12, -12);
  ctx.strokeStyle = color;
  ctx.lineWidth = (strong ? 1.75 : 1.6) / breath;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (tab) {
    case 'home': {
      // 房子：屋顶 + 屋身，门洞留白（一笔闭合）
      ctx.beginPath();
      ctx.moveTo(4, 11);
      ctx.lineTo(12, 4);
      ctx.lineTo(20, 11);
      ctx.lineTo(20, 20);
      ctx.lineTo(14, 20);
      ctx.lineTo(14, 15);
      ctx.lineTo(10, 15);
      ctx.lineTo(10, 20);
      ctx.lineTo(4, 20);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'map': {
      // 折起来的地图：外轮廓 + 两道折痕
      ctx.beginPath();
      ctx.moveTo(9, 4);
      ctx.lineTo(3, 6);
      ctx.lineTo(3, 20);
      ctx.lineTo(9, 18);
      ctx.lineTo(15, 20);
      ctx.lineTo(21, 18);
      ctx.lineTo(21, 4);
      ctx.lineTo(15, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(9, 4);
      ctx.lineTo(9, 18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(15, 6);
      ctx.lineTo(15, 20);
      ctx.stroke();
      break;
    }
    case 'skins': {
      // 主题：一只瓷盘 + 盘心一道釉（圆心不在正中，才像笔意）
      ctx.beginPath();
      ctx.arc(12, 12, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12, 8, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12, 5.5, Math.PI / 2, -Math.PI / 2, true);
      ctx.stroke();
      break;
    }
    case 'rank': {
      // 排行：三根立柱 + 一条基线（不封口，留呼吸）
      ctx.beginPath();
      ctx.moveTo(6, 20);
      ctx.lineTo(6, 12);
      ctx.lineTo(10, 12);
      ctx.lineTo(10, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, 20);
      ctx.lineTo(10, 7);
      ctx.lineTo(14, 7);
      ctx.lineTo(14, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, 20);
      ctx.lineTo(14, 10);
      ctx.lineTo(18, 10);
      ctx.lineTo(18, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4, 20);
      ctx.lineTo(20, 20);
      ctx.stroke();
      break;
    }
    case 'profile': {
      // 人像：头 + 肩（肩是一条弧，不是实心块）
      ctx.beginPath();
      ctx.arc(12, 8.5, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 20);
      ctx.quadraticCurveTo(5, 13, 12, 13);
      ctx.quadraticCurveTo(19, 13, 19, 20);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
