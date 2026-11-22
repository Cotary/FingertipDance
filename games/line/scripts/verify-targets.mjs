#!/usr/bin/env node
/**
 * 双端产物门禁：一条命令回答「这两个包能不能分别传微信 / 抖音」。
 *
 * ## 为什么需要它
 *
 * 两端共用一份 `src/`，靠 `__TARGET__` 在构建期选中平台实现。这个模型最怕
 * 一种退化：**某个平台专属的代码漏进了另一个包**。它不会让构建失败、
 * 也不会在微信开发者工具里报错 —— 只会在另一端「点了没反应」，
 * 而且没有任何日志（这轮就踩过一次：抖音端的触摸整段缺失）。
 *
 * 所以「能跑」的判据不是 `tsc 通过`，而是**产物里查不到另一端的命名空间**：
 *
 * - 微信包：`tt.` 必须为 0
 * - 抖音包：`wx.` 必须为 0
 * - 两端都不许出现 `127.0.0.1`（构建期地址漏注入）
 * - 微信 `game.json` 必须声明 `openDataContext` 与 `__usePrivacyCheck__`
 * - 主包体积要远小于平台上限（微信小游戏主包 4MB）
 *
 * ## 用法
 *
 *   node scripts/verify-targets.mjs            # 只检查已有产物
 *   node scripts/verify-targets.mjs --build    # 先双构建再检查（需要 API_BASE）
 *
 * 退出码：有 FAIL 时 1（CI 直接红），只有 WARN 时 0。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const WX_DIR = resolve(root, '../line-wx');
const DY_DIR = resolve(root, '../line-dy');

/** 微信小游戏主包上限（MB）。超过要分包，我们离它很远。 */
const WX_MAIN_LIMIT_MB = 4;

const doBuild = process.argv.includes('--build');

const rows = [];
let failed = 0;
let warned = 0;

/**
 * @param {'PASS'|'FAIL'|'WARN'} level
 */
function check(level, target, what, detail) {
  rows.push({ level, target, what, detail });
  if (level === 'FAIL') failed++;
  if (level === 'WARN') warned++;
}

function countOf(text, needle) {
  // 用 split 计数而不是正则：`tt.` 里的点在正则里要转义，容易写错
  return text.split(needle).length - 1;
}

function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// ── 1. 构建 ────────────────────────────────────────────────────────────────

if (doBuild) {
  const apiBase = process.env.API_BASE;
  if (!apiBase) {
    console.error('✗ --build 需要 API_BASE（小游戏包不允许环回地址，构建脚本会拒绝）');
    console.error('  例：API_BASE=https://api.example.com node scripts/verify-targets.mjs --build');
    process.exit(1);
  }
  for (const mode of ['wx', 'douyin']) {
    const script = mode === 'wx' ? 'build:wx' : 'build:douyin';
    process.stdout.write(`· ${script} … `);
    try {
      execFileSync('npm', ['run', script], {
        cwd: root,
        env: { ...process.env, API_BASE: apiBase },
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
      process.stdout.write('ok\n');
    } catch (e) {
      process.stdout.write('失败\n');
      console.error(e.stdout?.toString?.() ?? '');
      console.error(e.stderr?.toString?.() ?? '');
      process.exit(1);
    }
  }
}

// ── 2. 微信包 ──────────────────────────────────────────────────────────────

const wxJsPath = resolve(WX_DIR, 'dist/game.js');
const wxJs = readIfExists(wxJsPath);
if (!wxJs) {
  check('FAIL', 'wx', '产物存在', `缺 ${wxJsPath}（先跑 npm run build:wx）`);
} else {
  const tt = countOf(wxJs, 'tt.');
  check(tt === 0 ? 'PASS' : 'FAIL', 'wx', '不含 tt. 命名空间', `出现 ${tt} 次`);
  check(countOf(wxJs, 'wx.') > 0 ? 'PASS' : 'FAIL', 'wx', '含 wx. 命名空间', '平台实现已打包');

  const loopback = countOf(wxJs, '127.0.0.1') + countOf(wxJs, 'localhost:');
  check(loopback === 0 ? 'PASS' : 'FAIL', 'wx', 'API 地址不是环回', `出现 ${loopback} 次`);

  const sizeMb = statSync(wxJsPath).size / 1024 / 1024;
  check(
    sizeMb < WX_MAIN_LIMIT_MB ? 'PASS' : 'FAIL',
    'wx', '主包 < 4MB', `${sizeMb.toFixed(2)} MB`,
  );

  // 启动页与触摸接线：这两个东西缺失时没有任何报错，只能靠断言
  check(countOf(wxJs, '正在准备') > 0 ? 'PASS' : 'WARN', 'wx', '含冷启动页', 'loading 阶段不再是死屏');
  check(countOf(wxJs, 'onTouchStart') > 0 ? 'PASS' : 'FAIL', 'wx', '含触摸绑定', 'onTouchStart');
}

const wxGameJsonRaw = readIfExists(resolve(WX_DIR, 'game.json'));
if (!wxGameJsonRaw) {
  check('FAIL', 'wx', 'game.json 存在', '缺文件');
} else {
  let cfg = null;
  try { cfg = JSON.parse(wxGameJsonRaw); } catch { /* 下面判定 */ }
  if (!cfg) {
    check('FAIL', 'wx', 'game.json 可解析', 'JSON 坏了');
  } else {
    check(cfg.openDataContext ? 'PASS' : 'FAIL', 'wx', '声明开放数据域', 'openDataContext');
    check(cfg.__usePrivacyCheck__ === true ? 'PASS' : 'FAIL', 'wx', '声明隐私检查', '__usePrivacyCheck__');
  }
}

const wxProjectRaw = readIfExists(resolve(WX_DIR, 'project.config.json'));
if (wxProjectRaw) {
  let p = null;
  try { p = JSON.parse(wxProjectRaw); } catch { /* noop */ }
  const appid = p?.appid;
  if (!appid || appid === 'touristappid') {
    check('WARN', 'wx', 'appid 是真实值', `当前 ${appid ?? '缺失'}（游客版不能上传/提审）`);
  } else {
    check('PASS', 'wx', 'appid 是真实值', appid);
  }
}

// ── 3. 抖音包 ──────────────────────────────────────────────────────────────

const dyJsPath = resolve(DY_DIR, 'dist/game.js');
const dyJs = readIfExists(dyJsPath);
if (!dyJs) {
  check('FAIL', 'dy', '产物存在', `缺 ${dyJsPath}（先跑 npm run build:douyin）`);
} else {
  const wx = countOf(dyJs, 'wx.');
  check(wx === 0 ? 'PASS' : 'FAIL', 'dy', '不含 wx. 命名空间', `出现 ${wx} 次`);
  check(countOf(dyJs, 'tt.') > 0 ? 'PASS' : 'FAIL', 'dy', '含 tt. 命名空间', '平台实现已打包');

  const loopback = countOf(dyJs, '127.0.0.1') + countOf(dyJs, 'localhost:');
  check(loopback === 0 ? 'PASS' : 'FAIL', 'dy', 'API 地址不是环回', `出现 ${loopback} 次`);

  // 抖音没有开放数据域：主域不该尝试拿它（能力查询应返回 false）
  check(countOf(dyJs, 'openDataContext') === 0 ? 'PASS' : 'WARN', 'dy', '未声明开放数据域', '抖音无此能力');

  check(countOf(dyJs, '正在准备') > 0 ? 'PASS' : 'WARN', 'dy', '含冷启动页', 'loading 阶段不再是死屏');
  check(countOf(dyJs, 'onTouchStart') > 0 ? 'PASS' : 'FAIL', 'dy', '含触摸绑定', 'onTouchStart');
}

const dyProjectRaw = readIfExists(resolve(DY_DIR, 'project.config.json'));
if (dyProjectRaw) {
  let p = null;
  try { p = JSON.parse(dyProjectRaw); } catch { /* noop */ }
  const appid = p?.appid;
  if (!appid || appid === 'tt0000000000000000') {
    check('WARN', 'dy', 'appid 是真实值', `当前 ${appid ?? '缺失'}（游客版不能上传/提审）`);
  } else {
    check('PASS', 'dy', 'appid 是真实值', appid);
  }
}

// ── 4. 输出 ────────────────────────────────────────────────────────────────

const icon = { PASS: '✓', FAIL: '✗', WARN: '!' };
const color = { PASS: '\x1b[32m', FAIL: '\x1b[31m', WARN: '\x1b[33m' };
const reset = '\x1b[0m';

console.log('\n双端产物门禁\n');
for (const r of rows) {
  const c = process.stdout.isTTY ? color[r.level] : '';
  const z = process.stdout.isTTY ? reset : '';
  console.log(`  ${c}${icon[r.level]}${z} [${r.target}] ${r.what.padEnd(18, ' ')} ${r.detail}`);
}

console.log(
  `\n${rows.filter((r) => r.level === 'PASS').length} 通过 · ${warned} 警告 · ${failed} 失败\n`,
);

if (failed > 0) {
  console.error('有 FAIL：这个包现在不能上传。\n');
  process.exit(1);
}
