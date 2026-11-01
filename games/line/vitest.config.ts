import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 用 forks 池 + 单进程：规避 Windows 沙箱下 worker 线程并发写 vite-node
    // SSR 缓存临时文件导致的 EPERM（见 docs/连连看/TASK/T02 遗留问题）。
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
