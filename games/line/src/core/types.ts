/** 方向：移动方向。UP 表示向上移动（y 减小）。 */
export const Dir = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const DIRS: Dir[] = [Dir.UP, Dir.DOWN, Dir.LEFT, Dir.RIGHT];

/** 方向在 x/y 上的增量，索引与 Dir 对应。 */
export const DX: Readonly<number[]> = [0, 0, -1, 1];
export const DY: Readonly<number[]> = [-1, 1, 0, 0];

/** 格子类型。 */
export const CellType = {
  BLOCK: 0,
  BRICK: 1,
  ONEWAY: 2,
  START: 3,
  END: 4,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

/** 单个格子的内容。 */
export interface Cell {
  type: CellType;
  /** 仅当 type === CellType.ONEWAY 时有效。 */
  dir: Dir;
}

/** 一个关卡。 */
export interface Level {
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** grid[y][x]，行优先。 */
  grid: Cell[][];
  /** 理论最少步数（BFS 得出）。 */
  shortest: number;
  /** canonical 路径的转弯数。 */
  turns: number;
  blocks: number;
  oneways: number;
  /** 难度分 0..100。 */
  diff: number;
  unlockSkin: string | null;
}

/** 关卡表（公开部分）。 */
export interface LevelTable {
  version: string;
  count: number;
  generatedAt: string;
  levels: Level[];
}

/** 关卡表中每关的公开字段。 */
export type PublicLevel = Level;
