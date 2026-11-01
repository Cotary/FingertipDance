/**
 * 排行榜页。总榜（服务端）+ 好友榜（开放数据域）两个 Tab。
 * 视觉语言：奶油黏土行 + 金银铜黏土名次片 + 陶土 Tab。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { type Button } from './hud';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayText, rrectPts, tracePts, type ClayColor } from './clay';
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
  clayText(ctx, '排行榜', DESIGN_W / 2, 56, 40, {
    fill: CLAY_UI.ink,
    outline: 'rgba(255,251,243,0.55)',
    outlineWidth: 5,
  });

  // ── Tab 切换（选中=陶土块，未选=沙色块压在桌面上） ──
  const tabs: Button[] = [
    { x: DESIGN_W / 2 - 170, y: 96, w: 160, h: 64, label: '总榜', kind: 'secondary', id: 'tabGlobal' },
    { x: DESIGN_W / 2 + 10, y: 96, w: 160, h: 64, label: '好友榜', kind: 'secondary', id: 'tabFriends' },
  ];
  tabs.forEach((b, i) => {
    const on = (b.id === 'tabGlobal') === (st.tab === 'global');
    // 未选中用奶油而不是沙色：沙色和桌面色几乎同值，块会「陷进桌面」看不出边界
    clayBlock(ctx, b.x, b.y, b.w, b.h, b.h * 0.5, on ? CLAY.terracotta : CLAY.cream, 501 + i, {
      depth: on ? 8 : 4,
      hi: on ? 0.08 : 0.04,
    });
    clayText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2, 26, {
      weight: on ? 800 : 600,
      fill: on ? '#FFF6E9' : CLAY_UI.inkSoft,
      outline: on ? 'rgba(90,38,16,0.45)' : undefined,
      outlineWidth: on ? 4 : 0,
      emboss: false,
    });
  });

  if (st.tab === 'global') {
    drawGlobalRank(ctx, st.global);
  } else {
    drawFriendsBoard(ctx, st.friends, 176, 900);
  }

  return tabs;
}

/** 名次 → 徽章配色。前三名给金/银/铜，其余返回 null。 */
function medalOf(rank: number): ClayColor | null {
  if (rank === 1) return CLAY.mustard;
  if (rank === 2) return { base: '#C9D2E0', light: '#EFF3FA', dark: '#8E9BB1', shade: '#66738A' };
  if (rank === 3) return { base: '#D9A273', light: '#F7CFAC', dark: '#A8703F', shade: '#7A4C26' };
  return null;
}

/** 画总榜列表。 */
function drawGlobalRank(ctx: CanvasRenderingContext2D, g: GlobalRankData): void {
  const empty = (msg: string): void => {
    clayBlock(ctx, 70, 340, DESIGN_W - 140, 160, 32, CLAY.cream, 502, { depth: 10, hi: 0.05 });
    clayText(ctx, msg, DESIGN_W / 2, 420, 26, {
      weight: 600,
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
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
    const medal = medalOf(it.rank);

    // 行：一条压平在桌面上的奶油黏土条。
    // 不用交替色（沙色和桌面色太接近，交替会读成「有的行缺了一块」），
    // 前三名的区别交给左侧竖条 + 金银铜名次片。
    clayBlock(ctx, 40, y, DESIGN_W - 80, rh, 22, CLAY.cream, 510 + i, {
      depth: 5,
      hi: 0.05,
      jitter: 0.004,
    });

    if (medal) {
      ctx.fillStyle = medal.dark;
      tracePts(ctx, rrectPts(40, y + 8, 9, rh - 16, 4.5, 511 + i, 0.004));
      ctx.fill();
      ctx.fillStyle = medal.base;
      tracePts(ctx, rrectPts(40, y + 8, 9, rh - 16, 4.5, 511 + i, 0.004), 0, -1);
      ctx.fill();
    }

    // 名次片
    if (medal) {
      clayDisc(ctx, 84, y + rh / 2, 23, medal, 520 + i, { depth: 5, hi: 0.18 });
      clayText(ctx, String(it.rank), 84, y + rh / 2, 22, {
        fill: '#FFF6E9',
        outline: medal.shade,
        outlineWidth: 4,
        emboss: false,
      });
    } else {
      clayDisc(ctx, 84, y + rh / 2, 21, CLAY.sand, 520 + i, { depth: 3, lit: false });
      clayText(ctx, String(it.rank), 84, y + rh / 2, 21, {
        weight: 600,
        fill: CLAY_UI.inkSoft,
        outlineWidth: 0,
        emboss: false,
      });
    }

    // 昵称
    clayText(ctx, it.nickname || '玩家', 124, y + 32, 28, {
      align: 'left',
      fill: CLAY_UI.ink,
      outlineWidth: 0,
      emboss: false,
    });

    // 副标题：总用时（关卡数已由右侧徽章表达，不再重复）
    clayText(ctx, `总用时 ${Math.round(it.totalTimeMs / 60000)} 分`, 124, y + 61, 21, {
      weight: 600,
      align: 'left',
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });

    // 右侧关卡徽章
    clayBlock(ctx, DESIGN_W - 186, y + (rh - 44) / 2, 126, 44, 22, CLAY.blue, 530 + i, { depth: 4, hi: 0.08 });
    clayText(ctx, `${it.maxLevel} 关`, DESIGN_W - 123, y + rh / 2, 22, {
      fill: '#FFF6E9',
      outline: 'rgba(30,44,58,0.45)',
      outlineWidth: 3,
      emboss: false,
    });
  });

  // 吸底「我的名次」：一块压在最上面的陶土条
  const myY = DESIGN_H - 120 - 124;
  clayBlock(ctx, 40, myY, DESIGN_W - 80, 84, 26, CLAY.terracotta, 503, { depth: 11, hi: 0.07 });

  clayText(ctx, '我的名次', 74, myY + 42, 28, {
    align: 'left',
    fill: '#FFF6E9',
    outline: 'rgba(90,38,16,0.45)',
    outlineWidth: 4,
  });
  const mine = g.myRank > 0 ? `第 ${g.myRank} 名 / ${g.total} 人` : '未上榜';
  clayText(ctx, mine, DESIGN_W - 72, myY + 42, 28, {
    align: 'right',
    fill: g.myRank > 0 ? CLAY.mustard.light : 'rgba(255,246,233,0.72)',
    outline: 'rgba(90,38,16,0.45)',
    outlineWidth: 4,
  });
}
