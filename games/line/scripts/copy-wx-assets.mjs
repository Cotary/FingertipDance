// 把微信小游戏工程所需的静态配置/入口文件就位。
// 构建产物由 `vite build --mode wx` 产出到 ../line-wx/dist/game.js。
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wxDir = resolve(here, '../../line-wx');

mkdirSync(resolve(wxDir, 'dist'), { recursive: true });

// game.json：小游戏全局配置（竖屏、状态栏隐藏、请求超时）
writeFileSync(resolve(wxDir, 'game.json'), JSON.stringify({
  deviceOrientation: 'portrait',
  showStatusBar: false,
  networkTimeout: { request: 10000 },
}, null, 2));

// 拷贝开放数据域
mkdirSync(resolve(wxDir, 'openDataContext'), { recursive: true });
const odSrc = resolve(here, '../../line-wx/openDataContext/index.js');
const odDst = resolve(wxDir, 'openDataContext/index.js');
try {
  cpSync(odSrc, odDst);
} catch {
  // 若 index.js 已存在（与源同路径），忽略
}

console.log('微信工程资源已就绪:', wxDir);
