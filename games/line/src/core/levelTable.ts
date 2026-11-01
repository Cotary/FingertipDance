import { encodeGrid, decodeGrid } from './codec';
import type { Level } from './types';

/** 关卡表（公开）。 */
export interface LevelTableFile {
  version: string;
  count: number;
  generatedAt: string;
  levels: SerializedLevel[];
}

/** 关卡表中每关的序列化形式。 */
export interface SerializedLevel {
  idx: number;
  seed: number;
  w: number;
  h: number;
  grid: string;
  shortest: number;
  turns: number;
  blocks: number;
  oneways: number;
  diff: number;
  unlockSkin: string | null;
}

/** 私密解法表。 */
export interface SolutionTableFile {
  version: string;
  levels: Array<{ idx: number; solution: number[]; solutionSteps: number; turns: number; diff: number }>;
}

/** 关卡数据（不含 unlockSkin，由调用方补充）。 */
export type LevelData = Omit<Level, 'unlockSkin'>;

/** 把关卡序列化为可 JSON 的对象。 */
export function serializeLevel(lv: LevelData, unlockSkin: string | null): SerializedLevel {
  return {
    idx: lv.idx, seed: lv.seed, w: lv.w, h: lv.h,
    grid: encodeGrid(lv.grid, lv.w, lv.h),
    shortest: lv.shortest, turns: lv.turns,
    blocks: lv.blocks, oneways: lv.oneways, diff: lv.diff,
    unlockSkin,
  };
}

/** 从序列化对象还原关卡。 */
export function deserializeLevel(s: SerializedLevel): Level {
  return {
    idx: s.idx, seed: s.seed, w: s.w, h: s.h,
    grid: decodeGrid(s.grid, s.w, s.h),
    shortest: s.shortest, turns: s.turns,
    blocks: s.blocks, oneways: s.oneways, diff: s.diff,
    unlockSkin: s.unlockSkin,
  };
}

/** 计算内容哈希（版本号），取 SHA-256 前 12 位十六进制。 */
export async function computeVersion(content: string): Promise<string> {
  // 浏览器环境
  if (typeof globalThis.crypto !== 'undefined' && 'subtle' in globalThis.crypto) {
    const subtle = globalThis.crypto.subtle as SubtleCrypto;
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(content));
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex.slice(0, 12)}`;
  }
  // Node 环境回退
  const { createHash } = await import('node:crypto');
  return `sha256:${createHash('sha256').update(content).digest('hex').slice(0, 12)}`;
}
