import { describe, it, expect } from 'vitest';
import { NAV_TABS, NAV_ITEM_W, NAV_H, NAV_TOP, navHitAreas, pickNavTab } from '../src/ui/nav';
import { DESIGN_H } from '../src/render/layout';

describe('底部导航', () => {
  it('有 5 个页签', () => {
    expect(NAV_TABS.length).toBe(5);
  });

  it('命中区域互不重叠且铺满整行', () => {
    const areas = navHitAreas();
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i].x).toBeCloseTo(areas[i - 1].x + areas[i - 1].w, 5);
    }
    expect(areas[areas.length - 1].x + areas[areas.length - 1].w).toBeCloseTo(750, 5);
  });

  it('点击能命中对应页签', () => {
    const areas = navHitAreas();
    areas.forEach((a) => {
      expect(pickNavTab(a.x + a.w / 2, a.y + a.h / 2)).toBe(a.tab);
    });
  });

  it('导航栏之外点不到', () => {
    expect(pickNavTab(375, NAV_TOP - 50)).toBeNull();
    expect(pickNavTab(375, DESIGN_H + 10)).toBeNull();
  });

  it('导航栏锚定在底部', () => {
    expect(NAV_TOP + NAV_H).toBe(DESIGN_H);
    expect(NAV_ITEM_W).toBe(150);
  });
});
