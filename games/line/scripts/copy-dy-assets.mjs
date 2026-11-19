// 把抖音小游戏工程所需的静态配置/入口文件就位。
//
// 构建产物由 `vite build --mode douyin` 产出到 ../line-dy/dist/game.js。
//
// ## 与微信工程的三处差异
//
// 1. **game.json 的字段不同**：抖音用 `deviceOrientation`（同微信）+ `showStatusBar`，
//    但没有微信的 `openDataContext`（抖音没有开放数据域好友榜）。
// 2. **project.config.json 结构不同**：抖音叫 `.tt` 工程，
//    用 `project.config.json` + `ttgame` 标记。
// 3. **没有开放数据域目录**：抖音的好友能力不通过 openDataContext 提供。
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dyDir = resolve(here, '../../line-dy');

mkdirSync(resolve(dyDir, 'dist'), { recursive: true });

// game.json：小游戏全局配置
writeFileSync(resolve(dyDir, 'game.json'), JSON.stringify({
  // 竖屏。抖音小游戏横屏需要在后台单独申请，我们不需要。
  deviceOrientation: 'portrait',
  // 隐藏状态栏，画面可以铺满（与微信端一致）
  showStatusBar: false,
  // 抖音的字段名是 `networkTimeout`，结构与微信一致
  networkTimeout: { request: 10000 },
}, null, 2));

// project.config.json：开发者工具用它识别工程类型。
//
// `appid` 留占位 —— 真实 appid 不该进仓库（换团队/换号都要改，
// 而且它出现在截图里会被误当成凭证）。
writeFileSync(resolve(dyDir, 'project.config.json'), JSON.stringify({
  // 抖音的工程标识（不是微信的 `miniprogramRoot`）
  setting: {
    urlCheck: true,
    es6: true,
    minified: true,
  },
  appid: 'tt0000000000000000',
  projectname: 'fingertip-dance',
  // 编译入口（相对工程根）
  compileType: 'game',
}, null, 2));

// game.js：小游戏入口，require 打包产物
//
// 抖音的入口文件名同样必须是 `game.js`，与微信一致。
// 内容极简：把控制权交给 dist 里的打包结果。
writeFileSync(resolve(dyDir, 'game.js'), `// 抖音小游戏入口。\n// 真正的逻辑在 dist/game.js（vite build --mode douyin 产出）。\nrequire('./dist/game.js');\n`);

// 若已有分包/静态资源目录，确保存在（抖音要求目录显式存在）
for (const d of ['dist']) {
  mkdirSync(resolve(dyDir, d), { recursive: true });
}

// 可选：如果有抖音专属静态资源，拷进来
const extraSrc = resolve(here, '../../line-dy-assets');
if (existsSync(extraSrc)) {
  try {
    cpSync(extraSrc, dyDir, { recursive: true });
  } catch (e) {
    console.warn('拷贝抖音静态资源跳过:', e.message);
  }
}

console.log('抖音工程资源已就绪:', dyDir);
