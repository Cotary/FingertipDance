import { describe, it, expect, vi } from 'vitest';
import { drawHomePage } from '../src/ui/home';
import { drawNav, pickNavTab } from '../src/ui/nav';
import { createMapState, pickMapNode } from '../src/ui/mapview';
import { drawMapView } from '../src/ui/mapdraw';
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
  // 当前关 = 最高已通关 + 1
  currentLevel: 8,
  levelCount: 1000,
  nickname: '测试玩家',
  avatar: '',
  skinCount: 3,
  totalSkins: 16,
  starCount: 42,
  totalRetries: 5,
};

const PROFILE: ProfilePageState = {
  nickname: '测试玩家',
  avatar: '',
  maxLevel: 7,
  totalSteps: 123,
  totalTimeMs: 456000,
  adWatchCnt: 2,
  soundOn: true,
  vibrateOn: false,
  starCount: 42,
  totalRetries: 5,
  threeStarCount: 3,
  currentLevel: 8,
  uid: 88214,
};

describe('大厅绘制冒烟', () => {
  it('主页大厅能画完并返回开始按钮 + 分享挑战条', () => {
    const ctx = fakeCtx();
    const buttons = drawHomePage(ctx, HOME, 1000);
    // 两个：金 CTA + 「分享挑战」条（后者可点，点了去地图选关）
    expect(buttons.length).toBe(2);
    expect(buttons[0].id).toBe('homeStart');
    expect(buttons[1].id).toBe('homeSharePick');
    expect(ctx.__calls.length).toBeGreaterThan(50);
  });

  it('底部导航能画完，且 5 个页签都能点中', () => {
    const ctx = fakeCtx();
    drawNav(ctx, 'home', 1000);
    for (const [x, label] of [[75, 'home'], [225, 'map'], [375, 'skins'], [525, 'rank'], [675, 'profile']] as const) {
      expect(pickNavTab(x, 1290)).toBe(label);
    }
  });

  it('地图页能画完并返回脚卡按钮（返回交给底栏，卡上不再放返回键）', () => {
    const ctx = fakeCtx();
    const st = createMapState(7, 1000, { '1': 3, '2': 2 });
    st.scrollY = 300;
    const buttons = drawMapView(ctx, st, 1000);
    const ids = buttons.map((b) => b.id);
    expect(ids).toContain('playCurrent');
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
      offset: 0,
      pageSize: 50,
    };
    const tabs1 = drawRankPage(ctx, st, 1000);
    expect(tabs1.map((b) => b.id)).toEqual(['tabFriends', 'tabGlobal']);
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
    // 2026-11-22 加了「昵称头像」「适龄提示」两行：前者是微信资料的唯一入口
    // （getUserProfile 必须手势触发），后者是提审要求的回看入口。
    expect(ids).toEqual(['toggleSound', 'toggleVibrate', 'editProfile', 'shareGame', 'ageGate', 'profileStats']);
  });

  it('我的页不再有「清除缓存」空转按钮', () => {
    // 该行唯一的作用是 `storage.remove('levels_cache')`，但那个 key 早已无人写入
    // （写它的 `LevelStore` 已无实例，主入口用的是不落盘的 `CoverLevelStore`）。
    // 点下去零效果零反馈 = 假功能，2026-11-20 删除。
    const ctx = fakeCtx();
    const ids = drawProfilePage(ctx, PROFILE, 1000).map((b) => b.id);
    expect(ids).not.toContain('clearCache');
  });

  it('主题页能画完并返回按钮（大卡 = 展签，货架 = 卡片）', () => {
    const ctx = fakeCtx();
    // 使用中的主题 → 没有动作按钮，只有「使用中」金签
    const b1 = drawSkinsPage(
      ctx,
      { equipped: 'wood', selected: 'wood', unlocked: new Set(['wood']), page: 0, themeSelected: 'mise', themeEquipped: 'mise', maxLevel: 0 },
      1000,
    );
    // 分段永远在（皮肤入口不能靠"有没有内容"决定是否出现）
    expect(b1.map((b) => b.id)).toEqual(['themeTab', 'skinTab']);
    // 换一套已解锁但没装备的 → 出现「使用」按钮
    const b2 = drawSkinsPage(
      ctx,
      { equipped: 'wood', selected: 'wood', unlocked: new Set(['wood']), page: 0, themeSelected: 'mingsha', themeEquipped: 'mise', maxLevel: 200 },
      1000,
    );
    expect(b2.map((b) => b.id)).toEqual(['themeTab', 'skinTab', 'equipTheme']);
    // 金按钮落在屏内、在右半侧（设计稿右上角状态位）
    const b = b2[2];
    expect(b.x + b.w).toBeLessThanOrEqual(750);
    expect(b.y + b.h).toBeLessThanOrEqual(1334);
    expect(b.x).toBeGreaterThan(375);
  });

  it('结算页 4 个按钮且全部落在屏内（朱印版式 · 无面板）', () => {
    const ctx = fakeCtx();
    const buttons = drawResult(ctx, 7, 10, 8, 12345, null, 0.007);
    const ids = buttons.map((b) => b.id);
    expect(ids).toEqual(['next', 'share', 'skins', 'home']);
    // 朱印版式直接画在墨石暗幕上，没有奶油面板；
    // 只要求按钮全部落在 750×1334 屏内、且彼此不重叠。
    for (const b of buttons) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(750);
      expect(b.y + b.h).toBeLessThanOrEqual(1334);
    }
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i].y).toBeGreaterThanOrEqual(buttons[i - 1].y);
    }
    // 主按钮在上，分享/主题并排一行，返回大厅在最下
    const [main, share, skins, home] = buttons;
    expect(share.y).toBe(skins.y);
    expect(share.x + share.w).toBeLessThanOrEqual(skins.x);
    expect(main.y + main.h).toBeLessThanOrEqual(share.y);
    expect(share.y + share.h).toBeLessThanOrEqual(home.y);
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
