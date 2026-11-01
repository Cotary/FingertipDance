import { describe, it, expect } from 'vitest';
import { SKINS, skinById, paletteOf } from '../src/render/skins';

describe('skins', () => {
  it('皮肤数量 ≥ 12', () => {
    expect(SKINS.length).toBeGreaterThanOrEqual(12);
  });

  it('id 唯一', () => {
    const ids = new Set(SKINS.map((s) => s.id));
    expect(ids.size).toBe(SKINS.length);
  });

  it('获取分三层：默认拥有 / 广告解锁 / 关卡里程碑', () => {
    const types = new Set(SKINS.map((s) => s.unlockType));
    expect(types.has('default')).toBe(true);
    expect(types.has('ad')).toBe(true);
    expect(types.has('milestone')).toBe(true);
  });

  it('顶级皮肤只能靠关卡，广告买不到', () => {
    // 旧版把 8 个普通皮肤挂在 3/8/15…关自动发放，和广告发的是同一批货，
    // 顶级皮肤就没有稀缺性了 —— 现在只有 premium 还留在关卡线上
    const premium = SKINS.filter((s) => s.tier === 'premium');
    expect(premium.length).toBeGreaterThanOrEqual(3);
    for (const s of premium) {
      expect(s.unlockType).toBe('milestone');
      expect(s.unlockValue).toBeGreaterThan(0);
    }
    for (const s of SKINS.filter((x) => x.tier !== 'premium' && x.unlockType !== 'default')) {
      expect(s.unlockType).toBe('ad');
    }
  });

  it('至少 3 种广告解锁皮肤', () => {
    expect(SKINS.filter((s) => s.unlockType === 'ad').length).toBeGreaterThanOrEqual(3);
  });

  it('至少 2 种里程碑皮肤（广告买不到的长期目标）', () => {
    expect(SKINS.filter((s) => s.unlockType === 'milestone').length).toBeGreaterThanOrEqual(2);
  });

  it('skinById 找不到时返回默认皮肤', () => {
    expect(skinById('nonexistent').id).toBe('wood');
  });

  it('调色板生成有效颜色', () => {
    const p = paletteOf(SKINS[0]);
    expect(p.base).toMatch(/^hsl\(/);
    expect(p.light).toMatch(/^hsl\(/);
    expect(p.dark).toMatch(/^hsl\(/);
  });

  it('每种皮肤都能生成完整调色板', () => {
    for (const s of SKINS) {
      const p = paletteOf(s);
      expect(p.base).toMatch(/^hsl\(/);
      expect(p.light).toMatch(/^hsl\(/);
      expect(p.dark).toMatch(/^hsl\(/);
      expect(p.border).toMatch(/^hsl\(/);
      expect(p.glow).toMatch(/^hsl\(/);
    }
  });
});
