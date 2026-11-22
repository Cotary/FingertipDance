import { describe, it, expect, afterEach } from 'vitest';
import { themeById, themeUnlocked, applyThemeUnlocks, THEMES } from '../src/render/themes';
import {
  needsAdForHint,
  applyRewardFrequency,
  skipBlockReason,
  skipUsedToday,
  markSkippedToday,
} from '../src/ads/rewardRules';
import { Ads } from '../src/ads/ads';
import { resolveShareBase } from '../src/game/challenge';
import { platform } from '../src/platform';

/**
 * 平台配置下发后的**客户端消费**规则。
 *
 * 服务端的归一化测试在 Go 侧；这里锁的是「拿到值之后怎么用」：
 * 免费提示次数、每日跳关上限、激励视频额度、主题覆盖、分享基址。
 * 这些都是运营在后台改一下就会立刻影响线上的规则，
 * 出错不会报错，只会表现成「玩家点不动 / 广告看不了」。
 */

afterEach(() => {
  // 模块级配置是单例：一个用例改完必须还原，
  // 否则后面的用例会读到上一条的频控设置（vitest 同文件共享模块）。
  applyRewardFrequency({ hintFreeUses: 0, skipDailyLimit: 0 });
  applyThemeUnlocks([]);
});

describe('hintFreeUses：每关免费提示次数', () => {
  it('默认 0 = 第一次提示就要看广告（与改造前一致）', () => {
    applyRewardFrequency({ hintFreeUses: 0 });
    expect(needsAdForHint(1, 0)).toBe(true);
  });

  it('配 2 次免费：前两次不问广告，第三次付一次，之后本关免费', () => {
    applyRewardFrequency({ hintFreeUses: 2 });
    expect(needsAdForHint(1, 0)).toBe(false);
    expect(needsAdForHint(1, 1)).toBe(false);
    expect(needsAdForHint(1, 2)).toBe(true);
    // 关键：付过之后不再每次都要 —— 与改造前「只付一次」一致
    expect(needsAdForHint(1, 3)).toBe(false);
    expect(needsAdForHint(1, 9)).toBe(false);
  });

  it('负数不生效（否则会把提示直接锁死）', () => {
    applyRewardFrequency({ hintFreeUses: -1 });
    // 仍按 0 处理：第一次要看广告
    expect(needsAdForHint(1, 0)).toBe(true);
  });
});

describe('skipDailyLimit：每日跳关上限', () => {
  it('按「今日已用 + 上限」判定，并给出可读理由', () => {
    const used = skipUsedToday();
    applyRewardFrequency({ skipDailyLimit: used + 2 });

    const a = 900001;
    const b = 900002;
    const c = 900003;

    expect(skipBlockReason(a)).toBeNull();
    markSkippedToday(a);
    markSkippedToday(b);

    const reason = skipBlockReason(c);
    expect(reason).not.toBeNull();
    expect(reason).toContain('跳关次数用完');
  });

  it('同一关今天跳过之后，理由优先说「本关已跳过」', () => {
    const idx = 900010;
    markSkippedToday(idx);
    expect(skipBlockReason(idx)).toBe('本关今天已经跳过了');
  });

  it('上限 0 = 不限，只有「本关已跳过」这一条限制', () => {
    applyRewardFrequency({ skipDailyLimit: 0 });
    expect(skipBlockReason(900020)).toBeNull();
  });
});

describe('激励视频每日额度', () => {
  it('额度用完时立即返回 false（不弹广告、不白等）', async () => {
    // 直接写计数，不真跑一次 3 秒的 mock 广告
    const day = new Date().toISOString().slice(0, 10);
    platform.storage.set(`ad_rewarded_${day}`, '3');

    const a = new Ads();
    a.applyFrequency({ rewardedDailyLimit: 3 });

    expect(a.rewardedQuotaLeft()).toBe(0);
    expect(await a.showRewarded('hint')).toBe(false);

    a.applyFrequency({ rewardedDailyLimit: 0 });
    platform.storage.set(`ad_rewarded_${day}`, '0');
  });

  it('上限 0 = 不限（Infinity）', () => {
    const a = new Ads();
    a.applyFrequency({ rewardedDailyLimit: 0 });
    expect(a.rewardedQuotaLeft()).toBe(Infinity);
  });
});

describe('applyThemeUnlocks：主题解锁条件下发', () => {
  it('覆盖后按新关号判定，撤销后回落到本地常量', () => {
    const mingsha = themeById('mingsha')!;
    // 本地常量：60 关解锁
    expect(themeUnlocked(mingsha, 59, new Set())).toBe(false);

    applyThemeUnlocks([{ id: 'mingsha', unlock: 'milestone', value: 10 }]);
    expect(themeUnlocked(mingsha, 10, new Set())).toBe(true);
    expect(themeUnlocked(mingsha, 9, new Set())).toBe(false);

    // 服务端不再下发（或回滚）：必须回到 60，而不是停在 10
    applyThemeUnlocks([]);
    expect(themeUnlocked(mingsha, 10, new Set())).toBe(false);
    expect(themeUnlocked(mingsha, 60, new Set())).toBe(true);
  });

  it('服务端多出来的 / 拼错的 id 不影响本地主题', () => {
    const before = THEMES.map((t) => ({ id: t.id, ...t.unlock }));
    applyThemeUnlocks([
      { id: 'not-exist', unlock: 'free', value: 0 },
      { id: 'mise', unlock: '收费', value: 5 },
    ]);
    const after = THEMES.map((t) => ({ id: t.id, ...t.unlock }));
    expect(after).toEqual(before);
  });

  it('覆盖后按解锁关号重排（主题页是一条进阶线）', () => {
    // 把鸣沙提前到 1 关，它应该排到秘色天青（免费，0）之后、但仍在前
    applyThemeUnlocks([{ id: 'mingsha', unlock: 'milestone', value: 1 }]);
    expect(THEMES[0].id).toBe('mise');
    expect(THEMES[1].id).toBe('mingsha');

    // 把秘色改成里程碑 100 关，鸣沙（60）应该排前面
    applyThemeUnlocks([{ id: 'mise', unlock: 'milestone', value: 100 }]);
    expect(THEMES[0].id).toBe('mingsha');
    expect(THEMES[1].id).toBe('mise');
  });
});

describe('resolveShareBase：分享链接基址', () => {
  const loc = { origin: 'https://dev.local:50002', pathname: '/' };

  it('Web 端优先用当前页面地址（本地调试复制出来能直接打开）', () => {
    expect(resolveShareBase({ isWeb: true, shareUrlPrefix: 'https://game.example.com/line', location: loc }))
      .toBe('https://dev.local:50002/');
  });

  it('小游戏端没有 location，用服务端下发的前缀', () => {
    expect(resolveShareBase({ isWeb: false, shareUrlPrefix: 'https://game.example.com/line' }))
      .toBe('https://game.example.com/line');
  });

  it('前缀尾部的 ? / & 被去掉（否则拼出 ?&l=47）', () => {
    expect(resolveShareBase({ isWeb: false, shareUrlPrefix: 'https://game.example.com/line?&' }))
      .toBe('https://game.example.com/line');
  });

  it('既没有前缀也没有 location → 空串（由调用方提示配置缺失）', () => {
    expect(resolveShareBase({ isWeb: false })).toBe('');
  });
});
