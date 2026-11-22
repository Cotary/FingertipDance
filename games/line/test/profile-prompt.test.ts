import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawHomePage, type HomePageState } from '../src/ui/home';

/**
 * 昵称头像授权引导。
 *
 * ## 为什么这条要单独锁
 *
 * 微信的 `getUserProfile` **必须由用户手势触发**，启动时自动调只会失败。
 * 所以「什么时候提示他填」是这个功能能不能用的关键 —— 而它一旦被改回
 * "启动时弹一个框"，表现是授权框根本不弹（或弹了被判诱导），
 * 而且不报错，线上只能靠"分享卡片写着玩家"来发现。
 *
 * 三条规则：
 *   1. 大厅里是一条**可忽略**的提示，不是模态
 *   2. 提示条与分享条**共用同一个槽位**（纵向空间不够，叠加会压住主 CTA）
 *   3. 分享前提示一次，但**不拦着不让分享**
 */

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(here, '../src/main.ts'), 'utf8');
const HOME = readFileSync(resolve(here, '../src/ui/home.ts'), 'utf8');

function ctxStub(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const t: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    measureText: (s: string) => ({ width: s.length * 8 }),
  };
  return new Proxy(t, {
    get(o, p: string) { return p in o ? o[p] : () => undefined; },
    set(o, p: string, v) { o[p] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

const BASE: HomePageState = {
  maxLevel: 37, currentLevel: 38, levelCount: 1000,
  nickname: '小满', avatar: '', skinCount: 6, totalSkins: 16,
  starCount: 96, totalRetries: 23,
};

describe('首页提示条', () => {
  it('不开提示时不出现 fillProfile 按钮', () => {
    const ids = drawHomePage(ctxStub(), { ...BASE }, 0).map((b) => b.id);
    expect(ids).not.toContain('fillProfile');
  });

  it('开提示时出现 fillProfile，且分享条让位（不共存）', () => {
    const withPrompt = drawHomePage(ctxStub(), { ...BASE, showProfilePrompt: true }, 0).map((b) => b.id);
    expect(withPrompt).toContain('fillProfile');
    // 两者共用同一个槽位：同时画会叠在一起压住主 CTA
    expect(withPrompt).not.toContain('homeSharePick');
  });

  it('不提示时分享条正常出现', () => {
    const ids = drawHomePage(ctxStub(), { ...BASE, showProfilePrompt: false }, 0).map((b) => b.id);
    expect(ids).toContain('homeSharePick');
  });

  it('金色主 CTA 永远出现（不能被提示条挤掉）', () => {
    for (const show of [true, false]) {
      const ids = drawHomePage(ctxStub(), { ...BASE, showProfilePrompt: show }, 0).map((b) => b.id);
      expect(ids).toContain('homeStart');
    }
  });

  it('第 1 关（没打过）也不显示提示 —— 因为他刚走完引导，先让他玩', () => {
    // 这条是产品判断的记录：引导走完后**回大厅**才提示，
    // 不在引导过程中打扰。判据由 main.ts 决定（tutorialDone 之后才 syncHomeState）。
    expect(MAIN).toContain('showProfilePrompt: !progress.current.avatar');
  });
});

describe('判定信号', () => {
  it('用 avatar 而不是 nickname 判断已填', () => {
    // 服务端对新用户下发空昵称，而客户端 progress 默认昵称是「玩家」——
    // 用 nickname 判会恒为"已填"，提示条永远不出现。
    expect(MAIN).toContain('showProfilePrompt: !progress.current.avatar');
    expect(MAIN).not.toContain('showProfilePrompt: !progress.current.nickname');
  });
});

describe('分享前的提醒', () => {
  it('昵称没填时提示，但**照常打开面板**（不 return）', () => {
    const fn = MAIN.slice(
      MAIN.indexOf('function openSharePanel'),
      MAIN.indexOf('sharePanel.levelIdx = levelIdx'),
    );
    expect(fn).toContain('!progress.current.avatar');
    expect(fn).toContain('shareNameHinted');
    // 关键：提示之后不能 `return` —— 那等于"不填就不让分享"
    const hintIdx = fn.indexOf('shareNameHinted = true');
    const after = fn.slice(hintIdx);
    const beforeLevelIdx = after.slice(0, after.indexOf('sharePanel.levelIdx'));
    expect(beforeLevelIdx).not.toContain('return');
  });

  it('只提醒一次（每次点分享都念一遍会变成骚扰）', () => {
    expect(MAIN).toContain('shareNameHinted');
    expect(MAIN).toMatch(/if \(!progress\.current\.avatar && !shareNameHinted\)/);
  });
});

describe('引导走完后的引导', () => {
  it('引导三关走完、回大厅时提请完善资料', () => {
    const fn = MAIN.slice(MAIN.indexOf('function advanceTutorial'), MAIN.indexOf('function syncHomeState'));
    expect(fn).toContain('progress.current.avatar');
    expect(fn).toContain('顺手设个头像昵称');
    // 仍然不强制：没有弹授权框、没有 return
    expect(fn).not.toContain('platform.profile.request');
  });

  it('首页文案用的是 getUserProfile 那条路（手势触发）', () => {
    expect(HOME).toContain('getUserProfile');
    // 提示条是"可忽略"的：不能是整屏模态
    expect(HOME).not.toContain('rgba(6,12,9,0.78)');
  });
});
