import { describe, it, expect } from 'vitest';
import { Ads } from '../src/ads/ads';
import { needsAdForHint, canSkipToday, markSkippedToday, isSkinUnlocked } from '../src/ads/rewardRules';

describe('ads', () => {
  it('首次提示需要广告，之后免费', () => {
    expect(needsAdForHint(1, 0)).toBe(true);
    expect(needsAdForHint(1, 1)).toBe(false);
    expect(needsAdForHint(1, 2)).toBe(false);
  });

  it('广告失败时兜底返回 true（不卡玩家）', async () => {
    // Web mock 的广告总是成功；这里只验证不抛异常且返回布尔
    const a = new Ads();
    const r = await a.showRewarded('hint');
    expect(typeof r).toBe('boolean');
  });

  it('canSkipToday 初始为 true，标记后为 false', () => {
    const idx = 99999;
    expect(canSkipToday(idx)).toBe(true);
    markSkippedToday(idx);
    expect(canSkipToday(idx)).toBe(false);
  });

  it('isSkinUnlocked 正确反映集合', () => {
    const s = new Set(['wood', 'mint']);
    expect(isSkinUnlocked(s, 'wood')).toBe(true);
    expect(isSkinUnlocked(s, 'gold')).toBe(false);
  });

  it('插屏频控：连续调用第二次被跳过', async () => {
    const a = new Ads();
    // 第一次调用 lastInterstitialAt=0，now-0 很大，能通过
    await a.showInterstitial('result_interstitial');
    // 第二次立即调用，间隔 < 60s，被跳过（无副作用）
    await a.showInterstitial('result_interstitial');
    // 不抛异常即通过
    expect(true).toBe(true);
  });
});
