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

  it('覆盖四种解锁方式', () => {
    const types = new Set(SKINS.map((s) => s.unlockType));
    expect(types.has('default')).toBe(true);
    expect(types.has('level')).toBe(true);
    expect(types.has('ad')).toBe(true);
    expect(types.has('milestone')).toBe(true);
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
