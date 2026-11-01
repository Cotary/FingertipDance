/**
 * 排行榜页。总榜（服务端）+ 好友榜（开放数据域）两个 Tab。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { type Button } from './hud';
import { LOBBY_THEME } from './theme';
import { drawFriendsBoard, type FriendsPageState } from './friends';
import type { LeaderboardItem } from '../net/api';

/** 排行榜 Tab。 */
export type RankTab = 'global' | 'friends';

/** 总榜数据。 */
export interface GlobalRankData {
  list: LeaderboardItem[];
  myRank: number;
  total: number;
  loading: boolean;
}

/** 排行榜页状态。 */
export interface RankPageState {
  tab: RankTab;
  global: GlobalRankData;
  friends: FriendsPageState;
}

/** 创建初始状态。 */
export function createRankState(): RankPageState {
  return {
    tab: 'global',
    global: { list: [], myRank: 0, total: 0, loading: true },
    friends: { friends: [], stats: { friendCount: 0, avgLevel: 0, maxLevel: 0 }, myRank: 0, loadingOpenData: true },
  };
}

/**
 * 绘制排行榜页。
 * @returns 可点击按钮列表
 */
export function drawRankPage(ctx: CanvasRenderingContext2D, st: RankPageState, _now: number): Button[] {
  const t = LOBBY_THEME;

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 标题
  ctx.fillStyle = t.text;
  ctx.font = '700 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('排行榜', DESIGN_W / 2, 52);

  // ── Tab 切换 ──
  const tabs: Button[] = [
    { x: DESIGN_W / 2 - 170, y: 92, w: 160, h: 60, label: '总榜', kind: 'secondary', id: 'tabGlobal' },
    { x: DESIGN_W / 2 + 10, y: 92, w: 160, h: 60, label: '好友榜', kind: 'secondary', id: 'tabFriends' },
  ];
  for (const b of tabs) {
    const on = (b.id === 'tabGlobal') === (st.tab === 'global');
    ctx.fillStyle = on ? t.blue : 'rgba(255,255,255,0.7)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 30);
    ctx.fill();
    ctx.fillStyle = on ? '#FFFFFF' : t.subText;
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  }

  if (st.tab === 'global') {
    drawGlobalRank(ctx, st.global);
  } else {
    drawFriendsBoard(ctx, st.friends, 170, 900);
  }

  return tabs;
}

/** 画总榜列表。 */
function drawGlobalRank(ctx: CanvasRenderingContext2D, g: GlobalRankData): void {
  const t = LOBBY_THEME;

  if (g.loading) {
    ctx.fillStyle = t.subText;
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('加载中...', DESIGN_W / 2, 400);
    return;
  }
  if (g.list.length === 0) {
    ctx.fillStyle = t.subText;
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('还没有人上榜，快去通关抢第一！', DESIGN_W / 2, 400);
    return;
  }

  const rowH = 84;
  const top = 180;
  const maxRows = Math.floor((DESIGN_H - 120 - top - 110) / rowH);

  g.list.slice(0, maxRows).forEach((it, i) => {
    const y = top + i * rowH;
    // 行底板
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
    roundRect(ctx, 40, y, DESIGN_W - 80, rowH - 12, 18);
    ctx.fill();

    // 名次徽章
    const medal = i === 0 ? '#FFC93C' : i === 1 ? '#C9D2E0' : i === 2 ? '#E0A97A' : t.border;
    ctx.fillStyle = medal;
    ctx.beginPath();
    ctx.arc(84, y + (rowH - 12) / 2, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = i < 3 ? '#FFFFFF' : t.subText;
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(it.rank), 84, y + (rowH - 12) / 2 + 1);

    // 昵称
    ctx.fillStyle = t.text;
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(it.nickname || '玩家', 124, y + 18);

    // 关卡 + 用时
    ctx.fillStyle = t.subText;
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`第 ${it.maxLevel} 关 · ${(it.totalTimeMs / 1000).toFixed(0)} 秒`, 124, y + 48);

    // 右侧关卡徽章
    ctx.fillStyle = t.blue;
    roundRect(ctx, DESIGN_W - 176, y + 20, 116, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${it.maxLevel} 关`, DESIGN_W - 118, y + 43);
  });

  // 吸底「我的名次」
  const myY = DESIGN_H - 120 - 96;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, 40, myY, DESIGN_W - 80, 76, 24);
  ctx.fill();
  ctx.fillStyle = t.blue;
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('我的名次', 70, myY + 38);
  ctx.textAlign = 'right';
  ctx.fillStyle = t.text;
  ctx.fillText(g.myRank > 0 ? `第 ${g.myRank} 名 / ${g.total} 人` : '未上榜', DESIGN_W - 70, myY + 38);
}
