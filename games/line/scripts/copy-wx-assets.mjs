// 把微信小游戏工程所需的静态配置/入口文件就位。
// 构建产物由 `vite build --mode wx` 产出到 ../line-wx/dist/game.js。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppId } from './mini-appid.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wxDir = resolve(here, '../../line-wx');

mkdirSync(resolve(wxDir, 'dist'), { recursive: true });

/**
 * 内容没变就不写盘。
 *
 * ## 为什么值得多这几行
 *
 * 这三个脚手架文件（game.json / project.config.json / openDataContext/index.js）
 * 每次构建都会被重写。内容其实一模一样，但 mtime 变了、git 也认为「改了」——
 * 于是 `build:wx` 之后 `git status` 永远是脏的，发布 commit 里总会夹带
 * 一两行无关 diff。久了就没人看得懂「这次发布到底改了什么」。
 *
 * 发布产物必须能从**干净的 tag** 重建，工作区脏着是最容易出错的环节。
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

/** 按内容比对拷贝（源文件是文本，直接读进来比）。 */
function copyIfChanged(src, dst) {
  return writeIfChanged(dst, readFileSync(src, 'utf8'));
}

// game.json：小游戏全局配置（竖屏、状态栏隐藏、请求超时）
//
// ## `openDataContext` 这一行不能少
//
// 开放数据域目录必须在 game.json 里声明，微信才会把它当子域加载。
// 少了这一行，主域 `wx.getOpenDataContext()` 拿到的 canvas 永远是空的 ——
// 表现是「好友榜一片黑」，而且没有任何报错。
//
// ## `__usePrivacyCheck__` 这一行也不能少
//
// 微信从 2022 年起要求小游戏声明隐私保护指引。**不声明时平台根本不会
// 触发隐私授权流程** —— `wx.getPrivacySetting` 恒返回「不需要授权」，
// 于是我们那套授权代码看起来"跑通了"，实际一个弹窗都没弹过。
// 提审时会被判「未接入隐私保护机制」。
writeIfChanged(resolve(wxDir, 'game.json'), JSON.stringify({
  deviceOrientation: 'portrait',
  showStatusBar: false,
  networkTimeout: { request: 10000 },
  openDataContext: 'openDataContext',
  __usePrivacyCheck__: true,
}, null, 2));

// project.config.json：开发者工具用它识别工程。
//
// ## appid 的优先级（见 scripts/mini-appid.mjs）
//
//   1. 环境变量 `WX_APPID`（CI / 打包机）
//   2. 文件里已有的非占位 appid（运营手改过的那份）
//   3. 占位 `touristappid` + 构建结束打警告
//
// 这个文件**不是从零重写**的：`setting` / `libVersion` / `condition`
// 里有些是开发者工具自己写回去的调试配置，覆盖掉等于每次构建都
// 把「上次调试到哪一关」清掉。只改 `appid` 一个字段。
let wxProject = {
  description: '连连看 - 路径连线小游戏',
  setting: {
    es6: true,
    enhance: true,
    minified: true,
    postcss: true,
    urlCheck: true,
    coverView: true,
    autoAudits: false,
    showShadowRootInWxmlPanel: true,
    packNpmManually: false,
  },
  compileType: 'game',
  libVersion: '3.0.0',
  appid: 'touristappid',
  projectname: '连连看',
  condition: {},
};
const wxProjectPath = resolve(wxDir, 'project.config.json');
if (existsSync(wxProjectPath)) {
  try {
    wxProject = { ...wxProject, ...JSON.parse(readFileSync(wxProjectPath, 'utf8')) };
  } catch {
    // 文件坏了就按模板重建 —— 反正只影响开发者工具，不影响运行
  }
}
const wxAppId = resolveAppId('wx', process.env.WX_APPID, wxProject.appid);
wxProject.appid = wxAppId.appid;
writeIfChanged(wxProjectPath, JSON.stringify(wxProject, null, 2) + '\n');

// 拷贝开放数据域
//
// 源文件在 `games/line/opendata/index.js`（和小游戏源码放一起，才进版本库和评审）。
// 以前从 `../../line-wx/openDataContext/index.js` 拷到同一个路径 —— 自己拷自己，
// 等于源文件只能手改 `line-wx/`，改错了也没人看得见。
mkdirSync(resolve(wxDir, 'openDataContext'), { recursive: true });
copyIfChanged(
  resolve(here, '../opendata/index.js'),
  resolve(wxDir, 'openDataContext/index.js'),
);

console.log('微信工程资源已就绪:', wxDir);
if (wxAppId.warning) {
  console.warn('\n⚠ ' + wxAppId.warning + '\n');
}
