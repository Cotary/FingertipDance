/**
 * 排行榜页。总榜（服务端）+ 好友榜（开放数据域）两个 Tab。
 * 视觉语言：玻璃列表行 + 糖果名次徽章 + 果冻 Tab 胶囊。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { type Button } from './hud';
import { CANDY, THEME, type CandyColor } from './theme';
import { glass, halo, jelly, pill, strokeText } from './draw';
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
  // 标题
  strokeText(ctx, '排行榜', DESIGN_W / 2, 56, 40, {
    stroke: 'rgba(8,4,30,0.5)',
    strokeWidth: 4,
  });

  // ── Tab 切换（选中=糖果胶囊，未选=玻璃） ──
  const tabs: Button[] = [
    { x: DESIGN_W / 2 - 170, y: 96, w: 160, h: 64, label: '总榜', kind: 'secondary', id: 'tabGlobal', tone: 'orange' },
    { x: DESIGN_W / 2 + 10, y: 96, w: 160, h: 64, label: '好友榜', kind: 'secondary', id: 'tabFriends', tone: 'purple' },
  ];
  for (const b of tabs) {
    const on = (b.id === 'tabGlobal') === (st.tab === 'global');
    if (on) {
      const c = b.id === 'tabGlobal' ? CANDY.orange : CANDY.purple;
      jelly(ctx, b.x, b.y, b.w, b.h, c, {
        radius: b.h / 2,
        depth: 6,
        label: b.label,
        fontSize: 26,
      });
    } else {
      glass(ctx, b.x, b.y, b.w, b.h, b.h / 2, { fill: 'rgba(255,255,255,0.08)' });
      strokeText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, 26, {
        weight: 600,
        fill: 'rgba(214,210,255,0.70)',
      });
    }
  }

  if (st.tab === 'global') {
    drawGlobalRank(ctx, st.global);
  } else {
    drawFriendsBoard(ctx, st.friends, 176, 900);
  }

  return tabs;
}

/** 名次 → 徽章配色。 */
function medalOf(rank: number): CandyColor | null {
  if (rank === 1) return CANDY.gold;
  if (rank === 2) return { base: '#C9D2E0', light: '#EFF3FA', dark: '#8E9BB1', glow: 'rgba(201,210,224,0.4)' };
  if (rank === 3) return { base: '#E0A97A', light: '#FFD5B8', dark: '#A8703F', glow: 'rgba(224,169,122,0.4)' };
  return null;
}

/** 画总榜列表。 */
function drawGlobalRank(ctx: CanvasRenderingContext2D, g: GlobalRankData): void {
  const empty = (msg: string): void => {
    glass(ctx, 70, 340, DESIGN_W - 140, 160, 32, { fill: 'rgba(255,255,255,0.07)' });
    strokeText(ctx, msg, DESIGN_W / 2, 420, 26, {
      weight: 600,
      fill: THEME.subText,
    });
  };

  if (g.loading) {
    empty('加载中…');
    return;
  }
  if (g.list.length === 0) {
    empty('还没有人上榜，快去抢第一！');
    return;
  }

  const rowH = 92;
  const top = 184;
  const maxRows = Math.floor((DESIGN_H - 120 - top - 120) / rowH);

  g.list.slice(0, maxRows).forEach((it, i) => {
    const y = top + i * rowH;
    const rh = rowH - 12;

    // 行底板：前三名给一层暖色，其余交替玻璃
    glass(ctx, 40, y, DESIGN_W - 80, rh, 22, {
      fill: i < 3 ? 'rgba(255,255,255,0.16)' : i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)',
      shadow: false,
    });

    // 名次徽章
    const medal = medalOf(it.rank);
    if (medal) halo(ctx, 84, y + rh / 2, 40, medal.glow);
    if (medal) {
      ctx.fillStyle = medal.dark;
      ctx.beginPath();
      ctx.arc(84, y + rh / 2 + 3, 22, 0, Math.PI * 2);
      ctx.fill();
      const mg = ctx.createLinearGradient(84, y + rh / 2 - 22, 84, y + rh / 2 + 22);
      mg.addColorStop(0, medal.light);
      mg.addColorStop(0.5, medal.base);
      mg.addColorStop(1, medal.base);
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(84, y + rh / 2, 22, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(84, y + rh / 2, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    strokeText(ctx, String(it.rank), 84, y + rh / 2 + 1, 22, {
      fill: medal ? '#FFFFFF' : 'rgba(214,210,255,0.75)',
      stroke: medal ? medal.dark : undefined,
      strokeWidth: 4,
    });

    // 昵称
    strokeText(ctx, it.nickname || '玩家', 124, y + 32, 28, {
      align: 'left',
      stroke: 'rgba(8,4,30,0.45)',
      strokeWidth: 4,
    });

    // 副标题：总用时（关卡数已由右侧徽章表达，不再重复）
    strokeText(ctx, `总用时 ${Math.round(it.totalTimeMs / 60000)} 分`, 124, y + 61, 21, {
      weight: 600,
      fill: THEME.subText,
      align: 'left',
    });

    // 右侧关卡徽章
    pill(ctx, DESIGN_W - 186, y + (rh - 44) / 2, 126, 44, CANDY.blue, `${it.maxLevel} 关`, 22);
  });

  // 吸底「我的名次」
  const myY = DESIGN_H - 120 - 104;
  glass(ctx, 40, myY, DESIGN_W - 80, 84, 26, { fill: 'rgba(255,255,255,0.14)' });
  // 左侧糖果竖条
  ctx.fillStyle = CANDY.blue.base;
  roundRect(ctx, 40, myY, 10, 84, 5);
  ctx.fill();

  strokeText(ctx, '我的名次', 74, myY + 42, 28, {
    align: 'left',
    stroke: 'rgba(8,4,30,0.45)',
    strokeWidth: 4,
  });
  const mine = g.myRank > 0 ? `第 ${g.myRank} 名 / ${g.total} 人` : '未上榜';
  strokeText(ctx, mine, DESIGN_W - 72, myY + 42, 28, {
    align: 'right',
    fill: g.myRank > 0 ? CANDY.gold.base : THEME.subText,
    stroke: 'rgba(8,4,30,0.45)',
    strokeWidth: 4,
  });
}
