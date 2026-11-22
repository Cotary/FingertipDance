import { defineConfig } from 'vite';
// 纯函数模块（构建期后端地址校验）—— vite.config.ts 与 vitest 都能直接 import。
import { resolveApiBase } from './scripts/api-base';

/**
 * 本地开发端口。
 *
 * ## 为什么是 50002 而不是 Vite 默认的 5173
 *
 * 这台机器上 5173 被别的项目占着，而且那个项目的 supervisor 会**反复把它拉起来**
 * —— Vite 默认遇到端口被占会静默顺延，于是我们这个服务会被挤掉，
 * 表现为「刚才还好好的，过一会儿就没了」。
 *
 * `strictPort: true` 让它**端口被占就直接报错**，而不是偷偷换端口连到一个
 * 来路不明的服务上（上一轮就踩过这个坑：用户打开 5173 看到的是别人的游戏）。
 *
 * 端口可用环境变量覆盖：`PORT=50002 npm run dev`。
 */
const PORT = Number(process.env.PORT ?? 50002);

/**
 * 后端 API 地址。
 *
 * ## 为什么要单独抽一个模块
 *
 * 原来这里是一行 `process.env.API_BASE ?? 'http://127.0.0.1:50001'`。
 * 本地开发没问题，但 `build:wx` / `build:douyin` 没设环境变量时，
 * **产出的包里就带着 `127.0.0.1:50001`** ——
 * 线上包连的是玩家自己手机的环回地址，登录静默失败、进度不同步、
 * 排行榜空白，而 `boot()` 的 try/catch 把错误全兜住了，**日志一句都没有**。
 *
 * 现在小游戏构建**必须**显式给 `API_BASE`，否则构建直接失败。
 * 校验逻辑放在 `scripts/api-base.mjs`（纯函数，可被测试直接调用）。
 */

export default defineConfig(({ command, mode }) => {
  // ── 三端构建目标 ──
  //
  //   npm run dev               → web（浏览器调试）
  //   npm run build             → web
  //   npm run build:wx          → 微信小游戏（--mode wx）
  //   npm run build:douyin      → 抖音小游戏（--mode douyin）
  //
  // 后两者产出 **CommonJS 单文件**（小游戏不支持 ESM），
  // 分别落到 ../line-wx/dist/game.js 与 ../line-dy/dist/game.js。
  const isWx = mode === 'wx';
  const isDy = mode === 'douyin';
  // 「小游戏端」：产物形态相同（CJS + 单文件），只是平台实现不同
  const isMiniGame = isWx || isDy;
  // ── 调试模式 ──
  //
  // 「点任意一关」的调试入口只在**开发服务器**（`vite` dev）里打开。
  //
  // ## 为什么不是「非 production 构建」
  //
  // 微信小游戏走的是 `vite build --mode wx` —— `mode` 是 `'wx'` 不是 `'production'`，
  // 按「非 production 就开调试」的话，**正式发到微信的小游戏包里会带着调试入口**：
  // 玩家能点任意一关、能看到 `/api/debug/jump` 这个 URL。
  //
  // 所以判据用 `command === 'serve'`（只有 dev server 才是 serve），
  // 保证 `vite build`（不管什么 mode）产出的包里**没有调试入口**。
  //
  // 需要临时在构建产物里开调试时：
  //   DEBUG=true npm run build
  const debugEnabled =
    process.env.DEBUG === 'true' ||
    (process.env.DEBUG !== 'false' && command === 'serve');

  // ── 后端地址：小游戏构建必须显式给 ──
  //
  // 小游戏构建漏了 `API_BASE` 时，产出的包会指向 `127.0.0.1:50001`，
  // 线上连的是玩家自己手机的环回地址 —— 登录静默失败、进度不同步、
  // 排行榜空白，而且**日志里一句报错都没有**（`boot()` 全 try/catch 兜住了）。
  //
  // 与其发出去再排查半天，不如**构建期就失败**。
  const target = isWx ? 'wx' : isDy ? 'douyin' : 'web';
  const resolved = resolveApiBase(target, process.env.API_BASE);
  if (resolved.error) {
    throw new Error(`\n[构建配置错误] ${resolved.error}\n`);
  }

  return {
    server: { port: PORT, host: '0.0.0.0', strictPort: true },
    define: {
      __TARGET__: JSON.stringify(isWx ? 'wechat' : isDy ? 'douyin' : 'web'),
      __API_BASE__: JSON.stringify(resolved.base),
      __DEBUG__: JSON.stringify(debugEnabled ? 'true' : 'false'),
    },
    build: {
      target: 'es2017',
      outDir: isWx ? '../line-wx/dist' : isDy ? '../line-dy/dist' : 'dist',
      assetsInlineLimit: 0,
      rollupOptions: isMiniGame
        ? {
            output: {
              // 小游戏（微信 / 抖音）都不支持 ESM，
              // 打包成 CommonJS 单文件，由 game.js require
              format: 'cjs',
              entryFileNames: 'game.js',
              inlineDynamicImports: true,
            },
          }
        : {},
    },
  };
});
