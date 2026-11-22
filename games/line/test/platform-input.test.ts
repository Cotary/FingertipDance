import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { wechatPlatform } from '../src/platform/wechat';
import { douyinPlatform } from '../src/platform/douyin';

/**
 * 触摸 / 前后台 / 错误日志：三个**只在真机上才走得到**的分支。
 *
 * 它们的共同失败方式都是静默的：
 * - 触摸没绑上 → 点击一律无反应（抖音端曾整端如此，因为代码只读 `wx`）
 * - onShow 没读 query → 点好友分享卡片进来停在原界面
 * - 日志没写进去 → 线上崩了没有任何现场
 *
 * 真机之前至少要保证「命名空间选对了、回调真的被调到了」。
 */

type G = { wx?: Record<string, unknown>; tt?: Record<string, unknown> };
const KEYS = ['wx', 'tt'] as const;
const SAVED = KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);

beforeEach(() => {
  const g = globalThis as G;
  delete g.wx;
  delete g.tt;
});

afterEach(() => {
  for (const [k, desc] of SAVED) {
    if (desc) Object.defineProperty(globalThis, k, desc);
    else delete (globalThis as Record<string, unknown>)[k];
  }
});

/** 造一个只记回调的触摸宿主。 */
function touchHost() {
  const seen: Record<string, (e?: unknown) => void> = {};
  return {
    seen,
    api: {
      onTouchStart: (cb: (e?: unknown) => void) => { seen.start = cb; },
      onTouchMove: (cb: (e?: unknown) => void) => { seen.move = cb; },
      onTouchEnd: (cb: (e?: unknown) => void) => { seen.end = cb; },
      onTouchCancel: (cb: (e?: unknown) => void) => { seen.cancel = cb; },
    },
  };
}

/** 记录调用顺序的触摸绑定器。 */
function recorder() {
  const calls: string[] = [];
  return {
    calls,
    bind: {
      down: (x: number, y: number) => calls.push(`down:${x},${y}`),
      move: (x: number, y: number) => calls.push(`move:${x},${y}`),
      up: () => calls.push('up'),
      cancel: () => calls.push('cancel'),
    },
  };
}

describe('touch · 微信', () => {
  it('触摸从 wx 的四个回调进来，坐标是逻辑像素', () => {
    const host = touchHost();
    (globalThis as G).wx = host.api;
    const r = recorder();

    wechatPlatform.onTouch!(r.bind);
    host.seen.start({ touches: [{ clientX: 120, clientY: 340 }] });
    host.seen.move({ touches: [{ clientX: 130, clientY: 350 }] });
    host.seen.end();
    host.seen.cancel();

    expect(r.calls).toEqual(['down:120,340', 'move:130,350', 'up', 'cancel']);
  });

  it('手指不在 touches 里时用 changedTouches 兜底（抬手瞬间的最后一帧）', () => {
    const host = touchHost();
    (globalThis as G).wx = host.api;
    const r = recorder();
    wechatPlatform.onTouch!(r.bind);
    host.seen.move({ touches: [], changedTouches: [{ clientX: 7, clientY: 8 }] });
    expect(r.calls).toEqual(['move:7,8']);
  });
});

describe('touch · 抖音', () => {
  /**
   * 这条是**回归测试**。
   *
   * 改之前 `main.ts` 只读 `globalThis.wx.onTouchStart`，抖音包里没有 `wx`
   * —— 可选链静默短路，一个事件都收不到，表现是「能进游戏、点不动」。
   */
  it('触摸从 tt 进来（抖音端没有 wx）', () => {
    const host = touchHost();
    (globalThis as G).tt = host.api;
    const r = recorder();

    douyinPlatform.onTouch!(r.bind);
    host.seen.start({ touches: [{ clientX: 10, clientY: 20 }] });
    host.seen.end();

    expect(r.calls).toEqual(['down:10,20', 'up']);
  });

  it('抖音端**不能**去读 wx —— 那是别的平台的命名空间', () => {
    const host = touchHost();
    (globalThis as G).wx = host.api;
    const r = recorder();
    douyinPlatform.onTouch!(r.bind);
    // 只挂了 wx、没挂 tt：抖音实现应当什么也没绑上
    expect(host.seen.start).toBeUndefined();
    expect(r.calls).toEqual([]);
  });
});

describe('前后台', () => {
  it('微信 onShow 把 query 透出来（点分享卡片热启动就靠它）', () => {
    let onShow: ((res?: unknown) => void) | undefined;
    (globalThis as G).wx = { onShow: (cb: (res?: unknown) => void) => { onShow = cb; } };
    let got: Record<string, string> | undefined;
    wechatPlatform.onAppShow!((q) => { got = q; });
    onShow?.({ query: { l: '27', undos: '0' } });
    expect(got).toEqual({ l: '27', undos: '0' });
  });

  it('没有 query 时给空对象，调用方不必判 undefined', () => {
    let onShow: ((res?: unknown) => void) | undefined;
    (globalThis as G).wx = { onShow: (cb: (res?: unknown) => void) => { onShow = cb; } };
    let got: Record<string, string> | undefined;
    wechatPlatform.onAppShow!((q) => { got = q; });
    onShow?.({});
    expect(got).toEqual({});
  });

  it('抖音 onShow 同样透 query', () => {
    let onShow: ((res?: unknown) => void) | undefined;
    (globalThis as G).tt = { onShow: (cb: (res?: unknown) => void) => { onShow = cb; } };
    let got: Record<string, string> | undefined;
    douyinPlatform.onAppShow!((q) => { got = q; });
    onShow?.({ query: { l: '3' } });
    expect(got).toEqual({ l: '3' });
  });

  it('两端都没有 onShow 时不抛（老基础库 / 测试环境）', () => {
    expect(() => wechatPlatform.onAppShow!(() => {})).not.toThrow();
    expect(() => douyinPlatform.onAppHide!(() => {})).not.toThrow();
  });
});

describe('实时日志', () => {  it('微信：写进 getRealtimeLogManager，且带上自定义 filter', () => {
    const written: Array<[string, string]> = [];
    let filter = '';
    (globalThis as G).wx = {
      getRealtimeLogManager: () => ({
        setFilterMsg: (v: string) => { filter = v; },
        error: (tag: string, msg: string) => { written.push([tag, msg]); },
      }),
    };
    wechatPlatform.logError!('boot', new Error('关卡表坏了'));
    expect(filter).toBe('boot');
    expect(written).toHaveLength(1);
    expect(written[0][0]).toBe('boot');
    // 栈必须留着 —— 只写 message 的日志在线上等于没写
    expect(written[0][1]).toContain('关卡表坏了');
  });

  it('抖音：同样写进 tt 的实时日志', () => {
    const written: string[] = [];
    (globalThis as G).tt = {
      getRealtimeLogManager: () => ({ error: (_t: string, m: string) => { written.push(m); } }),
    };
    douyinPlatform.logError!('boot', 42);
    expect(written).toEqual(['42']);
  });

  it('拿不到实时日志能力时静默跳过（不能因为日志失败把游戏带崩）', () => {
    expect(() => wechatPlatform.logError!('x', new Error('y'))).not.toThrow();
    expect(() => douyinPlatform.logError!('x', { a: 1 })).not.toThrow();
  });
});

describe('launchQuery · 分享挑战的入口', () => {
  /**
   * 这条是**回归测试**：抖音端以前根本没有 `launchQuery`，
   * `challenge.ts` 于是退到 `location` 分支 —— 小游戏里没有 `location`，
   * 所有分享链接都打开不了对应关卡，而且一行报错都没有。
   */
  it('抖音读 tt.getLaunchOptionsSync().query', () => {
    (globalThis as G).tt = {
      getLaunchOptionsSync: () => ({ query: { l: '12', undos: '0' } }),
    };
    expect(douyinPlatform.launchQuery!()).toEqual({ l: '12', undos: '0' });
  });

  it('微信读 wx.getLaunchOptionsSync().query', () => {
    (globalThis as G).wx = {
      getLaunchOptionsSync: () => ({ query: { l: '27', c: 'TOK' } }),
    };
    expect(wechatPlatform.launchQuery!()).toEqual({ l: '27', c: 'TOK' });
  });

  it('抖音不会去读 wx 的启动参数（命名空间不能串）', () => {
    (globalThis as G).wx = {
      getLaunchOptionsSync: () => ({ query: { l: '99' } }),
    };
    expect(douyinPlatform.launchQuery!()).toEqual({});
  });

  it('没有启动参数能力时返回空对象，不抛（老基础库）', () => {
    expect(wechatPlatform.launchQuery!()).toEqual({});
    expect(douyinPlatform.launchQuery!()).toEqual({});
  });

  it('平台 API 自己抛错时也返回空对象（不能把启动流程打断）', () => {
    (globalThis as G).wx = {
      getLaunchOptionsSync: () => { throw new Error('boom'); },
    };
    expect(wechatPlatform.launchQuery!()).toEqual({});
  });
});
