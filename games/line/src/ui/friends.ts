/**
 * 好友页：好友榜（开放数据域）+ 好友进度统计面板。全部 Canvas 绘制。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, COLORS, type Button } from './hud';
import { roundRect } from '../render/board';
import { getOpenDataCanvas } from '../platform/openData';
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

/**
 * 绘制好友页。
 */
export function drawFriendsPage(ctx: CanvasRenderingContext2D, st: FriendsPageState): Button[] {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  ctx.fillStyle = COLORS.text;
  ctx.font = '700 38px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('好友', DESIGN_W / 2, 60);

  // ── 统计面板 ──
  const panelY = 120;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 40, panelY, DESIGN_W - 80, 180, 16);
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
    ctx.fillStyle = COLORS.subText;
    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.label, x, y);
    ctx.fillStyle = COLORS.yellow;
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText(s.value, x, y + 28);
  });

  // ── 好友榜 ──
  const boardY = panelY + 210;
  ctx.fillStyle = COLORS.subText;
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('好友榜', 40, boardY);
  if (st.loadingOpenData) {
    ctx.fillStyle = COLORS.subText;
    ctx.textAlign = 'right';
    ctx.fillText('加载中...', DESIGN_W - 40, boardY);
  }

  const od = getOpenDataCanvas();
  if (od) {
    const boardW = DESIGN_W - 80;
    const boardH = 420;
    try {
      ctx.drawImage(od.canvas, 40, boardY + 40, boardW, boardH);
    } catch {
      // 微信端首帧可能还没画好
    }
  } else {
    // Web 版用服务端好友列表兜底绘制
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, 40, boardY + 40, DESIGN_W - 80, 420, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '26px system-ui, sans-serif';
    const list = st.friends.slice(0, 12);
    if (list.length === 0) {
      ctx.fillStyle = COLORS.subText;
      ctx.fillText('还没有好友，分享给好友一起来玩吧', DESIGN_W / 2, boardY + 250);
    }
    list.forEach((f, i) => {
      const y = boardY + 90 + i * 46;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.text;
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(`${i + 1}. ${f.nickname || '玩家'}`, 70, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.yellow;
      ctx.fillText(`第 ${f.maxLevel} 关`, DESIGN_W - 70, y);
    });
  }

  // 返回按钮
  const back: Button = { x: 40, y: DESIGN_H - 140, w: 160, h: 72, label: '返回', kind: 'secondary', id: 'back' };
  drawButton(ctx, back, false);
  return [back];
}
