/**
 * 底部导航栏。主页 / 地图 / 皮肤 / 排行 / 我的 五个 Tab。
 *
 * 黏土版：奶油黏土板做底栏（顶部两角圆、左右圆角藏在屏幕外），
 * 选中项是一块**翘起来的陶土片**，把图标和文字一起包进去 —— 不再是发光的果冻胶囊。
 * 全部 Canvas 绘制，零 DOM。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { CLAY, CLAY_UI, clayBlock, clayText } from './clay';
import { clayFrom, type ThemeChrome } from '../render/themes/types';

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
export function drawNav(
  ctx: CanvasRenderingContext2D,
  active: NavTab,
  now: number,
  chrome?: ThemeChrome,
): void {
  // 主题色：底栏是「内容区的一部分」，深色主题下留一条奶油色板会像贴错了图。
  //
  // 三档色都从 chrome 取：
  // - `plate` 背板 ← `chrome.pill`（就是「板上的一块」，和关号胶囊同一个语义）
  // - `chip`  选中片 ← `chrome.primary`
  // - `inkOn` 选中字 ← `chrome.primaryInk`；`inkOff` 未选中 ← `chrome.pillInk`（压到 55%）
  //
  // 未选中不能用 `inkSoft`：它是「深色背景上的弱化正文」，浅色底上会直接消失。
  const plate = chrome ? clayFrom(chrome.pill) : CLAY.cream;
  const chip = chrome ? clayFrom(chrome.primary) : CLAY.terracotta;
  const inkOn = chrome ? chrome.primaryInk : '#FFF6E9';
  const inkOff = chrome ? chrome.pillInk : CLAY_UI.inkSoft;
  const offAlpha = chrome ? 0.55 : 1;

  // 内容区在导航上沿的落影（导航是浮在内容之上的，所以影子朝上）
  const fade = ctx.createLinearGradient(0, NAV_TOP - 40, 0, NAV_TOP);
  fade.addColorStop(0, 'rgba(74,51,39,0)');
  fade.addColorStop(1, chrome ? 'rgba(8,14,22,0.22)' : 'rgba(74,51,39,0.16)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, NAV_TOP - 40, DESIGN_W, 40);

  // 背板：横向外扩 40，让左右圆角藏在屏幕外，只留顶部两角
  clayBlock(ctx, -40, NAV_TOP - 6, DESIGN_W + 80, NAV_H + 80, 34, plate, 601, { depth: 0 });

  // 上沿一道浅色高光，把背板从内容区里「切」出来
  ctx.strokeStyle = 'rgba(255,251,243,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, NAV_TOP + 1.5);
  ctx.lineTo(DESIGN_W, NAV_TOP + 1.5);
  ctx.stroke();

  navHitAreas().forEach((h, i) => {
    const cx = h.x + h.w / 2;
    const on = h.tab === active;
    const iconY = NAV_TOP + 38;
    const labelY = NAV_TOP + 93;

    // 选中态：一整块翘起的陶土片（把图标和文字一起包住）
    if (on) {
      clayBlock(ctx, cx - 59, NAV_TOP + 6, 118, 106, 28, chip, 611 + i, { depth: 9 });
    }

    ctx.save();
    if (!on) ctx.globalAlpha = offAlpha;
    ctx.translate(cx, iconY + (on ? -3 : 0));
    drawNavIcon(ctx, h.tab, on ? inkOn : inkOff, now + i * 120, on);
    ctx.restore();

    ctx.save();
    if (!on) ctx.globalAlpha = offAlpha;
    clayText(ctx, NAV_LABELS[h.tab], cx, labelY, on ? 23 : 21, {
      weight: on ? 800 : 600,
      fill: on ? inkOn : inkOff,
      outline: on ? 'rgba(118,50,22,0.55)' : undefined,
      outlineWidth: on ? 4 : 0,
      emboss: false,
    });
    ctx.restore();
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
