/**
 * 好友榜：好友进度统计面板 + 好友榜（开放数据域）。全部 Canvas 绘制。
 * `drawFriendsBoard` 被排行榜页的好友榜 Tab 复用。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, type Button } from './hud';
import { roundRect } from '../render/board';
import { getOpenDataCanvas } from '../platform/openData';
import { LOBBY_THEME } from './theme';
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
  const t = LOBBY_THEME;

  // ── 统计面板 ──
  const panelY = topY;
  ctx.fillStyle = t.panel;
  roundRect(ctx, 40, panelY, DESIGN_W - 80, PANEL_H, 16);
  ctx.fill();

  const statItems = [
    { label: '好友数', value: String(st.stats.friendCount) },
    { label: '好友平均进度', value: `${st.stats.avgLevel} 关` },
    { label: '好友最高进度', value: `${st.stats.maxLevel} 关` },
    { label: '我的名次', value: st.myRank > 0 ? `第 ${st.myRank} 名` : '未上榜' },
  ];
  statItems.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 90 + col * 300;
    const y = panelY + 30 + row * 70;
    ctx.fillStyle = t.subText;
    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(s.label, x, y);
    ctx.fillStyle = t.blue;
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText(s.value, x, y + 28);
  });

  // ── 好友榜 ──
  const boardY = panelY + PANEL_TO_BOARD;
  ctx.fillStyle = t.subText;
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('好友榜', 40, boardY);
  if (st.loadingOpenData) {
    ctx.textAlign = 'right';
    ctx.fillText('加载中...', DESIGN_W - 40, boardY);
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
  } else {
    // Web 版用服务端好友列表兜底绘制
    ctx.fillStyle = t.panel;
    roundRect(ctx, 40, boardBoxY, DESIGN_W - 80, boardBoxH, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '26px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const list = st.friends.slice(0, 12);
    if (list.length === 0) {
      ctx.fillStyle = t.subText;
      ctx.fillText('还没有好友，分享给好友一起来玩吧', DESIGN_W / 2, boardBoxY + boardBoxH / 2);
    }
    list.forEach((f, i) => {
      const y = boardBoxY + 50 + i * 46;
      if (y > boardBoxY + boardBoxH - 20) return;
      ctx.textAlign = 'left';
      ctx.fillStyle = t.text;
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(`${i + 1}. ${f.nickname || '玩家'}`, 70, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = t.blue;
      ctx.fillText(`第 ${f.maxLevel} 关`, DESIGN_W - 70, y);
    });
  }
}

/**
 * 绘制独立好友页（标题 + 统计与榜单 + 返回）。
 * 排行榜页内嵌时不走这个函数，直接调 `drawFriendsBoard`。
 */
export function drawFriendsPage(ctx: CanvasRenderingContext2D, st: FriendsPageState): Button[] {
  const t = LOBBY_THEME;

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  ctx.fillStyle = t.text;
  ctx.font = '700 38px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('好友', DESIGN_W / 2, 60);

  drawFriendsBoard(ctx, st, 120, 900);

  const back: Button = { x: 40, y: DESIGN_H - 140, w: 160, h: 72, label: '返回', kind: 'secondary', id: 'back' };
  drawButton(ctx, back, false, t);
  return [back];
}
