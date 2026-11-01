/**
 * 好友榜：好友进度统计面板 + 好友榜（开放数据域）。全部 Canvas 绘制。
 * `drawFriendsBoard` 被排行榜页的好友榜 Tab 复用。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, type Button } from './hud';
import { getOpenDataCanvas } from '../platform/openData';
import { CANDY, THEME, type CandyColor } from './theme';
import { glass, strokeText } from './draw';
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
  // ── 统计面板 ──
  const panelY = topY;
  glass(ctx, 40, panelY, DESIGN_W - 80, PANEL_H, 28, { fill: 'rgba(255,255,255,0.10)' });

  const statItems: Array<{ label: string; value: string; c: CandyColor }> = [
    { label: '好友数', value: String(st.stats.friendCount), c: CANDY.blue },
    { label: '好友平均进度', value: `${st.stats.avgLevel} 关`, c: CANDY.green },
    { label: '好友最高进度', value: `${st.stats.maxLevel} 关`, c: CANDY.orange },
    { label: '我的名次', value: st.myRank > 0 ? `第 ${st.myRank} 名` : '未上榜', c: CANDY.gold },
  ];
  statItems.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 150 + col * 300;
    const y = panelY + 34 + row * 78;
    strokeText(ctx, s.label, x, y, 21, {
      weight: 600,
      fill: THEME.subText,
    });
    strokeText(ctx, s.value, x, y + 34, 32, {
      fill: s.c.light,
      stroke: 'rgba(8,4,30,0.45)',
      strokeWidth: 4,
    });
  });

  // 面板中间的分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(300, panelY + 26);
  ctx.lineTo(300, panelY + PANEL_H - 26);
  ctx.stroke();

  // ── 好友榜 ──
  const boardY = panelY + PANEL_TO_BOARD;
  strokeText(ctx, '好友榜', 40, boardY + 12, 28, {
    align: 'left',
    stroke: 'rgba(8,4,30,0.5)',
    strokeWidth: 5,
  });
  if (st.loadingOpenData) {
    strokeText(ctx, '加载中…', DESIGN_W - 40, boardY + 12, 22, {
      weight: 600,
      fill: THEME.subText,
      align: 'right',
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
  glass(ctx, 40, boardBoxY, DESIGN_W - 80, boardBoxH, 28, { fill: 'rgba(255,255,255,0.08)' });
  const list = st.friends.slice(0, 12);
  if (list.length === 0) {
    strokeText(ctx, '还没有好友，分享给好友一起来玩吧', DESIGN_W / 2, boardBoxY + boardBoxH / 2, 26, {
      weight: 600,
      fill: THEME.subText,
    });
    return;
  }

  list.forEach((f, i) => {
    const y = boardBoxY + 40 + i * 52;
    if (y > boardBoxY + boardBoxH - 24) return;

    // 名次糖果圆片
    const medal = i === 0 ? CANDY.gold : i === 1 ? CANDY.blue : i === 2 ? CANDY.orange : CANDY.purple;
    ctx.fillStyle = medal.dark;
    ctx.beginPath();
    ctx.arc(82, y + 2, 17, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createLinearGradient(82, y - 15, 82, y + 17);
    g.addColorStop(0, medal.light);
    g.addColorStop(0.5, medal.base);
    g.addColorStop(1, medal.base);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(82, y, 17, 0, Math.PI * 2);
    ctx.fill();
    strokeText(ctx, String(i + 1), 82, y + 1, 18, {
      stroke: medal.dark,
      strokeWidth: 3,
    });

    strokeText(ctx, f.nickname || '玩家', 116, y, 24, {
      align: 'left',
      stroke: 'rgba(8,4,30,0.45)',
      strokeWidth: 4,
    });
    strokeText(ctx, `第 ${f.maxLevel} 关`, DESIGN_W - 70, y, 24, {
      weight: 600,
      fill: CANDY.blue.light,
      align: 'right',
    });
  });
}

/**
 * 绘制独立好友页（标题 + 统计与榜单 + 返回）。
 * 排行榜页内嵌时不走这个函数，直接调 `drawFriendsBoard`。
 */
export function drawFriendsPage(ctx: CanvasRenderingContext2D, st: FriendsPageState): Button[] {
  strokeText(ctx, '好友', DESIGN_W / 2, 76, 40, {
    stroke: 'rgba(8,4,30,0.6)',
    strokeWidth: 7,
  });

  drawFriendsBoard(ctx, st, 130, 900);

  const back: Button = { x: 40, y: DESIGN_H - 220, w: 160, h: 72, label: '返回', kind: 'secondary', id: 'back', tone: 'blue' };
  drawButton(ctx, back, false);
  return [back];
}
