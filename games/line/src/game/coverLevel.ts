/**
 * Cover 模式 v3：客户端关卡运行时（关卡 + 规则集）。
 *
 * ## 为什么要单独一层
 *
 * 经典模式（`core/types.ts`）的关卡是「起终点 + 砖块」，
 * 而 cover 模式的关卡是「铺满整张图」，
 * 两者在**数据模型**和**胜负判定**上都不同，不能硬塞进同一套类型。
 *
 * 所以这里定义 cover 专属的关卡对象：
 *   - `CoverLevel`：解码后的关卡（供渲染与玩法使用）
 *   - `CoverRuntime`：关卡 + 规则集（供求解与校验使用）
 *
 * ## 单一事实源
 *
 * 规则判定全部走 `core/cover/v3/rules.ts` 的 `buildRuleSet` / `stepMove` /
 * `candidateMoves` / `replay` —— 生成器用的是同一份代码。
 * 这样「生成时认为合法」与「玩家实际能走」必然一致。
 */
import { decodeGrid, type LevelEntry } from '../core/cover/v3/codec';
import { buildRuleSet, type RuleSet } from '../core/cover/v3/rules';
import { CoverCell, cellGroup, cellType } from '../core/cover/v3/types';

/** 一个 cover 关卡（客户端视角，已解码）。 */
export interface CoverLevel {
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** 盘面编码：每格 1 字节 = (type << 4) | (dir << 2) | group */
  grid: Uint8Array;
  /** 可走格数（= 需要覆盖的格数） */
  required: number;
  /** 难度分 0..100 */
  diff: number;
  /** 端点固定数（D）：0 = 两端都自由 */
  deadEnds: number;
  /** 起点拍平索引；-1 = 自由 */
  startAt: number;
  /** 终点拍平索引；-1 = 自由 */
  endAt: number;
  /** 机制种类数 */
  mechKinds: number;
  /** 解数分档（1..9，9 = 至少 9 条） */
  solutionCount: number;
}

/**
 * 关卡运行时：关卡 + 规则集。
 *
 * 规则集持有「局部编号」体系（把可走格压成 0..n-1），
 * 这是求解器与回放校验的工作坐标系。
 */
export interface CoverRuntime {
  level: CoverLevel;
  /** 规则集（局部编号体系） */
  rs: RuleSet;
}

/** 把表条目解码成关卡。 */
export function decodeCoverLevel(entry: LevelEntry): CoverLevel {
  const grid = decodeGrid(entry.grid, entry.w * entry.h);
  return {
    idx: entry.idx,
    seed: entry.seed,
    w: entry.w,
    h: entry.h,
    grid,
    required: entry.required,
    diff: entry.diff,
    deadEnds: entry.deadEnds,
    startAt: entry.startAt,
    endAt: entry.endAt,
    mechKinds: entry.mechKinds,
    solutionCount: entry.solutionCount,
  };
}

/**
 * 抽出「可走格」的拍平索引列表（升序）。
 *
 * 局部编号（0..n-1）= 这个列表的下标。求解器、回放、提示全都工作在
 * 这套编号上，所以它是这层与核心算法之间的唯一桥梁。
 */
export function walkableCells(level: CoverLevel): number[] {
  const cells: number[] = [];
  const total = level.w * level.h;
  for (let i = 0; i < total; i++) {
    const t = cellType(level.grid[i]);
    if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
    cells.push(i);
  }
  return cells;
}

/**
 * 构建运行时（关卡 + 规则集）。
 *
 * 起终点的局部编号由 `level.startAt` / `level.endAt`（拍平索引）换算而来。
 * 自由端点保持 -1。
 */
export function buildCoverRuntime(level: CoverLevel): CoverRuntime {
  const cells = walkableCells(level);
  const rs = buildRuleSet(cells, level.grid, level.w, level.h);
  rs.startAt = level.startAt >= 0 ? rs.localOf[level.startAt] : -1;
  rs.endAt = level.endAt >= 0 ? rs.localOf[level.endAt] : -1;
  return { level, rs };
}

/** 某格的类型（拍平索引）。 */
export function typeAt(level: CoverLevel, flat: number): number {
  return cellType(level.grid[flat]);
}

/** 某格的分组（拍平索引）：星星编号 / 钥匙配对 / 传送门配对。 */
export function groupAt(level: CoverLevel, flat: number): number {
  return cellGroup(level.grid[flat]);
}
