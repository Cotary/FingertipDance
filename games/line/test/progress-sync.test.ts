import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `ProgressStore.sync` 的回归测试。
 *
 * ## 背景：真实踩过的坑
 *
 * cover 模式的成绩接口 `/api/cover/progress` 一度**没有返回 `unlockedSkins`**，
 * 而客户端写的是：
 *
 * ```ts
 * progress.sync({
 *   maxLevel: res.maxLevel,
 *   unlockedSkins: res.unlockedSkins,   // ← undefined
 *   ...
 * });
 * ```
 *
 * `sync` 是整体覆盖语义，`{...old, unlockedSkins: undefined}` 会把本地
 * 皮肤数组**覆盖成 `undefined`**。下一帧 `progress.current.unlockedSkins.length`
 * 直接抛 `Cannot read properties of undefined (reading 'length')`，
 * 而 `requestAnimationFrame(frame)` 在函数末尾调用 —— 一帧抛异常，
 * **整个渲染循环就永久中断**。
 *
 * 表现：通关后画面卡在结算动画，「下一关」按钮点了没反应，
 * 也不会报任何网络错误，极难定位。
 *
 * 修复有两层：
 *   1. 服务端补回 `unlockedSkins` 字段；
 *   2. 客户端 `sync` 忽略 `undefined`，不让缺失字段覆盖已有值。
 *
 * 这里锁死第 2 层 —— 它是防御性的，永久生效。
 */

const store = new Map<string, string>();
const storage = {
  get: (k: string) => store.get(k) ?? null,
  set: (k: string, v: string) => void store.set(k, v),
  remove: (k: string) => void store.delete(k),
};

vi.mock('../src/platform', () => ({
  platform: {
    name: 'web',
    storage,
    request: async () => ({ ok: true }),
    vibrate: () => {},
  },
}));

const { ProgressStore } = await import('../src/game/progressStore');

describe('ProgressStore.sync', () => {
  beforeEach(() => store.clear());

  it('缺字段（undefined）不会把已有值覆盖掉', () => {
    const p = new ProgressStore();
    p.sync({ unlockedSkins: ['wood', 'mint'], maxLevel: 3 });
    expect(p.current.unlockedSkins).toEqual(['wood', 'mint']);

    // 服务端少返回了 unlockedSkins
    p.sync({ maxLevel: 4, unlockedSkins: undefined });
    expect(p.current.unlockedSkins).toEqual(['wood', 'mint']);
    expect(p.current.maxLevel).toBe(4);
  });

  it('缺字段后皮肤数组仍然可用（.length 不抛）', () => {
    // 这是本次 bug 的直接触发点：下一帧读 .length 就崩
    const p = new ProgressStore();
    p.sync({ unlockedSkins: undefined });
    expect(() => p.current.unlockedSkins.length).not.toThrow();
    expect(p.current.unlockedSkins.length).toBe(2); // 默认 ['wood','mint']
  });

  it('正常覆盖仍然生效', () => {
    const p = new ProgressStore();
    p.sync({ unlockedSkins: ['a', 'b', 'c'], maxLevel: 7 });
    expect(p.current.unlockedSkins).toEqual(['a', 'b', 'c']);
    expect(p.current.maxLevel).toBe(7);
  });

  it('显式传空数组是合法的（表示服务端确实说没有皮肤）', () => {
    const p = new ProgressStore();
    p.sync({ unlockedSkins: [] });
    expect(p.current.unlockedSkins).toEqual([]);
  });

  it('currentLevel = 最高已通关 + 1（下一个可玩关）', () => {
    // 服务端 users.max_level 的语义是「最高已通关关号」，
    // 0 = 一关都没通。下一个该打的关是 maxLevel + 1。
    //
    // 以前客户端直接拿 maxLevel 当「当前关」，
    // 通关第 1 关后大厅写「继续 第 1 关」、地图把第 2 关锁着。
    const p = new ProgressStore();
    expect(p.current.maxLevel).toBe(0);
    expect(p.currentLevel).toBe(1);

    p.sync({ maxLevel: 1 });
    expect(p.currentLevel).toBe(2);

    p.sync({ maxLevel: 37 });
    expect(p.currentLevel).toBe(38);
  });
});
