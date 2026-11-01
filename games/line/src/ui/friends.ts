/**
 * 好友榜：好友进度统计面板 + 好友榜（开放数据域）。全部 Canvas 绘制。
 * `drawFriendsBoard` 被排行榜页的好友榜 Tab 复用。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, type Button } from './hud';
import { getOpenDataCanvas } from '../platform/openData';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayText, type ClayColor } from './clay';
import type { FriendItem, FriendStats } from '../net/api';

/** 好友页状态。 */
export interface FriendsPageState {
  /** 服务端好友列表 */
  friends: FriendItem[];
  /** 统计 */
  stats: FriendStats;
  /** 我的名次（1-based），0 = 未上榜 */
  myRank: number;
  /** 是否正在加载开放数据域 */
  loadingOpenData: boolean;
}

/** 统计面板高度。 */
const PANEL_H = 180;

/** 统计面板到榜单顶部的间距。 */
const PANEL_TO_BOARD = 210;

/**
 * 绘制好友统计面板 + 好友榜区域（不含背景与标题）。
 * @param topY 区域顶部 y
 * @param height 区域高度
 */
export function drawFriendsBoard(
  ctx: CanvasRenderingContext2D,
  st: FriendsPageState,
  topY: number,
  height: number,
): void {
  // ── 统计面板：一块奶油黏土板，压在桌面上 ──
  const panelY = topY;
  clayBlock(ctx, 40, panelY, DESIGN_W - 80, PANEL_H, 28, CLAY.cream, 541, { depth: 11, hi: 0.045 });

  // 两列在 670 宽里严格对称（旧版 150/450 + 分隔线 300 是偏的）
  const COL_L = 40 + (DESIGN_W - 80) / 4;
  const COL_R = 40 + ((DESIGN_W - 80) * 3) / 4;

  const statItems: Array<{ label: string; value: string; c: ClayColor }> = [
    { label: '好友数', value: String(st.stats.friendCount), c: CLAY.blue },
    { label: '好友平均进度', value: `${st.stats.avgLevel} 关`, c: CLAY.mint },
    { label: '好友最高进度', value: `${st.stats.maxLevel} 关`, c: CLAY.terracotta },
    { label: '我的名次', value: st.myRank > 0 ? `第 ${st.myRank} 名` : '未上榜', c: CLAY.mustard },
  ];
  statItems.forEach((s, i) => {
    const x = i % 2 === 0 ? COL_L : COL_R;
    const y = panelY + 46 + Math.floor(i / 2) * 64;
    clayText(ctx, s.label, x, y, 21, {
      weight: 600,
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
    clayText(ctx, s.value, x, y + 34, 32, {
      fill: s.c.dark,
      outlineWidth: 0,
      emboss: false,
    });
  });

  // 面板中间的隔断：一道压进黏土的细缝
  ctx.strokeStyle = CLAY.sand.shade;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(DESIGN_W / 2, panelY + 30);
  ctx.lineTo(DESIGN_W / 2, panelY + PANEL_H - 30);
  ctx.stroke();

  // ── 好友榜 ──
  const boardY = panelY + PANEL_TO_BOARD;
  clayText(ctx, '好友榜', 40, boardY + 12, 28, {
    align: 'left',
    fill: CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
  });
  if (st.loadingOpenData) {
    clayText(ctx, '加载中…', DESIGN_W - 40, boardY + 12, 22, {
      weight: 600,
      align: 'right',
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
  }

  // 榜单区：从 boardY + 40 起，正好铺到 topY + height
  const boardBoxY = boardY + 40;
  const boardBoxH = Math.max(120, height - PANEL_TO_BOARD - 40);

  const od = getOpenDataCanvas();
  if (od) {
    try {
      ctx.drawImage(od.canvas, 40, boardBoxY, DESIGN_W - 80, boardBoxH);
    } catch {
      // 微信端首帧可能还没画好
    }
    return;
  }

  // Web 版用服务端好友列表兜底绘制
  clayBlock(ctx, 40, boardBoxY, DESIGN_W - 80, boardBoxH, 28, CLAY.cream, 542, { depth: 9, hi: 0.035 });
  const list = st.friends.slice(0, 12);
  if (list.length === 0) {
    clayText(ctx, '还没有好友，分享给好友一起来玩吧', DESIGN_W / 2, boardBoxY + boardBoxH / 2, 26, {
      weight: 600,
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
    return;
  }

  list.forEach((f, i) => {
    const y = boardBoxY + 40 + i * 52;
    if (y > boardBoxY + boardBoxH - 24) return;

    // 名次片：前三名金/蓝/陶土，其余沙色
    const medal = i === 0 ? CLAY.mustard : i === 1 ? CLAY.blue : i === 2 ? CLAY.terracotta : CLAY.sand;
    clayDisc(ctx, 82, y, 17, medal, 550 + i, { depth: 3, hi: i < 3 ? 0.16 : 0 });
    clayText(ctx, String(i + 1), 82, y, 18, {
      fill: i < 3 ? '#FFF6E9' : CLAY_UI.inkSoft,
      outline: i < 3 ? medal.shade : undefined,
      outlineWidth: i < 3 ? 3 : 0,
      emboss: false,
    });

    clayText(ctx, f.nickname || '玩家', 116, y, 24, {
      align: 'left',
      fill: CLAY_UI.ink,
      outlineWidth: 0,
      emboss: false,
    });
    clayText(ctx, `第 ${f.maxLevel} 关`, DESIGN_W - 70, y, 24, {
      weight: 600,
      align: 'right',
      fill: CLAY.terracotta.dark,
      outlineWidth: 0,
      emboss: false,
    });
  });
}

/**
 * 绘制独立好友页（标题 + 统计与榜单 + 返回）。
 * 排行榜页内嵌时不走这个函数，直接调 `drawFriendsBoard`。
 */
export function drawFriendsPage(ctx: CanvasRenderingContext2D, st: FriendsPageState): Button[] {
  clayText(ctx, '好友', DESIGN_W / 2, 76, 40, {
    fill: CLAY_UI.ink,
    outline: 'rgba(255,251,243,0.55)',
    outlineWidth: 6,
  });

  drawFriendsBoard(ctx, st, 130, 900);

  const back: Button = { x: 40, y: DESIGN_H - 220, w: 160, h: 72, label: '返回', kind: 'secondary', id: 'back' };
  drawButton(ctx, back, false);
  return [back];
}
