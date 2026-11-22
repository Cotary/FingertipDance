/**
 * 二维码编码（QR Code Model 2，字节模式，纠错等级 M）�?
 *
 * ## 为什么自己写而不是引一个库
 *
 * 服务端接 `wxacode.getUnlimited` 需�?access_token + 小程序已发布�?
 * 抖音还得另接一套；引离线库则要多一个依赖（�?15KB）�?
 *
 * 自己写的好处是：**两端通用、不依赖平台、不依赖网络** —�?
 * 海报是离线生成的（分享时可能断网），二维码不能依赖网络才能画出来�?
 *
 * ## 这个实现支持什�?
 *
 * - **字节模式**（UTF-8）：分享链接带中文昵称时也能编码
 * - **纠错等级 M**（约 15%）：够用，且容错率比 L �?
 * - **版本自动选择**�?..10）：够放�?200 字节的链�?
 *
 * ## 不支持什么（知道了才不会用错�?
 *
 * - 纠错等级不能选（固定 M�?
 * - 版本超过 10 返回 null（链接不该长到那种程度）
 * - 没有 ECI 声明 —�?中文�?UTF-8 字节模式�?
 *   主流扫码器（含微信）都能认，但理论上不是最标准的中�?QR
 *
 * ## 参�?
 *
 * ISO/IEC 18004。数据编码、纠错、模块布置三段都按标准写�?
 *
 * 表格与底层运算在 `qrTables.ts` —�?编码器和测试里的解码器共用同一份，
 * 不然往返测试验的就不是同一套标准了�?
 */
import {
  ALIGN_POS,
  EC_FORMAT_BITS,
  EC_M,
  EC_TABLE_M,
  EXP,
  bitAt,
  formatBits,
  gfMul,
  maskFn,
  reservedMap,
  utf8Bytes,
} from './qrTables';

// ────────────────────────────── 数据编码 ──────────────────────────────

/** 字节数组 �?数据码字（带模式指示符、长度、填充）�?*/
function buildDataCodewords(bytes: number[], version: number): number[] {
  const spec = EC_TABLE_M[version - 1];
  const totalData = spec.totalData;

  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  // 模式指示符：字节模式 = 0100
  push(0b0100, 4);
  // 字符计数指示符：版本 1..9 �?8 位，10..26 �?16 �?
  const countBits = version <= 9 ? 8 : 16;
  push(bytes.length, countBits);

  for (const b of bytes) push(b, 8);

  // 终止符：最�?4 �?0
  const cap = totalData * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);

  // 补齐到字节边�?
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }

  // 交替填充码字 0xEC / 0x11
  const PAD = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalData) {
    codewords.push(PAD[p++ % 2]);
  }
  return codewords;
}

/**
 * 按标准把数据码字**分块**�?
 *
 * ## 为什么要分组
 *
 * 标准里的分组是「第一组块短、第二组块长」：
 * 版本 8-M �?`2×38 + 2×39` —�?前两�?38 个数据码字，
 * 后两�?39 个�?*短块在前**�?
 *
 * 分错顺序的话，画出来的码扫出来是乱码，而且不报错�?
 */
function splitBlocks(data: number[], version: number): number[][] {
  const spec = EC_TABLE_M[version - 1];
  const blocks: number[][] = [];
  let offset = 0;
  for (const group of spec.groups) {
    for (let i = 0; i < group.count; i++) {
      blocks.push(data.slice(offset, offset + group.dataPerBlock));
      offset += group.dataPerBlock;
    }
  }
  return blocks;
}

/**
 * 把数据码�?+ 纠错码字**交错**成放进矩阵的序列�?
 *
 * ## 标准怎么交错�?
 *
 * 码字是分块存的（版本 6-M �?4 块），但矩阵里码字是**按列**排的�?
 * 先把�?1 列的各块码字依次放进矩阵，再放第 2 列…�?
 *
 * 关键细节�?*短块在前**。标准把块分成两�?
 * （第一组每块少 1 个数据码字），交错时第一组先走�?
 * 版本 8-M 就是 `2×38 + 2×39` —�?两个 38 的块先交，然后两�?39 的块�?
 *
 * 不交错的话（把块首尾相接直接放进去），单块版本碰巧也对，
 * 多块版本�?*扫不出内�?* —�?结构合法，不报错�?
 */
function interleaveCodewords(data: number[], version: number): number[] {
  const spec = EC_TABLE_M[version - 1];
  const blocks = splitBlocks(data, version);
  const ecBlocks = blocks.map((b) => reedSolomonEncode(b, spec.ecPerBlock));

  const out: number[] = [];

  // 数据码字：逐列取各块的�?i 个（短块的列先取完，短块列数少）
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }

  // 纠错码字：同样逐列�?
  const maxEc = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEc; i++) {
    for (const b of ecBlocks) if (i < b.length) out.push(b[i]);
  }

  return out;
}

/** RS 编码：生�?`ecLen` 个纠错码字�?*/
function reedSolomonEncode(data: number[], ecLen: number): number[] {
  // 生成器多项式 (x - α^0)(x - α^1)...(x - α^(ecLen-1))
  const gen: number[] = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], EXP[i]);
    }
    gen.splice(0, gen.length, ...next);
  }

  // 多项式除法求余数
  const rem = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// ────────────────────────────── 矩阵 ──────────────────────────────

/** 矩阵里的模块：true = 深色�?*/
export type QrMatrix = boolean[][];

/** 建一张空矩阵�?*/
function newMatrix(size: number): QrMatrix {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

/** 置位（越界就忽略 —�?布局算法保证不会越界）�?*/
function set(m: QrMatrix, r: number, c: number, dark: boolean): void {
  if (r < 0 || c < 0 || r >= m.length || c >= m.length) return;
  m[r][c] = dark;
}

/** 画功能图形（定位、校正、定时、固定的暗模块）�?*/
function drawFunctionPatterns(m: QrMatrix, version: number): void {
  const size = m.length;

  // 定位图形（三个角�?
  const drawFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        m[rr][cc] = inRing || inCore;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 定时图形（黑白交替）
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    set(m, 6, i, dark);
    set(m, i, 6, dark);
  }

  // 校正图形（版�?2 起）
  for (const r of ALIGN_POS[version - 1]) {
    for (const c of ALIGN_POS[version - 1]) {
      // 跳过与定位图形重叠的三个�?
      const nearFinder =
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          set(m, r + dr, c + dc, dark);
        }
      }
    }
  }

  // 固定的暗模块
  set(m, size - 8, 8, true);
}

/**
 * 放数据位（Z 字形填充，从右下角开始）�?
 *
 * 两条列一组，从右往左走；每组内上下交替�?
 * 跳过功能图形占用的位置�?
 */
function placeData(m: QrMatrix, reserved: boolean[][], bits: number[]): void {
  const size = m.length;
  let bitIdx = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    // �?6 列是定时图形，整列跳过（这时只走左边那一列）
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const row = upward ? size - 1 - v : v;
      for (let k = 0; k < 2; k++) {
        const col = right - k;
        if (reserved[row][col]) continue;
        const bit = bitIdx < bits.length ? bits[bitIdx] : 0;
        bitIdx++;
        set(m, row, col, bit === 1);
      }
    }
    upward = !upward;
  }
}

/** 放格式信息（带掩�?id）�?*/
function placeFormatInfo(m: QrMatrix, mask: number): void {
  const size = m.length;
  const data = (EC_FORMAT_BITS[EC_M] << 3) | mask;
  const fmt = formatBits(data);

  // 左上
  for (let i = 0; i <= 5; i++) set(m, 8, i, bitAt(fmt, i));
  set(m, 8, 7, bitAt(fmt, 6));
  set(m, 8, 8, bitAt(fmt, 7));
  set(m, 7, 8, bitAt(fmt, 8));
  for (let i = 9; i < 15; i++) set(m, 14 - i, 8, bitAt(fmt, i));

  // 右上 + 左下（第二份�?
  for (let i = 0; i < 8; i++) set(m, 8, size - 1 - i, bitAt(fmt, i));
  for (let i = 8; i < 15; i++) set(m, size - 15 + i, 8, bitAt(fmt, i));
  set(m, size - 8, 8, true);
}

/** 放版本信息（版本 7 起）�?*/
function placeVersionInfo(m: QrMatrix, version: number): void {
  if (version < 7) return;
  const size = m.length;
  let d = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (d & (1 << (i + 12))) d ^= 0b1111100100101 << i;
  }
  const v = (version << 12) | d;
  for (let i = 0; i < 18; i++) {
    const bit = bitAt(v, i);
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    set(m, a, b, bit);
    set(m, b, a, bit);
  }
}

/** 把码字摊成位（MSB 在前）�?*/
function codewordsToBits(codewords: number[]): number[] {
  const bits: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  }
  return bits;
}

/**
 * 生成二维码矩阵�?
 *
 * @param text 要编码的文本
 * @returns 矩阵（`true` = 深色）；版本超过 10 返回 null
 */
export function encodeQr(text: string): QrMatrix | null {
  const bytes = utf8Bytes(text);

  // ── 选版本（1..10，M 级）──
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const capacity = EC_TABLE_M[v - 1].totalData;
    // 4 位模�?+ 8/16 位长�?+ 数据
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= capacity * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) return null; // 太长

  // ── 数据码字 + 纠错码字�?*都要交错**）──
  //
  // 数据码字按块交错（短块在前），纠错码字也按块交错 —�?
  // 放进矩阵的是这两个交错后的序列，不是原始的块顺序�?
  const data = buildDataCodewords(bytes, version);
  const all = interleaveCodewords(data, version);

  // ── 放数�?──
  const reserved = reservedMap(version);
  const m = newMatrix(version * 4 + 17);
  drawFunctionPatterns(m, version);
  placeData(m, reserved, codewordsToBits(all));

  // ── 选掩码（8 种里挑惩罚分最低的）──
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const test = m.map((row) => row.slice());
    applyMask(test, reserved, mask);
    placeFormatInfo(test, mask);
    placeVersionInfo(test, version);
    const p = penalty(test);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
    }
  }

  applyMask(m, reserved, bestMask);
  placeFormatInfo(m, bestMask);
  placeVersionInfo(m, version);

  return m;
}

/** 对数据区应用掩码�?*/
function applyMask(m: QrMatrix, reserved: boolean[][], mask: number): void {
  const size = m.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (maskFn(mask, r, c)) m[r][c] = !m[r][c];
    }
  }
}

/** 罚分（选掩码用）�?*/
function penalty(m: QrMatrix): number {
  const size = m.length;
  let p = 0;

  // 规则 1：同色连�?�?5 的行/列，�?5 格加 3 �?
  const runScore = (getter: (i: number) => boolean) => {
    let run = 1;
    let s = 0;
    for (let i = 1; i < size; i++) {
      if (getter(i) === getter(i - 1)) {
        run++;
        if (run === 5) s += 3;
        else if (run > 5) s += 1;
      } else {
        run = 1;
      }
    }
    return s;
  };
  for (let r = 0; r < size; r++) p += runScore((c) => m[r][c]);
  for (let c = 0; c < size; c++) p += runScore((r) => m[r][c]);

  // 规则 2�?×2 同色块，每块�?3 �?
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }

  // 规则 3：形似定位图形的 1:1:3:1:1 模式，每处加 40 �?
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  const check = (getter: (i: number) => boolean) => {
    let s = 0;
    for (let i = 0; i + 11 <= size; i++) {
      let m1 = true;
      let m2 = true;
      for (let j = 0; j < 11; j++) {
        if (getter(i + j) !== pat1[j]) m1 = false;
        if (getter(i + j) !== pat2[j]) m2 = false;
      }
      if (m1) s += 40;
      if (m2) s += 40;
    }
    return s;
  };
  for (let r = 0; r < size; r++) p += check((c) => m[r][c]);
  for (let c = 0; c < size; c++) p += check((r) => m[r][c]);

  // 规则 4：深色比例偏�?50% 的惩�?
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const ratio = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return p;
}
