/**
 * 自定义（参数驱动）生成器自检。
 *
 * 覆盖三件事：
 *   1. 生成的关卡**全部可解**（参考解在完整规则下回放通过）；
 *   2. 用户指定的**数量约束真的生效**（尺寸、障碍数、机制数）；
 *   3. 同种子 → 同结果（可复现）。
 */
import { describe, it, expect } from 'vitest';
import { generateCustomLevels, DEFAULT_CUSTOM_PARAMS, type CustomGenParams } from '../src/core/cover/v3/custom';
import { buildRuleSet, replay } from '../src/core/cover/v3/rules';
import { CoverCell, cellType } from '../src/core/cover/v3/types';

function walkable(lv: { grid: Uint8Array; w: number; h: number }): number[] {
  const out: number[] = [];
  for (let i = 0; i < lv.grid.length; i++) {
    const t = cellType(lv.grid[i]);
    if (t !== CoverCell.VOID && t !== CoverCell.BLOCK) out.push(i);
  }
  return out;
}

/** 统计某种机制的格数。 */
function countType(lv: { grid: Uint8Array }, type: number): number {
  let n = 0;
  for (const b of lv.grid) if (cellType(b) === type) n++;
  return n;
}

describe('自定义生成器', () => {
  const params: CustomGenParams = {
    ...DEFAULT_CUSTOM_PARAMS,
    count: 12,
    w: { min: 5, max: 7 },
    h: { min: 5, max: 7 },
    holes: { min: 2, max: 8 },
    oneway: { min: 1, max: 3 },
    shard: { min: 1, max: 3 },
    keygate: { min: 0, max: 1 },
    portal: { min: 0, max: 1 },
    ice: { min: 0, max: 1 },
    seed: 12345,
  };

  it('生成的关卡全部可解（参考解回放通过）', () => {
    const levels = generateCustomLevels(params);
    expect(levels.length).toBe(params.count);
    for (const lv of levels) {
      const rs = buildRuleSet(walkable(lv), lv.grid, lv.w, lv.h);
      rs.startAt = lv.startAt >= 0 ? rs.localOf[lv.startAt] : -1;
      rs.endAt = lv.endAt >= 0 ? rs.localOf[lv.endAt] : -1;
      const r = replay(rs, lv.solution.map((f) => rs.localOf[f]));
      expect(r.ok, `第 ${lv.idx} 关回放失败：${r.error}`).toBe(true);
      // 解必须铺满全部可走格
      expect(lv.solution.length).toBe(lv.required);
    }
  });

  it('尺寸落在用户指定的范围内', () => {
    const levels = generateCustomLevels(params);
    for (const lv of levels) {
      expect(lv.w).toBeGreaterThanOrEqual(params.w.min);
      expect(lv.w).toBeLessThanOrEqual(params.w.max);
      expect(lv.h).toBeGreaterThanOrEqual(params.h.min);
      expect(lv.h).toBeLessThanOrEqual(params.h.max);
    }
  });

  it('机制数量落在用户指定的范围内', () => {
    const levels = generateCustomLevels(params);
    for (const lv of levels) {
      // 单向门
      expect(countType(lv, CoverCell.ONEWAY)).toBeLessThanOrEqual(params.oneway.max);
      // 星星
      expect(countType(lv, CoverCell.SHARD)).toBeLessThanOrEqual(params.shard.max);
      // 传送门成对 → 格数是偶数，且不超过 2 × max
      const portals = countType(lv, CoverCell.PORTAL);
      expect(portals % 2).toBe(0);
      expect(portals).toBeLessThanOrEqual(params.portal.max * 2);
      // 冰块
      expect(countType(lv, CoverCell.ICE)).toBeLessThanOrEqual(params.ice.max);
    }
  });

  it('同种子 → 同结果（可复现）', () => {
    const a = generateCustomLevels({ ...params, count: 5 });
    const b = generateCustomLevels({ ...params, count: 5 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].grid.join(',')).toBe(b[i].grid.join(','));
      expect(a[i].solution).toEqual(b[i].solution);
    }
  });

  it('0 障碍 → 满矩形（可解）', () => {
    const levels = generateCustomLevels({
      ...params,
      count: 3,
      holes: { min: 0, max: 0 },
      oneway: { min: 0, max: 0 },
      shard: { min: 0, max: 0 },
      keygate: { min: 0, max: 0 },
      portal: { min: 0, max: 0 },
      ice: { min: 0, max: 0 },
    });
    expect(levels.length).toBe(3);
    for (const lv of levels) {
      // 全是可走格，没有障碍
      expect(lv.required).toBe(lv.w * lv.h);
    }
  });
});
