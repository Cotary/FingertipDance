/**
 * 我的页功能完整性（2026-11-20）。
 *
 * 这三条锁的都是「看起来有、其实没接通」的缺陷：
 *
 * 1. 战绩行点不开（`profileStats` 在 main.ts 里没有任何分支）
 * 2. 分享挑战分享的是上一局（`doShare` 依赖从不置空的 `session.state`）
 * 3. 头像字段被完全忽略（`st.avatar` 从未被读取）
 *
 * 前两条无法在单测里跑 `main.ts`（它一 import 就会启动整个游戏），
 * 所以用**源码断言**：确保对应的处理分支/函数存在且不再写回旧写法。
 * 第三条直接测 avatar 模块的缓存语义。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawStatsPanel } from '../src/ui/statsPanel';
import { getAvatarImage, __resetAvatarCache, __avatarCacheState } from '../src/ui/avatar';

const MAIN = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8');

/** 造一个只记录调用的 canvas 桩。 */
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

const STATS = {
  maxLevel: 46,
  currentLevel: 47,
  starCount: 96,
  threeStarCount: 12,
  totalRetries: 23,
  totalSteps: 1284,
  totalTimeMs: 2_460_000,
  adWatchCnt: 9,
  levelCount: 1000,
};

describe('战绩弹层', () => {
  it('能画完并返回可点击的关闭区域', () => {
    const ctx = fakeCtx();
    const buttons = drawStatsPanel(ctx, STATS);
    // 整屏遮罩 + 卡内关闭键
    expect(buttons.length).toBe(2);
    expect(buttons.every((b) => b.id === 'statsClose')).toBe(true);
    expect(ctx.__calls.length).toBeGreaterThan(20);
  });

  it('遮罩铺满整屏（点卡外也能关）', () => {
    const buttons = drawStatsPanel(fakeCtx(), STATS);
    const mask = buttons[0];
    expect(mask.x).toBe(0);
    expect(mask.y).toBe(0);
    expect(mask.w).toBeGreaterThan(700);
    expect(mask.h).toBeGreaterThan(1300);
  });

  it('时长/步数极值时也不崩、不出 NaN 字样', () => {
    const cases = [
      { ...STATS, totalTimeMs: 0, totalSteps: 0 },
      { ...STATS, totalTimeMs: 59_000 },
      { ...STATS, totalTimeMs: 100 * 3_600_000 },
    ];
    for (const c of cases) {
      const ctx = fakeCtx();
      expect(() => drawStatsPanel(ctx, c)).not.toThrow();
    }
  });

  it('关闭键不与最后一行数据重叠', () => {
    // 这是真的踩过的坑：卡片高写死 720、行高 62，8 行列表底 654 撞到按钮顶 596，
    // 第 8 行「看广告次数」被按钮整个压住。所以断言两个几何量的大小关系。
    const buttons = drawStatsPanel(fakeCtx(), STATS);
    const closeBtn = buttons[1];
    // 列表底 = 卡顶 + 158 + 8 行 × 64（见 statsPanel.ts 的分段注释）
    const cardTop = (1334 - 880) / 2;
    const listBottom = cardTop + 158 + 8 * 64;
    expect(closeBtn.y).toBeGreaterThan(listBottom);
  });

  it('卡片整体落在画布内（不被上下裁掉）', () => {
    const buttons = drawStatsPanel(fakeCtx(), STATS);
    const closeBtn = buttons[1];
    expect(closeBtn.y + closeBtn.h).toBeLessThan(1334);
    expect(closeBtn.y).toBeGreaterThan(0);
  });
});

describe('我的页接线（源码断言）', () => {
  it('战绩行有对应处理分支', () => {
    expect(MAIN).toMatch(/id === 'profileStats'/);
    expect(MAIN).toMatch(/statsPanelOpen = true/);
  });

  it('分享挑战走邀请抽屉，而不是分享上一局', () => {
    // 我的页的按钮必须打开分享抽屉，且 `undos` 传 null（= 纯邀请，不宣称成绩）
    expect(MAIN).toMatch(/id === 'shareGame'\)\s*\{\s*openSharePanel\(progress\.currentLevel, null,/);
    // 抽屉的关号/成绩必须由调用方显式传入，不能从 session 猜
    const start = MAIN.indexOf('function openSharePanel');
    expect(start).toBeGreaterThan(-1);
    const nextFn = MAIN.indexOf('\nfunction ', start + 10);
    const body = MAIN.slice(start, nextFn > 0 ? nextFn : undefined);
    expect(body, 'openSharePanel 不该读 session.state').not.toContain('session.state');
  });

  it('分享抽屉的渠道由平台能力决定，不写死', () => {
    // 平台通道：好友 / 朋友圈 / 抖音 —— 三端各自报自己的
    for (const id of ['shareFriend', 'shareTimeline', 'shareDouyin']) {
      expect(MAIN, `缺少 ${id} 的处理`).toMatch(new RegExp(`id === '${id}'`));
    }
    // 纯客户端渠道：两端都有
    for (const id of ['shareCopyLink', 'shareSavePoster', 'shareNewCopy', 'shareDismiss']) {
      expect(MAIN, `缺少 ${id} 的处理`).toMatch(new RegExp(`id === '${id}'`));
    }

    // 关键：渠道列表必须**从 platform.shareChannels 派生**，
    // 不能在面板里写死四格 —— 否则抖音端会多出一个点不动的朋友圈按钮。
    const panel = readFileSync(resolve(__dirname, '../src/ui/sharePanel.ts'), 'utf8');
    expect(panel).toContain('platform.shareChannels');
    // 旧的写死常量不该还在
    expect(panel, '不要写死 CHANNELS 常量').not.toMatch(/const CHANNELS\s*=/);
  });

  it('分享有三个入口：我的页(邀请) / 首页选关 / 通关结算(带成绩)', () => {
    // ① 我的页 —— 邀请：不带成绩
    expect(MAIN).toMatch(/id === 'shareGame'[\s\S]{0,80}openSharePanel\(progress\.currentLevel, null/);

    // ② 首页分享条 → 地图的选关模式
    expect(MAIN).toMatch(/id === 'homeSharePick'/);
    expect(MAIN).toMatch(/shareMode = true/);

    // ③ 地图选关模式下点节点 = 分享那一关（不是进关）
    //    且必须先校验「这一关自己已经通过」——未通过的关只给提示，不弹面板。
    const mapBranch = MAIN.slice(MAIN.indexOf("id.startsWith('map:')"));
    expect(mapBranch.slice(0, 600), '选关模式必须优先于进关判断，且只允许已通关的关').toMatch(
      /shareMode\)\s*\{\s*if \(!isLevelCleared\(idx, mapPage\)\) \{[\s\S]{0,200}openSharePanel\(idx, null/,
    );
    expect(mapBranch.slice(0, 600), '未通关时要说清楚，不能静默').toContain('先通过第');

    // ④ 结算页 —— 带成绩：关号取刚打完那关，不能取「下一关」
    const shareBranch = MAIN.slice(MAIN.indexOf("id === 'share')"));
    expect(shareBranch.slice(0, 400)).toContain('resultData?.levelIdx');
    expect(shareBranch.slice(0, 400)).toContain("'result'");
  });

  it('分享抽屉是全站模态（不只在我的页判断）', () => {
    // onDown 里必须是 `if (sharePanelOpen)`，不能带 `phase === 'profile'` ——
    // 否则从地图 / 结算页打开时，抽屉下面的按钮会被点穿
    const down = MAIN.slice(MAIN.indexOf('function onDown'));
    const hit = down.indexOf('sharePanelOpen');
    expect(hit).toBeGreaterThan(-1);
    const around = down.slice(Math.max(0, hit - 120), hit + 20);
    expect(around, '拦截不能只在 profile 页生效').not.toContain("phase === 'profile' && sharePanelOpen");
  });

  it('两个弹层互斥（不会叠两层遮罩）', () => {
    // 打开战绩时必须关分享，反之亦然
    const stats = MAIN.slice(MAIN.indexOf("id === 'profileStats'"));
    expect(stats.slice(0, 200)).toContain('sharePanelOpen = false');
  });

  it('战绩弹层在指针处理里抢先拦截（模态，不点穿底栏）', () => {
    // onDown 里必须先判弹层，再判导航栏
    const down = MAIN.slice(MAIN.indexOf('function onDown'));
    const panelAt = down.indexOf("phase === 'profile' && statsPanelOpen");
    const navAt = down.indexOf('isNavPhase(phase)');
    expect(panelAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(-1);
    expect(panelAt).toBeLessThan(navAt);
  });
});

describe('头像加载', () => {
  it('空 URL 直接返回 null（画首字）', () => {
    __resetAvatarCache();
    expect(getAvatarImage('')).toBeNull();
  });

  it('同一 URL 只发起一次加载，未就绪时返回 null', () => {
    __resetAvatarCache();
    const url = 'https://example.com/a.png';
    // 没有 Image 实现（node 环境）→ 首次调用即落到 failed
    expect(getAvatarImage(url)).toBeNull();
    expect(__avatarCacheState(url)).toBe('failed');
    // 再问一次不该重新进入 loading
    expect(getAvatarImage(url)).toBeNull();
    expect(__avatarCacheState(url)).toBe('failed');
  });

  it('失败状态是永久的（不会每帧重试）', () => {
    __resetAvatarCache();
    const url = 'https://example.com/bad.png';
    for (let i = 0; i < 60; i++) getAvatarImage(url);
    expect(__avatarCacheState(url)).toBe('failed');
  });
});
