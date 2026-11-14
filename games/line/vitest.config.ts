import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 与 vite.config.ts 保持一致的编译期常量，供依赖 platform 的模块（如 src/ads）在测试中解析
  define: {
    __TARGET__: JSON.stringify(process.env.TARGET ?? 'web'),
    __API_BASE__: JSON.stringify(process.env.API_BASE ?? 'http://127.0.0.1:50001'),
    // 测试里默认**关闭**调试模式 —— 需要测调试分支的用例单独 stub 后重新导入。
    __DEBUG__: JSON.stringify(process.env.DEBUG ?? 'false'),
  },
  test: {
    // 用 forks 池 + 单进程：规避 Windows 沙箱下 worker 线程并发写 vite-node
    // SSR 缓存临时文件导致的 EPERM（见 docs/连连看/TASK/T02 遗留问题）。
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
