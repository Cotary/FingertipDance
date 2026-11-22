/**
 * `scripts/mini-appid.mjs` 的类型声明。
 *
 * 那个文件必须保持 `.mjs` —— `copy-wx-assets.mjs` / `copy-dy-assets.mjs`
 * 由**裸 node** 直接执行（不经 tsx），不能 import `.ts`。
 * 但测试（vitest）和编辑器需要类型，所以这里补一份声明。
 */

export declare const PLACEHOLDER_APPID: { wx: string; douyin: string };

export type MiniTarget = 'wx' | 'douyin';

export declare function isPlaceholderAppId(target: MiniTarget, appid?: string): boolean;

export declare function validateAppId(target: MiniTarget, appid: string): string;

export declare function resolveAppId(
  target: MiniTarget,
  envAppId?: string,
  existing?: string,
): { appid: string; warning: string };
