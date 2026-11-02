/**
 * cover 关卡表的序列化。
 *
 * grid 编码：每格 1 字节 = (type << 4) | (dir << 2) | group（§8.1）。
 * 参考解编码：起点索引 + 每步方向 2 bit 打包（§5.1）——80 步 20 字节级，
 * 换来 O(1) 提示与免搜索服务端校验。
 */
import { CoverCell } from './generate';

/** grid 拍平数组 → base64（每格 1 字节）。 */
export function encodeCoverGrid(grid: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < grid.length; i++) bin += String.fromCharCode(grid[i]);
  return btoa(bin);
}

/** base64 → grid 拍平数组。 */
export function decodeCoverGrid(b64: string, len: number): Uint8Array {
  const bin = atob(b64);
  if (bin.length !== len) throw new Error(`decodeCoverGrid: 期望 ${len} 字节，实际 ${bin.length}`);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 方向编码：0=上 1=下 2=左 3=右。 */
function dirOf(delta: number, w: number): number {
  if (delta === -w) return 0;
  if (delta === w) return 1;
  if (delta === -1) return 2;
  if (delta === 1) return 3;
  throw new Error(`dirOf: 非法步长 ${delta}`);
}

/** 参考解 → "起点,步数,base64(方向序列)"。步数显式存储，避免字节打包的尾随填充。 */
export function encodeSolution(path: number[], w: number): string {
  const dirs: number[] = [];
  for (let i = 1; i < path.length; i++) dirs.push(dirOf(path[i] - path[i - 1], w));
  const bytes: number[] = [];
  for (let i = 0; i < dirs.length; i += 4) {
    let b = 0;
    for (let j = 0; j < 4 && i + j < dirs.length; j++) b |= dirs[i + j] << (6 - j * 2);
    bytes.push(b);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${path[0]},${dirs.length},${btoa(bin)}`;
}

/** 解码参考解 → 拍平索引序列。 */
export function decodeSolution(s: string, w: number): number[] {
  const parts = s.split(',');
  const start = parseInt(parts[0], 10);
  const steps = parseInt(parts[1], 10);
  const bin = atob(parts[2]);
  const dirs: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    for (let j = 0; j < 4; j++) dirs.push((b >> (6 - j * 2)) & 0b11);
  }
  const path: number[] = [start];
  let cur = start;
  for (let i = 0; i < steps; i++) {
    const d = dirs[i];
    if (d === 0) cur -= w;
    else if (d === 1) cur += w;
    else if (d === 2) cur -= 1;
    else cur += 1;
    path.push(cur);
  }
  return path;
}

/** 关卡表的序列化条目。 */
export interface CoverLevelSerialized {
  idx: number;
  seed: number;
  w: number;
  h: number;
  grid: string;
  required: number;
  shortest: number;
  deadEnds: number;
  branches: number;
  diff: number;
  solution: string;
}

export interface CoverLevelTable {
  version: string;
  count: number;
  generatedAt: string;
  levels: CoverLevelSerialized[];
}

/** 网格合法性自查（生成后门禁用）：逐格解码类型值域。 */
export function sanityCheckGrid(grid: Uint8Array): boolean {
  for (const b of grid) {
    const type = b >> 4;
    if (type > CoverCell.ICE) return false;
  }
  return true;
}
