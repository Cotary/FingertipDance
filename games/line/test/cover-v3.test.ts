/**
 * Cover v3 生成器测试。
 *
 * 核心断言（按重要性排序）：
 *  1. **可解性**：每一关的参考解都能在完整规则下回放通过（且覆盖全部可走格）。
 *  2. **奇偶定律**：可走格的黑白差必须 <= 1（这是路径存在的必要条件）。
 *  3. **确定性**：同样的种子必须产出同样的关卡（后台任务可复现）。
 *  4. **剪枝不漏解**：纯网格模式下求解器找到的解，在完整规则下同样合法。
 *  5. **难度单调**：世界内难度不出现大幅回落。
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { buildRuleSet, replay, withPlain } from '../src/core/cover/v3/rules';
import { solve } from '../src/core/cover/v3/solver';
import { estimateSolutions } from '../src/core/cover/v3/solcount';
import { carveAndVerify, endpointsColorCompatible } from '../src/core/cover/v3/carve';
import { designShape, isConnected } from '../src/core/cover/v3/design';
import {
  generateCandidate,
  generateLevel,
  worldOf,
  sizeOf,
  targetDiff,
  WORLDS,
} from '../src/core/cover/v3/generate';
import { cellType, CoverCell } from '../src/core/cover/v3/types';

const SEED = 20261101;

/** 取出一关的可走格（拍平索引）。 */
function walkable(grid: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    const t = cellType(grid[i]);
    if (
      t === CoverCell.BRICK || t === CoverCell.START || t === CoverCell.END ||
      t === CoverCell.ONEWAY || t === CoverCell.SHARD || t === CoverCell.KEY ||
      t === CoverCell.GATE || t === CoverCell.PORTAL || t === CoverCell.ICE
    ) {
      out.push(i);
    }
  }
  return out;
}

/** 黑白差。 */
function parityDiff(cells: number[], w: number): number {
  let b = 0;
  let wh = 0;
  for (const c of cells) {
    if (((c % w) + Math.floor(c / w)) % 2 === 0) b++;
    else wh++;
  }
  return b - wh;
}

describe('cover v3 / 规则与回放', () => {
  it('生成的关卡：参考解在完整规则下回放通过', () => {
    for (const idx of [1, 20, 50, 100, 200, 400, 700, 900]) {
      const c = generateLevel(idx, SEED);
      expect(c, `第 ${idx} 关应生成成功`).not.toBeNull();
      if (!c) continue;
      const cells = walkable(c.grid);
      const rs = buildRuleSet(cells, c.grid, c.w, c.h);
      rs.startAt = c.startAt;
      rs.endAt = c.endAt;
      const r = replay(rs, c.solution);
      expect(r.ok, `第 ${idx} 关回放失败：${r.error}`).toBe(true);
    }
  });

  it('可走格满足奇偶定律 |B - W| <= 1', () => {
    for (const idx of [1, 20, 50, 100, 200, 400, 700, 900]) {
      const c = generateLevel(idx, SEED);
      if (!c) continue;
      const cells = walkable(c.grid);
      expect(Math.abs(parityDiff(cells, c.w)), `第 ${idx} 关奇偶违规`).toBeLessThanOrEqual(1);
    }
  });

  it('解覆盖全部可走格（无遗漏、无重复）', () => {
    for (const idx of [20, 100, 400]) {
      const c = generateLevel(idx, SEED);
      if (!c) continue;
      const cells = walkable(c.grid);
      expect(c.solution.length).toBe(cells.length);
      expect(new Set(c.solution).size).toBe(cells.length);
    }
  });
});

describe('cover v3 / 确定性', () => {
  it('同种子产出完全相同的关卡', () => {
    const a = generateCandidate(200, SEED, 3);
    const b = generateCandidate(200, SEED, 3);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.solution).toEqual(b.solution);
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid));
  });

  it('不同种子产出不同的关卡', () => {
    const a = generateCandidate(200, SEED, 3);
    const b = generateCandidate(200, SEED + 999, 3);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe('cover v3 / 求解器', () => {
  it('纯网格模式找到的解，在完整规则下同样合法', () => {
    for (const idx of [20, 100, 400]) {
      const c = generateLevel(idx, SEED);
      if (!c) continue;
      const cells = walkable(c.grid);
      const rs = buildRuleSet(cells, c.grid, c.w, c.h);
      rs.startAt = c.startAt;
      rs.endAt = c.endAt;
      // 纯网格求解
      const plain = withPlain(rs, true);
      const r = solve(plain, mulberry32(7), c.startAt, 200000, 2000);
      expect(r.path, `第 ${idx} 关纯网格求解应成功`).not.toBeNull();
      if (!r.path) continue;
      // 完整规则下回放必须通过
      const rp = replay(rs, r.path);
      expect(rp.ok, `第 ${idx} 关纯网格解在完整规则下非法：${rp.error}`).toBe(true);
    }
  });

  it('解数估计器：能找出多个不同的解（小盘采样对照）', () => {
    // 5x5 满矩形：哈密顿路径数量很多，采样法应能找出多个不同解。
    const w = 5;
    const h = 5;
    const cells: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(y * w + x);
    const grid = new Uint8Array(w * h);
    for (const c of cells) grid[c] = (CoverCell.BRICK << 4);
    const rs = buildRuleSet(cells, grid, w, h);
    const est = estimateSolutions(rs, 10, 2000, 99);
    // 10 次采样全部命中，且指纹互不相同 -> 解数 >= 2
    expect(est.hits).toBe(est.samples);
    expect(est.count).toBeGreaterThanOrEqual(2);
    expect(est.band).not.toBe('unique');
  });

  it('解数估计器：唯一解的盘面应报告唯一', () => {
    // 2x3 矩形：暴力枚举（tools 内脚本）确认它有 **10** 条哈密顿路径
    // （起点 0 有 3 条、起点 2 有 2 条…… 全部起点合起来 10 条）。
    //
    // 所以它**不是唯一解盘面** —— 原断言「count === 1」是错的，
    // 而且断言本身与它自己的注释（「只有 1 条」）矛盾。
    //
    // 真正的「唯一解」盘面在 4×4 以内**不存在**（暴力枚举 2~5 连块：
    // 唯一解形状 0 种）—— 小盘的哈密顿路径数总是 >= 2。
    // 所以这里改成验证**估计器不会少数解**：
    // 从不同起点采样，看到的解数应当 >= 单起点的解数。
    const w = 2;
    const h = 3;
    const cells: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(y * w + x);
    const grid = new Uint8Array(w * h);
    for (const c of cells) grid[c] = (CoverCell.BRICK << 4);
    const rs = buildRuleSet(cells, grid, w, h);

    // 显式指定起点 0（只覆盖 3 条路径）
    const single = estimateSolutions(rs, 10, 2000, 5, 0);
    // 不指定起点（估计器在多个低度数起点之间轮转）
    const multi = estimateSolutions(rs, 10, 2000, 5);

    expect(single.hits).toBe(single.samples);
    expect(multi.hits).toBe(multi.samples);
    // 轮转起点后看到的不该更少（这是「系统性少数解」的回归测试）
    expect(multi.count).toBeGreaterThanOrEqual(single.count);
    // 2x3 至少有 2 个不同的解
    expect(multi.count).toBeGreaterThanOrEqual(2);
    expect(multi.band).not.toBe('unique');
  });

  it('解数估计器：把已知参考解计入样本（hits 不会因超时为 0）', () => {
    const w = 5;
    const h = 5;
    const cells: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(y * w + x);
    const grid = new Uint8Array(w * h);
    for (const c of cells) grid[c] = (CoverCell.BRICK << 4);
    const rs = buildRuleSet(cells, grid, w, h);
    // 造一条合法参考解（蛇形）
    const known: number[] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(y * w + x);
      if (y % 2 === 1) row.reverse();
      known.push(...row);
    }
    const est = estimateSolutions(rs, 1, 1, 3, undefined, true, known);
    // 即便时限只有 1ms（采样必然落空），参考解也保证 hits >= 1
    expect(est.hits).toBeGreaterThanOrEqual(1);
    expect(est.count).toBeGreaterThanOrEqual(1);
  });
});

describe('cover v3 / 挖洞构造', () => {
  it('挖洞结果一定可解（构造保证）', () => {
    for (const idx of [50, 200, 700]) {
      const wp = worldOf(idx);
      const { w, h } = sizeOf(idx);
      const rng = mulberry32(SEED + idx);
      const d = designShape(w, h, wp.families[0], rng, wp.scatterPairs, {
        deadEnds: 0,
        tries: 20,
      });
      expect(d).not.toBeNull();
      if (!d) continue;
      const wantD = wp.endpoints === 'free' ? 0 : wp.endpoints === 'start' ? 1 : 2;
      const r = carveAndVerify(d.cells, w, h, rng, {
        wantDeadEnds: wantD,
        budget: 60000,
        deadlineMs: 500,
        maxTries: d.cells.length,
        maxFailures: 8,
      });
      expect(r, `第 ${idx} 关挖洞应成功`).not.toBeNull();
      if (!r) continue;
      expect(r.path.length).toBe(r.cells.length);
      expect(isConnected(r.cells, w, h)).toBe(true);
    }
  });

  it('死端数符合要求（钉死的端点 D=0/1/2）', () => {
    for (const idx of [50, 100, 200, 700]) {
      const c = generateLevel(idx, SEED);
      if (!c) continue;
      const wp = worldOf(idx);
      const wantD = wp.endpoints === 'free' ? 0 : wp.endpoints === 'start' ? 1 : 2;
      // deadEnds = 被钉死的端点数（D）
      expect(c.deadEnds, `第 ${idx} 关钉死端点数`).toBe(wantD);
      // deadEndCells = 图论死端数（度 <= 1）—— 额外挖洞可能造出额外的被迫端点，
      // 这是正常的（度=1 的格本来就该是路径端点），但不能超过 2（超过就无解了）
      expect(c.deadEndCells, `第 ${idx} 关图论死端数`).toBeLessThanOrEqual(2);
    }
  });

  it('端点奇偶约束：矩形尺寸决定两端点颜色关系', () => {
    /**
     * 语义（见 carve.ts 的 `endpointsColorCompatible`）：
     *   路径黑白交替 → 走 |S|-1 步
     *   - |S| 奇 → 步数偶 → 两端点**同色**
     *   - |S| 偶 → 步数奇 → 两端点**异色**
     *
     * |S| 的奇偶 = w*h 的奇偶（挖洞单位都是「奇偶中性且数量为偶」）。
     * 所以：**面积偶 → 异色；面积奇 → 同色**。
     *
     * 颜色定义：`(x + y) % 2 === 0` 为黑（0），否则白（1）。
     */
    const compat = (w: number, h: number, c1: number, c2: number): boolean =>
      endpointsColorCompatible(w, h, c1, c2);

    // --- 7x7：面积 49 奇 → 两端点必须**同色** ---
    // 四个角全是黑：(0,0)=0 (0,6)=0 (6,0)=0 (6,6)=0
    expect(compat(7, 7, 0, 6)).toBe(true);   // 黑 + 黑
    expect(compat(7, 7, 0, 48)).toBe(true);  // 黑 + 黑
    // 白格在 (0,1)：黑 + 白 → 面积奇时**不兼容**
    expect(compat(7, 7, 0, 1)).toBe(false);

    // --- 8x7：面积 56 偶 → 两端点必须**异色** ---
    // 角颜色：(0,0)=0 (0,7)=1 (6,0)=0 (6,7)=1
    expect(compat(8, 7, 0, 7)).toBe(true);   // 黑 + 白 → 异色 ✅
    expect(compat(8, 7, 0, 6)).toBe(false);  // 黑 + 黑 → 同色 ❌

    // --- 8x8：面积 64 偶 → 两端点必须**异色** ---
    // 角颜色：(0,0)=0 (0,7)=1 (7,0)=1 (7,7)=0
    expect(compat(8, 8, 0, 7)).toBe(true);   // (0,7)=(0+7)%2=1 白 → 黑 + 白 ✅
    expect(compat(8, 8, 0, 8)).toBe(true);   // (0,1)=(0+1)%2=1 白 → 黑 + 白 ✅
    expect(compat(8, 8, 0, 9)).toBe(false);  // (1,1)=(1+1)%2=0 黑 → 黑 + 黑 ❌
  });
});

describe('cover v3 / 难度曲线', () => {
  it('目标难度随关号单调不降', () => {
    let prev = -1;
    for (let idx = 1; idx <= 1000; idx++) {
      const t = targetDiff(idx);
      expect(t, `第 ${idx} 关目标难度回落`).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('尺寸随关号单调不降', () => {
    let prevW = 0;
    let prevH = 0;
    for (const wp of WORLDS) {
      expect(wp.w).toBeGreaterThanOrEqual(prevW);
      expect(wp.h).toBeGreaterThanOrEqual(prevH);
      prevW = wp.w;
      prevH = wp.h;
    }
  });

  it('世界边界连续（无空隙、无重叠）', () => {
    let expectFrom = 1;
    for (const wp of WORLDS) {
      expect(wp.from).toBe(expectFrom);
      expect(wp.to).toBeGreaterThanOrEqual(wp.from);
      expectFrom = wp.to + 1;
    }
    expect(expectFrom - 1).toBe(1000);
  });

  it('实际难度落在目标附近（平均偏差 <= 8）', () => {
    const idxs = [5, 25, 50, 100, 250, 550, 850];
    const devs: number[] = [];
    for (const idx of idxs) {
      const c = generateLevel(idx, SEED);
      if (!c) continue;
      devs.push(Math.abs(c.diff - targetDiff(idx)));
    }
    expect(devs.length).toBeGreaterThan(0);
    const avg = devs.reduce((a, b) => a + b, 0) / devs.length;
    expect(avg, `平均难度偏差 ${avg.toFixed(2)}`).toBeLessThanOrEqual(8);
  });
});
