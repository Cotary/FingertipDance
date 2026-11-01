import { platform } from '../platform';
import { reportEvent } from '../net/api';

/** 广告位。 */
export type Placement = 'hint' | 'skip' | 'skin_unlock' | 'result_interstitial' | 'skin_banner';

/**
 * 广告管理器。统一处理奖励判定、失败兜底与埋点。
 */
export class Ads {
  /** 上次插屏时间戳。 */
  private lastInterstitialAt = 0;
  /** 插屏最小间隔（毫秒）。 */
  private interstitialInterval = 60_000;

  /**
   * 展示激励视频。
   * @param placement 广告位，用于埋点
   * @returns true = 完整看完（或加载失败兜底发放），false = 中途退出
   */
  async showRewarded(placement: Placement): Promise<boolean> {
    reportEvent('ad_start', { ad_type: 'rewarded', placement });
    try {
      const completed = await platform.ad.showRewarded(placement);
      if (completed) {
        reportEvent('ad_complete', { ad_type: 'rewarded', placement });
      } else {
        reportEvent('ad_abort', { ad_type: 'rewarded', placement });
      }
      return completed;
    } catch (e) {
      reportEvent('ad_error', { ad_type: 'rewarded', placement, err_msg: String(e) });
      // 兜底：广告不可用时直接发放，避免玩家点击无响应
      return true;
    }
  }

  /**
   * 展示插屏。带频控。
   */
  async showInterstitial(placement: Placement): Promise<void> {
    const now = Date.now();
    if (now - this.lastInterstitialAt < this.interstitialInterval) return;
    this.lastInterstitialAt = now;
    reportEvent('ad_start', { ad_type: 'interstitial', placement });
    try {
      await platform.ad.showInterstitial(placement);
      reportEvent('ad_complete', { ad_type: 'interstitial', placement });
    } catch {
      reportEvent('ad_error', { ad_type: 'interstitial', placement });
    }
  }

  /** 显示 Banner。 */
  showBanner(): void {
    platform.ad.showBanner();
  }

  /** 隐藏 Banner。 */
  hideBanner(): void {
    platform.ad.hideBanner();
  }
}

/** 全局单例。 */
export const ads = new Ads();
