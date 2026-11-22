import { describe, it, expect } from 'vitest';
import { encodeQr } from '../src/core/qr';
import { FORMAT_INFO_TABLE, formatBits } from '../src/core/qrTables';
import { roundTrip } from './qrDecoder';

/**
 * 二维码编码器。
 *
 * ## 为什么必须测
 *
 * 二维码是**纯数据** —— 画错了不会报错，只会「扫不出来」。
 * 而海报是离线生成的，扫不出码玩家根本不会发现，
 * 只会觉得「这游戏的小程序码是坏的」。
 *
 * 所以这里对**结构**做硬断言：尺寸、定位图形、格式信息、
 * 以及「同一输入必得同一输出」。
 */

/** 取出矩阵的行列数。 */
function size(m: boolean[][]): number {
  return m.length;
}

/**
 * 定位图形的一行长这样：`#######` / `#.....#` / `#.###.#` / `#.###.#` / `#.###.#` / `#.....#` / `#######`
 *
 * 这里检查**第 0 行**：7 个深色 + 中间 1 个浅色（列 7 是分隔符）。
 */
function finderOk(m: boolean[][], row: number, col: number): boolean {
  for (let i = 0; i < 7; i++) if (m[row][col + i] !== true) return false;
  // 第 7 列是分隔符（浅色）—— 但右上 / 左下的分隔符方向不同，
  // 所以只断言「不越界」。
  return true;
}

describe('encodeQr：结构正确性', () => {
  it('生成的是正方形矩阵', () => {
    const m = encodeQr('https://game.example.com/line')!;
    expect(m).not.toBeNull();
    expect(size(m)).toBe(m.length);
    for (const row of m) expect(row.length).toBe(m.length);
  });

  it('尺寸 = 版本 × 4 + 17（短链接落在版本 3 附近）', () => {
    const m = encodeQr('https://game.example.com/line')!;
    const n = m.length;
    // 版本 1..10 对应 21..57 的尺寸，且必须是 4k+17
    expect((n - 17) % 4).toBe(0);
    expect(n).toBeGreaterThanOrEqual(21);
    expect(n).toBeLessThanOrEqual(57);
  });

  it('三个角上的定位图形都在位', () => {
    const m = encodeQr('https://game.example.com/line')!;
    const n = m.length;
    // 左上
    expect(finderOk(m, 0, 0)).toBe(true);
    // 右上
    expect(finderOk(m, 0, n - 7)).toBe(true);
    // 左下
    expect(finderOk(m, n - 7, 0)).toBe(true);
  });

  it('定位图形的中心是深色、外环是深色、间隔是浅色', () => {
    const m = encodeQr('hello')!;
    // 左上定位图形：7×7，环深、间隔浅、3×3 核心深
    expect(m[0][0]).toBe(true);
    expect(m[1][1]).toBe(false);
    expect(m[3][3]).toBe(true);
    expect(m[0][6]).toBe(true);
    expect(m[6][0]).toBe(true);
  });

  it('固定的暗模块在位（左下角那格永远深色）', () => {
    const m = encodeQr('hello')!;
    const n = m.length;
    expect(m[n - 8][8]).toBe(true);
  });

  it('定时图形是黑白交替', () => {
    const m = encodeQr('hello')!;
    // 第 6 行：从第 8 列开始交替
    expect(m[6][8]).toBe(true);
    expect(m[6][9]).toBe(false);
    expect(m[6][10]).toBe(true);
  });

  it('分隔符是浅色（定位图形外圈那圈留白）', () => {
    const m = encodeQr('hello')!;
    const n = m.length;
    expect(m[7][0]).toBe(false);
    expect(m[0][7]).toBe(false);
    expect(m[7][n - 8]).toBe(false);
    expect(m[n - 8][7]).toBe(false);
  });
});

describe('encodeQr：确定性', () => {
  it('同一输入必得同一输出（掩码选择稳定）', () => {
    const a = encodeQr('https://game.example.com/line?l=47')!;
    const b = encodeQr('https://game.example.com/line?l=47')!;
    expect(a).toEqual(b);
  });

  it('不同输入得出不同矩阵', () => {
    const a = encodeQr('https://game.example.com/line?l=47')!;
    const b = encodeQr('https://game.example.com/line?l=48')!;
    expect(a).not.toEqual(b);
  });
});

describe('encodeQr：容量与边界', () => {
  it('空串也能编（扫出来是空内容，不是坏码）', () => {
    const m = encodeQr('');
    expect(m).not.toBeNull();
    expect(m!.length).toBeGreaterThan(0);
  });

  it('超长内容返回 null（而不是画一个坏码）', () => {
    // 版本 10 / M 级最多约 213 字节，这里给 500
    const m = encodeQr('x'.repeat(500));
    expect(m).toBeNull();
  });

  it('接近上限的链接仍能编（分享链接的常见长度）', () => {
    const m = encodeQr(`https://game.example.com/line?l=1000&u=${'9'.repeat(80)}`);
    expect(m).not.toBeNull();
  });

  it('中文能编（UTF-8 字节模式）', () => {
    const m = encodeQr('挑战第47关');
    expect(m).not.toBeNull();
    // 「挑战第47关」是 6 个字符 = 15 字节（UTF-8）→ 版本 1（21 模块）
    expect(m!.length).toBe(21);
  });

  it('中文比同样字符数的英文占更多模块（UTF-8 多字节）', () => {
    // 版本 1 / M 级最多 14 字节内容（16 数据码字 - 4 位模式 - 8 位长度）。
    // 英文 12 字符 = 12 字节 → 版本 1；
    // 中文 12 字 = 36 字节 → 版本 3（容量 44 字节）
    const en = encodeQr('A'.repeat(12))!;
    const cn = encodeQr('挑'.repeat(12))!;
    expect(en.length).toBe(21); // 版本 1
    expect(cn.length).toBeGreaterThan(en.length);
  });

  it('版本边界：14 字节进版本 1，15 字节进版本 2', () => {
    // 版本 1 / M 级：16 个数据码字 = 128 位
    // 扣掉 4 位模式 + 8 位长度 = 12 位，剩 116 位 = 14.5 字节 → 14 字节是上限
    expect(encodeQr('A'.repeat(14))!.length).toBe(21);
    // 15 字节 → 4 + 8 + 120 = 132 位 > 128 位 → 版本 2
    expect(encodeQr('A'.repeat(15))!.length).toBe(25);
  });
});

describe('encodeQr：往返（编 → 解 → 原串）', () => {
  // 这是**最强**的一条：结构断言只验外壳，
  // 数据编码错了照样能过。往返才能证明「扫出来就是原文」。

  it('典型分享链接能原样解回来', () => {
    const url = 'https://game.example.com/line?l=47';
    expect(roundTrip(url)).toBe(url);
  });

  it('带多个查询参数的链接', () => {
    const url = 'https://game.example.com/line?l=1000&u=333&t=1700000000';
    expect(roundTrip(url)).toBe(url);
  });

  it('中文能原样解回来', () => {
    const text = '挑战第47关';
    expect(roundTrip(text)).toBe(text);
  });

  it('中英混排（含 emoji）', () => {
    const text = '挑战第47关 🎮 come on!';
    expect(roundTrip(text)).toBe(text);
  });

  it('空串能原样解回来', () => {
    expect(roundTrip('')).toBe('');
  });

  it('不同长度都过（覆盖多个版本）', () => {
    for (const n of [1, 5, 17, 18, 40, 80, 120, 200]) {
      const text = 'A'.repeat(n);
      expect(roundTrip(text)).toBe(text);
    }
  });

  it('多字节字符在每个版本边界上都过', () => {
    // 中文 3 字节/字，跨版本时反交错 / 分块逻辑最容易出错
    for (const n of [5, 6, 10, 15, 20, 40]) {
      const text = '挑'.repeat(n);
      expect(roundTrip(text)).toBe(text);
    }
  });

  it('二进制安全的字符（URL 里的特殊字符）', () => {
    const text = 'https://game.example.com/line?a=1&b=%20%26#frag';
    expect(roundTrip(text)).toBe(text);
  });
});

describe('格式信息：与标准表一致', () => {
  // 格式信息算错了，扫码器读不出纠错等级和掩码 —— **直接扫不出来**。
  // 所以这里拿标准的 32 个值当基准，逐个对。

  it('自己算出来的格式信息 == 标准表（全部 32 个）', () => {
    // 等级位：L=01, M=00, Q=11, H=10（标准表 12）
    const levelBits = [0b01, 0b00, 0b11, 0b10];
    for (let mask = 0; mask < 8; mask++) {
      for (let level = 0; level < 4; level++) {
        const data = (levelBits[level] << 3) | mask;
        expect(formatBits(data)).toBe(FORMAT_INFO_TABLE[mask][level]);
      }
    }
  });

  it('M 级（我们用的那档）的 8 个值与标准一致', () => {
    // M = levelBits[1] = 00
    const expected = [
      0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
      0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
    ];
    for (let mask = 0; mask < 8; mask++) {
      expect(formatBits((0b00 << 3) | mask)).toBe(expected[mask]);
    }
  });
});
