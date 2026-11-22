/**
 * 二维码的标准表格与底层运算。
 *
 * ## 为什么单独抽出来
 *
 * 编码器（`qr.ts`）和测试里的解码器（`test/qrDecoder.ts`）必须用
 * **同一份**表格与运算 —— 不然解码器验的是「另一套标准」，
 * 往返测试就白测了。
 *
 * 只在测试里用到的部分不往这里放（解码器的位流处理留在测试里）。
 */

/**
 * GF(2^8) 指数表。
 *
 * `EXP[a] = 2^a mod 256`，`LOG[a]` 是它的对数（`LOG[0]` 不用）。
 *
 * 模数 256 的本原多项式是 0x11D（285）—— QR 标准规定的。
 */
export const EXP = new Uint8Array(512);
export const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // 溢出时异或本原多项式（0x11D），把 9 位截回 8 位
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

/** GF(2^8) 乘法。 */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/**
 * 一个纠错分组。
 *
 * 标准里的分组是这样：**第一组块短，第二组块长**。
 * 交错的顺序也是按这个来的（先短后长）。
 */
export interface QrBlockGroup {
  /** 该组有几块。 */
  count: number;
  /** 该组每块有多少数据码字（纠错前）。 */
  dataPerBlock: number;
}

/**
 * 一个版本 + 纠错等级的结构。
 */
export interface QrVersionSpec {
  /** 数据码字总数（纠错前，所有块加起来）。 */
  totalData: number;
  /** 每块的纠错码字数（所有块一样）。 */
  ecPerBlock: number;
  /** 分组：第一组是短块，第二组是长块（没有第二组时省略）。 */
  groups: QrBlockGroup[];
}

/**
 * **M 级**（纠错率约 15%）的版本结构。
 *
 * ## 这张表曾经写错过
 *
 * 原来填的是 **L 级**的数字（19 / 34 / 55 / 80 …）——
 * 看起来很像，但 L 级的纠错码字更少、容量更大。
 * 用 L 级的容量去做 M 级的编码，画出来的码**结构完全合法**，
 * 却**扫不出正确内容**（纠错码字对不上）。
 *
 * 这种错**不会报错**，只能靠往返测试发现 —— 所以这里每行都标了
 * 「总数 = 数据 + 块数 × 每块纠错」的自检。
 *
 * ## 自检（ISO/IEC 18004 表 13-22）
 *
 * | 版本 | 总码字 | 数据 | 纠错 | 分组 |
 * |---|---|---|---|---|
 * | 1  | 26  | 16  | 10 | 1×16 |
 * | 2  | 44  | 28  | 16 | 1×28 |
 * | 3  | 70  | 44  | 26 | 1×44 |
 * | 4  | 100 | 64  | 18 | 2×32 |
 * | 5  | 134 | 86  | 24 | 2×43 |
 * | 6  | 172 | 108 | 16 | 4×27 |
 * | 7  | 196 | 124 | 18 | 4×31 |
 * | 8  | 242 | 154 | 22 | 2×38 + 2×39 |
 * | 9  | 292 | 182 | 22 | 3×36 + 2×37 |
 * | 10 | 346 | 216 | 26 | 4×43 + 1×44 |
 */
export const EC_TABLE_M: QrVersionSpec[] = [
  { totalData: 16, ecPerBlock: 10, groups: [{ count: 1, dataPerBlock: 16 }] },
  { totalData: 28, ecPerBlock: 16, groups: [{ count: 1, dataPerBlock: 28 }] },
  { totalData: 44, ecPerBlock: 26, groups: [{ count: 1, dataPerBlock: 44 }] },
  { totalData: 64, ecPerBlock: 18, groups: [{ count: 2, dataPerBlock: 32 }] },
  { totalData: 86, ecPerBlock: 24, groups: [{ count: 2, dataPerBlock: 43 }] },
  { totalData: 108, ecPerBlock: 16, groups: [{ count: 4, dataPerBlock: 27 }] },
  { totalData: 124, ecPerBlock: 18, groups: [{ count: 4, dataPerBlock: 31 }] },
  { totalData: 154, ecPerBlock: 22, groups: [{ count: 2, dataPerBlock: 38 }, { count: 2, dataPerBlock: 39 }] },
  { totalData: 182, ecPerBlock: 22, groups: [{ count: 3, dataPerBlock: 36 }, { count: 2, dataPerBlock: 37 }] },
  { totalData: 216, ecPerBlock: 26, groups: [{ count: 4, dataPerBlock: 43 }, { count: 1, dataPerBlock: 44 }] },
];

/** 版本 → 总码字数（数据 + 纠错）。索引 `[版本 - 1]`。 */
export const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** 版本 → 对齐图形中心坐标。索引 `[版本 - 1]`。 */
export const ALIGN_POS: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/**
 * 纠错等级索引：L=0, M=1, Q=2, H=3。
 */
export const EC_M = 1;

/**
 * 格式信息（15 位）里该纠错等级对应的两位。
 *
 * 注意这个编码是**反直觉**的（标准表 12）：
 * L = 01，M = 00，Q = 11，H = 10。
 */
export const EC_FORMAT_BITS: Record<number, number> = { 0: 1, 1: 0, 2: 3, 3: 2 };

/**
 * 标准的 32 个格式信息值（表 13）。
 *
 * 索引 `[掩码][纠错等级]`（等级顺序 L / M / Q / H）。
 *
 * 这张表**直接抄自标准**，不是算出来的 —— 它的作用是当**基准**：
 * 编码器自己算出来的值必须与这张表一致，否则格式信息就是错的，
 * 扫码器读不出纠错等级和掩码。
 */
export const FORMAT_INFO_TABLE: number[][] = [
  [0b111011111000100, 0b101010000010010, 0b011010101011111, 0b001011010001001],
  [0b111001011110011, 0b101000100100101, 0b011000001101000, 0b001001110111110],
  [0b111110110101010, 0b101111001111100, 0b011111100110001, 0b001110011100111],
  [0b111100010011101, 0b101101101001011, 0b011101000000110, 0b001100111010000],
  [0b110011000101111, 0b100010111111001, 0b010010010110100, 0b000011101100010],
  [0b110001100011000, 0b100000011001110, 0b010000110000011, 0b000001001010101],
  [0b110110001000001, 0b100111110010111, 0b010111011011010, 0b000110100001100],
  [0b110100101110110, 0b100101010100000, 0b010101111101101, 0b000100000111011],
];

/**
 * 8 种掩码的判定函数。
 *
 * 掩码 id 与矩阵坐标的对应关系（ISO/IEC 18004 表 10.1）。
 */
export function maskFn(id: number, r: number, c: number): boolean {
  switch (id) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

/** 15 位格式信息（含 BCH(15,5) 纠错与异或掩码）。 */
export function formatBits(data: number): number {
  let d = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (d & (1 << (i + 10))) d ^= 0b10100110111 << i;
  }
  return ((data << 10) | d) ^ 0b101010000010010;
}

/** 取整数的第 i 位（从 0 起，最低位是 0）。 */
export function bitAt(v: number, i: number): boolean {
  return ((v >>> i) & 1) === 1;
}

/** UTF-8 编码（不依赖 TextEncoder —— 老基础库可能没有）。 */
export function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

/** UTF-8 字节 → 字符串。 */
export function utf8Decode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/**
 * 标记功能图形占用的位置。
 *
 * 编码（放数据）与解码（读数据）都要跳过这些格子。
 */
export function reservedMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    reserved[r][c] = true;
  };

  // 定位图形 + 分隔符（三个角各 8×8）
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      mark(i, j);
      mark(i, size - 1 - j);
      mark(size - 1 - j, i);
    }
  }
  // 定时图形
  for (let i = 8; i < size - 8; i++) {
    mark(6, i);
    mark(i, 6);
  }
  // 格式信息区（15 位 × 2 份）
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  // 版本信息区（版本 7 起）
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j);
        mark(size - 11 + j, i);
      }
    }
  }
  // 校正图形区域
  for (const r of ALIGN_POS[version - 1]) {
    for (const c of ALIGN_POS[version - 1]) {
      const nearFinder =
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
      }
    }
  }
  return reserved;
}
