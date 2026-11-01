/**
 * 底部导航栏。主页 / 地图 / 皮肤 / 排行 / 我的 五个 Tab。
 * 全部 Canvas 绘制，零 DOM。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { LOBBY_THEME } from './theme';

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
  const t = LOBBY_THEME;

  // 背板 + 顶部投影
  ctx.fillStyle = t.shadow;
  ctx.fillRect(0, NAV_TOP - 8, DESIGN_W, 8);
  ctx.fillStyle = t.bgLight;
  ctx.fillRect(0, NAV_TOP, DESIGN_W, NAV_H);

  // 顶部分隔线
  ctx.fillStyle = t.border;
  ctx.fillRect(0, NAV_TOP, DESIGN_W, 2);

  navHitAreas().forEach((h, i) => {
    const cx = h.x + h.w / 2;
    const on = h.tab === active;
    const iconY = NAV_TOP + 44;
    const labelY = NAV_TOP + 92;

    // 选中项：浅蓝圆角底 + 轻微上浮
    if (on) {
      ctx.fillStyle = 'rgba(61,123,255,0.12)';
      roundRect(ctx, cx - 38, iconY - 30, 76, 68, 22);
      ctx.fill();
    }

    // 图标
    ctx.save();
    ctx.translate(cx, iconY + (on ? -3 : 0));
    drawNavIcon(ctx, h.tab, on ? t.blue : t.subText, now + i * 120);
    ctx.restore();

    // 文案
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = on ? t.blue : t.subText;
    ctx.font = on ? '600 24px system-ui, sans-serif' : '22px system-ui, sans-serif';
    ctx.fillText(NAV_LABELS[h.tab], cx, labelY);
  });
}

/**
 * 画一个导航图标（以原点为中心，约 44×44）。
 * @param now 预留给动效的相位参数（各页签错开）
 */
function drawNavIcon(ctx: CanvasRenderingContext2D, tab: NavTab, color: string, now: number): void {
  // 用相位做极轻微的呼吸，避免导航栏完全静止（幅度足够小，不干扰阅读）
  const breath = 1 + Math.sin(now / 700) * 0.02;

  ctx.save();
  ctx.scale(breath, breath);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (tab) {
    case 'home': {
      // 房子：三角屋顶 + 方形屋身
      ctx.beginPath();
      ctx.moveTo(-16, 2);
      ctx.lineTo(0, -14);
      ctx.lineTo(16, 2);
      ctx.stroke();
      ctx.fillRect(-11, 2, 22, 16);
      break;
    }
    case 'map': {
      // 路线：折线 + 四个节点
      ctx.beginPath();
      ctx.moveTo(-14, 14);
      ctx.lineTo(-4, -4);
      ctx.lineTo(6, 6);
      ctx.lineTo(15, -12);
      ctx.stroke();
      for (const [x, y] of [[-14, 14], [-4, -4], [6, 6], [15, -12]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'skins': {
      // 皮肤：2×2 圆角方块
      for (const [x, y] of [[-11, -11], [3, -11], [-11, 3], [3, 3]] as const) {
        roundRect(ctx, x, y, 9, 9, 2);
        ctx.fill();
      }
      break;
    }
    case 'rank': {
      // 奖杯：杯身 + 底座 + 把手
      ctx.beginPath();
      ctx.moveTo(-10, -14);
      ctx.lineTo(10, -14);
      ctx.lineTo(8, -2);
      ctx.quadraticCurveTo(0, 6, -8, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-3, 4, 6, 6);
      ctx.fillRect(-9, 10, 18, 4);
      // 把手
      ctx.beginPath();
      ctx.arc(-10, -9, 5, Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(10, -9, 5, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      break;
    }
    case 'profile': {
      // 人像：头 + 肩
      ctx.beginPath();
      ctx.arc(0, -8, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-13, 16);
      ctx.quadraticCurveTo(0, -2, 13, 16);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
