import { describe, it, expect } from 'vitest';
import { THEMES, themeById, isThemeId, themeUnlocked } from '../src/render/themes';
import { clayFrom } from '../src/render/themes/types';
import { pickSkinsTab, pickThemeChip, themeIdAt, isThemeOwned, type SkinsPageState } from '../src/ui/skins';

describe('棋盘主题 · 目录', () => {
  it('九套，按解锁关号从小到大排列', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'ink', 'glass', 'kintsugi', 'pixel', 'orbit', 'neon', 'obsidian', 'gilded', 'abyss',
    ]);
  });

  it('九套的 id / 名字都不重复（重复的 id 会让装备值指向两套）', () => {
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
    // 注意：`bamboo`/`frost` 都曾经是「不存在的 id」样例，现在 `frost` 已下线、`kintsugi` 上线。
    // 挑样例时别用「即将上线的主题名」，否则新主题一落地这条就会假失败。
    expect(isThemeId('sakura')).toBe(false);
    expect(isThemeId('kintsugi')).toBe(true);
    expect(isThemeId('gilded')).toBe(true);
  });

  it('里程碑解锁按最高通关关号判定', () => {
    const glass = themeById('glass')!;
    expect(themeUnlocked(glass, 199, new Set())).toBe(false);
    expect(themeUnlocked(glass, 200, new Set())).toBe(true);
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
    tab: 'skin',
    themeSelected: '',
    themeEquipped: '',
    maxLevel: 0,
  };

  it('页签热区互不重叠，且都在标题带内', () => {
    const skin = pickSkinsTab(60, 90);
    const theme = pickSkinsTab(250, 90);
    expect(skin).toBe('skin');
    expect(theme).toBe('theme');
    // 两块之间是空隙，不该有归属
    expect(pickSkinsTab(232, 90)).toBe(null);
    // 展台区域内点不到页签
    expect(pickSkinsTab(375, 400)).toBe(null);
  });

  it('陶片：0 号是「经典」，1~9 是九套主题', () => {
    expect(themeIdAt(0)).toBe('');
    expect(themeIdAt(1)).toBe('ink');
    expect(themeIdAt(9)).toBe('abyss');
    expect(themeIdAt(99)).toBe('');
  });

  it('十块陶片都能点中，且互不重叠（5 列 × 2 行，两行都满）', () => {
    const hits: number[] = [];
    // 两行各 5 块：总宽 5*121+4*10 = 645，左界 52.5；陶片 y 878 / 1022，高 104
    for (let i = 0; i < 5; i++) hits.push(pickThemeChip(52.5 + i * 131 + 60, 930));
    for (let i = 5; i < 10; i++) hits.push(pickThemeChip(52.5 + (i - 5) * 131 + 60, 1074));
    expect(hits).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 名字也在热区里（字比色块小，点字也该选中）
    expect(pickThemeChip(52.5 + 60, 1000)).toBe(0);
    // 两行之间的空隙不该有归属（否则点空白会误选上一行）
    expect(pickThemeChip(52.5 + 60, 1016)).toBe(-1);
  });

  it('里程碑未到不解锁；调试构建全解锁', () => {
    const gilded = themeById('gilded')!;
    expect(isThemeOwned({ ...base, maxLevel: 899 }, gilded)).toBe(false);
    expect(isThemeOwned({ ...base, maxLevel: 900 }, gilded)).toBe(true);
    expect(isThemeOwned({ ...base, maxLevel: 0, themeAllUnlocked: true }, gilded)).toBe(true);
  });
});
