declare const __TARGET__: 'web' | 'wechat';
declare const __API_BASE__: string;
/**
 * 调试模式开关（`'true'` / `'false'`）。
 *
 * 由 `vite.config.ts` 的 `define` 注入：非 production 构建为 `'true'`，
 * 生产构建为 `'false'`（整块调试代码会被 tree-shake 掉）。
 */
declare const __DEBUG__: string;
