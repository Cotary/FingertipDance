/**
 * 首页「分享挑战」的选关规则：只能选自己已经通过的关。
 *
 * ## 判据
 *
 * 用 cover 星级表（`/api/progress/stars?mode=cover`）：
 * 服务端只为真正打过的关写星，看广告跳过（`skipped`）的关没有星。
 * 所以 `stars[idx] > 0` 才是「通过」，`idx < currentLevel` 只能当地图显示口径，
 * 不能拿来分享 —— 那会把跳过关一起放进来。
 */
import { describe, it, expect } from 'vitest';

import { createMapState, isLevelCleared } from '../src/ui/mapview';

describe('分享选关：只能选已通过的关', () => {
  it('有星级表时，只有真正打过（有星）的关可选', () => {
    // 当前关 7：1..6 在地图上都画成「已过关」，但 3、4 是跳过的（无星）
    const st = createMapState(7, 1000, { '1': 3, '2': 2, '5': 1, '6': 1 });

    expect(isLevelCleared(1, st)).toBe(true);
    expect(isLevelCleared(2, st)).toBe(true);
    expect(isLevelCleared(5, st)).toBe(true);
    expect(isLevelCleared(6, st)).toBe(true);

    // 跳过关：地图上已过关，但没有星，不能分享
    expect(isLevelCleared(3, st)).toBe(false);
    expect(isLevelCleared(4, st)).toBe(false);

    // 当前关还没打
    expect(isLevelCleared(7, st)).toBe(false);
    // 未来的关
    expect(isLevelCleared(8, st)).toBe(false);
  });

  it('一关都没打时，任何关都不可选', () => {
    const st = createMapState(1, 1000, {});
    for (const idx of [1, 2, 10]) expect(isLevelCleared(idx, st)).toBe(false);
  });

  it('星级表还没拉回来时，退回「当前关之前」的地图口径', () => {
    // 首屏 / 断网：stars 为空。不能让有进度的玩家一个都选不了。
    const st = createMapState(6, 1000, {});
    for (const idx of [1, 2, 3, 4, 5]) expect(isLevelCleared(idx, st)).toBe(true);
    expect(isLevelCleared(6, st)).toBe(false);
  });

  it('关号越界一律不可选', () => {
    const st = createMapState(6, 1000, { '1': 3 });
    expect(isLevelCleared(0, st)).toBe(false);
    expect(isLevelCleared(-1, st)).toBe(false);
    expect(isLevelCleared(1001, st)).toBe(false);
  });
});
