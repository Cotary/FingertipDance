import { describe, it, expect } from 'vitest';
import { THEMES, themeById, isThemeId, themeUnlocked } from '../src/render/themes';
import { clayFrom } from '../src/render/themes/types';
import {
  pickThemeChip, themeIdAt, isThemeOwned, shelfCardRect, shelfMaxScroll, clampShelfScroll,
  shelfCount, type SkinsPageState,
} from '../src/ui/skins';

describe('棋盘主题 · 目录', () => {
  it('只挂两套做完的，按解锁关号从小到大排列', () => {
    // 目录里出现几套，就意味着几套是**六通道整套做完**的。
    // 没做完的先摘掉 —— 主题页上凑数的卡片比少几张卡伤害大得多
    expect(THEMES.map((t) => t.id)).toEqual(['mise', 'mingsha']);
  });

  it('id / 名字都不重复（重复的 id 会让装备值指向两套）', () => {
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
  });

  it('id 唯一', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  });

  it('陈列顺序按解锁关号递增（玩家看到的是一条进阶线）', () => {
    const vals = THEMES.map((t) => t.unlock.value);
    expect([...vals].sort((a, b) => a - b)).toEqual(vals);
  });

  it('每套都自带界面配色 —— 深色盘面配黏土 UI 会读不出来', () => {
    for (const t of THEMES) {
      expect(t.chrome, `${t.id} 缺 chrome`).toBeTruthy();
      const c = t.chrome!;
      // 十个字段一个都不能空：空串在 canvas 上是静默失败（fillStyle 不生效），
      // 表现成「上一笔的颜色」，排查起来极贵
      for (const [k, v] of Object.entries(c)) {
        expect(typeof v, `${t.id}.${k}`).toBe('string');
        expect(v.length, `${t.id}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('主题名字与一句话卖点都不为空（展台要放得下）', () => {
    for (const t of THEMES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.name.length).toBeLessThanOrEqual(6);
      expect(t.tagline.length).toBeGreaterThan(0);
    }
  });

  it('themeById / isThemeId 对未知 id 返回空（旧存档里的废弃主题要能安全退化）', () => {
    expect(themeById('bamboo')).toBeUndefined();
    expect(themeById('')).toBeUndefined();
    // 注意：`bamboo`/`frost` 都曾经是「不存在的 id」样例，现在 `frost` 已下线。
    // 挑样例时别用「即将上线的主题名」，否则新主题一落地这条就会假失败。
    expect(isThemeId('sakura')).toBe(false);
    expect(isThemeId('mingsha')).toBe(true);
    // 摘掉的主题：文件还在，但不注册 —— 旧存档里装备着它必须安全退回经典
    expect(isThemeId('kintsugi')).toBe(false);
    expect(isThemeId('gilded')).toBe(false);
  });

  it('里程碑解锁按最高通关关号判定', () => {
    const mingsha = themeById('mingsha')!;
    const gate = mingsha.unlock.value;
    expect(themeUnlocked(mingsha, gate - 1, new Set())).toBe(false);
    expect(themeUnlocked(mingsha, gate, new Set())).toBe(true);
  });
});

describe('clayFrom · 单色派生黏土四阶', () => {
  it('浅色基色照常往白推（保持和手写 CLAY 一致的观感）', () => {
    const t = clayFrom('#E07A4F');
    expect(t.base).toBe('#E07A4F');
    // 亮面必须比基色亮：解析成 rgb 后逐通道比较
    const [r1, g1, b1] = /rgb\((\d+),(\d+),(\d+)\)/.exec(t.light)!.slice(1).map(Number);
    expect(r1 + g1 + b1).toBeGreaterThan(0xe0 + 0x7a + 0x4f);
  });

  it('近黑基色只轻推 —— 同样的 +26% 会把深色按钮推成脏灰（实测读作「禁用」）', () => {
    const dark = clayFrom('#21473C');
    const [r, g, b] = /rgb\((\d+),(\d+),(\d+)\)/.exec(dark.light)!.slice(1).map(Number);
    // 亮面必须仍是「深色」：三通道都在 130 以下
    expect(Math.max(r, g, b)).toBeLessThan(130);
  });

  it('非法输入原样返回，不抛异常（颜色写错不该让整屏变黑）', () => {
    const t = clayFrom('rgba(1,2,3,0.5)');
    expect(t.base).toBe('rgba(1,2,3,0.5)');
    expect(t.light).toBe('rgba(1,2,3,0.5)');
  });
});

describe('棋盘页 · 命中与解锁', () => {
  const base: SkinsPageState = {
    equipped: 'wood',
    selected: 'wood',
    unlocked: new Set(['wood']),
    page: 0,
    themeSelected: '',
    themeEquipped: '',
    maxLevel: 0,
  };

  it('陶片：0 号就是第一套主题（不再有「经典」那一张），越界返回空', () => {
    // 主题页上只摆真主题 —— "经典 · 陶土盘面"那张卡已经摘掉。
    // 默认装备是 `progressStore` 里的 `currentTheme: 'mise'`（天青）。
    expect(themeIdAt(0)).toBe('mise');
    expect(themeIdAt(1)).toBe('mingsha');
    expect(themeIdAt(2)).toBe('');
    expect(themeIdAt(99)).toBe('');
    expect(shelfCount()).toBe(2);
  });

  it('货架几何按设计稿：卡 320×252、间距 22、两列左沿 44 / 386', () => {
    const a = shelfCardRect(0);
    expect([a.x, a.y, a.w, a.h]).toEqual([44, 418, 320, 253]);
    const b = shelfCardRect(1);
    expect(b.x).toBe(386);
    expect(b.y).toBe(418);
    const c = shelfCardRect(2);
    expect([c.x, c.y]).toEqual([44, 418 + 253 + 18]);
  });

  it('每张卡都能点中，且互不重叠', () => {
    const hits: number[] = [];
    for (let i = 0; i < shelfCount(); i++) {
      const r = shelfCardRect(i, 0);
      // 首屏之外的行先滚进来
      const scroll = Math.max(0, r.y + r.h - 1200);
      const rr = shelfCardRect(i, scroll);
      hits.push(pickThemeChip(rr.x + 40, rr.y + 40, scroll));
    }
    expect(hits).toEqual([...Array(shelfCount()).keys()]);
    // 卡内任意点都算命中（点名字/预览一样选中）
    expect(pickThemeChip(44 + 20, 418 + 20)).toBe(0);
    // 两列之间的空隙不该有归属
    expect(pickThemeChip(375, 418 + 60)).toBe(-1);
    // 两行之间的空隙不该有归属（卡底 664、下一行顶 684）
    expect(pickThemeChip(44 + 160, 418 + 253 + 9)).toBe(-1);
    // 大卡区域不该返回卡片
    expect(pickThemeChip(44 + 160, 300)).toBe(-1);
  });

  it('滚动上限：内容不足一屏时为 0，且不会滚成负数', () => {
    const rows = Math.ceil(shelfCount() / 2);
    const contentH = rows * 253 + (rows - 1) * 18;
    expect(shelfMaxScroll()).toBe(Math.max(0, contentH - (1214 - 418)));
    expect(clampShelfScroll(-99)).toBe(0);
    expect(clampShelfScroll(99999)).toBe(shelfMaxScroll());
    // 只有内容超出一屏时，滚到底才"最后一行正好露全"
    if (shelfMaxScroll() > 0) {
      const last = shelfCardRect(shelfCount() - 1, shelfMaxScroll());
      expect(last.y + last.h).toBe(1214);
    }
  });

  it('里程碑未到不解锁；调试构建全解锁', () => {
    const mingsha = themeById('mingsha')!;
    const gate = mingsha.unlock.value;
    expect(isThemeOwned({ ...base, maxLevel: gate - 1 }, mingsha)).toBe(false);
    expect(isThemeOwned({ ...base, maxLevel: gate }, mingsha)).toBe(true);
    expect(isThemeOwned({ ...base, maxLevel: 0, themeAllUnlocked: true }, mingsha)).toBe(true);
  });
});
