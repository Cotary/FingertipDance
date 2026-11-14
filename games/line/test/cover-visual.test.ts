/**
 * 棋盘渲染的**回归锁**（纯逻辑部分，不碰 canvas）。
 *
 * ## 锁的是什么
 *
 * `segmentPath` 曾经把每个相邻步都切成「只有一个格」的段 ——
 * 于是所有绘制循环的 `length < 2` 判断全部命中，**一条连线都画不出来**，
 * 盘面上只剩每格一颗转折珠。玩家看到的是「一盘橙色小点」。
 *
 * 这个 bug 不会报错、不会崩，只是「变丑」。所以必须有测试把
 * 「每段至少 2 格、且所有段拼起来正好等于原路径」钉死。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { segmentPath } from '../src/render/coverTrail';
import { CoverCell, cellType, packCell } from '../src/core/cover/v3/types';
import { decodeGrid, decodeSolution, type LevelEntry } from '../src/core/cover/v3/codec';
import { computeLayout } from '../src/render/layout';
import { densityOf } from '../src/render/coverBoard';

/** 造一张 w×h 的盘面，默认全 BRICK（格子是打包字节，类型在高 4 位）。 */
function makeGrid(w: number, h: number, cells: Record<number, number> = {}): Uint8Array {
  const g = new Uint8Array(w * h).fill(packCell(CoverCell.BRICK));
  for (const [idx, type] of Object.entries(cells)) g[Number(idx)] = packCell(type);
  return g;
}

/** 段拼起来必须能还原原路径（相邻段共享一格）。 */
function rebuild(segs: ReturnType<typeof segmentPath>): number[] {
  const out: number[] = [];
  for (const seg of segs) {
    for (const c of seg.cells) if (out[out.length - 1] !== c) out.push(c);
  }
  return out;
}

describe('segmentPath（连线分段）', () => {
  it('一段直行只切成 1 段，且包含整条路径', () => {
    const w = 6;
    const grid = makeGrid(w, 1);
    const path = [0, 1, 2, 3];
    const segs = segmentPath(path, w, grid);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('walk');
    expect(segs[0].cells).toEqual(path);
  });

  it('每段至少 2 格（这正是旧实现丢掉的那条不变量）', () => {
    const w = 6;
    const grid = makeGrid(w, 2);
    // 蛇形：0→1→2→3→9→8→7→6（第二行反向）
    const path = [0, 1, 2, 3, 9, 8, 7, 6];
    for (const seg of segmentPath(path, w, grid)) {
      expect(seg.cells.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('进入冰块的那一步是 ice 段，之前之后各自成段', () => {
    const w = 6;
    // 格 1 与格 2 是冰：0→1（walk）→2（ice，因为上一步从冰出发）→3（ice）
    const grid = makeGrid(w, 1, { 1: CoverCell.ICE, 2: CoverCell.ICE });
    const segs = segmentPath([0, 1, 2, 3], w, grid);
    expect(segs.map((s) => s.kind)).toEqual(['walk', 'ice']);
    expect(segs[1].cells).toEqual([1, 2, 3]);
  });

  it('传送门跳跃单独成段（2 格），两侧不被它吞掉', () => {
    const w = 6;
    const grid = makeGrid(w, 2);
    // 0→1 相邻，1→8 不相邻（隔一行）= 传送，8→9 相邻
    const segs = segmentPath([0, 1, 8, 9], w, grid);
    expect(segs.map((s) => s.kind)).toEqual(['walk', 'portal', 'walk']);
    expect(segs[1].cells).toEqual([1, 8]);
    expect(rebuild(segs)).toEqual([0, 1, 8, 9]);
  });

  it('路径不足 2 格时没有段（不该画出任何线）', () => {
    const grid = makeGrid(3, 3);
    expect(segmentPath([], 3, grid)).toHaveLength(0);
    expect(segmentPath([4], 3, grid)).toHaveLength(0);
  });
});

describe('真实关卡的参考解', () => {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  const table = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    levels: Array<LevelEntry & { solution?: string }>;
  };

  it('1000 关的参考解全部能切成「每段 ≥ 2 格」的段', () => {
    let checked = 0;
    for (const entry of table.levels) {
      if (!entry.solution) continue;
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const path = decodeSolution(entry.solution, entry.w);
      const segs = segmentPath(path, entry.w, grid);
      if (path.length >= 2) expect(segs.length).toBeGreaterThan(0);
      for (const seg of segs) expect(seg.cells.length).toBeGreaterThanOrEqual(2);
      expect(rebuild(segs)).toEqual(path);
      checked++;
    }
    expect(checked).toBe(table.levels.length);
  });

  it('参考解里踩过的冰格确实被识别成 ice 段', () => {
    let iceSteps = 0;
    for (const entry of table.levels) {
      if (!entry.solution) continue;
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const path = decodeSolution(entry.solution, entry.w);
      for (const seg of segmentPath(path, entry.w, grid)) {
        if (seg.kind !== 'ice') continue;
        // 段的第 2 格起，每一步的起点都必须是冰
        for (let i = 0; i + 1 < seg.cells.length; i++) {
          expect(cellType(grid[seg.cells[i]])).toBe(CoverCell.ICE);
        }
        iceSteps++;
      }
    }
    // 生成器在 5×5 之后才开始放冰，整表必须至少有几段
    expect(iceSteps).toBeGreaterThan(0);
  });
});

describe('密度分档', () => {
  it('按格宽分三档，11×11 落在 compact', () => {
    expect(densityOf(computeLayout(5, 5).cell)).toBe('rich');
    expect(densityOf(computeLayout(8, 8).cell)).toBe('standard');
    expect(densityOf(computeLayout(11, 11).cell)).toBe('compact');
  });
});
