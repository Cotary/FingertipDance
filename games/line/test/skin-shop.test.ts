import { afterEach, describe, it, expect } from 'vitest';
import {
  drawSkinsPage, isSkinOwned, isThemeOwned, pickSkinChip, skinCardRect,
  skinMaxScroll, clampSkinScroll, skinIdAt, ownedSkinCount,
  type SkinsPageState,
} from '../src/ui/skins';
import { SKINS, skinById } from '../src/render/skins';
import { applyThemeUnlocks, themeById } from '../src/render/themes';

/** Canvas 桩：绘图全部 no-op。 */
function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return () => undefined;
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function state(patch: Partial<SkinsPageState> = {}): SkinsPageState {
  return {
    tab: 'skins',
    equipped: 'wood',
    selected: 'wood',
    unlocked: new Set(['wood', 'mint']),
    page: 0,
    themeSelected: 'mise',
    themeEquipped: 'mise',
    maxLevel: 0,
    unlockedThemes: new Set<string>(),
    ...patch,
  };
}

afterEach(() => {
  // 还原主题解锁档位：`applyThemeUnlocks(undefined)` 会把本地快照覆盖回去
  applyThemeUnlocks(undefined);
});

describe('棋子皮肤 · 归属判定', () => {
  it('默认皮肤永远拥有，不依赖任何存档', () => {
    const st = state({ unlocked: new Set() });
    expect(isSkinOwned(st, skinById('wood'))).toBe(true);
    expect(isSkinOwned(st, skinById('mint'))).toBe(true);
  });

  it('广告皮肤要看 unlocked 集合', () => {
    const st = state();
    expect(isSkinOwned(st, skinById('graphite'))).toBe(false);
    st.unlocked.add('graphite');
    expect(isSkinOwned(st, skinById('graphite'))).toBe(true);
  });

  it('里程碑皮肤由 maxLevel 推导（不用等落盘）', () => {
    expect(isSkinOwned(state({ maxLevel: 199 }), skinById('gold'))).toBe(false);
    expect(isSkinOwned(state({ maxLevel: 200 }), skinById('gold'))).toBe(true);
    expect(isSkinOwned(state({ maxLevel: 900 }), skinById('galaxy'))).toBe(true);
  });

  it('已拥有数与 16 套目录一致（不多不少）', () => {
    expect(SKINS.length).toBe(16);
    const st = state({ maxLevel: 900 });
    // 2 免费 + 10 广告（未解锁）+ 3 里程碑（够关号）= 5
    expect(ownedSkinCount(st)).toBe(5);
    st.unlocked = new Set(SKINS.map((s) => s.id));
    expect(ownedSkinCount(st)).toBe(16);
  });
});

describe('主题 · 广告解锁档', () => {
  it('unlockedThemes 里的主题算拥有', () => {
    // 目录里没有 ad 档主题 —— ad 档只能由后台配置下发，
    // 所以这里必须先套一次覆盖，否则 mingsha 还是里程碑档（60 关）。
    applyThemeUnlocks([{ id: 'mingsha', unlock: 'ad', value: 0 }]);
    const st = state();
    expect(isThemeOwned(st, themeById('mingsha')!)).toBe(false);
    st.unlockedThemes = new Set(['mingsha']);
    expect(isThemeOwned(st, themeById('mingsha')!)).toBe(true);
  });

  it('ad 档主题在大卡上给「看视频解锁」按钮', () => {
    applyThemeUnlocks([{ id: 'mingsha', unlock: 'ad', value: 0 }]);
    const ids = drawSkinsPage(fakeCtx(), state({ tab: 'themes', themeSelected: 'mingsha' }), 0).map((b) => b.id);
    expect(ids).toContain('unlockThemeAd');

    // 解锁后同一个位置换成「使用」
    const owned = drawSkinsPage(
      fakeCtx(),
      state({ tab: 'themes', themeSelected: 'mingsha', unlockedThemes: new Set(['mingsha']) }),
      0,
    ).map((b) => b.id);
    expect(owned).not.toContain('unlockThemeAd');
    expect(owned).toContain('equipTheme');
  });

  it('里程碑主题不给假按钮（只写关号）', () => {
    const ids = drawSkinsPage(fakeCtx(), state({ tab: 'themes', themeSelected: 'mingsha', maxLevel: 10 }), 0).map((b) => b.id);
    expect(ids).not.toContain('unlockThemeAd');
    expect(ids).not.toContain('equipTheme');
  });
});

describe('皮肤网格 · 几何与点击', () => {
  it('三列布局：左沿 44 / 271 / 498', () => {
    expect(skinCardRect(0).x).toBe(44);
    expect(skinCardRect(1).x).toBe(44 + 208 + 19);
    expect(skinCardRect(2).x).toBe(44 + (208 + 19) * 2);
  });

  it('16 套装得下、需要滚动，且滚动被夹在合法区间', () => {
    expect(skinMaxScroll()).toBeGreaterThan(0);
    expect(clampSkinScroll(-100)).toBe(0);
    expect(clampSkinScroll(999999)).toBe(skinMaxScroll());
  });

  it('每张卡都能点中', () => {
    for (let i = 0; i < SKINS.length; i++) {
      const r = skinCardRect(i, 0);
      const scroll = Math.max(0, r.y + r.h - 1200);
      const rr = skinCardRect(i, scroll);
      expect(pickSkinChip(rr.x + 30, rr.y + 30, scroll), `第 ${i} 张`).toBe(i);
    }
    expect(skinIdAt(0)).toBe('wood');
    expect(skinIdAt(999)).toBe('');
  });

  it('皮肤分段返回可点的卡（拥有的整张可点，广告卡给解锁键）', () => {
    const ids = drawSkinsPage(
      fakeCtx(),
      state({ tab: 'skins', unlocked: new Set(['wood', 'mint', 'graphite']) }),
      0,
    ).map((b) => b.id);
    expect(ids).toContain('skinTab');
    expect(ids).toContain('themeTab');
    // wood 是「使用中」→ 不出按钮；graphite 已拥有未装备 → 可点
    expect(ids).toContain(`skin:${SKINS.findIndex((s) => s.id === 'graphite')}`);
    // 未解锁的广告皮肤给「看视频解锁」
    expect(ids).toContain(`skinAd:${SKINS.findIndex((s) => s.id === 'slate')}`);
  });
});
