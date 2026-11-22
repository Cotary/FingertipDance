/**
 * cover v3：解的编解码（传送跳跃格式）+ 2-opt 拼接器。
 *
 * ## 为什么要单独测
 *
 * 「进入即传送」的语义下，解里**相邻两格可能几何上不相邻** ——
 * 那是传送跳跃（从入口格跳到搭档格）。
 *
 * 2 bit 的方向编码表达不了这种步长（`dirFromDelta` 会抛「非法步长」），
 * 所以跳跃步单独记在解的第 4 段：`stepIdx:targetFlat`。
 *
 * 这份测试钉住三件事：
 *  1. **无跳跃的关卡仍是 3 段**（向后兼容 —— 旧表/旧客户端/旧服务端照读）；
 *  2. 有跳跃的关卡是 4 段，且能**无损往返**；
 *  3. 拼接器产出的路径满足全部构造约束。
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { decodeSolution, encodeSolution } from '../src/core/cover/v3/codec';
import { buildRuleSet } from '../src/core/cover/v3/rules';
import { splicePortals } from '../src/core/cover/v3/portal';
import { CoverCell, packCell } from '../src/core/cover/v3/types';

/** 造一个 5×6 的规则集（全是普通砖）。 */
function makeRs(w: number, h: number): ReturnType<typeof buildRuleSet> {
  const grid = new Uint8Array(w * h);
  const cells: number[] = [];
  for (let i = 0; i < w * h; i++) {
    grid[i] = packCell(CoverCell.BRICK, 0, 0);
    cells.push(i);
  }
  return buildRuleSet(cells, grid, w, h);
}

describe('cover v3 / 解的编解码', () => {
  it('无跳跃的解仍是 3 段（向后兼容）', () => {
    const w = 5;
    const path = [0, 1, 2, 7, 12, 17, 18, 19];
    const enc = encodeSolution(path, w);
    expect(enc.split(','), '无跳跃不应有第 4 段').toHaveLength(3);
    expect(decodeSolution(enc, w)).toEqual(path);
  });

  it('有跳跃的解是 4 段，且能无损往返', () => {
    const w = 5;
    // 0→1→2 是邻接步；2→17 是**非邻接**（传送跳跃）；17→18→19 是邻接步。
    const path = [0, 1, 2, 17, 18, 19];
    const enc = encodeSolution(path, w);
    const parts = enc.split(',');
    expect(parts, '有跳跃应有第 4 段').toHaveLength(4);
    expect(parts[3]).toBe('2:17');
    expect(decodeSolution(enc, w)).toEqual(path);
  });

  it('多段跳跃全部记录在第 4 段里', () => {
    const w = 5;
    const path = [0, 1, 2, 17, 18, 29, 24];
    const enc = encodeSolution(path, w);
    const parts = enc.split(',');
    expect(parts).toHaveLength(4);
    // 跳跃步：1→2 是邻接；2→17、17→18 是邻接？17→18 邻接；18→29 跳跃；29→24 跳跃
    expect(decodeSolution(enc, w)).toEqual(path);
  });

  it('步数字段仍是「方向序列长度」（跳跃步占一个占位方向）', () => {
    const w = 5;
    const path = [0, 1, 2, 17, 18];
    const enc = encodeSolution(path, w);
    const parts = enc.split(',');
    expect(Number(parts[1]), '步数 = 路径长度 - 1').toBe(path.length - 1);
  });
});

describe('cover v3 / 2-opt 拼接器', () => {
  it('拼接后的路径长度不变、每格恰好出现一次', () => {
    const w = 5;
    const h = 6;
    const rs = makeRs(w, h);
    // 造一条基础路径（蛇形遍历）。
    const path: number[] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(y * w + x);
      if (y % 2 === 1) row.reverse();
      path.push(...row);
    }
    const res = splicePortals(rs, path, mulberry32(1), 1);
    expect(res, '应能找到可行的拼接对').not.toBeNull();
    if (!res) return;
    expect(res.path).toHaveLength(path.length);
    expect(new Set(res.path).size).toBe(path.length);
  });

  it('拼接保持两端不变（钉死的起终点不受影响）', () => {
    const w = 5;
    const h = 6;
    const rs = makeRs(w, h);
    const path: number[] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(y * w + x);
      if (y % 2 === 1) row.reverse();
      path.push(...row);
    }
    const res = splicePortals(rs, path, mulberry32(7), 1);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.path[0], '起点必须保持').toBe(path[0]);
    expect(res.path[res.path.length - 1], '终点必须保持').toBe(path[path.length - 1]);
  });

  it('跳跃边的两端在路径上相邻，且几何上不相邻', () => {
    const w = 5;
    const h = 6;
    const rs = makeRs(w, h);
    const path: number[] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(y * w + x);
      if (y % 2 === 1) row.reverse();
      path.push(...row);
    }
    const res = splicePortals(rs, path, mulberry32(3), 1);
    expect(res).not.toBeNull();
    if (!res) return;

    const [pair] = res.portals;
    // 入口与出口在路径上**相邻**（位置 i 与 i+1）——
    // 这正是「走进入口 → 传送到出口」与路径序列逐位对齐的前提。
    const iEntry = res.path.indexOf(pair.entry);
    const iExit = res.path.indexOf(pair.exit);
    expect(iExit - iEntry, '入口出口应在路径上相邻').toBe(1);
    // 且几何上**不相邻**（否则就不是跳跃了）。
    const dx = Math.abs((pair.exit % w) - (pair.entry % w));
    const dy = Math.abs(Math.floor(pair.exit / w) - Math.floor(pair.entry / w));
    expect(dx + dy, '入口出口应几何不相邻').toBeGreaterThan(1);
  });

  it('跳跃保持二分交替（奇偶剪枝依然成立）', () => {
    const w = 5;
    const h = 6;
    const rs = makeRs(w, h);
    const path: number[] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(y * w + x);
      if (y % 2 === 1) row.reverse();
      path.push(...row);
    }
    const res = splicePortals(rs, path, mulberry32(11), 1);
    expect(res).not.toBeNull();
    if (!res) return;

    // 每一步（邻接步或跳跃步）都必须连接异色格。
    const color = (local: number): number => {
      const f = rs.flatOf[local];
      return (f % w + Math.floor(f / w)) % 2;
    };
    for (let i = 1; i < res.path.length; i++) {
      expect(
        color(res.path[i - 1]) !== color(res.path[i]),
        `第 ${i} 步两端应异色`,
      ).toBe(true);
    }
  });

  it('0 对传送门 = 原样返回', () => {
    const w = 5;
    const h = 6;
    const rs = makeRs(w, h);
    const path = [0, 1, 2, 7, 12, 17];
    const res = splicePortals(rs, path, mulberry32(5), 0);
    expect(res).not.toBeNull();
    expect(res!.portals).toHaveLength(0);
    expect(res!.path).toEqual(path);
  });
});
