/**
 * 剪贴板：复制分享链接走平台能力，不走 `navigator`。
 *
 * ## 为什么值得单独测
 *
 * 改之前 `copyInviteLink` 直接 `navigator.clipboard.writeText(url)`。
 * 小游戏端**没有 `navigator`** —— 这句会抛 `ReferenceError`，被 `try/catch`
 * 兜住后给玩家「复制没成功，长按上面的链接试试」，而小游戏界面上
 * 根本没有可长按的链接文本。也就是说「复制链接」在真正的发行端**从来没成功过**。
 *
 * 这里锁两件事：
 * 1. `wx` / `tt` 的 `setClipboardData` 被真的调到，且传的是完整链接
 * 2. 平台没有这个 API / 系统拒绝时**返回 false**，不抛异常、不假装成功
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { wechatPlatform } from '../src/platform/wechat';
import { douyinPlatform } from '../src/platform/douyin';

type G = { wx?: Record<string, unknown>; tt?: Record<string, unknown> };

// 按 descriptor 存快照再还原 —— 不允许 `delete globalThis.wx` 了事，
// 那是上一轮整轮测试被静默中断的根因（见 platform-runtime.test.ts 的说明）。
const KEYS = ['wx', 'tt'] as const;
const SAVED = KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);

beforeEach(() => {
  const g = globalThis as G;
  delete g.wx;
  delete g.tt;
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const [k, desc] of SAVED) {
    if (desc) Object.defineProperty(globalThis, k, desc);
    else delete g[k];
  }
});

describe('微信端剪贴板', () => {
  it('调 setClipboardData 并传入完整文本', async () => {
    const seen: string[] = [];
    (globalThis as G).wx = {
      setClipboardData: (opts: { data: string; success?: () => void }) => {
        seen.push(opts.data);
        opts.success?.();
      },
    };

    const ok = await wechatPlatform.clipboard!.set('https://x.cn/p?l=7&undos=0');
    expect(ok).toBe(true);
    expect(seen).toEqual(['https://x.cn/p?l=7&undos=0']);
  });

  it('系统拒绝时返回 false（调用方据此改文案，不能假装成功）', async () => {
    (globalThis as G).wx = {
      setClipboardData: (opts: { fail?: () => void }) => opts.fail?.(),
    };
    expect(await wechatPlatform.clipboard!.set('x')).toBe(false);
  });

  it('没有 wx（浏览器 / 测试环境）时返回 false，不抛异常', async () => {
    expect(await wechatPlatform.clipboard!.set('x')).toBe(false);
  });

  it('老基础库没有 setClipboardData 时也返回 false', async () => {
    (globalThis as G).wx = {};
    expect(await wechatPlatform.clipboard!.set('x')).toBe(false);
  });
});

describe('抖音端剪贴板', () => {
  it('走 tt.setClipboardData，且不会误用 wx', async () => {
    const seen: string[] = [];
    (globalThis as G).tt = {
      setClipboardData: (opts: { data: string; success?: () => void }) => {
        seen.push(opts.data);
        opts.success?.();
      },
    };
    (globalThis as G).wx = {
      setClipboardData: () => {
        throw new Error('抖音端不该调 wx.setClipboardData');
      },
    };

    expect(await douyinPlatform.clipboard!.set('https://x.cn/p')).toBe(true);
    expect(seen).toEqual(['https://x.cn/p']);
  });
});
