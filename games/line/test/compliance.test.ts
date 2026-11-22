import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawAgeGate, AGE_RATING, KEY_AGE_ACK } from '../src/ui/ageGate';

/**
 * 合规与统计口径的接线。
 *
 * ## 为什么这类东西要用源码断言
 *
 * 「隐私授权在登录之前」「广告计数上报了」「累计重来不再本地自增」——
 * 这几条都是**流程顺序**，用纯函数单测测不出来（它们分布在 boot 和事件处理里），
 * 而一旦被后人改回去，表现全是静默的：
 *
 * - 授权放到登录之后：`wx.login` 已经收集了 openid，提审被判违规；
 * - 广告计数没上报：后台「看广告次数」永远是 0（正是这轮要修的 bug）；
 * - 累计重来又变成本地 +1：界面上那个数字和后台对不上。
 */

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(here, '../src/main.ts'), 'utf8');
const API = readFileSync(resolve(here, '../src/net/api.ts'), 'utf8');
const WX_ASSETS = readFileSync(resolve(here, '../scripts/copy-wx-assets.mjs'), 'utf8');

/** Canvas 桩：绘图全部 no-op。 */
function fakeCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = { measureText: () => ({ width: 10 }) };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return () => undefined;
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('适龄提示卡片', () => {
  it('固定一档 8+，文案里带家长监护', () => {
    expect(AGE_RATING).toBe('8+');
    const ids = drawAgeGate(fakeCtx(), true).map((b) => b.id);
    expect(ids).toContain('ageGateOk');
  });

  it('点卡外也能关（遮罩是同一个 id，不会出现点不动的死路）', () => {
    const btns = drawAgeGate(fakeCtx(), true);
    // 最后一个一定是整屏遮罩，否则玩家点到卡外会没有任何反应
    const full = btns[btns.length - 1];
    expect(full.id).toBe('ageGateOk');
    expect(full.w).toBeGreaterThan(300);
  });

  it('只有微信端才画「隐私保护指引」入口', () => {
    const withPrivacy = drawAgeGate(fakeCtx(), true).map((b) => b.id);
    const withoutPrivacy = drawAgeGate(fakeCtx(), false).map((b) => b.id);
    expect(withPrivacy).toContain('ageGatePrivacy');
    expect(withoutPrivacy).not.toContain('ageGatePrivacy');
  });

  it('首次启动才自动弹：靠本地标记', () => {
    expect(MAIN).toMatch(new RegExp(`ageGateOpen = platform\\.storage\\.get\\(KEY_AGE_ACK\\)`));
    expect(KEY_AGE_ACK).toBeTruthy();
  });
});

describe('隐私授权必须在登录之前', () => {
  it('boot 里先调 ensurePrivacyAuthorized，再 login', () => {
    const privacy = MAIN.indexOf('await ensurePrivacyAuthorized()');
    const loginAt = MAIN.indexOf('const loginRes = await login()');
    expect(privacy).toBeGreaterThan(0);
    expect(loginAt).toBeGreaterThan(0);
    expect(privacy, '授权必须在 wx.login 之前').toBeLessThan(loginAt);
  });

  it('没授权就不登录（但不是不让人玩）', () => {
    expect(MAIN).toMatch(/if \(privacyOK\) try \{/);
  });

  it('game.json 要声明 __usePrivacyCheck__，否则平台根本不会弹授权', () => {
    expect(WX_ASSETS).toContain('__usePrivacyCheck__: true');
  });
});

describe('统计口径', () => {
  it('广告看完会上报服务端（挂着 Ads 的回调，四个调用点不用各写一遍）', () => {
    expect(MAIN).toMatch(/ads\.setOnWatched\(/);
    expect(MAIN).toMatch(/reportAdWatch\(placement\)/);
  });

  it('累计重来不再本地自增（口径是服务端 SUM(undos)）', () => {
    expect(MAIN).not.toMatch(/totalRetries: \(progress\.current\.totalRetries \?\? 0\) \+ 1/);
    expect(MAIN).toMatch(/totalRetries: loginRes\.totalRetries/);
  });

  it('登录必须带平台，否则抖音玩家全被记成微信（平台配置永远下发微信那份）', () => {
    expect(API).toMatch(/platform: platform\.name/);
  });

  it('资料更新与广告计数都有对应接口', () => {
    expect(API).toContain("'/api/profile'");
    expect(API).toContain("'/api/cover/ad-watch'");
  });
});
