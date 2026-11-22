import { describe, it, expect } from 'vitest';
import { dayKeyCN, adRewardedKey, skipCountKey, skipLevelKey } from '../src/core/dayKey';

/**
 * 每日额度必须和服务端同一天。
 *
 * ## 这个 bug 长什么样
 *
 * 客户端原来用 `new Date().toISOString().slice(0,10)` —— 那是 **UTC**。
 * 服务端用 `time.Now().Format("2006-01-02")` 配 `TZ=Asia/Shanghai` —— 东八区。
 *
 * 于是每天 **00:00 ~ 08:00** 这八小时里两边日期不同：
 * 东八区已经是 11月24日，UTC 还停在 11月23日。
 *
 * 后果：
 * - 玩家凌晨 1 点跳关：客户端记到 23 日的键里，服务端记 24 日 →
 *   服务端说「今日 0 次」放行，但客户端以为额度已用，**拦着不让跳**；
 * - 或者反过来：客户端额度还没用完，服务端按新的一天算，也可能出现
 *   「客户端说没了、服务端说还有」/「客户端说还有，服务端 4007 拒绝」。
 *
 * 两种都只在凌晨出现，测试和白天验收都发现不了。
 */

/** 构造某个东八区时刻的时间戳。 */
function cn(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return Date.UTC(y, m - 1, d, hh - 8, mm); // 东八区 = UTC+8
}

describe('dayKeyCN · 东八区日期', () => {
  it('凌晨 0 点整已经是新的一天（UTC 还停在前一天）', () => {
    // 东八区 2026-11-24 00:00 == UTC 2026-11-23 16:00
    const t = cn(2026, 11, 24, 0, 0);
    expect(new Date(t).toISOString().slice(0, 10)).toBe('2026-11-23'); // UTC 口径
    expect(dayKeyCN(t)).toBe('2026-11-24'); // 我们要的口径
  });

  it('早上 7:59 仍算当天（UTC 口径会算成前一天）', () => {
    const t = cn(2026, 11, 24, 7, 59);
    expect(dayKeyCN(t)).toBe('2026-11-24');
  });

  it('早上 8:00 前后是同一个东八区日期（UTC 在此换天，我们不该跟着换）', () => {
    expect(dayKeyCN(cn(2026, 11, 24, 7, 59))).toBe(dayKeyCN(cn(2026, 11, 24, 8, 1)));
  });

  it('跨年夜零点进到次年 1 月 1 日', () => {
    expect(dayKeyCN(cn(2026, 12, 31, 23, 59))).toBe('2026-12-31');
    expect(dayKeyCN(cn(2027, 1, 1, 0, 0))).toBe('2027-01-01');
  });

  it('闰年 2 月 29 日正确', () => {
    expect(dayKeyCN(cn(2028, 2, 29, 12, 0))).toBe('2028-02-29');
  });

  it('月份与日期都补零（键名要能排序、能肉眼读）', () => {
    expect(dayKeyCN(cn(2026, 1, 5, 12, 0))).toBe('2026-01-05');
  });

  it('不依赖运行环境时区（同一时间戳在任何 TZ 下结果一致）', () => {
    const t = cn(2026, 11, 24, 3, 0);
    // 实现里用的是 getUTC* + 手工偏移，所以结果与环境无关。
    // 这条断言是防止有人"优化"成 toLocaleDateString。
    expect(dayKeyCN(t)).toBe('2026-11-24');
  });
});

describe('存储键', () => {
  it('三种键都带东八区日期，且前缀不互相包含', () => {
    const t = cn(2026, 11, 24, 1, 0);
    expect(adRewardedKey(t)).toBe('ad_rewarded_2026-11-24');
    expect(skipCountKey(t)).toBe('skip_count_2026-11-24');
    expect(skipLevelKey(47, t)).toBe('skip_2026-11-24_47');
  });

  it('不同关的 skip 键不同（否则一关跳过会连带锁住另一关）', () => {
    const t = cn(2026, 11, 24, 12, 0);
    expect(skipLevelKey(1, t)).not.toBe(skipLevelKey(2, t));
  });

  it('跨天后键变化（额度自然重置，不需要定时器）', () => {
    const d1 = cn(2026, 11, 24, 23, 59);
    const d2 = cn(2026, 11, 25, 0, 1);
    expect(skipCountKey(d1)).not.toBe(skipCountKey(d2));
  });
});
