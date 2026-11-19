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
