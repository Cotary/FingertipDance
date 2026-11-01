import type { Platform } from './types';

/** 声明微信全局对象，避免类型报错。 */
declare const wx: any;

/**
 * 微信小游戏平台实现。
 */
export const wechatPlatform: Platform = {
  name: 'wechat',

  async login() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res: any) => resolve({ code: res.code }),
        fail: (err: any) => reject(new Error('wx.login 失败: ' + err.errMsg)),
      });
    });
  },

  request<T>(url: string, method: 'GET' | 'POST', data?: unknown, header?: Record<string, string>): Promise<T> {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        data,
        header: { 'content-type': 'application/json', ...(header ?? {}) },
        success: (res: any) => {
          const body = res.data as { code: number; msg: string; data: T };
          if (!body || body.code !== 0) {
            reject(new Error(`${body?.code ?? 'unknown'}: ${body?.msg ?? '请求失败'}`));
            return;
          }
          resolve(body.data);
        },
        fail: (err: any) => reject(new Error('网络请求失败: ' + err.errMsg)),
      });
    });
  },

  storage: {
    get: (k) => wx.getStorageSync(k) || null,
    set: (k, v) => wx.setStorageSync(k, v),
    remove: (k) => wx.removeStorageSync(k),
  },

  ad: {
    showRewarded(placement: string) {
      return new Promise<boolean>((resolve) => {
        const ad = wx.createRewardedVideoAd({ adUnitId: rewardedAdId });
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        ad.onClose((res: any) => finish(!!res?.isEnded));
        ad.onError(() => { console.warn('广告加载失败', placement); finish(true); });  // 兜底发放
        ad.load()
          .then(() => ad.show())
          .catch(() => ad.load().then(() => ad.show()).catch(() => finish(true)));
      });
    },
    showInterstitial(_placement: string) {
      try {
        const ad = wx.createInterstitialAd({ adUnitId: interstitialAdId });
        ad.onClose(() => {});
        ad.load().then(() => ad.show()).catch(() => { /* 不可用则静默跳过 */ });
      } catch {
        // 基础库不支持
      }
      return Promise.resolve();
    },
    showBanner() {
      try {
        const ad = wx.createBannerAd({ adUnitId: bannerAdId, style: { left: 0, top: 0, width: 750 } });
        ad.onError(() => {});
        ad.load().then(() => ad.show()).catch(() => {});
      } catch { /* noop */ }
    },
    hideBanner() { /* 由 banner 引用统一管理，此处留空 */ },
  },

  async share(opts) {
    wx.shareAppMessage({
      title: opts.title,
      imageUrl: opts.imageUrl,
      query: opts.query,
    });
  },

  vibrate() {
    try { wx.vibrateShort({ type: 'light' }); } catch { /* noop */ }
  },

  getCanvas() {
    const sys = wx.getSystemInfoSync();
    const dpr = Math.min(sys.pixelRatio || 1, 3);
    const width = sys.windowWidth;
    const height = sys.windowHeight;
    const canvas = wx.createCanvas();
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    return { canvas, width, height, dpr };
  },

  openDataAvailable: true,
};

/** 广告位 ID，从 /api/config 的 ad 字段获取后写入这里。 */
let rewardedAdId = 'adunit-placeholder';
let interstitialAdId = 'adunit-placeholder';
let bannerAdId = 'adunit-placeholder';

/** 用服务端下发的配置初始化广告位 ID。 */
export function configureAds(ids: { rewardedVideoId?: string; interstitialId?: string; bannerId?: string }): void {
  if (ids.rewardedVideoId) rewardedAdId = ids.rewardedVideoId;
  if (ids.interstitialId) interstitialAdId = ids.interstitialId;
  if (ids.bannerId) bannerAdId = ids.bannerId;
}
