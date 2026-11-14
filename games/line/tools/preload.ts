/**
 * tsx 运行时的构建期常量垫片。
 * Vite 在构建时用 define 注入 __TARGET__ / __API_BASE__；用 Node 直接跑 TS 时得自己补上。
 * 必须在任何业务模块之前被 import（ESM 按 import 顺序求值）。
 */
const g = globalThis as unknown as Record<string, string>;
g.__TARGET__ = 'web';
g.__API_BASE__ = 'http://127.0.0.1:50001';
// 调试开关：Node 直跑时按「非生产」处理，开着（本地调试脚本用得上）。
g.__DEBUG__ = 'true';

export {};
