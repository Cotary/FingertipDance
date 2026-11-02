/**
 * cover 模式：棋盘轮廓构造（形状库）。
 *
 * 两条前置定律（见 24-关卡设计.md §2）：
 * 1. **第一定律（染色奇偶）**：必需格按 (x+y) 奇偶染黑白，|黑−白| ≤ 1 才可能有
 *    哈密顿路径。因此**挖洞必须成对**（一黑一白）——2×2 块、成对单格、偶数长
 *    竖直段都天然平衡。
 * 2. **第二定律（连通）**：必需格必须四邻接连通。
 *
 * 所有 pattern 的挖洞形状都按「天然奇偶平衡 + 保持连通」设计，挖完仍要做
 * O(area) 的复核（生成器不信任任何直觉）。
 *
 * VOID 与 BLOCK 求解等价（都不可进入），渲染不同：盘内被必需格完全包围的
 * 挖掉格 → BLOCK（深色石头）；触边的 → VOID（棋盘缺了一块）。
 */
import type { Rng } from '../rng';

export type ShapePattern =
  | 'solid'      // 满矩形
  | 'corner'     // 挖 1~4 个角的 2×2
  | 'hole'       // 盘内 1~2 个 2×2 石障
  | 'island'     // 挖一条竖直「河」，留 1~2 座桥
  | 'ring'       // 中央 4×4 挖空（环形）
  | 'lshape'     // 右上 (w/2)×(h/2) 挖掉（L 形）
  | 'scatter'    // 随机成对单格洞
  | 'edgeDent'   // 边上挖出 1 个死端（起终点自由度 D=1 的构造）
  | 'composite'; // corner + hole + scatter 混合

export interface ShapeResult {
  w: number;
  h: number;
  /** 必需格（拍平索引，升序）。 */
  cells: number[];
  /** 空洞格（触边 / 塑造轮廓）。 */
  voids: number[];
  /** 石障格（盘内）。 */
  blocks: number[];
  /** 必需格之间的邻接表（局部编号 0..cells.length-1）。 */
  adj: number[][];
  black: number;
  white: number;
}

const MAX_TRIES = 80;

/** 四邻接（含越界过滤）。 */
function fourNeighbors(idx: number, w: number, h: number): number[] {
  const x = idx % w;
  const y = Math.floor(idx / w);
  const out: number[] = [];
  if (x > 0) out.push(idx - 1);
  if (x < w - 1) out.push(idx + 1);
  if (y > 0) out.push(idx - w);
  if (y < h - 1) out.push(idx + w);
  return out;
}

function applyPattern(
  removed: Set<number>,
  w: number,
  h: number,
  pattern: ShapePattern,
  voidBudget: number,
  rng: Rng,
): void {
  const at = (x: number, y: number) => y * w + x;

  switch (pattern) {
    case 'solid':
      return;

    case 'corner': {
      // 每个角 50% 挖 2×2（黑白各 2，天然平衡）
      const corners: Array<[number, number]> = [[0, 0], [w - 2, 0], [0, h - 2], [w - 2, h - 2]];
      for (const [cx, cy] of corners) {
        if (rng.chance(0.5)) {
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) removed.add(at(cx + dx, cy + dy));
        }
      }
      return;
    }

    case 'hole': {
      // 盘内 1~2 个 2×2。位置收在 [2, w-4]：洞贴到第二列就会把边格孤立成死端
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        if (w < 7 || h < 7) break;
        const hx = rng.int(2, Math.max(3, w - 4));
        const hy = rng.int(2, Math.max(3, h - 4));
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) removed.add(at(hx + dx, hy + dy));
      }
      return;
    }

    case 'island': {
      // 挖一列中段（偶数长，黑白平衡），上下各留 ≥1 格做桥
      if (h < 5) return;
      const col = rng.int(1, w - 1);
      const span = h - 4;                 // 可挖区间长度（上下各留 2 做桥）
      const len = rng.int(1, Math.max(2, Math.floor(span / 2))) * 2;
      const top = rng.int(2, 2 + span - len);
      for (let y = top; y < top + len; y++) removed.add(at(col, y));
      return;
    }

    case 'ring': {
      if (w < 6 || h < 6) return;
      const rw = Math.max(2, Math.floor(w / 2) - (w % 2));
      const rh = Math.max(2, Math.floor(h / 2) - (h % 2));
      const cx = Math.floor((w - rw) / 2);
      const cy = Math.floor((h - rh) / 2);
      for (let dy = 0; dy < rh; dy++) for (let dx = 0; dx < rw; dx++) removed.add(at(cx + dx, cy + dy));
      return;
    }

    case 'lshape': {
      const cw = Math.floor(w / 2);
      const ch = Math.floor(h / 2);
      // 右上块；2×2 对齐保证奇偶平衡（cw/ch 为偶时；为奇时靠下方复核兜底）
      for (let y = 0; y < ch; y++) for (let x = w - cw; x < w; x++) removed.add(at(x, y));
      return;
    }

    case 'scatter': {
      // 成对挖：每次随机挖一个黑格 + 一个白格。
      // 上限 4 对：随机散洞在 9×9 上挖 8 个以上时连通率急剧下降（生成器大量重试）
      // 8 邻域隔离洞，上限 2 对：洞之间距离 ≥2，任何格子最多被 1 个洞影响，
      // 不会出现「三个洞包围一个格子」把它变成死端的情况
      const pairs = Math.max(1, Math.min(voidBudget, 2));
      for (let i = 0; i < pairs; i++) {
        const inner = (c: number) => {
          const cx = c % w;
          const cy = Math.floor(c / w);
          return cx >= 2 && cx <= w - 3 && cy >= 2 && cy <= h - 3;
        };
        const isolated = (c: number) => {
          if (removed.has(c)) return false;
          const cx = c % w;
          const cy = Math.floor(c / w);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              if (removed.has(ny * w + nx)) return false;
            }
          }
          return true;
        };
        const blackCands = allCells(w, h).filter((c) => isolated(c) && inner(c) && (Math.floor(c / w) + (c % w)) % 2 === 0);
        if (blackCands.length === 0) break;
        const black = rng.pick(blackCands);
        const whiteCands = allCells(w, h).filter((c) => isolated(c) && c !== black && inner(c) && (Math.floor(c / w) + (c % w)) % 2 === 1);
        if (whiteCands.length === 0) break;
        const white = rng.pick(whiteCands);
        removed.add(black);
        removed.add(white);
      }
      return;
    }

    case 'edgeDent': {
      applyEdgeDent(removed, w, h, rng);
      return;
    }

    case 'composite': {
      // 结构化大洞 + 孤立散点。不用 2×2 hole 块：块洞与散洞连片会让死端失控
      applyPattern(removed, w, h, 'ring', voidBudget, rng);
      applyPattern(removed, w, h, 'scatter', Math.max(1, voidBudget - 2), rng);
      return;
    }
  }
}

/**
 * 挖边格 v 的两个同排邻居 + 一个盘内异色格 → 边格 v 变死端（度=1）。
 * 死端必为路径端点，这就是「起终点自由度 D」的构造（每调用一次 +1 死端）。
 * 奇偶：两个同色边格 + 一个异色格 → |B−W| 差 1，第一定律允许。
 */
function applyEdgeDent(removed: Set<number>, w: number, h: number, rng: Rng): void {
  const at = (x: number, y: number) => y * w + x;
  // side 候选收在 [3, w-4]：同排邻居 (by±1) 挖掉后若贴着角，角格度 2→1 变成
  // 计划外的第三个死端
  const sides: Array<[number, number]> = [];
  for (let y = 3; y <= h - 4; y++) sides.push([0, y]);
  for (let y = 3; y <= h - 4; y++) sides.push([w - 1, y]);
  for (let x = 3; x <= w - 4; x++) sides.push([x, 0]);
  for (let x = 3; x <= w - 4; x++) sides.push([x, h - 1]);
  // side 候选：死端本身及其两个同排邻居都必须未挖，否则挖完不产生死端
  // 或与已有洞连片（制造出第 3 个死端）
  const valid = sides.filter(([bx, by]) => {
    if (removed.has(at(bx, by))) return false;
    // 死端的内侧邻居也不能已挖，否则死端度变 0 成孤岛
    const innerX = bx === 0 ? 1 : bx === w - 1 ? w - 2 : bx;
    const innerY = by === 0 ? 1 : by === h - 1 ? h - 2 : by;
    if (bx === 0 || bx === w - 1) {
      return !removed.has(at(bx, by - 1)) && !removed.has(at(bx, by + 1)) && !removed.has(at(innerX, by));
    }
    return !removed.has(at(bx - 1, by)) && !removed.has(at(bx + 1, by)) && !removed.has(at(bx, innerY));
  });
  if (valid.length === 0) return;
  const [bx, by] = rng.pick(valid);
  // 两个同排邻居
  if (bx === 0 || bx === w - 1) {
    removed.add(at(bx, by - 1));
    removed.add(at(bx, by + 1));
  } else {
    removed.add(at(bx - 1, by));
    removed.add(at(bx + 1, by));
  }
  // 盘内异色格（避开已挖与死端本身）
  const inner = allCells(w, h).filter((c) => {
    if (removed.has(c)) return false;
    const cx = c % w;
    const cy = Math.floor(c / w);
    if (cx < 2 || cx > w - 3 || cy < 2 || cy > h - 3) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (removed.has(ny * w + nx)) return false;
      }
    }
    return (cx + cy) % 2 !== (bx + by) % 2;
  });
  if (inner.length > 0) removed.add(rng.pick(inner));
}

function allCells(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(y * w + x);
  return out;
}

function isConnected(cells: number[], w: number, h: number): boolean {
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

/**
 * 构造轮廓。失败返回 null（调用方重试或退化）。
 */
export function buildShape(
  w: number,
  h: number,
  pattern: ShapePattern,
  voidBudget: number,
  rng: Rng,
  /** 追加的死端数（0/1/2）：在 pattern 之上精确制造起终点自由度。 */
  dents = 0,
): ShapeResult | null {
  for (let t = 0; t < MAX_TRIES; t++) {
    const removed = new Set<number>();
    applyPattern(removed, w, h, pattern, voidBudget, rng);
    for (let d = 0; d < dents; d++) applyEdgeDent(removed, w, h, rng);

    const cells = allCells(w, h).filter((c) => !removed.has(c));
    if (cells.length < 8) continue;
    if (!isConnected(cells, w, h)) continue;

    let black = 0;
    let white = 0;
    for (const c of cells) {
      if ((Math.floor(c / w) + (c % w)) % 2 === 0) black++;
      else white++;
    }
    if (Math.abs(black - white) > 1) continue;

    // 邻接表（局部编号）
    const localId = new Map<number, number>();
    cells.forEach((c, i) => localId.set(c, i));
    const adj: number[][] = cells.map((c) => {
      const out: number[] = [];
      for (const nb of fourNeighbors(c, w, h)) {
        const lid = localId.get(nb);
        if (lid !== undefined) out.push(lid);
      }
      return out;
    });

    // 第一定律的细化：D=2 时两个死端就是起终点，颜色必须匹配
    // 路径黑白交替 → n 奇时起终点同色，n 偶时起终点异色
    const deadCellColors: number[] = [];
    adj.forEach((a, i) => {
      if (a.length === 1) deadCellColors.push((cells[i] % w + Math.floor(cells[i] / w)) % 2);
    });
    if (deadCellColors.length === 2) {
      const same = deadCellColors[0] === deadCellColors[1];
      if (cells.length % 2 === 1 && !same) continue; // n 奇需要同色
      if (cells.length % 2 === 0 && same) continue;  // n 偶需要异色
    }

    // VOID vs BLOCK：被必需格完全包围的挖掉格 → BLOCK
    const voids: number[] = [];
    const blocks: number[] = [];
    for (const c of removed) {
      const nbs = fourNeighbors(c, w, h);
      const enclosed = nbs.length === 4 && nbs.every((nb) => localId.has(nb));
      if (enclosed) blocks.push(c);
      else voids.push(c);
    }

    return { w, h, cells, voids, blocks, adj, black, white };
  }
  return null;
}

/** 分析必需格图的拓扑：死端（度=1）、分叉（度≥3）、度分布。 */
export function analyze(adj: number[][]): { deadEnds: number; branches: number; deg2: number } {
  let deadEnds = 0;
  let branches = 0;
  let deg2 = 0;
  for (const list of adj) {
    if (list.length <= 1) deadEnds++;
    else if (list.length >= 3) branches++;
    else deg2++;
  }
  return { deadEnds, branches, deg2 };
}

/**
 * 诱饵检测：对每个分叉格 v 的每个邻居 d，模拟「先走 v→d」，检查剩余格子
 * （除 v、d 外）是否仍连通。不连通 → 该方向是诱饵。
 * 返回诱饵总数与最大诱饵深度（沿该分支能走多远才发现死路）。
 */
export function baitAnalysis(adj: number[][]): { baits: number; maxDepth: number } {
  const n = adj.length;
  let baits = 0;
  let maxDepth = 0;

  for (let v = 0; v < n; v++) {
    if (adj[v].length < 3) continue;
    for (const d of adj[v]) {
      const blocked = new Set<number>([v, d]);
      // 剩余连通性
      let start = -1;
      for (let u = 0; u < n; u++) {
        if (!blocked.has(u)) { start = u; break; }
      }
      if (start === -1) continue;
      const seen = new Set<number>([start]);
      const q: number[] = [start];
      let head = 0;
      let reach = 0;
      while (head < q.length) {
        const c = q[head++];
        reach++;
        for (const u of adj[c]) {
          if (blocked.has(u) || seen.has(u)) continue;
          seen.add(u);
          q.push(u);
        }
      }
      if (reach < n - 2) {
        baits++;
        // 深度：从 d 出发沿「唯一非回头方向」的链长
        let cur = d;
        let prev = v;
        let depth = 0;
        while (true) {
          const nexts = adj[cur].filter((u) => u !== prev);
          if (nexts.length === 1) {
            prev = cur;
            cur = nexts[0];
            depth++;
          } else break;
        }
        maxDepth = Math.max(maxDepth, depth);
      }
    }
  }
  return { baits, maxDepth };
}
