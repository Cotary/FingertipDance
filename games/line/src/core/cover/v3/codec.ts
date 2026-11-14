/**
 * Cover 模式 v3：序列化。
 *
 * grid：每格 1 字节 = (type << 4) | (dir << 2) | group。
 * 解：起点索引 + 步数 + 方向序列（每步 2 bit）。
 *
 * **两张表的分工（架构红线）**：
 *   - 含解的表 → 只放服务端（成绩校验、离线复核）
 *   - 不含解的表 → 客户端用
 * 客户端一旦持有解，提示广告就形同虚设（玩家直接读表回放），
 * 且可回放提交当作通关，服务端的线性校验无法区分真假。
 */
import { CoverCell, cellDir, cellGroup, cellType, dirFromDelta, MAX_CELL_TYPE } from './types';

/** grid 拍平数组 → base64（每格 1 字节）。 */
export function encodeGrid(grid: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < grid.length; i += CHUNK) {
    bin += String.fromCharCode(...grid.subarray(i, Math.min(i + CHUNK, grid.length)));
  }
  return btoa(bin);
}

/** base64 → grid 拍平数组。 */
export function decodeGrid(b64: string, len: number): Uint8Array {
  const bin = atob(b64);
  if (bin.length !== len) throw new Error(`decodeGrid: 期望 ${len} 字节，实际 ${bin.length}`);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解（拍平索引序列）→ "起点,步数,base64(方向序列)"。 */
export function encodeSolution(path: number[], w: number): string {
  const dirs: number[] = [];
  for (let i = 1; i < path.length; i++) dirs.push(dirFromDelta(path[i] - path[i - 1], w));
  const bytes: number[] = [];
  for (let i = 0; i < dirs.length; i += 4) {
    let b = 0;
    for (let j = 0; j < 4 && i + j < dirs.length; j++) b |= dirs[i + j] << (6 - j * 2);
    bytes.push(b);
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return `${path[0]},${dirs.length},${btoa(bin)}`;
}

/** 解码解 → 拍平索引序列。 */
export function decodeSolution(s: string, w: number): number[] {
  const parts = s.split(',');
  const start = parseInt(parts[0], 10);
  const steps = parseInt(parts[1], 10);
  const bin = atob(parts[2]);
  const path: number[] = [start];
  let cur = start;
  for (let i = 0; i < steps; i++) {
    const b = bin.charCodeAt(Math.floor(i / 4));
    const d = (b >> (6 - (i % 4) * 2)) & 0b11;
    if (d === 0) cur -= w;
    else if (d === 1) cur += w;
    else if (d === 2) cur -= 1;
    else cur += 1;
    path.push(cur);
  }
  return path;
}

/** 网格合法性自查（生成后门禁用）。 */
export function sanityCheckGrid(grid: Uint8Array): boolean {
  for (const b of grid) {
    const type = cellType(b);
    if (type > MAX_CELL_TYPE) return false;
    if (type === CoverCell.ONEWAY && cellDir(b) > 3) return false;
    if (cellGroup(b) > 3) return false;
  }
  return true;
}

/** 关卡表条目（客户端版：不含解）。 */
export interface LevelEntry {
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** base64 编码的 grid。 */
  grid: string;
  /** 可走格数。 */
  required: number;
  /** 步数（恒为 required − 1，保留兼容）。 */
  shortest: number;
  /** 端点固定度 D。 */
  deadEnds: number;
  /** 分叉数。 */
  branches: number;
  /** 难度分 0..100。 */
  diff: number;
  /** 转弯数。 */
  turns: number;
  /** 最长强制走廊长度。 */
  corridor: number;
  /** 机制种类数。 */
  mechKinds: number;
  /** 解数分档（1..9，9 = ≥9）。 */
  solutionCount: number;
  /** 起点拍平索引（-1 = 自由）。 */
  startAt: number;
  /** 终点拍平索引（-1 = 自由）。 */
  endAt: number;
  /**
   * 通关该关发放的皮肤 id（null = 不发）。
   *
   * cover 关卡表**必须**带这个字段 ——
   * 否则 premium 三款（黄金/星尘/星河）在 cover 模式下永远拿不到。
   */
  unlockSkin: string | null;
}

/** 关卡表条目（服务端版：含解）。 */
export interface LevelEntryWithSolution extends LevelEntry {
  /** base64 方向序列编码的解。 */
  solution: string;
}

/** 关卡表。 */
export interface LevelTable {
  version: string;
  count: number;
  generatedAt: string;
  /** 内容哈希（SHA-256 前 12 位）——版本分流用。 */
  hash: string;
  levels: LevelEntryWithSolution[];
}
