import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { createAudioContext, hasConvolver, type MiniAudioContext } from '../src/platform/webaudio';
import { canCreateOffscreenCanvas, createOffscreenCanvas } from '../src/platform/offscreen';

/**
 * 小游戏端的两条"平台分支"。
 *
 * 这两个文件是小游戏**能不能出声 / 能不能画棋子**的唯一开关，
 * 而它们的失败方式是**静默的**：没有 AudioContext 就整条链不出声，
 * 拿不到离屏画布就少一层影子。跑真机之前，至少要保证分支选对了。
 */

type G = {
  wx?: Record<string, unknown>;
  tt?: Record<string, unknown>;
  AudioContext?: unknown;
  window?: unknown;
};

/**
 * 把全局恢复成「小游戏环境」：有 `wx`/`tt` 可选、**没有** `window.AudioContext`。
 *
 * ⚠️ 不要 `delete globalThis.window`。
 *
 * 这是踩过的坑：`voice.test.ts` 把 `window` 挂在全局上没还原，这里再删掉它，
 * 同一个 fork 里后续文件的 vitest RPC 会按「浏览器」分支走，
 * 报一个和测试毫无关系的 `RangeError: Invalid array length`，并且**整个 run 提前中断**
 * （表现为「31 个文件通过、32 个文件」而目录里实际有 56 个）。
 *
 * 所以：`window` 只清空不删除 —— `g.window?.AudioContext` 一样是 undefined，
 * 拿不到上下文，但 `typeof window !== 'undefined'` 仍然成立。
 * 每个用例结束后按快照还原，互不污染。
 */
const KEYS = ['wx', 'tt', 'AudioContext', 'window'] as const;
const SAVED = KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);

function reset(): void {
  const g = globalThis as G;
  delete g.wx;
  delete g.tt;
  delete g.AudioContext;
  g.window = {};
}

function restore(): void {
  for (const [k, desc] of SAVED) {
    if (desc) Object.defineProperty(globalThis, k, desc);
    else delete (globalThis as Record<string, unknown>)[k];
  }
}

beforeEach(reset);
afterEach(restore);

describe('webaudio · 上下文选择', () => {
  it('小游戏端走 wx.createWebAudioContext（没有 window.AudioContext）', () => {
    const fake = { name: 'wx-ctx' } as unknown as MiniAudioContext;
    (globalThis as G).wx = { createWebAudioContext: () => fake };
    expect(createAudioContext()).toBe(fake);
  });

  it('抖音端走 tt.createWebAudioContext', () => {
    const fake = { name: 'tt-ctx' } as unknown as MiniAudioContext;
    (globalThis as G).tt = { createWebAudioContext: () => fake };
    expect(createAudioContext()).toBe(fake);
  });

  it('都没有时返回 null（调用方静默降级，不能抛）', () => {
    expect(createAudioContext()).toBeNull();
  });

  it('小游戏上下文没有 createConvolver → 判为不支持混响', () => {
    const fake = {} as MiniAudioContext;
    expect(hasConvolver(fake)).toBe(false);
  });

  it('有 createConvolver 时判为支持', () => {
    const fake = { createConvolver: () => ({}) } as unknown as MiniAudioContext;
    expect(hasConvolver(fake)).toBe(true);
  });
});

describe('offscreen · 画布选择', () => {
  it('小游戏端走 wx.createOffscreenCanvas，且按 2d + 尺寸创建', () => {
    let seen: { type: string; width: number; height: number } | null = null;
    (globalThis as G).wx = {
      createOffscreenCanvas: (o: { type: string; width: number; height: number }) => {
        seen = o;
        return { width: o.width, height: o.height, getContext: () => null };
      },
    };
    const c = createOffscreenCanvas(120, 80);
    expect(c).toBeTruthy();
    expect(seen).toEqual({ type: '2d', width: 120, height: 80 });
    expect(canCreateOffscreenCanvas()).toBe(true);
  });

  it('抖音端也走同一套工厂', () => {
    (globalThis as G).tt = {
      createOffscreenCanvas: (o: { width: number; height: number }) => ({
        width: o.width, height: o.height, getContext: () => null,
      }),
    };
    expect(createOffscreenCanvas(12, 12)?.width).toBe(12);
  });

  it('零尺寸被兜成 1（0×0 画布画出来什么都没有，且不报错）', () => {
    (globalThis as G).wx = {
      createOffscreenCanvas: (o: { width: number; height: number }) => ({
        width: o.width, height: o.height, getContext: () => null,
      }),
    };
    const c = createOffscreenCanvas(0, -5);
    expect(c?.width).toBe(1);
    expect(c?.height).toBe(1);
  });

  it('拿不到工厂时返回 null，且 canCreate 为 false', () => {
    expect(createOffscreenCanvas(10, 10)).toBeNull();
    expect(canCreateOffscreenCanvas()).toBe(false);
  });

  it('工厂抛错时返回 null（老基础库不能把整盘带崩）', () => {
    (globalThis as G).wx = {
      createOffscreenCanvas: () => { throw new Error('not supported'); },
    };
    expect(createOffscreenCanvas(10, 10)).toBeNull();
  });
});
