/**
 * Cover 模式 v3：盘面正向设计（形状库）。
 *
 * 核心思想：**先设计盘面，再暴力求解**。
 * 障碍（空白不能走）是难度的主要载体，形状库是「辨识度」来源——
 * 让 1000 关看起来是 1000 张不同的图，而不是同一张图挖几个洞。
 *
 * ## 奇偶纪律（本文件的第一约束）
 *
 * 路径黑白交替 → 必需格必须满足 `|B − W| ≤ 1`（§2.1 第一定律）。
 * 挖洞就是「移除格子」，每移除一格，|B − W| 变动 ±1。因此：
 *
 *   - 移除**偶数个同色格** → |B − W| 变动 ±2 → 必然违规 → 该形状无解。
 *   - 移除**奇数个同色格** → |B − W| 变动 ±1 → 仍合法。
 *
 * **实现纪律：所有挖洞单位都必须是「奇偶中性」的**（1 黑 1 白）：
 *   - **骨牌**（相邻 2 格）：1 黑 1 白 ✅
 *   - **2×2 块**（4 格）：2 黑 2 白 ✅
 *   - **十字臂长 2**（8 格）：4 黑 4 白 ✅
 *     （臂长 1 是 4 格同色 → 违反奇偶纪律，**不能用**）
 *
 * ## 洞预算（v3 规模回归的修复）
 *
 * v3 初版每个家族挖多少格是**拍脑袋**的，导致世界一（4×4）只能产出 10~12 格，
 * 远低于设计的 16~25 格。根因是 carve 的「额外挖洞轮」会超出设计目标继续挖。
 *
 * 现在：**每个世界显式声明洞预算 `holeRange`**，家族只能在这个预算内挖。
 * 预算耗尽即停 → 规模回到设计区间。
 */
import type { Rng } from '../../rng';
import { idxOf, packCell, CoverCell } from './types';
import { buildRuleSet } from './rules';
import { solve } from './solver';

/** 形状家族。 */
export type ShapeFamily =
  | 'solid'      // 满矩形
  | 'corner'     // 挖角
  | 'notch'      // 边缘缺口
  | 'hole'       // 盘内洞
  | 'cross'      // 十字
  | 'ring'       // 环形
  | 'island'     // 河 + 桥
  | 'lshape'     // L 形角块
  | 'scatter'    // 散点洞
  | 'domino'     // 随机骨牌铺洞（形状空间最大的家族）
  | 'composite'; // 叠加

/** 设计结果。 */
export interface DesignResult {
  w: number;
  h: number;
  /** 可走格（拍平索引，升序）。 */
  cells: number[];
  /** 缺口：不可走，且与盘外连通。 */
  voids: number[];
  /** 石头：不可走，且被可走格完全包围。 */
  blocks: number[];
  /** 可走格之间的邻接表，节点编号 0..cells.length-1（与 cells 下标对应）。 */
  adj: number[][];
  /** 黑格数（(x+y) 为偶）。 */
  black: number;
  /** 白格数。 */
  white: number;
  /** 死端（度=1）的拍平索引。 */
  deadEnds: number[];
  /** 实际挖掉的格数。 */
  holeCount: number;
  /**
   * **已求得的参考解**（局部编号序列）。
   *
   * 仅在 `requireSolvable` 开启时非 null。
   *
   * ## 为什么必须把它带出来
   *
   * `designShape` 为了验证可解性**已经跑过一次哈密顿搜索**，
   * 而 `carveAndVerify` 拿到设计形状后**又要求一次解**（`verify`）——
   * 同一张盘被解了两次。这是生成慢一倍的根本原因。
   *
   * 把解带出来，`carve` 就能走 **hint 快路径**（O(n) 回放检查），
   * 完全省掉第二次搜索。实测大盘上这一步从 60~300ms 降到 ~0ms。
   */
  path: number[] | null;
}

/** 四邻接（含越界过滤）。 */
export function fourNeighbors(idx: number, w: number, h: number): number[] {
  const x = idx % w;
  const y = Math.floor(idx / w);
  const out: number[] = [];
  if (x > 0) out.push(idx - 1);
  if (x < w - 1) out.push(idx + 1);
  if (y > 0) out.push(idx - w);
  if (y < h - 1) out.push(idx + w);
  return out;
}

/** 全部格子索引。 */
export function allCells(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(idxOf(x, y, w));
  return out;
}

/** 计算必需格的黑白差。 */
export function parityDiff(cells: number[], w: number): number {
  let black = 0;
  let white = 0;
  for (const c of cells) {
    if (((c % w) + Math.floor(c / w)) % 2 === 0) black++;
    else white++;
  }
  return black - white;
}

/** 可走格集合是否四邻接连通。 */
export function isConnected(cells: number[], w: number, h: number): boolean {
  if (cells.length === 0) return false;
  const set = new Set(cells);
  const seen = new Set<number>([cells[0]]);
  const q: number[] = [cells[0]];
  let head = 0;
  let count = 0;
  while (head < q.length) {
    const c = q[head++];
    count++;
    for (const nb of fourNeighbors(c, w, h)) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
    }
  }
  return count === cells.length;
}

/** 计算邻接表（局部编号）。 */
export function buildAdj(cells: number[], w: number, h: number): number[][] {
  const localId = new Map<number, number>();
  cells.forEach((c, i) => localId.set(c, i));
  return cells.map((c) => {
    const out: number[] = [];
    for (const nb of fourNeighbors(c, w, h)) {
      const lid = localId.get(nb);
      if (lid !== undefined) out.push(lid);
    }
    return out;
  });
}

/** 一格是否与盘外连通（用于区分石头与缺口）。 */
function touchesOutside(idx: number, w: number, h: number, removed: Set<number>): boolean {
  const stack: number[] = [idx];
  const seen = new Set<number>([idx]);
  while (stack.length > 0) {
    const c = stack.pop()!;
    const cx = c % w;
    const cy = Math.floor(c / w);
    if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) return true;
    for (const nb of fourNeighbors(c, w, h)) {
      if (!removed.has(nb) || seen.has(nb)) continue;
      seen.add(nb);
      stack.push(nb);
    }
  }
  return false;
}

/** 剩余可挖格数。 */
function left(removed: Set<number>, maxHoles: number): number {
  return maxHoles - removed.size;
}

/**
 * 挖一个 2×2 角块（预算不足时退化为角上的骨牌）。
 * 2×2 块含 2 黑 2 白 → 奇偶平衡 ✅；骨牌含 1 黑 1 白 → 奇偶平衡 ✅
 */
function carveCorner2x2(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - 2, 0],
    [0, h - 2],
    [w - 2, h - 2],
  ];
  for (const [cx, cy] of corners) {
    if (!rng.chance(0.5)) continue;
    if (left(removed, maxHoles) >= 4) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < w && y < h) removed.add(idxOf(x, y, w));
        }
      }
    } else if (left(removed, maxHoles) >= 2) {
      // 半块：2×2 的第一行（角 + 同排邻居），保证在界内且相邻
      removed.add(idxOf(cx, cy, w));
      removed.add(idxOf(cx + 1, cy, w));
    }
  }
}

/**
 * 挖边缘缺口（偶数长度）。
 * 偶数长度的边缘条带含等量黑白 → 奇偶平衡 ✅
 */
function carveNotch(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  let len = 2 * rng.int(1, 3); // 2 或 4
  while (len > left(removed, maxHoles)) len -= 2;
  if (len < 2) return;
  const side = rng.int(0, 4);
  if (side === 0) {
    const x = rng.int(0, Math.max(1, w - len));
    for (let i = 0; i < len; i++) removed.add(idxOf(x + i, 0, w));
  } else if (side === 1) {
    const x = rng.int(0, Math.max(1, w - len));
    for (let i = 0; i < len; i++) removed.add(idxOf(x + i, h - 1, w));
  } else if (side === 2) {
    const y = rng.int(0, Math.max(1, h - len));
    for (let i = 0; i < len; i++) removed.add(idxOf(0, y + i, w));
  } else {
    const y = rng.int(0, Math.max(1, h - len));
    for (let i = 0; i < len; i++) removed.add(idxOf(w - 1, y + i, w));
  }
}

/**
 * 挖盘内洞（1~3 个 2×2，互不相邻、不贴边）。
 * 每个 2×2 含 2 黑 2 白 → 奇偶平衡 ✅
 */
function carveHoles(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  if (w < 7 || h < 7) return;
  const count = rng.int(1, 4);
  const placed: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (left(removed, maxHoles) < 4) break;
    for (let t = 0; t < 20; t++) {
      const hx = rng.int(2, Math.max(3, w - 4));
      const hy = rng.int(2, Math.max(3, h - 4));
      let ok = true;
      for (const [px, py] of placed) {
        if (Math.abs(px - hx) < 3 && Math.abs(py - hy) < 3) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      placed.push([hx, hy]);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) removed.add(idxOf(hx + dx, hy + dy, w));
      }
      break;
    }
  }
}

/**
 * 挖十字形（臂长 2，不挖中心）。
 * 臂长 2：d=1 的 4 格 + d=2 的 4 格 → 2 黑 2 白 × 2 → 平衡 ✅
 * **臂长 1 是 4 格同色 → 违反奇偶纪律，不能用。**
 */
function carveCross(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  if (w < 7 || h < 7) return;
  if (left(removed, maxHoles) < 8) return;
  const arm = 2;
  const cx = rng.int(3, Math.max(4, w - 3));
  const cy = rng.int(3, Math.max(4, h - 3));
  for (let i = 1; i <= arm; i++) {
    if (cx + i < w - 1) removed.add(idxOf(cx + i, cy, w));
    if (cx - i > 0) removed.add(idxOf(cx - i, cy, w));
    if (cy + i < h - 1) removed.add(idxOf(cx, cy + i, w));
    if (cy - i > 0) removed.add(idxOf(cx, cy - i, w));
  }
}

/** 挖环形（中央挖一块，至少一边为偶数 → 平衡）。 */
function carveRing(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  if (w < 6 || h < 6) return;
  let rw = rng.int(2, Math.max(3, Math.floor(w / 2)));
  let rh = rng.int(2, Math.max(3, Math.floor(h / 2)));
  if (rw % 2 !== 0 && rh % 2 !== 0) rw += 1;
  if (left(removed, maxHoles) < rw * rh) return;
  const cx = Math.floor((w - rw) / 2);
  const cy = Math.floor((h - rh) / 2);
  for (let dy = 0; dy < rh; dy++) {
    for (let dx = 0; dx < rw; dx++) removed.add(idxOf(cx + dx, cy + dy, w));
  }
}

/**
 * 挖一条「河」（偶数长度），上下留桥。
 * 竖直条带相邻格异色 → 偶数长度平衡 ✅
 */
function carveIsland(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  if (h < 5 || w < 5) return;
  const col = rng.int(1, w - 1);
  const maxPairs = Math.floor((h - 4) / 2);
  if (maxPairs < 1) return;
  let len = 2 * rng.int(1, maxPairs + 1);
  while (len > left(removed, maxHoles)) len -= 2;
  if (len < 2) return;
  const top = rng.int(1, Math.max(2, h - len - 1));
  for (let y = top; y < top + len && y < h - 1; y++) {
    removed.add(idxOf(col, y, w));
  }
}

/** 挖 L 形角块（至少一边为偶数 → 平衡）。 */
function carveLshape(removed: Set<number>, w: number, h: number, rng: Rng, maxHoles: number): void {
  let cw = rng.int(2, Math.max(3, Math.floor(w / 2)));
  let ch = rng.int(2, Math.max(3, Math.floor(h / 2)));
  if (cw % 2 !== 0 && ch % 2 !== 0) cw += 1;
  if (left(removed, maxHoles) < cw * ch) return;
  const corner = rng.int(0, 4);
  for (let dy = 0; dy < ch; dy++) {
    for (let dx = 0; dx < cw; dx++) {
      let x = 0;
      let y = 0;
      if (corner === 0) {
        x = dx; y = dy;
      } else if (corner === 1) {
        x = w - 1 - dx; y = dy;
      } else if (corner === 2) {
        x = dx; y = h - 1 - dy;
      } else {
        x = w - 1 - dx; y = h - 1 - dy;
      }
      removed.add(idxOf(x, y, w));
    }
  }
}

/** 随机成对单格洞（黑 + 白，保持奇偶平衡）。 */
function carveScatter(removed: Set<number>, w: number, h: number, rng: Rng, pairs: number, maxHoles: number): void {
  const inner = (c: number) => {
    const x = c % w;
    const y = Math.floor(c / w);
    return x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2;
  };
  const isolated = (c: number) => {
    if (removed.has(c)) return false;
    const x = c % w;
    const y = Math.floor(c / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (removed.has(idxOf(nx, ny, w))) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < pairs; i++) {
    if (left(removed, maxHoles) < 2) break;
    const all = allCells(w, h);
    const blacks = all.filter(
      (c) => isolated(c) && inner(c) && ((c % w) + Math.floor(c / w)) % 2 === 0,
    );
    if (blacks.length === 0) break;
    const black = rng.pick(blacks);
    const whites = all.filter(
      (c) => isolated(c) && inner(c) && c !== black && ((c % w) + Math.floor(c / w)) % 2 === 1,
    );
    if (whites.length === 0) break;
    removed.add(black);
    removed.add(rng.pick(whites));
  }
}

/**
 * 随机骨牌铺洞（形状空间最大的家族）。
 *
 * ## 为什么必须有这个家族
 *
 * 形状库的其他家族在小盘上空间太小：
 *   - `corner`：只有 4 个角位置 × 2 种骨牌 = 8 种
 *   - `notch`：4 条边 × 少量长度 = 十几种
 *   - `cross` / `ring` / `lshape`：各只有 1~4 种
 *
 * 实测世界一（5×5，12 关）有 **28 个重复盘面**，世界三（7×7，32 关）有 54 个 ——
 * 因为可选形状就那么几种，生成多少次都会撞上。
 *
 * `domino` 家族在**所有**相邻格对上随机挑若干个互不重叠的骨牌，
 * 组合数随盘面大小指数增长（5×5 上就有上百种）——
 * 这是解决「小盘重复」的关键。
 *
 * **奇偶中性**：每块骨牌 = 1 黑 1 白 → 整体平衡 ✅
 *
 * ## 连通性守恒（实测数据支撑）
 *
 * 朴素版（随机放骨牌、放到预算上限）在大盘上**几乎必然不可解**：
 *   - 9×9、洞预算 24：成功率 3/20，平均耗时 20ms
 *   - 10×10、洞预算 30：成功率 **0/20**
 *
 * 根因：随机骨牌会把盘面切成碎片 —— 连通但不哈密顿。
 *
 * 现在做两件事：
 *   1. **骨牌数量随机**（1..上限），不再固定铺满预算 → 形状空间再涨一维，
 *      而且**少铺几块**大幅提高可解率；
 *   2. **每放一块就检查连通性**（O(area) 泛洪），
 *      放不下就不放 —— 保证剩下的盘面**始终连通**。
 *
 * 代价是每块骨牌一次泛洪（10×10 上 100 格 → 约 30 次泛洪 = 微秒级），
 * 但换来的是**设计阶段一次成功**（省掉 30 次 × 60ms 的求解重试）。
 */
function carveDomino(
  removed: Set<number>,
  w: number,
  h: number,
  rng: Rng,
  maxHoles: number,
): void {
  // 全部可能的骨牌（横向 + 纵向）
  const dominos: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) dominos.push([y * w + x, y * w + x + 1]);
      if (y + 1 < h) dominos.push([y * w + x, (y + 1) * w + x]);
    }
  }
  if (dominos.length === 0) return;

  const maxCount = Math.max(1, Math.floor(maxHoles / 2));
  /**
   * **数量随机** —— 这是形状空间的第四维。
   *
   * 固定铺满预算会让大盘必然不可解（见上），而且形状单一。
   * 在 1..maxCount 里随机取，多样性与可解率同时改善。
   */
  const target = rng.int(1, maxCount);

  // 随机打散后逐块放
  const order = rng.shuffle(dominos);
  let placed = 0;
  for (const d of order) {
    if (placed >= target) break;
    if (removed.size + 2 > maxHoles) break;
    if (d.some((c) => removed.has(c))) continue;

    // 先试着放，再验连通；不连通就回退
    removed.add(d[0]);
    removed.add(d[1]);
    const rest = allCells(w, h).filter((c) => !removed.has(c));
    if (rest.length < 10 || !isConnected(rest, w, h)) {
      removed.delete(d[0]);
      removed.delete(d[1]);
      continue;
    }
    placed++;
  }
}

/**
 * 按家族挖洞（返回被挖掉的格集合）。
 * 各家族都设计成天然奇偶平衡，且**受洞预算约束**。
 */
export function carveShape(
  removed: Set<number>,
  w: number,
  h: number,
  family: ShapeFamily,
  rng: Rng,
  scatterPairs = 2,
  maxHoles = Number.MAX_SAFE_INTEGER,
): void {
  switch (family) {
    case 'solid':
      return;
    case 'corner':
      carveCorner2x2(removed, w, h, rng, maxHoles);
      return;
    case 'notch':
      carveNotch(removed, w, h, rng, maxHoles);
      return;
    case 'hole':
      carveHoles(removed, w, h, rng, maxHoles);
      return;
    case 'cross':
      carveCross(removed, w, h, rng, maxHoles);
      return;
    case 'ring':
      carveRing(removed, w, h, rng, maxHoles);
      return;
    case 'island':
      carveIsland(removed, w, h, rng, maxHoles);
      return;
    case 'lshape':
      carveLshape(removed, w, h, rng, maxHoles);
      return;
    case 'scatter':
      carveScatter(removed, w, h, rng, scatterPairs, maxHoles);
      return;
    case 'domino':
      carveDomino(removed, w, h, rng, maxHoles);
      return;
    case 'composite': {
      carveHoles(removed, w, h, rng, maxHoles);
      carveNotch(removed, w, h, rng, maxHoles);
      carveScatter(removed, w, h, rng, Math.max(1, scatterPairs - 1), maxHoles);
      return;
    }
  }
}

/**
 * 构造死端（度=1 的格），用作起终点。
 *
 * **只挖 1 个邻居**（不是 2 个）—— 见文件头「死端的正确构造」。
 * 移除 1 格 → |B − W| 变动 ±1 → 仍然合法。
 *
 * @param want 需要几个死端（0/1/2）
 * @returns 死端的拍平索引；数量不足返回 null
 */
export function carveDeadEnds(
  removed: Set<number>,
  cells: number[],
  w: number,
  h: number,
  want: number,
  rng: Rng,
): number[] | null {
  if (want === 0) return [];
  const deadEnds: number[] = [];

  // 候选：度为 2 的边界格（角格最理想）
  const set = new Set(cells);
  const candidates: number[] = [];
  for (const c of cells) {
    let deg = 0;
    for (const nb of fourNeighbors(c, w, h)) if (set.has(nb)) deg++;
    if (deg !== 2) continue;
    const x = c % w;
    const y = Math.floor(c / w);
    const onBorder = x === 0 || x === w - 1 || y === 0 || y === h - 1;
    if (onBorder) candidates.push(c);
  }

  for (const v of rng.shuffle(candidates)) {
    if (deadEnds.length >= want) break;
    if (deadEnds.includes(v)) continue;

    for (const n of fourNeighbors(v, w, h)) {
      if (!set.has(n) || removed.has(n)) continue;
      // 模拟挖掉 n
      const trial = new Set(removed);
      trial.add(n);
      const newCells = cells.filter((c) => !trial.has(c));
      // v 的度数必须降为 1
      let deg = 0;
      for (const nb of fourNeighbors(v, w, h)) if (newCells.includes(nb)) deg++;
      if (deg !== 1) continue;
      // 奇偶必须仍然合法
      if (Math.abs(parityDiff(newCells, w)) > 1) continue;
      // 连通必须保持
      if (!isConnected(newCells, w, h)) continue;

      removed.add(n);
      deadEnds.push(v);
      break;
    }
  }
  if (deadEnds.length < want) return null;

  // **端点奇偶约束**（生成期校验，非玩家规则）：
  // 路径黑白交替 → |S| 奇时两端点同色，|S| 偶时两端点异色。
  // 违反即丢弃这一版盘面（否则会造出「看着有起终点、实则永远走不通」的假关卡）。
  if (want >= 2) {
    const p = (c: number) => (((c % w) + Math.floor(c / w)) % 2);
    const same = p(deadEnds[0]) === p(deadEnds[1]);
    const n = cells.length;
    if (n % 2 === 1 && !same) return null;
    if (n % 2 === 0 && same) return null;
  }
  return deadEnds;
}

/** 设计选项。 */
export interface DesignOptions {
  /** 需要的死端数（0/1/2）。 */
  deadEnds: number;
  /** 内部重试次数。 */
  tries: number;
  /** 洞数量区间（含）。挖出的洞数必须落在此区间，否则重试。 */
  holeRange?: [number, number];
  /** 洞数量上限（家族挖洞的硬预算）。 */
  maxHoles?: number;
  /**
   * 是否在设计阶段就验证可解性（默认 false）。
   *
   * 开启后，不可解的形状会被直接丢弃（换形状重试），
   * 从而让 `carveFromDesign` **永不失败** —— 省掉「回退到从满矩形挖」
   * 那条要几十次完整搜索的路径。
   */
  requireSolvable?: boolean;
  /** 可解性验证的搜索步数上限。 */
  solveBudget?: number;
  /** 可解性验证的墙钟时限（ms）。 */
  solveDeadlineMs?: number;
  /** 整个设计过程的总时间预算（ms）。 */
  totalDeadlineMs?: number;
  /**
   * **绝对截止时间戳**（`Date.now()` 基准）。
   *
   * 与 `totalDeadlineMs` 二选一。给多个家族调用共享同一个截止时刻时用这个 ——
   * 否则每个家族各开一份预算，N 个家族就是 N 倍时间。
   *
   * ## ⚠️ 用它会**破坏确定性**
   *
   * 墙钟时限依赖机器速度与负载：同一份种子在快机器上跑 30 次重试，
   * 在慢机器上可能只跑 10 次 → **产出不同的盘面**。
   *
   * 所以**生产路径不用它**（用 `tries` + `solveBudget` 这两个确定性预算）。
   * 它只在交互式调试时用来「快速放弃」。
   */
  deadlineMs?: number;
}

/** 构造一个全是可走格的网格（设计阶段验证用）。 */
function gridOf(cells: number[], w: number, h: number): Uint8Array {
  const grid = new Uint8Array(w * h);
  for (const c of cells) grid[c] = packCell(CoverCell.BRICK);
  return grid;
}

/**
 * 正向设计一张盘面。
 *
 * @param family      形状家族
 * @param scatterPairs 散点洞对数
 * @param opts         设计选项（死端数、重试次数、洞预算）
 * @returns 设计结果；失败返回 null
 */
export function designShape(
  w: number,
  h: number,
  family: ShapeFamily,
  rng: Rng,
  scatterPairs = 2,
  opts: DesignOptions = { deadEnds: 0, tries: 40 },
): DesignResult | null {
  const maxHoles = opts.maxHoles ?? Math.max(0, w * h - 10);
  const holeRange = opts.holeRange ?? [0, maxHoles];

  /**
   * **总时间预算**。
   *
   * 每个候选形状都要跑一次可解性验证（上限 60ms），
   * 30 次重试最坏就是 1.8 秒 —— 实测大盘上单关卡到 300ms+。
   * 所以给整个设计过程一个总预算，超了就返回最后一次的（可能失败）。
   *
   * **跨家族共享**：调用方（`generateCandidate`）会按随机顺序逐个试家族，
   * 每个家族各自开一个 400ms 预算的话，4 个家族就是 1.6 秒 —— 1000 关要 26 分钟。
   * 所以这里允许调用方传 `deadlineMs`（**绝对时间戳**），
   * 让所有家族的尝试**共享同一个截止时刻**。
   */
  const totalDeadline =
    opts.deadlineMs ?? Date.now() + (opts.totalDeadlineMs ?? 400);
  /** 生产路径必须确定性：不看墙钟，只看重试次数。 */
  const deterministic = opts.deadlineMs === undefined && opts.totalDeadlineMs === undefined;

  for (let t = 0; t < opts.tries; t++) {
    // 预算用尽就别再试了（否则最后一次失败的求解会白烧 60ms）
    if (!deterministic && Date.now() >= totalDeadline) return null;
    const removed = new Set<number>();
    carveShape(removed, w, h, family, rng, scatterPairs, maxHoles);

    let cells = allCells(w, h).filter((c) => !removed.has(c));
    if (cells.length < 10) continue;

    // 死端构造（会移除额外的格）
    let deadEnds: number[] = [];
    let foundPath: number[] | null = null;
    if (opts.deadEnds > 0) {
      const carved = carveDeadEnds(removed, cells, w, h, opts.deadEnds, rng);
      if (!carved) continue;
      deadEnds = carved;
      cells = cells.filter((c) => !removed.has(c));
      if (cells.length < 10) continue;
    }

    /**
     * **洞预算校验**：洞数**不得超过**上限。
     *
     * 下限只作软目标 —— 形状库的挖洞单位是 2 格（骨牌）/ 4 格（2×2 块），
     * 小盘上家族挖出的洞数天然可能低于下限（比如 5×5 挖 2 格，下限 0），
     * 用硬下限会把所有形状都否掉。
     *
     * 上限是硬约束 —— 它决定关卡规模（`|S| = w*h − holes`），
     * 超了规模就飘了。
     */
    if (removed.size > holeRange[1]) continue;

    /**
     * **禁止「零洞满盘」**（小盘重复的头号根因）。
     *
     * 实测世界一（5×5，12 关）有 24 个重复盘面，根因是：
     * `scatter`(pairs=0) / `corner`(放不下 2×2) 等家族会产出 **0 个洞**，
     * 于是盘面 = 满矩形 5×5，指纹**完全相同**（`#########################`）。
     *
     * 满矩形既没有形状变化也没有障碍，难度贡献为零 ——
     * 它只是「同一张盘重复 12 次」。
     *
     * 所以：**只要洞预算允许（maxHoles >= 2），就要求至少挖掉一块骨牌（2 格）**。
     * 挖不出 2 格的家族（`solid`、pairs=0 的 `scatter`）在小盘上直接作废，
     * 这正是 `domino` 家族存在的意义。
     */
    if (holeRange[1] >= 2 && removed.size < 2) continue;

    if (!isConnected(cells, w, h)) continue;
    const diff = parityDiff(cells, w);
    if (Math.abs(diff) > 1) continue;

    /**
     * **可解性校验**（v3 规模/性能的关键）。
     *
     * 形状「看起来对」不代表「有哈密顿路径」——
     * 挖出来的洞可能把盘面切成必须绕路的形状，那就没有解。
     *
     * 如果不在这里校验，`carveFromDesign` 会失败并**回退到「从满矩形挖」**，
     * 那条路径要做几十次完整搜索（实测 9×9 盘上要 300~700ms），
     * 而且挖出来的形状与设计意图不符。
     *
     * 在设计阶段就验证：可解 → 直接采用；不可解 → 换一个形状重试。
     * 成本是一次搜索，换来的是零回退。
     */
    if (opts.requireSolvable) {
      const rs = buildRuleSet(cells, gridOf(cells, w, h), w, h);
      /**
       * **确定性模式**：不给墙钟时限，只用步数预算。
       *
       * 墙钟时限会让同一份种子在不同机器上跑出**不同的盘面** ——
       * 搜索在时限内找到解就返回、否则放弃，结果依赖机器速度。
       * 生产路径必须只依赖**步数预算**（`solveBudget`），
       * 它与硬件无关。
       *
       * 代价：坏盘面的无解证明会烧满整个步数预算。
       * 所以 `solveBudget` 要给得够小（30000 步 ≈ 几十毫秒）。
       */
      const remaining = totalDeadline - Date.now();
      if (!deterministic && remaining <= 0) return null;
      const sol = solve(
        rs,
        rng,
        -1,
        opts.solveBudget ?? 20000,
        // 确定性模式 -> deadlineMs = 0（不限时）；调试模式 -> 用剩余墙钟。
        deterministic ? 0 : Math.min(remaining, opts.solveDeadlineMs ?? 60),
      );
      if (!sol.path) continue;
      // **把解带出去** —— 让 carve 走 hint 快路径，省掉第二次搜索。
      foundPath = sol.path;
    }

    // 障碍分类：不属于 S 且不与盘外连通 → 石头；否则 → 缺口
    const voids: number[] = [];
    const blocks: number[] = [];
    for (const c of removed) {
      if (touchesOutside(c, w, h, removed)) voids.push(c);
      else blocks.push(c);
    }

    let black = 0;
    let white = 0;
    for (const c of cells) {
      if (((c % w) + Math.floor(c / w)) % 2 === 0) black++;
      else white++;
    }

    return {
      w,
      h,
      cells,
      voids,
      blocks,
      adj: buildAdj(cells, w, h),
      black,
      white,
      deadEnds,
      holeCount: removed.size,
      path: foundPath,
    };
  }
  return null;
}
