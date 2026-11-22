import type { PlatformPrivacy, PlatformProfile } from './types';

declare const wx: any;

/**
 * 微信小游戏的合规能力：隐私授权 + 昵称头像。
 *
 * ## 为什么单独一个文件
 *
 * 这两件事都**必须由用户手势或平台弹窗触发**，和 `login` / `request` 那种
 * 后台静默调用不是一类东西。混进 `wechat.ts` 的实现体里，
 * 很容易被人顺手在启动时调一次 —— 那会被微信判定为诱导授权直接拒审。
 *
 * ## 拿不到 API 怎么办：放行，不拦
 *
 * 基础库很老、或者跑在 Web 上时，`wx.getPrivacySetting` 根本不存在。
 * 这种情况下**必须 `resolve(true)`**：
 * 拦下来意味着「老设备永远进不了游戏」，而合规要求的对象是
 * 能弹出授权框的那些版本 —— 弹不出来的时候，平台自己也不会校验你。
 */

/** 一次隐私授权最多等这么久（毫秒）。超时按「未完成」处理，让调用方去提示。 */
const AUTHORIZE_TIMEOUT_MS = 60_000;

/** 微信隐私授权实现。 */
export const wechatPrivacy: PlatformPrivacy = {
  /**
   * 确保拿到隐私授权。
   *
   * 流程是微信官方给的三步：
   * 1. `wx.getPrivacySetting` 问「需不需要授权」（已同意过就是 `false`，直接放行）
   * 2. 需要 → `wx.requirePrivacyAuthorize` 拉起官方隐私弹窗
   * 3. 用户同意 → success；拒绝 → fail
   *
   * 不做「自己画一个隐私弹窗」：微信的官方弹窗带协议原文入口，
   * 自制的反而容易被判不合规（用户看不到完整条款）。
   */
  ensureAuthorized(): Promise<boolean> {
    // 非微信环境 / 老基础库：不拦
    if (typeof wx === 'undefined' || typeof wx.getPrivacySetting !== 'function') {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };

      // 超时兜底：授权框被系统挂起（切后台 / 来电）时回调可能永远不来，
      // 没有这个的话启动流程会卡死在一句 await 上，表现是「白屏」。
      const timer = setTimeout(() => finish(false), AUTHORIZE_TIMEOUT_MS);

      wx.getPrivacySetting({
        success: (res: any) => {
          if (!res?.needAuthorization) {
            clearTimeout(timer);
            finish(true);
            return;
          }
          if (typeof wx.requirePrivacyAuthorize !== 'function') {
            // 有 getPrivacySetting 却没有 requirePrivacyAuthorize 的中间版本：
            // 当作不需要，别让玩家卡住。
            clearTimeout(timer);
            finish(true);
            return;
          }
          wx.requirePrivacyAuthorize({
            success: () => {
              clearTimeout(timer);
              finish(true);
            },
            fail: () => {
              clearTimeout(timer);
              finish(false);
            },
          });
        },
        fail: () => {
          // 查询失败（少见）：按「不需要」放行 —— 隐私接口挂了不是玩家的错
          clearTimeout(timer);
          finish(true);
        },
      });
    });
  },

  /** 打开「隐私保护指引」原文（微信自动渲染后台配置的那份）。 */
  openContract(): void {
    if (typeof wx === 'undefined' || typeof wx.openPrivacyContract !== 'function') return;
    wx.openPrivacyContract({
      fail: () => console.warn('[privacy] 打开隐私协议失败（后台未配置隐私保护指引？）'),
    });
  },

  /**
   * 注册「接口触发隐私需求」的监听。
   *
   * 挂在平台对象上（而不是让 `main.ts` 直接 import 本文件的函数）：
   * 直接 import 会把整套 `wx.*` 拖进抖音包 —— 那里根本没有 `wx`。
   */
  installWatcher(): void {
    installPrivacyWatcher();
  },
};

/**
 * 兜住「第三方接口触发隐私需求」的情况。
 *
 * 有些微信接口（读写相册、剪贴板等）在用户**还没同意**隐私协议时会走
 * `wx.onNeedPrivacyAuthorization`，而不是由我们主动调 `requirePrivacyAuthorize`。
 * 不注册这个监听，那些接口会直接失败，而且失败提示和"权限不足"长得一样，很难查。
 *
 * 这里注册一个**只做一件事**的处理：回调里立刻 `resolve()` 不带参数，
 * 把决定权交回平台（微信会弹官方隐私弹窗）。
 * 不自建弹窗的理由同上 —— 官方弹窗才有完整条款。
 *
 * 重复调用无副作用（平台侧只保留最后一次注册的回调）。
 */
export function installPrivacyWatcher(): void {
  if (typeof wx === 'undefined' || typeof wx.onNeedPrivacyAuthorization !== 'function') return;
  try {
    wx.onNeedPrivacyAuthorization((resolve: (arg?: unknown) => void) => {
      // 不带参数 = 交给平台默认处理（官方弹窗）
      try { resolve(); } catch { /* 老基础库可能要求带参，忽略 */ }
    });
  } catch {
    /* 注册失败不影响主流程 */
  }
}

/**
 * 微信昵称头像。
 *
 * ## 两条路，按基础库版本选
 *
 * - `wx.getUserProfile`（2.10.4+）：一次授权同时拿昵称和头像 URL，
 *   也是官方推荐的写法；
 * - `wx.getUserInfo`（更老）：还能用，但新版本返回的是**匿名数据**
 *   （灰头像 + 「微信用户」），所以只当兜底。
 *
 * 都拿不到就返回 `null` —— 调用方保持首字圆球，不要当成错误。
 */
export const wechatProfile: PlatformProfile = {
  request(): Promise<{ nickname: string; avatar: string } | null> {
    return new Promise((resolve) => {
      if (typeof wx === 'undefined') {
        resolve(null);
        return;
      }

      const pick = (info: any) => {
        const nickname = String(info?.nickName ?? info?.nickname ?? '').trim();
        const avatar = String(info?.avatarUrl ?? info?.avatar ?? '').trim();
        // 空昵称 + 空头像 = 用户拒绝或拿到匿名数据，一律当"没拿到"
        if (!nickname && !avatar) resolve(null);
        else resolve({ nickname, avatar });
      };

      if (typeof wx.getUserProfile === 'function') {
        wx.getUserProfile({
          desc: '用于在排行榜和好友榜显示你的昵称与头像',
          success: (res: any) => pick(res?.userInfo),
          fail: () => resolve(null),
        });
        return;
      }
      if (typeof wx.getUserInfo === 'function') {
        wx.getUserInfo({
          withCredentials: false,
          success: (res: any) => pick(res?.userInfo),
          fail: () => resolve(null),
        });
        return;
      }
      resolve(null);
    });
  },
};
