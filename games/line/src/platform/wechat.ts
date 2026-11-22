import type { Platform, ShareResult, SaveableCanvas } from './types';
import { ApiError } from './apiError';
import { wechatPrivacy, wechatProfile } from './privacy';
import { saveCanvasToAlbum, exportCanvasToTempFile } from './saveImage';
import { stringifyDetail } from './detail';
import { inputTextOn, pickImageOn } from './input';

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

  /**
   * 启动参数。分享挑战的 `l` / `undos` / `c` 都在这里。
   *
   * **注意它只代表"本次进程第一次启动"** —— 游戏在运行时点分享卡片
   * 走的是 `onAppShow(res).query`，两者都要接。
   */
  launchQuery(): Record<string, string> {
    // `wx?.` 挡不住「wx 未声明」的 ReferenceError（可选链只防 null/undefined 属性），
    // 所以先显式判断全局存在
    if (typeof wx === 'undefined') return {};
    try {
      return wx.getLaunchOptionsSync?.()?.query ?? {};
    } catch {
      return {};
    }
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
            reject(new ApiError(body?.code ?? -1, body?.msg ?? '请求失败'));
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

  /**
   * 分享。
   *
   * ## 两条通道的能力完全不同，不要混为一谈
   *
   * **好友（friend）** —— `wx.shareAppMessage` 主动拉起通讯录面板，
   * `title` / `imageUrl` / `query` 全部由我们控制，这是唯一能定制内容的通道。
   *
   * **朋友圈（timeline）** —— 微信自 2022 年（基础库 ≥ 2.25）起
   * **下线了朋友圈分享的自定义能力**：所有 `shareTimeline` 钩子与
   * `shareAppMessage` 的相关配置对朋友圈一律无效，强制使用小游戏后台
   * 配置的昵称 + 图标。所以这里能做的最多是 `wx.showShareMenu` 把
   * 「分享到朋友圈」按钮放到右上角菜单里，然后引导玩家自己去点。
   *
   * 返回 `'menu'` 而不是 `'sent'`：**我们没分享，只是把门打开了。**
   * 调用方不能把这个当成分享成功上报，界面上也要说清。
   *
   * （`menus` 里的 `shareTimeline` 是 Beta，官方文档写明只有 Android 支持；
   * iOS 上不生效 —— 这是平台限制，不做假动作。）
   */
  async share(opts) {
    if (opts.channel === 'timeline') {
      try {
        wx.showShareMenu({
          withShareTicket: false,
          menus: ['shareAppMessage', 'shareTimeline'],
        });
      } catch {
        return 'failed';
      }
      return 'menu';
    }

    return new Promise<ShareResult>((resolve) => {
      try {
        wx.shareAppMessage({
          title: opts.title,
          imageUrl: opts.imageUrl,
          query: opts.query,
          // 微信不回调「用户是否真的发出去了」——成功只代表面板已拉起。
          success: () => resolve('sent'),
          fail: () => resolve('failed'),
        });
      } catch {
        resolve('failed');
      }
    });
  },

  /**
   * 微信只给三档强弱，给不了「振 10ms、停 25ms」这种节奏。
   *
   * 所以按**总时长**归到最近的一档：设计稿的 8 / 15 / 18 / 40 分别落到
   * light / medium / medium / heavy，和 Web 端的强弱排序是一致的 ——
   * 两个平台手感不能一个"轻点"、一个"砸墙"。
   */
  vibrate(pattern: number | number[] = 15) {
    const ms = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
    const type = ms >= 30 ? 'heavy' : ms >= 12 ? 'medium' : 'light';
    try { wx.vibrateShort({ type }); } catch { /* noop */ }
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

  /**
   * 重新测量画布尺寸。
   *
   * 微信端在横竖屏切换 / 状态栏高度变化后，窗口尺寸会变。
   * 不重新测量的话，`toDesign` 会按旧尺寸反解 → **点击位置整体偏移**。
   */
  resizeCanvas() {
    const sys = wx.getSystemInfoSync();
    const dpr = Math.min(sys.pixelRatio || 1, 3);
    const width = sys.windowWidth;
    const height = sys.windowHeight;
    const canvas = wx.getCanvas ? wx.getCanvas() : wx.createCanvas();
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    return { canvas, width, height, dpr };
  },

  /**
   * 订阅尺寸变化（`wx.onWindowResize`）。
   *
   * 微信的 `onWindowResize` 在横竖屏切换时触发；
   * 补充 `onShow` —— 从后台回来时窗口尺寸也可能已经变了。
   */
  onResize(cb: () => void) {
    const g = globalThis as { wx?: { onWindowResize?: (f: () => void) => void; offWindowResize?: (f: () => void) => void } };
    g.wx?.onWindowResize?.(cb);
    return () => {
      g.wx?.offWindowResize?.(cb);
    };
  },

  openDataAvailable: true,

  /**
   * 微信支持的分享通道。
   *
   * `timeline`（朋友圈）自 2022 起**不可定制内容**，只能把右上角菜单的
   * 入口放出来（见 share 的实现）。仍然列在这里，是因为对玩家来说
   * 「能发到朋友圈」这件事是真的，只是内容不由我们决定。
   */
  shareChannels: ['friend', 'timeline'] as const,

  // 隐私授权 + 昵称头像（合规要求，见 privacy.ts 的说明）
  privacy: wechatPrivacy,
  profile: wechatProfile,

  /**
   * 复制分享链接。
   *
   * 小游戏端**没有 `navigator.clipboard`** —— 直接调会抛
   * `ReferenceError`，落到「长按上面的链接试试」这句假提示上
   * （屏幕上根本没有可长按的文本）。走 `wx.setClipboardData`。
   */
  clipboard: {
    set(text: string): Promise<boolean> {
      return new Promise((resolve) => {
        if (typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') {
          resolve(false);
          return;
        }
        wx.setClipboardData({
          data: text,
          success: () => resolve(true),
          // 用户拒绝/系统拒绝都算失败 —— 调用方据此改文案，不要假装成功
          fail: () => resolve(false),
        });
      });
    },
  },

  /**
   * 保存海报到相册。
   *
   * 走 `canvasToTempFilePath` → `saveImageToPhotosAlbum` 两步
   * （见 platform/saveImage.ts 的说明）。
   */
  saveImage(canvas: SaveableCanvas) {
    return saveCanvasToAlbum(canvas);
  },

  /**
   * 导出画布成临时文件（分享卡片图要用）。
   *
   * 微信的 `shareAppMessage({ imageUrl })` 只吃**本地文件路径**，
   * 传 dataURL 会被忽略 —— 卡片就退回默认图。
   */
  exportCanvas(canvas: SaveableCanvas) {
    return exportCanvasToTempFile(canvas);
  },

  /**
   * 绑定触摸。
   *
   * 小游戏没有 DOM，`canvas.addEventListener` 不存在 ——
   * 触摸只能从 `wx.onTouch*` 拿。
   */
  onTouch(bind) {
    if (typeof wx === 'undefined') return;
    wx.onTouchStart?.((e: any) => {
      const t = e?.touches?.[0] ?? e?.changedTouches?.[0];
      if (t) bind.down(t.clientX, t.clientY);
    });
    wx.onTouchMove?.((e: any) => {
      const t = e?.touches?.[0] ?? e?.changedTouches?.[0];
      if (t) bind.move(t.clientX, t.clientY);
    });
    wx.onTouchEnd?.(() => bind.up());
    wx.onTouchCancel?.(() => bind.cancel());
  },

  onAppHide(cb) {
    if (typeof wx === 'undefined') return;
    wx.onHide?.(() => cb());
  },

  /**
   * 回前台。
   *
   * `res.query` 是这次唤起的参数（点分享卡片进来的情况），
   * 冷启动的那次 onShow 也带 query —— 调用方用 `booted` 标志区分。
   */
  onAppShow(cb) {
    if (typeof wx === 'undefined') return;
    wx.onShow?.((res: any) => cb(res?.query ?? {}));
  },

  /**
   * 实时日志。
   *
   * 微信小游戏后台「运维中心 → 实时日志」可查最近 7 天，
   * 这是玩家手机上崩了之后唯一能拿到现场的地方。
   */
  logError(tag: string, detail: unknown) {
    try {
      const mgr = wx?.getRealtimeLogManager?.();
      if (!mgr) return;
      mgr.setFilterMsg?.(tag);
      mgr.error?.(tag, stringifyDetail(detail));
    } catch { /* 日志失败不影响游戏 */ }
  },

  installErrorReporting: installWxErrorReporting,

  inputText(opts) {
    return inputTextOn('wx', opts);
  },

  pickImage() {
    return pickImageOn('wx');
  },
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

/**
 * 全局未捕获异常 → 实时日志。
 *
 * ## 为什么要在启动最早期挂上
 *
 * 启动阶段抛的异常恰恰是最致命的（白屏、进不去游戏），而那时业务侧的
 * try/catch 还没铺到那里。由 `platform/index.ts` 在模块求值后立即调用，
 * 早于 `boot()`。
 *
 * 微信后台「运维中心 → 实时日志」能查最近 7 天，是玩家手机上崩了之后
 * 唯一能看到现场的地方；只写 console 在真机上没人看得到。
 */
export function installWxErrorReporting(): void {
  if (typeof wx === 'undefined') return;
  try {
    wx.onError?.((err: any) => {
      const text = typeof err === 'string'
        ? err
        : `${err?.message ?? ''}\n${err?.stack ?? ''}`;
      try {
        wx.getRealtimeLogManager?.()?.error?.('uncaught', stringifyDetail(text));
      } catch { /* 日志失败不影响游戏 */ }
    });
    // Promise 里漏掉的 reject 不会进 onError，要单独接
    wx.onUnhandledRejection?.((res: any) => {
      try {
        wx.getRealtimeLogManager?.()?.error?.('unhandled-rejection', stringifyDetail(res?.reason ?? res));
      } catch { /* noop */ }
    });
  } catch { /* 老基础库没有这些钩子 */ }
}
