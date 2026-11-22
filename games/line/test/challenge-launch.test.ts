import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * 启动参数 → 挑战。
 *
 * ## 两条容易断的路径
 *
 * 1. **参数来源**：微信 / 抖音 `getLaunchOptionsSync`、Web `location.search`。
 *    这段以前写在 `challenge.ts` 里，只认 `wx`，抖音端落进 `location` 分支
 *    —— 小游戏里没有 `location`，于是**抖音端所有分享链接都打不开对应关卡**。
 *    现在来源统一由 `platform.launchQuery()` 提供（来源本身的测试见
 *    `platform-input.test.ts`），这里只验证「拿到参数之后怎么解析」。
 * 2. **热启动**：游戏在运行时点分享卡片，参数来自 `onShow(res).query`，
 *    走 `parseChallengeFrom` —— 必须和冷启动同一套规则，不能各写一份。
 */

const SAVED = Object.getOwnPropertyDescriptor(globalThis, 'location');

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../src/platform');
  vi.resetModules();
  if (SAVED) Object.defineProperty(globalThis, 'location', SAVED);
  else delete (globalThis as Record<string, unknown>).location;
});

/** 用一份固定的启动参数加载 challenge 模块。 */
async function loadWith(query: Record<string, string> | undefined, name: 'web' | 'wechat' | 'douyin' = 'wechat') {
  vi.doMock('../src/platform', () => ({
    platform: { name, launchQuery: () => query ?? {} },
  }));
  return import('../src/game/challenge');
}

describe('parseChallenge · 冷启动', () => {
  it('读出关号、重来次数、发起人、token', async () => {
    const { parseChallenge } = await loadWith({
      l: '27', undos: '3', uid: '42', name: encodeURIComponent('小明'), c: 'TOK',
    });
    expect(parseChallenge()).toEqual({
      levelIdx: 27,
      fromUid: 42,
      fromName: '小明',
      fromUndos: 3,
      token: 'TOK',
    });
  });

  it('0 次重来保留为 0（最好的成绩，不能退化成「不知道」）', async () => {
    const { parseChallenge } = await loadWith({ l: '12', undos: '0' });
    expect(parseChallenge()?.fromUndos).toBe(0);
  });

  it('平台拿不到启动参数（返回空）时解析为 null，不抛', async () => {
    const { parseChallenge } = await loadWith(undefined);
    expect(parseChallenge()).toBeNull();
  });
});

describe('parseChallengeFrom · 热启动复用同一套规则', () => {
  it('与冷启动解析结果一致', async () => {
    const { parseChallengeFrom } = await loadWith({});
    expect(parseChallengeFrom({ l: '9', undos: '1', uid: '7', name: encodeURIComponent('阿青') })).toEqual({
      levelIdx: 9,
      fromUid: 7,
      fromName: '阿青',
      fromUndos: 1,
      token: null,
    });
  });

  it('空 query / 无 l / 非法关号 一律 null（不能把玩家送进第 0 关）', async () => {
    const { parseChallengeFrom } = await loadWith({});
    expect(parseChallengeFrom(undefined)).toBeNull();
    expect(parseChallengeFrom({})).toBeNull();
    expect(parseChallengeFrom({ l: '0' })).toBeNull();
    expect(parseChallengeFrom({ l: '-3' })).toBeNull();
    expect(parseChallengeFrom({ l: 'abc' })).toBeNull();
  });

  it('只带 l 时是纯邀请：没有成绩、没有 token', async () => {
    const { parseChallengeFrom } = await loadWith({});
    const c = parseChallengeFrom({ l: '5' });
    expect(c?.fromUndos).toBeNull();
    expect(c?.token).toBeNull();
    expect(c?.fromUid).toBe(0);
    expect(c?.fromName).toBe('好友');
  });
});
