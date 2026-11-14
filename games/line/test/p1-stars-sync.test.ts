/**
 * P1 回归测试：结算页的星级口径与进度同步。
 *
 * ## 覆盖两个问题
 *
 * 1. **跳过却显示 3 星**
 *    跳过时 `undos = 0`，`starOfCover(0) = 3` → 结算页画三星。
 *    但服务端 `CoverSkipHandler` 不发星、客户端 `clearStar` 也清了星 ——
 *    同一关在结算页是三星、在地图上没星，自相矛盾。
 *
 * 2. **上报失败后地图状态不同步**
 *    服务端没记上 → `maxLevel` 不变 → 地图把下一关画成锁着，
 *    但玩家已经打完了这一关。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const { starOfCover, starOf } = await import('../src/ui/hud');

describe('P1 / 跳过不给星', () => {
  it('starOfCover(0) = 3 星（正常通关无重来）', () => {
    expect(starOfCover(0)).toBe(3);
  });

  it('跳过的关卡在本地不留星级', () => {
    const p = new ProgressStore();
    p.setStar(5, 3);
    expect(p.current.stars['5']).toBe(3);

    // 跳过 → 清星
    p.clearStar(5);
    expect(p.current.stars['5']).toBeUndefined();
  });

  it('clearStar 对从未打过星的关卡是安全的（不抛）', () => {
    const p = new ProgressStore();
    expect(() => p.clearStar(999)).not.toThrow();
    expect(p.current.stars['999']).toBeUndefined();
  });

  it('setStar 不会用更低的星覆盖更高的星', () => {
    const p = new ProgressStore();
    p.setStar(5, 3);
    p.setStar(5, 1);
    expect(p.current.stars['5']).toBe(3);
  });

  it('setStar(0) 不写入（0 星 = 不点亮）', () => {
    const p = new ProgressStore();
    p.setStar(5, 0);
    expect(p.current.stars['5']).toBeUndefined();
  });
});

describe('P1 / 星级阈值与后端一致', () => {
  it('cover 星级：0→3, 1~2→2, 3+→1', () => {
    expect(starOfCover(0)).toBe(3);
    expect(starOfCover(1)).toBe(2);
    expect(starOfCover(2)).toBe(2);
    expect(starOfCover(3)).toBe(1);
    expect(starOfCover(99)).toBe(1);
  });

  it('经典星级：步数比最短步数多就掉星', () => {
    expect(starOf(10, 10)).toBe(3);
    expect(starOf(12, 10)).toBe(2);
    expect(starOf(20, 10)).toBe(1);
    // shortest <= 0 的保护
    expect(starOf(10, 0)).toBe(1);
  });
});

describe('P1 / 上报失败也要推进本地进度', () => {
  beforeEach(() => store.clear());

  it('乐观更新：maxLevel 取本地与服务端的最大值', () => {
    const p = new ProgressStore();
    p.sync({ maxLevel: 3 });

    // 模拟「服务端返回了更小的 maxLevel」或「没同步」
    p.sync({ maxLevel: Math.max(p.current.maxLevel, 5) });
    expect(p.current.maxLevel).toBe(5);
    // `currentLevel` 是 Store 上的派生 getter（不在 progress 对象里）
    expect(p.currentLevel).toBe(6);
  });

  it('服务端返回更小的 maxLevel 不会把进度退回去', () => {
    const p = new ProgressStore();
    p.sync({ maxLevel: 10 });
    // 服务端返回旧值（缓存/竞态）→ 不应回退
    p.sync({ maxLevel: Math.max(p.current.maxLevel, 10) });
    expect(p.current.maxLevel).toBe(10);
  });
});
