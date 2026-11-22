import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 双端产物门禁的判据本身。
 *
 * ## 为什么门禁要测
 *
 * 这一轮踩到过：门禁数 `tt.` 出现次数，而压缩产物里局部变量名正好叫 `tt`
 * （`const tt = tutorialResult`），于是微信包被误判成"混进了抖音代码"。
 * 差点被当成真问题去改代码。
 *
 * 误报比漏报更坏 —— 门禁一叫狼来了，下次真混进去就没人当回事。
 * 所以判据收紧成「像平台调用的形态」，并用**真实产物片段**验证两件事：
 * 真的混入能抓到，压缩变量名的巧合不会误报。
 */

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(resolve(here, '../scripts/verify-targets.mjs'), 'utf8');

/**
 * 从脚本里把 `countPlatformCalls` 抽出来跑（脚本是 .mjs，不 import 它的整体）。
 *
 * 直接复制实现会失去"测的就是线上那份"的意义 —— 所以这里用 eval 取真身。
 */
function loadCounter(): (text: string, ns: string) => number {
  const m = SCRIPT.match(/function countPlatformCalls\([\s\S]*?\n}/);
  if (!m) throw new Error('找不到 countPlatformCalls');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return countPlatformCalls;`)() as (t: string, n: string) => number;
}

describe('countPlatformCalls · 真混入要抓到', () => {
  const count = loadCounter();

  it('tt 方法调用（抖音代码混进微信包）被抓到', () => {
    expect(count('var a=1;tt.login({});', 'tt')).toBe(1);
    expect(count('tt.onTouchStart(cb);tt.onTouchEnd(cb);', 'tt')).toBe(2);
  });

  it('typeof tt 存在性判断被抓到（平台代码最典型的开头）', () => {
    expect(count('if(typeof tt!=="undefined"){...}', 'tt')).toBe(1);
    expect(count('if (typeof tt === "undefined") return;', 'tt')).toBe(1);
  });

  it('wx 调用同样能抓（反向验证：抖音包混进微信代码）', () => {
    expect(count('wx.request({url:u});', 'wx')).toBe(1);
    expect(count('typeof wx', 'wx')).toBe(1);
  });
});

describe('countPlatformCalls · 变量名巧合不能误报', () => {
  const count = loadCounter();

  it('局部变量叫 tt 但只是读属性 —— 不算平台调用', () => {
    // 这一轮真实出现过的形态：`const tt = tutorialResult` 之后
    expect(count('setTimeout(()=>{M="result"}),tt.isLast&&S.setTutorialDone()', 'tt')).toBe(0);
    expect(count('{step:tt.step,total:tt.total,title:kn.title}', 'tt')).toBe(0);
  });

  it('完全无关的 tt 字符串不算', () => {
    expect(count('var better = 1; var tt = 2;', 'tt')).toBe(0);
    // 注意：`better` 里含 "tt" 但不是独立标识符
    expect(count('var attr = "x";', 'tt')).toBe(0);
  });

  it('空产物 / 无匹配返回 0', () => {
    expect(count('', 'tt')).toBe(0);
    expect(count('var a=1;', 'tt')).toBe(0);
  });
});

describe('门禁脚本的断言清单', () => {
  it('两端都检查：跨端调用为 0 + 本端调用 > 0', () => {
    // 「本端调用 > 0」这条不能省：否则一个空的 / 没打包的产物也能过门禁
    expect(SCRIPT).toContain("countPlatformCalls(wxJs, 'tt')");
    expect(SCRIPT).toContain("countPlatformCalls(dyJs, 'wx')");
    expect(SCRIPT).toMatch(/'wx', '含 wx 平台调用'/);
    expect(SCRIPT).toMatch(/'dy', '含 tt 平台调用'/);
  });

  it('检查环回地址（构建期 API_BASE 漏注入）', () => {
    expect(SCRIPT).toContain('127.0.0.1');
    expect(SCRIPT).toContain("'API 地址不是环回'");
  });

  it('微信工程必须声明开放数据域与隐私检查', () => {
    expect(SCRIPT).toContain('openDataContext');
    expect(SCRIPT).toContain('__usePrivacyCheck__');
  });

  it('主包体积上限（微信 4MB）', () => {
    expect(SCRIPT).toContain('WX_MAIN_LIMIT_MB');
  });
});
