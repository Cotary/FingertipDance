/**
 * Cover 模式 v3：核心类型与位布局。
 *
 * 核心规则（唯一不可动摇的一条）：
 *   一条连续的路，铺满整张地图；不能交叉，不能重复走。
 *
 * 本文件只定义「格子长什么样」，不含任何玩法逻辑。
 *
 * 位布局（每格 1 字节）：
 *   byte = (type << 4) | (dir << 2) | group
 *     type  4 bit  格子类型
 *     dir   2 bit  方向（单向门用：允许的离开方向）
 *     group 2 bit  分组（钥匙/门配对、星星编号、传送门配对）
 */

/** cover 格子类型。 */
export const CoverCell = {
  /** 缺口：不可走，且与盘外连通（露出底板）。 */
  VOID: 0,
  /** 普通可走格。 */
  BRICK: 1,
  /** 石头：不可走，且被可走格完全包围（盘内障碍）。 */
  BLOCK: 2,
  /** 单向门：只能沿 dir 方向离开。 */
  ONEWAY: 3,
  /** 星星：必须按 group 编号顺序经过。 */
  SHARD: 4,
  /** 钥匙：走过即拾取，与 group 对应的门配对。 */
  KEY: 5,
  /** 门：未持有对应钥匙不可进入。 */
  GATE: 6,
  /** 传送门：group 相同的一对格之间存在额外通道。 */
  PORTAL: 7,
  /** 冰块：踩上后沿进入方向滑行至撞墙。 */
  ICE: 8,
  /** 起点标记（同时也是普通可走格）。 */
  START: 9,
  /** 终点标记（同时也是普通可走格）。 */
  END: 10,
} as const;

export type CoverCellType = (typeof CoverCell)[keyof typeof CoverCell];

/** 合法格子类型上界（用于自检）。 */
export const MAX_CELL_TYPE = CoverCell.END;

/** 方向编码：0=上 1=下 2=左 3=右。 */
export const DIR = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
} as const;

export type Dir = (typeof DIR)[keyof typeof DIR];

/** 方向的反向。 */
export const OPPOSITE: Record<Dir, Dir> = {
  [DIR.UP]: DIR.DOWN,
  [DIR.DOWN]: DIR.UP,
  [DIR.LEFT]: DIR.RIGHT,
  [DIR.RIGHT]: DIR.LEFT,
};

/** 打包一个格子。 */
export function packCell(type: number, dir = 0, group = 0): number {
  return ((((type & 0x0f) << 4) | ((dir & 0x03) << 2) | (group & 0x03)) & 0xff) >>> 0;
}

/** 解出格子类型。 */
export function cellType(b: number): number {
  return (b >>> 4) & 0x0f;
}

/** 解出方向。 */
export function cellDir(b: number): number {
  return (b >>> 2) & 0x03;
}

/** 解出分组。 */
export function cellGroup(b: number): number {
  return b & 0x03;
}

/** 由步长得到方向编码。 */
export function dirFromDelta(delta: number, w: number): number {
  if (delta === -w) return DIR.UP;
  if (delta === w) return DIR.DOWN;
  if (delta === -1) return DIR.LEFT;
  if (delta === 1) return DIR.RIGHT;
  throw new Error(`dirFromDelta: 非法步长 ${delta}`);
}

/** 由方向编码得到步长。 */
export function deltaFromDir(d: number, w: number): number {
  if (d === DIR.UP) return -w;
  if (d === DIR.DOWN) return w;
  if (d === DIR.LEFT) return -1;
  if (d === DIR.RIGHT) return 1;
  throw new Error(`deltaFromDir: 非法方向 ${d}`);
}

/** 方向的单位向量。 */
export function dirVec(d: number): [number, number] {
  if (d === DIR.UP) return [0, -1];
  if (d === DIR.DOWN) return [0, 1];
  if (d === DIR.LEFT) return [-1, 0];
  return [1, 0];
}

/** 格子的 (x, y)。 */
export function xyOf(idx: number, w: number): [number, number] {
  return [idx % w, Math.floor(idx / w)];
}

/** (x, y) → 拍平索引。 */
export function idxOf(x: number, y: number, w: number): number {
  return y * w + x;
}
