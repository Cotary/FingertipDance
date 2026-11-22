/**
 * 抖音小游戏平台实现。
 *
 * ## 为什么能复用大半逻辑
 *
 * 抖音小游戏（`tt.`）与微信小游戏（`wx.`）的 API **高度同形**：
 * 存储、请求、激励视频、插屏、振动、画布创建几乎逐字对应，
 * 只是命名空间不同。所以这个文件里大部分函数是「换个前缀」。
 *
 * 真正需要思考的差异有三处：
 *
 * 1. **登录**（见 `login`）：抖音允许匿名，返回 `anonymous_openid`。
 * 2. **分享**（见 `share`）：抖音没有朋友圈，但有「分享到抖音」。
 * 3. **录屏**：抖音独有 `getGameRecorderManager`，本期不接。
 *
 * ## 命名空间声明
 *
 * 抖音小游戏的全局对象是 `tt`。微信工程里它不存在 ——
 * 所以这里用 `declare const tt`，构建时靠 `__TARGET__` 保证
 * 只有抖音包会走到这些代码（tree-shaking 会摇掉微信包里这一整个文件）。
 */
import type { Platform, ShareResult, SaveableCanvas } from './types';
import { ApiError } from './apiError';
import { saveCanvasToAlbum, exportCanvasToTempFile } from './saveImage';
import { stringifyDetail } from './detail';

declare const tt: any;

/**
 * 抖音广告位 ID。
 *
 * ## 与微信必须分开配
 *
 * `configureAds` 在微信端注入的是 `wx` 的广告位；抖音的广告位
 * 是另一套（后台独立创建）。混用会导致广告加载失败 ——
 * 而失败的表现是「点了没反应」，比报错更难查。
 */
let rewardedAdId = 'adunit-placeholder';
let interstitialAdId = 'adunit-placeholder';
let bannerAdId = 'adunit-placeholder';

/** 用服务端下发的配置初始化广告位 ID。 */
export function configureDouyinAds(ids: {
  rewardedVideoId?: string;
  interstitialId?: string;
  bannerId?: string;
}): void {
  if (ids.rewardedVideoId) rewardedAdId = ids.rewardedVideoId;
  if (ids.interstitialId) interstitialAdId = ids.interstitialId;
  if (ids.bannerId) bannerAdId = ids.bannerId;
}

/**
 * 全局未捕获异常 → 实时日志（抖音后台「运营中心 → 实时日志」）。
 *
 * 与微信端同一套理由：必须在业务代码之前挂上，才接得住启动期崩溃。
 */
export function installDouyinErrorReporting(): void {
  if (typeof tt === 'undefined') return;
  try {
    tt.onError?.((err: any) => {
      const text = typeof err === 'string'
        ? err
        : `${err?.message ?? ''}\n${err?.stack ?? ''}`;
      try {
        tt.getRealtimeLogManager?.()?.error?.('uncaught', stringifyDetail(text));
      } catch { /* 日志失败不影响游戏 */ }
    });
    tt.onUnhandledRejection?.((res: any) => {
      try {
        tt.getRealtimeLogManager?.()?.error?.('unhandled-rejection', stringifyDetail(res?.reason ?? res));
      } catch { /* noop */ }
    });
  } catch { /* 老版本没有这些钩子 */ }
}

export const douyinPlatform: Platform = {
  name: 'douyin',

  /**
   * 登录。
   *
   * ## `anonymousCode` 为什么要一起返回
   *
   * 抖音玩家可以不授权就进游戏。这时 `tt.login` 只给 `anonymousCode`，
   * 用它可以换到 `anonymous_openid` —— 这是我们唯一能拿到的稳定标识。
   *
   * 直接拒绝匿名玩家会让他们根本玩不了，而他们恰恰是大多数。
   * 服务端看到 openid 就走正常建号流程，不区分真名/匿名
   * （对游戏逻辑来说两者都是「一个玩家」）。
   *
   * ## 为什么把两个 code 拼在一起传给服务端
   *
   * 现有 `Platform.login()` 的返回类型是 `{ code: string }`，
   * 服务端 `loginReq.code` 也是单个字符串。改类型会牵动微信端与
   * 服务端两处，收益不抵风险。
   *
   * 这里用 `code|anonymousCode` 的形式把两者一起送上去，
   * 服务端 `douyin.Code2Session` 按 `|` 拆分后逐个尝试。
   * ——这是个务实的妥协，但比让抖音玩家登录失败要好得多。
   */
  async login() {
    return new Promise((resolve, reject) => {
      tt.login({
        force: false,
        success: (res: any) => {
          const code = res?.code ?? '';
          const anon = res?.anonymousCode ?? '';
          if (!code && !anon) {
            reject(new Error('抖音登录未返回 code'));
            return;
          }
          resolve({ code: anon ? `${code}|${anon}` : code });
        },
        fail: (err: any) => reject(new Error('tt.login 失败: ' + (err?.errMsg ?? ''))),
      });
    });
  },

  /**
   * 启动参数。
   *
   * 抖音同样走 `getLaunchOptionsSync`，但命名空间是 `tt` ——
   * 这里如果漏了，`game/challenge.ts` 会退到 `location` 分支，
   * 而小游戏里没有 `location`，结果是**分享链接在抖音端全部打不开对应关卡**。
   */
  launchQuery(): Record<string, string> {
    if (typeof tt === 'undefined') return {};
    try {
      return tt.getLaunchOptionsSync?.()?.query ?? {};
    } catch {
      return {};
    }
  },

  request<T>(url: string, method: 'GET' | 'POST', data?: unknown, header?: Record<string, string>): Promise<T> {
    return new Promise((resolve, reject) => {
      tt.request({
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
        fail: (err: any) => reject(new Error('网络请求失败: ' + (err?.errMsg ?? ''))),
      });
    });
  },

  storage: {
    get: (k) => tt.getStorageSync(k) || null,
    set: (k, v) => tt.setStorageSync(k, v),
    remove: (k) => tt.removeStorageSync(k),
  },

  ad: {
    showRewarded(placement: string) {
      return new Promise<boolean>((resolve) => {
        const ad = tt.createRewardedVideoAd({ adUnitId: rewardedAdId });
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        ad.onClose((res: any) => finish(!!res?.isEnded));
        // 加载失败时**兜底发放**：与微信端同一策略 ——
        // 玩家没义务为平台的广告库存不足买单。
        ad.onError(() => {
          console.warn('广告加载失败', placement);
          finish(true);
        });
        ad.load()
          .then(() => ad.show())
          .catch(() => ad.load().then(() => ad.show()).catch(() => finish(true)));
      });
    },
    showInterstitial(_placement: string) {
      try {
        const ad = tt.createInterstitialAd({ adUnitId: interstitialAdId });
        ad.onClose(() => {});
        ad.load().then(() => ad.show()).catch(() => { /* 不可用则静默跳过 */ });
      } catch {
        // 基础库不支持插屏
      }
      return Promise.resolve();
    },
    showBanner() {
      try {
        const ad = tt.createBannerAd({ adUnitId: bannerAdId, style: { left: 0, top: 0, width: 750 } });
        ad.onError(() => {});
        ad.load().then(() => ad.show()).catch(() => {});
      } catch { /* noop */ }
    },
    hideBanner() { /* 由 banner 引用统一管理，此处留空 */ },
  },

  /**
   * 分享。
   *
   * ## 抖音只有两种「分享」
   *
   * - `friend` —— `tt.shareAppMessage` 拉起好友选择，**支持自定义 query**
   *   （这点比微信的朋友圈强太多）。
   * - `douyin` —— `tt.shareAppMessage` 带 `channel: 'video'`，
   *   分享成抖音内的视频/图文卡片。同样支持 query。
   *
   * **没有 timeline**。所以 `shareChannels` 里不列它，
   * 分享面板也不会画出朋友圈按钮。
   *
   * ## 为什么两个通道都返回 `sent`
   *
   * 抖音与微信一样，不回调「用户到底发出去了没」——
   * `success` 只代表面板已拉起。所以这里如实返回 `sent`，
   * 调用方的文案是「已打开分享面板」而不是「分享成功」。
   */
  async share(opts) {
    return new Promise<ShareResult>((resolve) => {
      const payload: Record<string, unknown> = {
        title: opts.title,
        imageUrl: opts.imageUrl,
        query: opts.query,
        success: () => resolve('sent'),
        fail: () => resolve('failed'),
      };
      // `douyin` 通道用 channel 参数区分；`friend` 用默认（不动 channel）
      if (opts.channel === 'douyin') {
        payload.channel = 'video';
        payload.extra = opts.query ? { query: opts.query } : undefined;
      } else if (opts.channel === 'timeline') {
        // 抖音没有朋友圈。静默降级到好友分享，而不是让按钮点了没反应。
        //
        // 正常路径下 UI 不会画出这个按钮（shareChannels 里没有它），
        // 这里是防御性兜底 —— 万一将来有人误传。
      }

      try {
        tt.shareAppMessage(payload);
      } catch {
        resolve('failed');
      }
    });
  },

  /**
   * 振动。
   *
   * 抖音给的是 `type: 'light' | 'medium' | 'heavy'`，与微信同一套。
   * 按总时长归到最近一档 —— 和微信端保持**同一套映射**，
   * 否则同一个动作在两端的力度不一样。
   */
  vibrate(pattern: number | number[] = 15) {
    const ms = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
    const type = ms >= 30 ? 'heavy' : ms >= 12 ? 'medium' : 'light';
    try {
      tt.vibrateShort({ type });
    } catch { /* noop */ }
  },

  getCanvas() {
    const sys = tt.getSystemInfoSync();
    const dpr = Math.min(sys.pixelRatio || 1, 3);
    const width = sys.windowWidth;
    const height = sys.windowHeight;
    const canvas = tt.createCanvas();
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    return { canvas, width, height, dpr };
  },

  /**
   * 重新测量画布尺寸。
   *
   * 抖音同样有窗口尺寸变化（横竖屏、分屏）。不重测的话
   * `toDesign` 会按旧尺寸反解 → 点击位置整体偏移。
   */
  resizeCanvas() {
    const sys = tt.getSystemInfoSync();
    const dpr = Math.min(sys.pixelRatio || 1, 3);
    const width = sys.windowWidth;
    const height = sys.windowHeight;
    const canvas = tt.getCanvas ? tt.getCanvas() : tt.createCanvas();
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    return { canvas, width, height, dpr };
  },

  onResize(cb: () => void) {
    const g = globalThis as {
      tt?: { onWindowResize?: (f: () => void) => void; offWindowResize?: (f: () => void) => void };
    };
    g.tt?.onWindowResize?.(cb);
    return () => {
      g.tt?.offWindowResize?.(cb);
    };
  },

  /**
   * 抖音**没有开放数据域**这种好友榜机制
   * （抖音的社交关系链能力与微信不同，好友榜要走它自己的接口）。
   * 所以这里为 false —— 排行榜页会退回服务端好友榜。
   */
  openDataAvailable: false,

  /**
   * 抖音支持的分享通道。
   *
   * 只有两个：好友、分享到抖音。**没有朋友圈**。
   */
  shareChannels: ['friend', 'douyin'] as const,

  /**
   * 昵称头像。
   *
   * 抖音的 `tt.getUserInfo` 与微信 `getUserInfo` 同形，返回
   * `userInfo.nickName / avatarUrl`。**没有** `getUserProfile` 那一层
   * 「必须手势触发」的限制，但仍然只在「我的 → 完善资料」里调 ——
   * 启动时弹授权框会让玩家莫名其妙。
   */
  profile: {
    request(): Promise<{ nickname: string; avatar: string } | null> {
      return new Promise((resolve) => {
        if (typeof tt === 'undefined' || typeof tt.getUserInfo !== 'function') {
          resolve(null);
          return;
        }
        tt.getUserInfo({
          withCredentials: false,
          success: (res: any) => {
            const info = res?.userInfo ?? res;
            const nickname = String(info?.nickName ?? info?.nickname ?? '').trim();
            const avatar = String(info?.avatarUrl ?? info?.avatar ?? '').trim();
            if (!nickname && !avatar) resolve(null);
            else resolve({ nickname, avatar });
          },
          fail: () => resolve(null),
        });
      });
    },
  },

  /**
   * 复制分享链接（`tt.setClipboardData`）。
   *
   * 抖音端同样没有 `navigator.clipboard`；走直连 DOM 会在点击后
   * 直接抛 `ReferenceError`，被兜住后给玩家一句「长按试试」——
   * 而小游戏里没有可长按的文本。
   */
  clipboard: {
    set(text: string): Promise<boolean> {
      return new Promise((resolve) => {
        if (typeof tt === 'undefined' || typeof tt.setClipboardData !== 'function') {
          resolve(false);
          return;
        }
        tt.setClipboardData({
          data: text,
          success: () => resolve(true),
          fail: () => resolve(false),
        });
      });
    },
  },

  /**
   * 保存海报到相册。
   *
   * 抖音小游戏的 `tt.saveImageToPhotosAlbum` 与微信同名同参，
   * 所以直接复用 `platform/saveImage.ts`（它同时认 `wx` 和 `tt`）。
   */
  saveImage(canvas: SaveableCanvas) {
    return saveCanvasToAlbum(canvas);
  },

  /**
   * 导出画布成临时文件（分享卡片图要用）。
   *
   * 抖音的 `tt.shareAppMessage({ imageUrl })` 同样只吃本地路径。
   */
  exportCanvas(canvas: SaveableCanvas) {
    return exportCanvasToTempFile(canvas);
  },

  /**
   * 绑定触摸。
   *
   * **这一条此前是缺的**：`main.ts` 只读了 `globalThis.wx.onTouchStart`，
   * 而抖音包里没有 `wx` —— 结果是抖音端进得去、点不动，且因为
   * 可选链短路，一行报错都没有。
   */
  onTouch(bind) {
    if (typeof tt === 'undefined') return;
    tt.onTouchStart?.((e: any) => {
      const t = e?.touches?.[0] ?? e?.changedTouches?.[0];
      if (t) bind.down(t.clientX, t.clientY);
    });
    tt.onTouchMove?.((e: any) => {
      const t = e?.touches?.[0] ?? e?.changedTouches?.[0];
      if (t) bind.move(t.clientX, t.clientY);
    });
    tt.onTouchEnd?.(() => bind.up());
    tt.onTouchCancel?.(() => bind.cancel());
  },

  onAppHide(cb) {
    if (typeof tt === 'undefined') return;
    tt.onHide?.(() => cb());
  },

  /** 回前台。`res.query` 是点分享卡片进来时带的参数。 */
  onAppShow(cb) {
    if (typeof tt === 'undefined') return;
    tt.onShow?.((res: any) => cb(res?.query ?? {}));
  },

  /** 实时日志（抖音后台「运营中心 → 实时日志」）。 */
  logError(tag: string, detail: unknown) {
    try {
      const mgr = tt?.getRealtimeLogManager?.();
      if (!mgr) return;
      mgr.setFilterMsg?.(tag);
      mgr.error?.(tag, stringifyDetail(detail));
    } catch { /* 日志失败不影响游戏 */ }
  },

  installErrorReporting: installDouyinErrorReporting,
};
