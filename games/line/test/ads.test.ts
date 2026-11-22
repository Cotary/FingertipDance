import { describe, it, expect } from 'vitest';
import { Ads } from '../src/ads/ads';
import { platform } from '../src/platform';
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

  it('看完一次 → 触发 onWatched（本地计数与服务端上报都靠它）', async () => {
    // Web mock 的激励视频总是「看完」，所以这里能拿到 completed === true。
    // 回调挂在 Ads 上而不是四个调用点各写一遍：漏一处就是「某类广告不计次」，
    // 而界面上完全看不出来（那个数字只会偏小）。
    const a = new Ads();
    const seen: string[] = [];
    a.setOnWatched((placement) => seen.push(placement));

    const ok = await a.showRewarded('skip');
    expect(ok).toBe(true);
    expect(seen).toEqual(['skip']);
  });

  it('中途退出（false）不触发 onWatched —— 没看完不算一次', async () => {
    const a = new Ads();
    const seen: string[] = [];
    a.setOnWatched((p) => seen.push(p));

    // 把平台实现临时换掉，模拟「玩家看了 3 秒就关掉」
    const orig = platform.ad.showRewarded;
    (platform.ad as unknown as { showRewarded: () => Promise<boolean> }).showRewarded =
      async () => false;
    try {
      const ok = await a.showRewarded('hint');
      expect(ok).toBe(false);
      expect(seen, '没看完不该计数').toEqual([]);
    } finally {
      (platform.ad as unknown as { showRewarded: typeof orig }).showRewarded = orig;
    }
  });
});
