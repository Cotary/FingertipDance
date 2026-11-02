/**
 * cover 模式：构造式关卡生成器主流程。
 *
 * 与 v1 的本质区别（24-关卡设计.md §4.1）：
 * v1 = 随机撒块 → 求解验证；v2 = **先构造哈密顿路径 → 反推合法性**。
 * 「有解」是构造的副产品，不需要搜索验证。
 *
 * 流程：buildShape（轮廓，双定律前置过滤）→ findHamiltonian（构造路径）
 * → analyze（死端/分叉/诱饵）→ 难度评分 → 与目标难度对齐。
 * 死端数 D 是「起终点自由度」的唯一开关（§1.2）：D=0 任意起手，D=2 起终点固定。
 */
import { mulberry32, levelSeed } from '../rng';
import { countHamiltonian, type HamGraph } from './hamilton';
import { baitAnalysis } from './shape';

/** cover 格类型（24-关卡设计.md §8.1）。 */
export const CoverCell = {
  VOID: 0,
  BRICK: 1,
  BLOCK: 2,
  ONEWAY: 3,
  SHARD: 4,
  KEY: 5,
  GATE: 6,
  PORTAL: 7,
  ICE: 8,
} as const;
export type CoverCellType = (typeof CoverCell)[keyof typeof CoverCell];

/** cover 关卡。 */
export interface CoverLevel {
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** 拍平 grid，长度 w*h，CoverCell 值。 */
  grid: Uint8Array;
  /** 必需格数（= shortest + 1）。 */
  required: number;
  shortest: number;
  /** 死端数（起终点自由度开关）。 */
  deadEnds: number;
  /** 分叉数（deg ≥ 3）。 */
  branches: number;
  /** 诱饵数 / 最大诱饵深度。 */
  baits: number;
  maxBaitDepth: number;
  /** 参考解转弯数（决策负担主指标）。 */
  turns: number;
  /** 难度分 0..100。 */
  diff: number;
  /** 参考解（拍平索引序列，长度 = required）。 */
  solution: number[];
}

/** 世界阶梯参数（24-关卡设计.md §6.3）。 */
export interface WorldParams {
  from: number;
  to: number;
  w: number;
  h: number;
  w2: number;
  h2: number;
  /** 切尾格数区间（构造式生成：满矩形构造路径后切掉尾部，棋盘 = 路径前缀）。 */
  cutRange: [number, number];
  /** 死端目标区间（含）。 */
  deadEnds: [number, number];
  /** 参考解转弯数上限（防极端蛇形；决策负担由难度公式用转弯+诱饵表达）。 */
  maxTurns: number;
  /** 段内难度范围。 */
  diffRange: [number, number];
}

/** 七个世界。尺寸随难度阶梯增长；死端 D 从 0 爬到 2。 */
export const WORLDS: WorldParams[] = [
  { from: 1,    to: 12,   w: 5,  h: 5,  w2: 5,  h2: 5,  cutRange: [2, 8],    deadEnds: [0, 0], maxTurns: 12, diffRange: [5, 10] },
  { from: 13,   to: 32,   w: 6,  h: 6,  w2: 6,  h2: 6,  cutRange: [2, 6],    deadEnds: [0, 0], maxTurns: 16, diffRange: [10, 14] },
  { from: 33,   to: 64,   w: 7,  h: 7,  w2: 7,  h2: 7,  cutRange: [4, 10],   deadEnds: [0, 0], maxTurns: 20, diffRange: [14, 18] },
  { from: 65,   to: 152,  w: 8,  h: 8,  w2: 8,  h2: 8,  cutRange: [12, 20],  deadEnds: [0, 1], maxTurns: 26, diffRange: [18, 24] },
  { from: 153,  to: 404,  w: 8,  h: 8,  w2: 9,  h2: 9,  cutRange: [14, 24],  deadEnds: [0, 1], maxTurns: 30, diffRange: [24, 28] },
  { from: 405,  to: 704,  w: 9,  h: 9,  w2: 9,  h2: 9,  cutRange: [18, 30],  deadEnds: [0, 1], maxTurns: 48, diffRange: [28, 32] },
  { from: 705,  to: 1000, w: 10, h: 10, w2: 11, h2: 11, cutRange: [22, 38],  deadEnds: [0, 1], maxTurns: 56, diffRange: [32, 40] },
];

const MAX_ATTEMPT = 40;
const DIFF_TOLERANCE = 8;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 关号所属世界。 */
export function worldOf(idx: number): WorldParams {
  for (const wp of WORLDS) if (idx >= wp.from && idx <= wp.to) return wp;
  return WORLDS[WORLDS.length - 1];
}

/** 目标难度分：段内线性，段间无缝衔接（上段终点 = 下段起点，保证全程单调不降）。 */
export function coverTargetDiff(idx: number): number {
  const wp = worldOf(idx);
  const span = wp.to - wp.from;
  const t = span <= 0 ? 0 : (idx - wp.from) / span;
  const base = wp.diffRange[0] + (wp.diffRange[1] - wp.diffRange[0]) * t;
  return Math.max(0, Math.min(100, Math.round(base)));
}

/** 路径转弯数（拍平索引序列的方向变化次数）。 */
export function countTurns(path: number[], w: number): number {
  let turns = 0;
  let prev = -1;
  for (let i = 1; i < path.length; i++) {
    const d = path[i] - path[i - 1];
    const dir = d === -w ? 0 : d === w ? 1 : d === -1 ? 2 : 3;
    if (prev !== -1 && dir !== prev) turns++;
    prev = dir;
  }
  return turns;
}

/**
 * 难度分（24-关卡设计.md §6.2，权重为先验值、待实测回填）。
 * 决策负担 = 转弯数（玩家要预判几次转向）+ 诱饵深度（走错多少步才发现）。
 * 静态度 ≥3 的格子数不适合做难度——满矩形里这种格子占一大半，但蛇形路径
 * 只有约 10 次转弯，玩家毫无压力。转弯数是决策负担的果，直接采它。
 */
export function coverDiff(input: {
  required: number;
  turns: number;
  deadEnds: number;
  voids: number;
  area: number;
  maxBaitDepth: number;
}): number {
  const { required, turns, deadEnds, voids, area, maxBaitDepth } = input;
  const sizeTerm = clamp01((required - 20) / 101);            // 20..121
  const turnTerm = clamp01(turns / 36);                       // 蛇形 ~6，迷宫 36+
  const deadEndTerm = deadEnds / 2;
  const mechTerm = 0;                                          // 机制下一轮接入
  const shapeTerm = clamp01(voids / area / 0.45);
  const baitTerm = clamp01(maxBaitDepth / 6);
  const raw =
    0.12 * sizeTerm +
    0.22 * turnTerm +
    0.16 * deadEndTerm +
    0.20 * mechTerm +
    0.14 * shapeTerm +
    0.16 * baitTerm;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

/**
 * 生成一关。返回 null 表示 MAX_ATTEMPT 内失败（调用方应退化或报错）。
 */
export function generateCoverLevel(
  idx: number,
  globalSeed: number,
  requireUnique = false,
): CoverLevel | null {
  const wp = worldOf(idx);
  const seed = levelSeed(globalSeed, idx);
  const target = coverTargetDiff(idx);
  const span = wp.to - wp.from;
  const t = span <= 0 ? 0 : (idx - wp.from) / span;
  const w = Math.round(wp.w + (wp.w2 - wp.w) * t);
  const h = Math.round(wp.h + (wp.h2 - wp.h) * t);

  let best: CoverLevel | null = null;
  let bestDelta = Infinity;

  for (let attempt = 0; attempt < MAX_ATTEMPT; attempt++) {
    const rng = mulberry32(seed + attempt * 7919);

    // 构造式生成（24-关卡设计.md §4.1）：
    // 满矩形上的哈密顿路径不用搜索 —— 蛇形/螺旋基线 + 段重建打乱。
    // 双端切：切头 iCut + 切尾 jCut → 棋盘 = 路径中段，参考解 = 中段本身。
    // 单端切的前缀形状严重趋同（k=24 的盘全是「环形」）；中段的形状空间是
    // i×j 组合，再加 8 种对称变换（旋转/镜像保相邻、保哈密顿性）。
    const P = randomHamiltonian(w, h, rng);
    const jCut = rng.int(wp.cutRange[0], wp.cutRange[1] + 1);
    const iCut = rng.int(0, Math.min(8, jCut) + 1);
    let cells = P.slice(iCut, P.length - jCut);
    cells = symTransform(cells, w, h, rng.int(0, w === h ? 8 : 6));
    if (cells.length < 20) continue;

    // 分析：死端（起终点自由度）、分叉、诱饵
    const { adj, deadEnds, branches } = analyzeCells(cells, w, h);
    if (deadEnds < wp.deadEnds[0] || deadEnds > wp.deadEnds[1]) continue;

    // 转弯数：参考解的决策负担
    const turns = countTurns(cells, w);
    if (turns > wp.maxTurns) continue;

    // 唯一解要求（后期关卡用它收紧解空间）
    if (requireUnique) {
      const count = countHamiltonian(adj, 9, 4000000);
      if (count > 2) continue;
    }

    const baits = baitAnalysis(adj.adj);
    const diff = coverDiff({
      required: cells.length,
      turns,
      deadEnds,
      voids: w * h - cells.length,
      area: w * h,
      maxBaitDepth: baits.maxDepth,
    });

    const level = buildLevel(idx, seed, w, h, cells, deadEnds, branches, baits, turns, diff);
    const delta = Math.abs(diff - target);
    if (delta <= DIFF_TOLERANCE) return level;
    if (delta < bestDelta) {
      best = level;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * 满矩形上的螺旋哈密顿路径（从左上角顺时针向内）。

/**
 * 满矩形上的随机哈密顿路径：蛇形基线 + 2-opt 局部变换。
 * 2-opt = 反转路径的一段 [i..j]；合法性只需检查两条新边 (i-1,j)、(i,j+1) 相邻。
 * 变换保持哈密顿性 → 不需要求解器验证，比 Warnsdorff 快两个数量级且形态多样。
 */
function spiralPath(w: number, h: number): number[] {
  const path: number[] = [];
  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top <= bottom && left <= right) {
    for (let x = left; x <= right; x++) path.push(top * w + x);
    top++;
    for (let y = top; y <= bottom; y++) path.push(y * w + right);
    right--;
    if (top <= bottom) {
      for (let x = right; x >= left; x--) path.push(bottom * w + x);
      bottom--;
    }
    if (left <= right) {
      for (let y = bottom; y >= top; y--) path.push(y * w + left);
      left++;
    }
  }
  return path;
}

function randomHamiltonian(w: number, h: number, rng: import('../rng').Rng): number[] {
  // 基线：蛇形或螺旋二选一 —— 两个不同的布局家族，比单一蛇形的多样性大得多
  if (rng.chance(0.5)) {
    const spiral = spiralPath(w, h);
    return rng.chance(0.5) ? spiral : spiral.slice().reverse();
  }

  // 蛇形基线：4 角 × 2 方向，随机选一种
  const corners: Array<[number, number]> = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const [sx, sy] = rng.pick(corners);
  const horizontal = rng.chance(0.5);
  const path: number[] = [];
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const fromTop = (sy === 0 && y % 2 === 0) || (sy !== 0 && y % 2 === 1);
      const leftToRight = fromTop === (sx === 0);
      for (let i = 0; i < w; i++) {
        const x = leftToRight ? i : w - 1 - i;
        path.push(y * w + x);
      }
    }
    if (path[0] !== sy * w + sx) path.reverse();
  } else {
    for (let x = 0; x < w; x++) {
      const fromLeft = (sx === 0 && x % 2 === 0) || (sx !== 0 && x % 2 === 1);
      const topToBottom = fromLeft === (sy === 0);
      for (let i = 0; i < h; i++) {
        const y = topToBottom ? i : h - 1 - i;
        path.push(y * w + x);
      }
    }
    if (path[0] !== sy * w + sx) path.reverse();
  }
  if (rng.chance(0.5)) path.reverse();

  // 段重建打乱：随机选一段 [i..j]（长 2~7），固定两个端点，在段内做随机 DFS
  // 重连。子问题 ≤ 9 格，DFS 秒解；每步重建都随机，路径形态（转弯数）快速发散。
  // 注意不能用 2-opt 式「反转任意段」——随机两点的几何相邻概率 ~(2/n)²，
  // 接受率几乎为 0，混合不动。
  const T = w * h * 10;
  for (let t = 0; t < T; t++) {
    if (!rebuildSegment(path, w, h, rng)) continue;
  }
  return path;
}

/**
 * 段重建：path[i-1] →（段内随机路径）→ path[j+1]。
 * 段内格子集合 = path[i..j]，端点是 path[i-1] / path[j+1]。
 * 随机 DFS 在 ≤9 格上找一条覆盖段内全部格子的路径。
 */
function rebuildSegment(
  path: number[],
  w: number,
  h: number,
  rng: import('../rng').Rng,
): boolean {
  const n = path.length;
  // 段长 3~16：段太短（2~7）混合后转弯数不升反降，路径形态发散不开
  const len = rng.int(3, 17);
  const i = rng.int(1, n - len - 1);
  const j = i + len - 1;
  const start = path[i - 1];
  const end = path[j + 1];

  const segCells = path.slice(i, j + 1);
  const allowed = new Set<number>([start, end, ...segCells]);

  // 几何邻接（cur±1 在行首/行尾会跨行，必须按坐标生成）
  const neighborsOf = (cur: number): number[] => {
    const x = cur % w;
    const y = Math.floor(cur / w);
    const out: number[] = [];
    if (x > 0) out.push(cur - 1);
    if (x < w - 1) out.push(cur + 1);
    if (y > 0) out.push(cur - w);
    if (y < h - 1) out.push(cur + w);
    return out;
  };

  const dfs = (cur: number, depth: number, visited: Set<number>, out: number[]): number[] | null => {
    if (cur === end && depth === len + 1) return out.slice();
    // 候选必须随机序：固定顺序会让原路径总是第一个被找到，重建等于没动
    for (const nb of rng.shuffle(neighborsOf(cur))) {
      if (!allowed.has(nb) || visited.has(nb)) continue;
      if (nb === end && depth + 1 !== len + 1) continue;
      visited.add(nb);
      out.push(nb);
      const r = dfs(nb, depth + 1, visited, out);
      if (r) return r;
      out.pop();
      visited.delete(nb);
    }
    return null;
  };

  const found = dfs(start, 0, new Set([start]), [start]);
  if (!found) return false;
  path.splice(i, len, ...found.slice(1, found.length - 1));
  return true;
}

/** 8 种对称变换（保相邻 → 保路径合法）：旋转 ×4 + 镜像 ×2 + 对角 ×2（仅方阵）。 */
function symTransform(cells: number[], w: number, h: number, t: number): number[] {
  const map = (x: number, y: number): number => {
    let nx: number;
    let ny: number;
    switch (t) {
      case 0: nx = x; ny = y; break;
      case 1: nx = w - 1 - y; ny = x; break;
      case 2: nx = w - 1 - x; ny = h - 1 - y; break;
      case 3: nx = y; ny = h - 1 - x; break;
      case 4: nx = w - 1 - x; ny = y; break;
      case 5: nx = x; ny = h - 1 - y; break;
      case 6: nx = y; ny = x; break;
      default: nx = w - 1 - y; ny = h - 1 - x; break;
    }
    return ny * w + nx;
  };
  return cells.map((c) => map(c % w, Math.floor(c / w)));
}

/** 从必需格集合构建邻接表 + 拓扑分析（死端 / 分叉）。 */
function analyzeCells(
  cells: number[],
  w: number,
  h: number,
): { adj: HamGraph; deadEnds: number; branches: number } {
  const set = new Set(cells);
  const local = new Map<number, number>();
  cells.forEach((c, i) => local.set(c, i));
  const adjArr: number[][] = cells.map((c) => {
    const x = c % w;
    const y = Math.floor(c / w);
    const out: number[] = [];
    const push = (nb: number) => {
      if (set.has(nb)) out.push(local.get(nb)!);
    };
    if (x > 0) push(c - 1);
    if (x < w - 1) push(c + 1);
    if (y > 0) push(c - w);
    if (y < h - 1) push(c + w);
    return out;
  });
  let deadEnds = 0;
  let branches = 0;
  for (const a of adjArr) {
    if (a.length <= 1) deadEnds++;
    else if (a.length >= 3) branches++;
  }
  return { adj: { n: cells.length, adj: adjArr }, deadEnds, branches };
}

/** 把切尾结果组装成 CoverLevel（机制尚未接入，全部 BRICK）。 */
function buildLevel(
  idx: number,
  seed: number,
  w: number,
  h: number,
  cells: number[],
  deadEnds: number,
  branches: number,
  baits: { baits: number; maxDepth: number },
  turns: number,
  diff: number,
): CoverLevel {
  const grid = new Uint8Array(w * h); // 默认 VOID=0
  for (const c of cells) grid[c] = CoverCell.BRICK;
  // 挖掉格分类：被必需格完全包围 → BLOCK（盘内石头），否则 VOID（轮廓缺角）
  const set = new Set(cells);
  for (let c = 0; c < w * h; c++) {
    if (set.has(c)) continue;
    const x = c % w;
    const y = Math.floor(c / w);
    const nbs: number[] = [];
    if (x > 0) nbs.push(c - 1);
    if (x < w - 1) nbs.push(c + 1);
    if (y > 0) nbs.push(c - w);
    if (y < h - 1) nbs.push(c + w);
    if (nbs.length === 4 && nbs.every((nb) => set.has(nb))) grid[c] = CoverCell.BLOCK;
  }

  return {
    idx,
    seed,
    w,
    h,
    grid,
    required: cells.length,
    shortest: cells.length - 1,
    deadEnds,
    branches,
    baits: baits.baits,
    maxBaitDepth: baits.maxDepth,
    turns,
    diff,
    solution: cells,
  };
}

/** 校验参考解：自避、四邻接、只走必需格、覆盖全部必需格。 */
export function validateSolution(level: CoverLevel): string | null {
  const { w, h, grid, solution, required } = level;
  const seen = new Set<number>();
  let count = 0;
  for (let i = 0; i < solution.length; i++) {
    const c = solution[i];
    if (c < 0 || c >= w * h) return `越界格子 ${c}`;
    if (grid[c] !== CoverCell.BRICK) return `参考解经过非必需格 ${c}（type=${grid[c]}）`;
    if (seen.has(c)) return `重复经过 ${c}`;
    seen.add(c);
    count++;
    if (i > 0) {
      const dx = Math.abs((c % w) - (solution[i - 1] % w));
      const dy = Math.abs(Math.floor(c / w) - Math.floor(solution[i - 1] / w));
      if (dx + dy !== 1) return `第 ${i} 步不邻接`;
    }
  }
  if (count !== required) return `覆盖 ${count}/${required}`;
  return null;
}
