/**
 * cover 模块测试。
 *
 * 核心断言：带剪枝的 countHamiltonian 与朴素全枚举的**解数完全一致**——
 * 三条剪枝都是「必要条件」，不能漏解。这是门禁「解数上界」可信的前提。
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { findHamiltonian, countHamiltonian, type HamGraph } from '../src/core/cover/hamilton';
import { buildShape, analyze } from '../src/core/cover/shape';
import {
  generateCoverLevel, validateSolution, coverTargetDiff, worldOf,
} from '../src/core/cover/generate';
import {
  encodeCoverGrid, decodeCoverGrid, encodeSolution, decodeSolution, sanityCheckGrid,
} from '../src/core/cover/codec';

/** 朴素全枚举（无剪枝），上限 limit 条即停。 */
function naiveCount(adj: number[][], limit: number): number {
  const n = adj.length;
  let count = 0;
  const visited = new Uint8Array(n);

  const dfs = (cur: number, depth: number): void => {
    if (count >= limit) return;
    if (depth === n) {
      count++;
      return;
    }
    for (const u of adj[cur]) {
      if (!visited[u]) {
        visited[u] = 1;
        dfs(u, depth + 1);
        visited[u] = 0;
        if (count >= limit) return;
      }
    }
  };

  for (let s = 0; s < n && count < limit; s++) {
    visited.fill(0);
    visited[s] = 1;
    dfs(s, 1);
  }
  return count;
}

/** 满矩形邻接图。 */
function fullGrid(w: number, h: number): HamGraph {
  const n = w * h;
  const adj: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nb: number[] = [];
      if (x > 0) nb.push(y * w + x - 1);
      if (x < w - 1) nb.push(y * w + x + 1);
      if (y > 0) nb.push((y - 1) * w + x);
      if (y < h - 1) nb.push((y + 1) * w + x);
      adj.push(nb);
    }
  }
  return { n, adj };
}

/** 随机挖洞的小盘（保证连通，不保证奇偶——无解时两边都要返回 0）。 */
function randomShape(w: number, h: number, voids: number, seed: number): HamGraph {
  const rng = mulberry32(seed);
  const n = w * h;
  const removed = new Set<number>();
  while (removed.size < voids) {
    const c = rng.int(1, n - 1);
    if (c % w === 0 || c % w === w - 1) continue;
    removed.add(c);
  }
  const kept = Array.from({ length: n }, (_, i) => i).filter((c) => !removed.has(c));
  // 连通性检查：不连通直接返回空图（两边都是 0 解，依然是对比）
  const set = new Set(kept);
  const seen = new Set<number>([kept[0]]);
  const q = [kept[0]];
  let head = 0;
  while (head < q.length) {
    const c = q[head++];
    for (const nb of [c - 1, c + 1, c - w, c + w]) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
    }
  }
  if (seen.size !== kept.length) return { n: 1, adj: [[]] };

  const local = new Map<number, number>();
  kept.forEach((c, i) => local.set(c, i));
  const adj = kept.map((c) => {
    const out: number[] = [];
    for (const nb of [c - 1, c + 1, c - w, c + w]) {
      if (set.has(nb)) out.push(local.get(nb)!);
    }
    return out;
  });
  return { n: kept.length, adj };
}

describe('哈密顿求解器', () => {
  it('满矩形 4×4：剪枝枚举与朴素枚举解数一致', () => {
    const g = fullGrid(4, 4);
    const a = countHamiltonian(g, 100);
    const b = naiveCount(g.adj, 100);
    expect(a).toBe(b);
  });

  it('满矩形 5×5：解数一致（截断到 200）', () => {
    const g = fullGrid(5, 5);
    const a = countHamiltonian(g, 200);
    const b = naiveCount(g.adj, 200);
    expect(a).toBe(b);
  });

  it('随机挖洞小盘 ×20：剪枝枚举与朴素枚举解数一致（含无解盘）', () => {
    for (let s = 1; s <= 20; s++) {
      const g = randomShape(6, 6, s % 5, s * 101);
      const a = countHamiltonian(g, 50);
      const b = naiveCount(g.adj, 50);
      expect(a, `seed ${s}`).toBe(b);
    }
  });

  it('findHamiltonian 找到合法路径且不自交', () => {
    const rng = mulberry32(42);
    for (let s = 0; s < 20; s++) {
      const g = randomShape(6, 6, 3, s * 77);
      const res = findHamiltonian(g, rng);
      if (g.n === 1) continue;
      if (naiveCount(g.adj, 1) === 0) {
        expect(res, `无解盘不应找到路径 seed ${s}`).toBeNull();
      } else {
        expect(res).not.toBeNull();
        expect(new Set(res!.path).size).toBe(g.n);
        for (let i = 1; i < res!.path.length; i++) {
          expect(g.adj[res!.path[i - 1]]).toContain(res!.path[i]);
        }
      }
    }
  });
});

describe('轮廓构造', () => {
  it('全部 pattern 都能产出满足双定律的形状', () => {
    const patterns = ['solid', 'corner', 'hole', 'island', 'ring', 'lshape', 'scatter', 'composite'] as const;
    for (const p of patterns) {
      let ok = 0;
      for (let s = 0; s < 10; s++) {
        const rng = mulberry32(s * 31 + 7);
        const shape = buildShape(8, 8, p, 6, rng);
        if (!shape) continue;
        expect(Math.abs(shape.black - shape.white), `${p} 奇偶差`).toBeLessThanOrEqual(1);
        ok++;
      }
      expect(ok, `${p} 至少成功一次`).toBeGreaterThan(0);
    }
  });

  it('island 模式必留桥（挖掉的列不全断）', () => {
    const rng = mulberry32(999);
    for (let s = 0; s < 30; s++) {
      const shape = buildShape(8, 8, 'island', 6, rng);
      if (!shape) continue;
      const a = analyze(shape.adj);
      expect(a.deadEnds).toBeLessThanOrEqual(2);
    }
  });
});

describe('构造式生成器', () => {
  it('前 100 关全部生成成功且参考解合法', () => {
    for (let idx = 1; idx <= 100; idx++) {
      const lv = generateCoverLevel(idx, 20261101);
      expect(lv, `第 ${idx} 关`).not.toBeNull();
      expect(validateSolution(lv!), `第 ${idx} 关`).toBeNull();
      expect(lv!.deadEnds).toBeLessThanOrEqual(2);
    }
  });

  it('死端数与世界目标一致', () => {
    for (let idx = 1; idx <= 100; idx++) {
      const lv = generateCoverLevel(idx, 20261101)!;
      const wp = worldOf(idx);
      expect(lv.deadEnds).toBeGreaterThanOrEqual(wp.deadEnds[0]);
      expect(lv.deadEnds).toBeLessThanOrEqual(wp.deadEnds[1]);
    }
  });

  it('难度分在 0..100 且目标曲线单调不减', () => {
    let last = 0;
    for (let idx = 1; idx <= 1000; idx += 7) {
      const t = coverTargetDiff(idx);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});

describe('codec 往返', () => {
  it('grid 编码解码无损', () => {
    const grid = new Uint8Array([0, 1, 2, 3, 8, 1, 4, 0, 2]);
    const enc = encodeCoverGrid(grid);
    const dec = decodeCoverGrid(enc, grid.length);
    expect(Array.from(dec)).toEqual(Array.from(grid));
    expect(sanityCheckGrid(grid)).toBe(true);
  });

  it('参考解编码解码无损', () => {
    const w = 8;
    const path = [0, 1, 2, 10, 18, 26, 27, 28];
    const enc = encodeSolution(path, w);
    const dec = decodeSolution(enc, w);
    expect(dec).toEqual(path);
  });
});
