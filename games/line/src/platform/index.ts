import type { Platform } from './types';
import { webPlatform } from './web';
import { wechatPlatform } from './wechat';

export * from './types';
export { configureAds } from './wechat';

/**
 * 当前平台实现。构建时通过 Vite define 注入 __TARGET__ 决定。
 */
export const platform: Platform = __TARGET__ === 'wechat' ? wechatPlatform : webPlatform;
