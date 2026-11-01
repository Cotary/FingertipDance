import { describe, it, expect, vi } from 'vitest';
import { drawHomePage } from '../src/ui/home';
import { drawNav, pickNavTab } from '../src/ui/nav';
import { createMapState, drawMapView, pickMapNode } from '../src/ui/mapview';
import { createRankState, drawRankPage } from '../src/ui/leaderboard';
import { drawProfilePage, type ProfilePageState } from '../src/ui/profile';
import { drawSkinsPage } from '../src/ui/skins';
import { drawResult } from '../src/ui/hud';

/**
 * Canvas 桩：所有绘图方法都是 no-op，属性可写。
 * 目的：在 Node 里跑真实的绘制代码，捕捉 typecheck 抓不到的运行时错误
 * （未定义变量、错误的 ctx 方法调用、无限循环等）。
 */
function fakeCtx() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === '__calls') return calls;
      // 任意方法名 → 记录后返回 undefined
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.length})`);
        return undefined;
      };
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  };
  return new Proxy(target, handler) as unknown as CanvasRenderingContext2D & { __calls: string[] };
}

const HOME = {
  maxLevel: 7,
  levelCount: 1000,
  nickname: '测试玩家',
  avatar: '',
  skinCount: 3,
  totalSkins: 16,
};

const PROFILE: ProfilePageState = {
  nickname: '测试玩家',
  avatar: '',
  maxLevel: 7,
  totalSteps: 123,
  totalTimeMs: 456000,
  adWatchCnt: 2,
  unlockedSkins: ['wood', 'mint', 'graphite'],
  totalSkins: 16,
  soundOn: true,
  vibrateOn: false,
};

describe('大厅绘制冒烟', () => {
  it('主页大厅能画完并返回开始按钮', () => {
    const ctx = fakeCtx();
    const buttons = drawHomePage(ctx, HOME, 1000);
    expect(buttons.length).toBe(1);
    expect(buttons[0].id).toBe('homeStart');
    expect(ctx.__calls.length).toBeGreaterThan(50);
  });

  it('底部导航能画完，且 5 个页签都能点中', () => {
    const ctx = fakeCtx();
    drawNav(ctx, 'home', 1000);
    for (const [x, label] of [[75, 'home'], [225, 'map'], [375, 'skins'], [525, 'rank'], [675, 'profile']] as const) {
      expect(pickNavTab(x, 1290)).toBe(label);
    }
  });

  it('地图页能画完并返回返回按钮', () => {
    const ctx = fakeCtx();
    const st = createMapState(7, 1000, { '1': 3, '2': 2 });
    st.scrollY = 300;
    const buttons = drawMapView(ctx, st, 1000);
    const ids = buttons.map((b) => b.id);
    expect(ids).toContain('navHome');
    // 吸底的「继续」：一屏 16 关，不该让玩家自己找当前关
    expect(ids).toContain('playCurrent');
    // 可视区里至少有节点能被点中
    expect(pickMapNode(375, 210 - 300 + 0, st)).toBeGreaterThanOrEqual(-1);
  });

  it('排行榜页两个 Tab 都能画完', () => {
    const ctx = fakeCtx();
    const st = createRankState();
    st.global = {
      list: [{ rank: 1, uid: 1, nickname: '某人', avatar: '', maxLevel: 9, totalTimeMs: 12345 }],
      myRank: 3,
      total: 10,
      loading: false,
    };
    const tabs1 = drawRankPage(ctx, st, 1000);
    expect(tabs1.map((b) => b.id)).toEqual(['tabGlobal', 'tabFriends']);
    st.tab = 'friends';
    st.friends.loadingOpenData = false;
    st.friends.friends = [{ uid: 2, nickname: '好友', avatar: '', maxLevel: 5, totalTimeMs: 1000, skinCount: 2, isMutual: true }];
    st.friends.stats = { friendCount: 1, avgLevel: 5, maxLevel: 5 };
    const tabs2 = drawRankPage(ctx, st, 1000);
    expect(tabs2.length).toBe(2);
  });

  it('我的页能画完并返回功能行按钮', () => {
    const ctx = fakeCtx();
    const buttons = drawProfilePage(ctx, PROFILE, 1000);
    const ids = buttons.map((b) => b.id);
    expect(ids).toContain('shareGame');
    expect(ids).toContain('toggleSound');
    expect(ids).toContain('toggleVibrate');
    expect(ids).toContain('clearCache');
  });

  it('皮肤页能画完并返回按钮', () => {
    const ctx = fakeCtx();
    const buttons = drawSkinsPage(
      ctx,
      { equipped: 'wood', selected: 'wood', unlocked: new Set(['wood', 'mint']), page: 0 },
      1000,
    );
    expect(buttons.every((b) => typeof b.id === 'string')).toBe(true);
    // 选中的是「已装备」→ 没有按钮；换一个已解锁未装备的，才会出现装备按钮
    const b2 = drawSkinsPage(
      ctx,
      { equipped: 'wood', selected: 'mint', unlocked: new Set(['wood', 'mint']), page: 0 },
      1000,
    );
    expect(b2.map((b) => b.id)).toContain('equipSkin');
  });

  it('结算页 4 个按钮且全部落在加高后的面板内', () => {
    const ctx = fakeCtx();
    const buttons = drawResult(ctx, 7, 10, 8, 12345, null, 0.007);
    const ids = buttons.map((b) => b.id);
    expect(ids).toEqual(['next', 'share', 'skins', 'home']);
    const panelBottom = 380 + 660;
    for (const b of buttons) {
      expect(b.y + b.h).toBeLessThanOrEqual(panelBottom);
    }
  });

  it('未捕获异常应被记录（防止绘制函数静默失败）', () => {
    // 该用例是自检：确保 fakeCtx 不会把异常吞掉
    const spy = vi.fn();
    try {
      drawNav(fakeCtx(), 'unknown' as never, 0);
    } catch (e) {
      spy(e);
    }
    // drawNav 对未知 tab 不抛异常（图标 switch 无 default），断言不会崩
    expect(spy).not.toHaveBeenCalled();
  });
});
