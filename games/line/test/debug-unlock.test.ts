import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 调试模式：可以点任意一关。
 *
 * ## 为什么要有这个功能
 *
 * 1000 关手动打过来不现实；想复现某个具体关卡的 bug 更不可能。
 * 测试环境需要能直接进入任意一关。
 *
 * ## 关键约束
 *
 * **只影响客户端界面**。服务端有独立的 `debug.enabled` 配置，
 * 客户端绕过不算数（详见 `server/internal/games/line/debug_jump.go`）。
 *
 * ## 为什么用 `vi.doMock` 而不是直接 import
 *
 * `DEBUG_ENABLED` 是**构建期常量**（`vite define` 注入），
 * 在测试里被**字面量内联**了 —— `vi.stubGlobal('__DEBUG__', ...)` 没用。
 *
 * 所以这里 mock 整个 `core/debug` 模块，再用动态 import 重新加载
 * `ui/mapview`（`vi.resetModules()` 让模块缓存失效）。
 */

/** 按给定的调试开关重新加载 mapview 模块。 */
async function loadMapview(debug: boolean) {
  vi.resetModules();
  vi.doMock('../src/core/debug', () => ({ DEBUG_ENABLED: debug }));
  return await import('../src/ui/mapview');
}

describe('调试模式：点击任意关卡', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../src/core/debug');
    vi.resetModules();
  });

  it('正常模式下，锁着的关不可点', async () => {
    const { createMapState, isLevelPlayable } = await loadMapview(false);
    const st = createMapState(3, 1000, {});
    expect(st.debugUnlockAll).toBe(false);

    // 已通关 / 当前关可以点
    expect(isLevelPlayable(1, st)).toBe(true);
    expect(isLevelPlayable(2, st)).toBe(true);
    expect(isLevelPlayable(3, st)).toBe(true);

    // 锁着的关不可点
    expect(isLevelPlayable(4, st)).toBe(false);
    expect(isLevelPlayable(500, st)).toBe(false);
    expect(isLevelPlayable(1000, st)).toBe(false);
  });

  it('调试模式下，所有关卡都可点', async () => {
    const { createMapState, isLevelPlayable } = await loadMapview(true);
    const st = createMapState(3, 1000, {}, true);
    expect(st.debugUnlockAll).toBe(true);

    for (const idx of [1, 3, 4, 100, 500, 999, 1000]) {
      expect(isLevelPlayable(idx, st)).toBe(true);
    }
  });

  it('生产构建（DEBUG_ENABLED=false）时，即使误传 true 也不开调试', async () => {
    const { createMapState, isLevelPlayable } = await loadMapview(false);
    // 调用方误传了 true —— 但构建期开关关着，就不能开
    const st = createMapState(3, 1000, {}, true);
    expect(st.debugUnlockAll).toBe(false);
    expect(isLevelPlayable(500, st)).toBe(false);
  });

  it('调试模式下，锁着的关依然能被点击命中（几何上画出来了就能点）', async () => {
    const { createMapState, mapNodePos, pickMapNode, scrollToLevel, camXOf, screenXOf } = await loadMapview(true);
    const st = createMapState(1, 1000, {}, true);
    // 先滚到第 500 关 —— `pickMapNode` 只命中**可视区**内的节点
    st.scrollY = scrollToLevel(500);
    const p = mapNodePos(500);
    // 命中判定吃屏幕坐标：横向要先减掉相机偏移
    const sx = screenXOf(p.x, camXOf(st.scrollY, st.levelCount));
    expect(pickMapNode(sx, p.y - st.scrollY, st)).toBe(500);
  });

  it('调试开关只影响可玩性，不影响地图结构（关数 / 滚动范围）', async () => {
    const { createMapState } = await loadMapview(true);
    const normal = createMapState(1, 1000, {});
    const debug = createMapState(1, 1000, {}, true);

    expect(debug.levelCount).toBe(normal.levelCount);
    expect(debug.maxScrollY).toBe(normal.maxScrollY);
    expect(debug.currentLevel).toBe(normal.currentLevel);
  });
});
