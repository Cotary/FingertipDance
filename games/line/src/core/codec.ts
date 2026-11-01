import { CellType, Dir, type Cell } from './types';
import { flatten, unflatten } from './grid';

/**
 * 把二维网格编码成 base64。
 * 每格 1 字节：bit7 = 是否单向块，bit6..4 = 方向，bit3..1 = 类型，bit0 = 保留位。
 * 只有 ONEWAY 存真实方向，其余类型方向一律归零。
 */
export function encodeGrid(grid: Cell[][], w: number, h: number): string {
  const flat = flatten(grid);
  if (flat.length !== w * h) {
    throw new Error(`encodeGrid: 期望 ${w * h} 格，实际 ${flat.length}`);
  }
  const bytes = new Uint8Array(flat.length);
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i];
    const isOneWay = c.type === CellType.ONEWAY ? 1 : 0;
    const dir = isOneWay ? (c.dir & 0b111) : 0;
    bytes[i] = (isOneWay << 7) | (dir << 4) | ((c.type & 0b111) << 1);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // 浏览器与 Node 都能用
  const btoaFn = typeof btoa === 'function' ? btoa : (s: string) => Buffer.from(s, 'binary').toString('base64');
  return btoaFn(bin);
}

/** 解码 base64 网格为二维 grid[y][x]。 */
export function decodeGrid(b64: string, w: number, h: number): Cell[][] {
  const atobFn = typeof atob === 'function'
    ? atob
    : (s: string) => Buffer.from(s, 'base64').toString('binary');
  const bin = atobFn(b64);
  if (bin.length !== w * h) {
    throw new Error(`decodeGrid: 期望 ${w * h} 字节，实际 ${bin.length}`);
  }
  const flat: Cell[] = [];
  for (let i = 0; i < bin.length; i++) {
    const byte = bin.charCodeAt(i);
    const isOneWay = (byte >> 7) & 1;
    const dir = ((byte >> 4) & 0b111) as Dir;
    const type = ((byte >> 1) & 0b111) as CellType;
    flat.push({ type: isOneWay ? CellType.ONEWAY : type, dir });
  }
  return unflatten(flat, w, h);
}
