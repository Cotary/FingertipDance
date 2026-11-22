import type { Platform } from './types';
import { webPlatform } from './web';
import { wechatPlatform } from './wechat';
import { douyinPlatform } from './douyin';

export * from './types';
export { configureAds } from './wechat';
export { configureDouyinAds } from './douyin';

/**
 * 当前平台实现。构建时通过 Vite define 注入 __TARGET__ 决定。
 *
 * ## 三端怎么选
 *
 * - `wechat` → 微信小游戏（`wx.*`）
 * - `douyin` → 抖音小游戏（`tt.*`）
 * - 其它     → Web（浏览器，`navigator`）
 *
 * tree-shaking 会摇掉未选中的实现 —— 微信包里不会带 `tt.` 的代码，
 * 抖音包里也不会带 `wx.`。
 */
export const platform: Platform =
  __TARGET__ === 'wechat' ? wechatPlatform
  : __TARGET__ === 'douyin' ? douyinPlatform
  : webPlatform;

/**
 * 挂全局异常钩子。
 *
 * 放在这里而不是各平台模块顶层：模块顶层的 `if (typeof wx !== 'undefined')`
 * 是副作用，bundler 不敢摇，微信包里会混进 `tt.onError`、抖音包里混进
 * `wx.onError`（被 typeof 挡住不会执行，但「跨端命名空间零污染」这条纪律就破了）。
 *
 * 必须在任何业务代码之前调用 —— 启动期崩溃才接得住。
 */
platform.installErrorReporting?.();

/**
 * 确保已获得隐私授权（微信合规）。
 *
 * 平台没有这套能力（Web / 抖音 / 老基础库）时**直接放行** ——
 * 拦下来等于「老设备永远进不了游戏」，而合规要求的对象是能弹授权的那些版本。
 *
 * 放在这里而不是让调用方写 `platform.privacy?.ensureAuthorized()`：
 * 「拿不到就放行」这条规则只该写一次，写两遍就会有一处写成 `?? false`。
 */
export function ensurePrivacyAuthorized(): Promise<boolean> {
  return platform.privacy?.ensureAuthorized() ?? Promise.resolve(true);
}
