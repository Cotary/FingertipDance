/** 种子化随机数发生器。所有生成逻辑必须使用它，禁止 Math.random。 */
export interface Rng {
  /** 返回 [0, 1) 的浮点数。 */
  next(): number;
  /** 返回 [minInclusive, maxExclusive) 的整数。 */
  int(minInclusive: number, maxExclusive: number): number;
  /** 从数组中随机取一个元素（数组不能为空）。 */
  pick<T>(arr: readonly T[]): T;
  /** 返回打乱后的新数组（不修改入参）。 */
  shuffle<T>(arr: readonly T[]): T[];
  /** 以概率 p 返回 true。 */
  chance(p: number): boolean;
}

/** mulberry32：32 位种子、快速、分布均匀，适合关卡生成。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => {
    if (max <= min) throw new Error(`int: max(${max}) 必须 > min(${min})`);
    return min + Math.floor(next() * (max - min));
  };
  return {
    next,
    int,
    pick: <T,>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick: 数组为空');
      return arr[int(0, arr.length)];
    },
    shuffle: <T,>(arr: readonly T[]): T[] => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance: (p: number): boolean => next() < p,
  };
}

/** FNV-1a 32 位字符串哈希，用于把 seed 字符串转成数字种子。 */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由全局种子和关号派生每关独立种子，保证关卡之间互不相关。 */
export function levelSeed(globalSeed: number, idx: number): number {
  return hashSeed(`${globalSeed}:${idx}`);
}
