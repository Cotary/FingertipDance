import { platform } from '../platform';
import { reportEvent } from '../net/api';

/** 广告位。 */
export type Placement = 'hint' | 'skip' | 'skin_unlock' | 'result_interstitial' | 'skin_banner';

/** 观看计数用的日期键（与 `rewardRules` 的每日键同一口径：UTC 日期）。 */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function rewardedCountKey(): string {
  return `ad_rewarded_${todayKey()}`;
}

/**
 * 广告管理器。统一处理奖励判定、失败兜底与埋点。
 */
export class Ads {
  /** 上次插屏时间戳。 */
  private lastInterstitialAt = 0;
  /**
   * 插屏最小间隔（毫秒）。
   *
   * 默认 60 秒与改造前一致；服务端下发 `interstitialIntervalSec` 后覆盖。
   * 保留这个默认值是有意的：配置接口挂掉时广告节奏不该跟着乱掉。
   */
  private interstitialInterval = 60_000;
  /**
   * 激励视频每日次数上限。0 = 不限。
   *
   * 0 是默认值（与改造前一致：以前没有上限）。
   */
  private rewardedDailyLimit = 0;
  /**
   * 「一次激励视频被计入」时的回调。
   *
   * ## 为什么挂回调，而不是让四个调用点各记一次
   *
   * 看得完有两条路：`completed === true`（正常看完）和 catch 里的**兜底发放**
   * （广告 SDK 挂了也要让玩家拿到奖励）。两处都该计数 —— 只要在这里统一发一次，
   * 调用点（提示 / 跳过 / 解锁主题 / 解锁皮肤）就不用各写一遍。
   *
   * 漏一处的后果是「某类广告不计次」，而且从界面上完全看不出来。
   */
  private onWatched?: (placement: Placement) => void;

  /** 注册「看完一次」回调（`main.ts` 用它本地 +1 并上报服务端）。 */
  setOnWatched(cb: (placement: Placement) => void): void {
    this.onWatched = cb;
  }

  /**
   * 应用服务端下发的广告频控。
   *
   * 只接受 >= 0 的数字：服务端已经归一化过，这里是第二道 ——
   * 负数间隔会让「上次时间 + 间隔 < now」恒成立，等于完全没有频控。
   */
  applyFrequency(cfg: {
    interstitialIntervalSec?: number;
    rewardedDailyLimit?: number;
  }): void {
    if (typeof cfg.interstitialIntervalSec === 'number' && cfg.interstitialIntervalSec >= 0) {
      this.interstitialInterval = cfg.interstitialIntervalSec * 1000;
    }
    if (typeof cfg.rewardedDailyLimit === 'number' && cfg.rewardedDailyLimit >= 0) {
      this.rewardedDailyLimit = Math.floor(cfg.rewardedDailyLimit);
    }
  }

  /**
   * 今日还能看几次激励视频。`Infinity` = 不限。
   *
   * 调用方（提示 / 跳过）在**弹广告之前**问一次：
   * 额度用完时应该直接说「今天看不了了」，
   * 而不是让玩家盯着「广告加载中」等十秒再失败。
   */
  rewardedQuotaLeft(): number {
    if (this.rewardedDailyLimit <= 0) return Infinity;
    const used = parseInt(platform.storage.get(rewardedCountKey()) ?? '0', 10) || 0;
    return Math.max(0, this.rewardedDailyLimit - used);
  }

  /** 今日已看次数（后台/调试可读）。 */
  rewardedUsedToday(): number {
    return parseInt(platform.storage.get(rewardedCountKey()) ?? '0', 10) || 0;
  }

  private countRewarded(): void {
    const n = this.rewardedUsedToday() + 1;
    platform.storage.set(rewardedCountKey(), String(n));
  }

  /**
   * 记一次「真的拿到了奖励」：本地日计数 + 对外回调。
   *
   * 正常看完与兜底发放都走这里 —— 两条路对玩家是同一件事
   * （都得了一次奖励），统计上也该是同一件事。
   */
  private noteRewarded(placement: Placement): void {
    this.countRewarded();
    try {
      this.onWatched?.(placement);
    } catch (e) {
      // 回调里可能要发网络请求，出错不能反过来把广告流程弄崩
      console.warn('[ads] onWatched 回调异常', e);
    }
  }

  /**
   * 展示激励视频。
   * @param placement 广告位，用于埋点
   * @returns true = 完整看完（或加载失败兜底发放），false = 中途退出 / 今日额度用完
   */
  async showRewarded(placement: Placement): Promise<boolean> {
    // 额度在**展示之前**判：已经用完还去 load 一次，
    // 玩家会看到一段加载动画然后什么都没发生 —— 比直接拒绝更让人困惑。
    if (this.rewardedQuotaLeft() <= 0) {
      reportEvent('ad_blocked', { ad_type: 'rewarded', placement });
      return false;
    }

    reportEvent('ad_start', { ad_type: 'rewarded', placement });
    try {
      const completed = await platform.ad.showRewarded(placement);
      if (completed) {
        this.noteRewarded(placement);
        reportEvent('ad_complete', { ad_type: 'rewarded', placement });
      } else {
        reportEvent('ad_abort', { ad_type: 'rewarded', placement });
      }
      return completed;
    } catch (e) {
      reportEvent('ad_error', { ad_type: 'rewarded', placement, err_msg: String(e) });
      // 兜底：广告不可用时直接发放，避免玩家点击无响应。
      // **也要计数** —— 否则「广告 SDK 挂了」等于额度被绕过，
      // 而这类故障可能持续一整天。
      this.noteRewarded(placement);
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
