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
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppId } from './mini-appid.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dyDir = resolve(here, '../../line-dy');

mkdirSync(resolve(dyDir, 'dist'), { recursive: true });

/**
 * 内容没变就不写盘（与微信脚本同一理由）。
 *
 * 脚手架文件每次构建都重写，内容却一模一样 —— 结果是每次 `build:douyin`
 * 之后工作区都是脏的，发布 commit 里夹带无关 diff。发布产物必须能从
 * 干净的 tag 重建，工作区脏着是最容易出错的环节。
 */
function writeIfChanged(file, content) {
  if (existsSync(file)) {
    try {
      if (readFileSync(file, 'utf8') === content) return false;
    } catch { /* 读不了就当变了，照写 */ }
  }
  writeFileSync(file, content);
  return true;
}

// game.json：小游戏全局配置
writeIfChanged(resolve(dyDir, 'game.json'), JSON.stringify({
  // 竖屏。抖音小游戏横屏需要在后台单独申请，我们不需要。
  deviceOrientation: 'portrait',
  // 隐藏状态栏，画面可以铺满（与微信端一致）
  showStatusBar: false,
  // 抖音的字段名是 `networkTimeout`，结构与微信一致
  networkTimeout: { request: 10000 },
}, null, 2));

// project.config.json：开发者工具用它识别工程类型。
//
// ## appid 不能每次重写成占位值
//
// 以前这里直接 `writeFileSync` 一份带 `tt0000000000000000` 的模板 ——
// 运营手改的 appid 会在**下一次 `build:douyin` 时被悄悄改回去**，
// 表现是「明明改过了，上传还是说 appid 不对」。
//
// 现在按 `scripts/mini-appid.mjs` 的优先级：环境变量 `DY_APPID` ›
// 文件里已有的真实 appid › 占位值（并打警告）。
const dyProjectPath = resolve(dyDir, 'project.config.json');
let dyProject = {
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
};
if (existsSync(dyProjectPath)) {
  try {
    dyProject = { ...dyProject, ...JSON.parse(readFileSync(dyProjectPath, 'utf8')) };
  } catch {
    // 文件坏了就按模板重建
  }
}
const dyAppId = resolveAppId('douyin', process.env.DY_APPID, dyProject.appid);
dyProject.appid = dyAppId.appid;
writeIfChanged(dyProjectPath, JSON.stringify(dyProject, null, 2) + '\n');

// game.js：小游戏入口，require 打包产物
//
// 抖音的入口文件名同样必须是 `game.js`，与微信一致。
// 内容极简：把控制权交给 dist 里的打包结果。
writeIfChanged(resolve(dyDir, 'game.js'), `// 抖音小游戏入口。\n// 真正的逻辑在 dist/game.js（vite build --mode douyin 产出）。\nrequire('./dist/game.js');\n`);

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
if (dyAppId.warning) {
  console.warn('\n⚠ ' + dyAppId.warning + '\n');
}
