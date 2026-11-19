import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 平台能力矩阵的契约测试。
 *
 * ## 为什么用源码断言而不是 import
 *
 * `platform` 是编译期按 `__TARGET__` 选出来的单例，测试环境里
 * 只会加载到其中一份（Web）。要验证「抖音端报什么通道」，
 * 必须直接读源码 —— 反正这些值是**常量声明**，源码就是真值。
 */

const ROOT = resolve(__dirname, '../src/platform');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('平台分享能力矩阵', () => {
  it('微信报 friend + timeline', () => {
    const src = read('wechat.ts');
    expect(src).toMatch(/shareChannels:\s*\['friend',\s*'timeline'\]/);
  });

  it('抖音报 friend + douyin，且**不含 timeline**', () => {
    const src = read('douyin.ts');
    expect(src).toMatch(/shareChannels:\s*\['friend',\s*'douyin'\]/);
    // 抖音没有朋友圈。列进去会在面板上多画一个点不动的按钮。
    expect(src, '抖音不能声明 timeline').not.toMatch(/shareChannels:[^\n]*timeline/);
  });

  it('Web 只报 friend', () => {
    const src = read('web.ts');
    expect(src).toMatch(/shareChannels:\s*\['friend'\]/);
  });

  it('每个平台都实现了 shareChannels（接口要求）', () => {
    for (const f of ['wechat.ts', 'douyin.ts', 'web.ts']) {
      expect(read(f), `${f} 缺少 shareChannels`).toContain('shareChannels');
    }
  });
});

describe('抖音平台实现完整性', () => {
  const src = read('douyin.ts');

  it('用 tt.* 而不是 wx.*（命名空间不能混）', () => {
    // 抖音小游戏的全局对象是 tt；混入 wx 调用会在抖音上直接 undefined
    expect(src).toMatch(/tt\.login/);
    expect(src).toMatch(/tt\.createRewardedVideoAd/);
    expect(src).toMatch(/tt\.getSystemInfoSync/);
    // 不该出现 wx 的调用（注释里可以提，但 `wx.` 后面跟标识符就是调用）
    expect(src, '抖音实现里不该调用 wx.*').not.toMatch(/\bwx\.\w+\(/);
  });

  it('登录同时返回 code 与 anonymousCode（抖音允许匿名）', () => {
    // 抖音玩家可以不授权就进游戏，只能拿到 anonymousCode。
    // 只认 code 会让这批玩家直接登录失败 —— 而他们是大多数。
    expect(src).toContain('anonymousCode');
  });

  it('广告加载失败时兜底发放（不卡玩家）', () => {
    // 与微信端同一策略：玩家没义务为平台广告库存不足买单
    expect(src).toMatch(/onError[\s\S]{0,200}finish\(true\)/);
  });

  it('振动档位映射与微信一致', () => {
    // 同一个动作在两端力度必须一样，否则手感不同
    for (const f of ['wechat.ts', 'douyin.ts']) {
      const s = read(f);
      expect(s, `${f} 的振动分档应与微信一致`).toContain("ms >= 30 ? 'heavy'");
    }
  });
});

describe('平台实现选择', () => {
  it('index.ts 覆盖三端', () => {
    const src = read('index.ts');
    expect(src).toContain('wechatPlatform');
    expect(src).toContain('douyinPlatform');
    expect(src).toContain('webPlatform');
    // 抖音分支必须真的被选中（否则构建出 --mode douyin 也跑 Web）
    expect(src).toMatch(/__TARGET__\s*===\s*'douyin'/);
  });

  it('Platform.name 的类型包含三端', () => {
    const src = read('types.ts');
    expect(src).toMatch(/'web'\s*\|\s*'wechat'\s*\|\s*'douyin'/);
  });
});
