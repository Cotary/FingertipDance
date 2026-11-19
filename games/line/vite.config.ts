import { defineConfig } from 'vite';

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

/** 后端 API 地址。同样可用 `API_BASE` 覆盖。 */
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:50001';

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
  return {
    server: { port: PORT, host: '0.0.0.0', strictPort: true },
    define: {
      __TARGET__: JSON.stringify(isWx ? 'wechat' : isDy ? 'douyin' : 'web'),
      __API_BASE__: JSON.stringify(API_BASE),
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
