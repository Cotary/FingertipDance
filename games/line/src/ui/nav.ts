/**
 * 底部导航栏。主页 / 地图 / 皮肤 / 排行 / 我的 五个 Tab。
 * 深色玻璃背板 + 选中态糖果果冻胶囊，全部 Canvas 绘制，零 DOM。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { CANDY } from './theme';
import { jelly, strokeText } from './draw';

/** 导航页签。 */
export type NavTab = 'home' | 'map' | 'skins' | 'rank' | 'profile';

/** 全部页签，顺序即显示顺序。 */
export const NAV_TABS: NavTab[] = ['home', 'map', 'skins', 'rank', 'profile'];

/** 每个页签的文案。 */
export const NAV_LABELS: Record<NavTab, string> = {
  home: '主页',
  map: '地图',
  skins: '皮肤',
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
 */
export function drawNav(ctx: CanvasRenderingContext2D, active: NavTab, now: number): void {
  // 栏上方的柔和过渡（避免背板出现硬边）
  const fade = ctx.createLinearGradient(0, NAV_TOP - 46, 0, NAV_TOP);
  fade.addColorStop(0, 'rgba(10,6,32,0)');
  fade.addColorStop(1, 'rgba(10,6,32,0.88)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, NAV_TOP - 46, DESIGN_W, 46);

  // 背板
  ctx.fillStyle = 'rgba(14,9,44,0.94)';
  ctx.fillRect(0, NAV_TOP, DESIGN_W, NAV_H);

  // 顶部边光
  const edge = ctx.createLinearGradient(0, NAV_TOP, DESIGN_W, NAV_TOP);
  edge.addColorStop(0, 'rgba(255,255,255,0.04)');
  edge.addColorStop(0.5, 'rgba(255,255,255,0.26)');
  edge.addColorStop(1, 'rgba(255,255,255,0.04)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, NAV_TOP, DESIGN_W, 2);

  navHitAreas().forEach((h, i) => {
    const cx = h.x + h.w / 2;
    const on = h.tab === active;
    const iconY = NAV_TOP + 38;
    const labelY = NAV_TOP + 93;

    // 选中态：糖果胶囊 + 果冻体积
    if (on) {
      jelly(ctx, cx - 38, NAV_TOP + 6, 76, 64, CANDY.blue, { radius: 24, depth: 5 });
    }

    // 图标
    ctx.save();
    ctx.translate(cx, iconY + (on ? -4 : 0));
    drawNavIcon(ctx, h.tab, on ? '#FFFFFF' : 'rgba(255,255,255,0.55)', now + i * 120, on);
    ctx.restore();

    // 文案
    strokeText(ctx, NAV_LABELS[h.tab], cx, labelY, on ? 23 : 21, {
      weight: on ? 800 : 600,
      fill: on ? '#FFFFFF' : 'rgba(214,210,255,0.62)',
      stroke: on ? CANDY.blue.dark : undefined,
      strokeWidth: 4,
    });
  });
}

/**
 * 画一个导航图标（以原点为中心，约 44×44）。粗线条 + 圆头端点。
 * @param now 预留给动效的相位参数（各页签错开）
 * @param strong 选中态：线条更粗
 */
function drawNavIcon(
  ctx: CanvasRenderingContext2D,
  tab: NavTab,
  color: string,
  now: number,
  strong: boolean,
): void {
  // 极轻微的呼吸，避免导航栏完全静止（幅度足够小，不干扰阅读）
  const breath = 1 + Math.sin(now / 700) * 0.02;

  ctx.save();
  ctx.scale(breath, breath);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = strong ? 5 : 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (tab) {
    case 'home': {
      // 房子：实心屋顶 + 屋身 + 门洞
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(17, 1);
      ctx.lineTo(-17, 1);
      ctx.closePath();
      ctx.fill();
      roundRect(ctx, -12, 2, 24, 15, 5);
      ctx.fill();
      break;
    }
    case 'map': {
      // 路线：折线 + 三个节点
      ctx.beginPath();
      ctx.moveTo(-14, 14);
      ctx.lineTo(-4, -2);
      ctx.lineTo(6, 8);
      ctx.lineTo(15, -12);
      ctx.stroke();
      for (const [x, y] of [[-14, 14], [15, -12]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, strong ? 5 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'skins': {
      // 皮肤：2×2 圆角方块（代表色板）
      for (const [x, y] of [[-12, -12], [3, -12], [-12, 3], [3, 3]] as const) {
        roundRect(ctx, x, y, 10, 10, 3);
        ctx.fill();
      }
      break;
    }
    case 'rank': {
      // 奖杯：杯身 + 杯柄 + 底座
      ctx.beginPath();
      ctx.moveTo(-11, -14);
      ctx.lineTo(11, -14);
      ctx.lineTo(9, -3);
      ctx.quadraticCurveTo(0, 5, -9, -3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-11, -9, 5.5, Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(11, -9, 5.5, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillRect(-3, 4, 6, 6);
      roundRect(ctx, -9, 11, 18, 5, 2.5);
      ctx.fill();
      break;
    }
    case 'profile': {
      // 人像：头 + 肩
      ctx.beginPath();
      ctx.arc(0, -8, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 16);
      ctx.quadraticCurveTo(0, -1, 14, 16);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
