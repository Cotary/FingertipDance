/**
 * 二维码**解码器**（只用于测试）。
 *
 * ## 为什么测试里要写一个解码器
 *
 * 二维码是纯数据：画错了**不会报错**，只会「扫不出来」。
 * 而海报是离线生成的 —— 玩家扫不出码根本不会报错，
 * 只会觉得「这游戏的码是坏的」。
 *
 * 光断言「矩阵尺寸对、定位图形在位」不够：那些只验了外壳，
 * 里面编码的数据是错的一样能过。所以这里写一个**真解码器**，
 * 把码字从矩阵里读回来、做 RS 校验、反解位流，
 * 最后断言还原出的字符串**等于原串**。
 *
 * 这是**往返（round-trip）验证** —— 编码对了但解不出来，
 * 一样是坏的。
 *
 * ## 为什么不用现成的解码库
 *
 * 测试要跟着仓库走，不能引入新依赖。自己写一个刚好覆盖
 * 本编码器用到的子集（字节模式、M 级、版本 1..10）就够了。
 *
 * ## 表格从哪来
 *
 * 从 `src/core/qrTables.ts` import —— **和编码器同一份**。
 * 不然解码器验的是「另一套标准」，往返测试就白测了。
 */
import {
  EC_TABLE_M,
  EXP,
  gfMul,
  maskFn,
  reservedMap,
  utf8Decode,
} from '../src/core/qrTables';
import { encodeQr, type QrMatrix } from '../src/core/qr';

/** 读格式信息（从左上那 15 位），返回掩码 id。 */
function readMask(m: QrMatrix): number {
  const bits: number[] = [];
  // 左上：8 行 0..5 列 → 8,7 → 8,8 → 7,8 → 14-i,8 (i=9..14)
  for (let i = 0; i <= 5; i++) bits.push(m[8][i] ? 1 : 0);
  bits.push(m[8][7] ? 1 : 0);
  bits.push(m[8][8] ? 1 : 0);
  bits.push(m[7][8] ? 1 : 0);
  for (let i = 9; i < 15; i++) bits.push(m[14 - i][8] ? 1 : 0);

  // 格式信息的位序是「低位在前」
  let fmt = 0;
  for (let i = 0; i < 15; i++) fmt |= bits[i] << i;
  // 去掉异或掩码
  fmt ^= 0b101010000010010;
  // 高 5 位里，低 3 位是掩码 id
  return (fmt >>> 10) & 0b111;
}

/** 逆掩码（把矩阵还原成未掩码的位）。 */
function unmask(m: QrMatrix, reserved: boolean[][], mask: number): QrMatrix {
  const size = m.length;
  const out = m.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (maskFn(mask, r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

/** 按 Z 字形把数据位读出来。 */
function readDataBits(m: QrMatrix, reserved: boolean[][]): number[] {
  const size = m.length;
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const row = upward ? size - 1 - v : v;
      for (let k = 0; k < 2; k++) {
        const col = right - k;
        if (reserved[row][col]) continue;
        bits.push(m[row][col] ? 1 : 0);
      }
    }
    upward = !upward;
  }
  return bits;
}

/** 位 → 码字。 */
function bitsToCodewords(bits: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  return out;
}

/**
 * RS 校验：把纠错码字从数据里减掉。
 *
 * 返回空数组 = 校验没过（数据被破坏或编码就是错的）。
 *
 * 注意：这里**不做真正的纠错**（Berlekamp-Massey + Forney）——
 * 测试里的数据本来就不该有错，校验通过就说明编码是对的。
 */
function rsVerify(data: number[], ec: number[]): number[] {
  const ecLen = ec.length;
  const gen: number[] = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], EXP[i]);
    }
    gen.splice(0, gen.length, ...next);
  }
  const rem = new Array(ecLen).fill(0);
  for (const byte of [...data, ...ec]) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  if (rem.some((v) => v !== 0)) return [];
  return data;
}

/**
 * 解码二维码矩阵 → 原文。
 *
 * @returns 解出来的字符串；失败返回 null
 */
export function decodeQr(m: QrMatrix): string | null {
  const size = m.length;
  if ((size - 17) % 4 !== 0) return null;
  const version = (size - 17) / 4;
  if (version < 1 || version > 10) return null;

  const mask = readMask(m);
  const reserved = reservedMap(version);
  const plain = unmask(m, reserved, mask);

  const all = bitsToCodewords(readDataBits(plain, reserved));

  // 反交错：拆回块
  const spec = EC_TABLE_M[version - 1];

  // 块的长度：第一组的块短（每块 dataPerBlock），第二组的块长（每块 +1）
  const blockLens: number[] = [];
  for (const group of spec.groups) {
    for (let i = 0; i < group.count; i++) blockLens.push(group.dataPerBlock);
  }

  const blocks: number[][] = blockLens.map(() => []);
  const ecBlocks: number[][] = blockLens.map(() => []);

  let idx = 0;
  // 数据码字：逐列取各块的第 i 个（短块列数少，自然先取完）
  const maxData = Math.max(...blockLens);
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < blockLens.length; b++) {
      if (i < blockLens[b]) blocks[b].push(all[idx++]);
    }
  }
  // 纠错码字：同样逐列取
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < blockLens.length; b++) ecBlocks[b].push(all[idx++]);
  }

  // 每块做 RS 校验并取回数据
  const data: number[] = [];
  for (let b = 0; b < blockLens.length; b++) {
    const ok = rsVerify(blocks[b], ecBlocks[b]);
    if (ok.length === 0) return null;
    data.push(...ok);
  }

  // 反解位流
  const bits: number[] = [];
  for (const cw of data) {
    for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  }
  let p = 0;
  const take = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (bits[p++] ?? 0);
    return v;
  };

  const mode = take(4);
  if (mode !== 0b0100) return null; // 只支持字节模式
  const countBits = version <= 9 ? 8 : 16;
  const len = take(countBits);

  const bytes: number[] = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));

  return utf8Decode(bytes);
}

/**
 * 编 → 解 的往返。
 */
export function roundTrip(text: string): string | null {
  const m = encodeQr(text);
  if (!m) return null;
  return decodeQr(m);
}
