/** 单调插值。 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** 缓入缓出，让段内曲线不平直。 */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
/** 把值钳制到 [0,1]。 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 一段难度配置。 */
interface Segment {
  /** 该段起始关号（含） */
  from: number;
  /** 该段结束关号（含） */
  to: number;
  /** 段内起始尺寸 */
  w: number; h: number;
  /** 段内结束尺寸 */
  w2: number; h2: number;
  /** 阻挡块数量区间 */
  blocks: [number, number];
  /** 单向块数量区间 */
  oneways: [number, number];
  /** 最少转弯数 */
  minTurns: number;
  /** 开放面积比下限 */
  openRatio: number;
}

/** 分段表。顺序必须按 from 升序。 */
export const SEGMENTS: Segment[] = [
  { from: 1,   to: 10,   w: 6, h: 6, w2: 6, h2: 6,  blocks: [0, 3],   oneways: [0, 0],  minTurns: 1, openRatio: 0.78 },
  { from: 11,  to: 30,   w: 7, h: 7, w2: 7, h2: 7,  blocks: [6, 12],  oneways: [0, 2],  minTurns: 2, openRatio: 0.72 },
  { from: 31,  to: 60,   w: 8, h: 8, w2: 8, h2: 8,  blocks: [12, 20], oneways: [3, 6],  minTurns: 3, openRatio: 0.66 },
  { from: 61,  to: 150,  w: 9, h: 9, w2: 9, h2: 9,  blocks: [20, 30], oneways: [6, 10], minTurns: 4, openRatio: 0.60 },
  { from: 151, to: 400,  w: 9, h: 9, w2: 9, h2: 9,  blocks: [28, 38], oneways: [8, 14], minTurns: 5, openRatio: 0.56 },
  { from: 401, to: 700,  w: 10, h: 10, w2: 10, h2: 10, blocks: [35, 48], oneways: [10, 16], minTurns: 6, openRatio: 0.52 },
  { from: 701, to: 1000, w: 10, h: 10, w2: 11, h2: 11, blocks: [45, 60], oneways: [12, 20], minTurns: 7, openRatio: 0.48 },
];

/** 生成参数包。 */
export interface CurveParams {
  /** 棋盘列数 */
  w: number;
  /** 棋盘行数 */
  h: number;
  /** 阻挡块数量 */
  blocks: number;
  /** 单向块数量 */
  oneways: number;
  /** 正解路径最少转弯数 */
  minTurns: number;
  /** 目标开放面积比下限 */
  openRatio: number;
  /** 正解路径的最小长度（步数） */
  minPathLen: number;
  /** 分叉抑制强度 0..1，越大越追求唯一解 */
  branchPenalty: number;
}

/** 找到关号所属的分段。 */
function segmentOf(idx: number): Segment {
  for (const s of SEGMENTS) if (idx >= s.from && idx <= s.to) return s;
  return SEGMENTS[SEGMENTS.length - 1];
}

/**
 * 计算关卡的生成参数。纯函数，不依赖随机数。
 * @param idx 关号，1 起
 */
export function curveFor(idx: number): CurveParams {
  const seg = segmentOf(idx);
  const span = seg.to - seg.from;
  const t = span <= 0 ? 0 : (idx - seg.from) / span;
  const e = easeInOut(t);

  // 大关（每 100 关）：相对同段略微放宽，转弯更多 → "绕但不死"
  const isBig = idx % 100 === 0;

  const w = Math.round(lerp(seg.w, seg.w2, e));
  const h = Math.round(lerp(seg.h, seg.h2, e));

  let blocks = Math.round(lerp(seg.blocks[0], seg.blocks[1], e));
  const oneways = Math.round(lerp(seg.oneways[0], seg.oneways[1], e));
  let openRatio = lerp(seg.openRatio, seg.openRatio - 0.04, e);

  if (isBig) {
    blocks = Math.max(0, blocks - 6);
    openRatio = Math.min(0.9, openRatio + 0.04);
  }

  const minTurns = seg.minTurns + (isBig ? 1 : 0);
  const minPathLen = Math.max(4, Math.round(Math.max(w, h) * 1.4));

  return {
    w, h, blocks, oneways, minTurns, openRatio, minPathLen,
    branchPenalty: clamp01(0.35 + (idx / 1000) * 0.5),
  };
}

/**
 * 目标难度分（0..100）。
 * 1~10 关从 5 升到 15，11~1000 从 15 升到 85（平方根曲线，前快后慢，
 * 匹配 computeDiff 的实际输出上限 ~84，见 T04/T07 遗留问题）。
 * 每 10 关加 8 分小高峰；每 100 关额外 +4（大关）。
 * 注：规格 02 §4.3 写的是「分段线性 15→92」，但 computeDiff 实际输出上限
 * 约 84（见 out/audit.md 直方图），线性 15→92 会造成后期系统性负偏差
 * （331 处异常），故按实测改为平方根 15→85。
 */
export function targetDiff(idx: number): number {
  let base: number;
  if (idx <= 10) {
    base = lerp(5, 15, (idx - 1) / 9);
  } else {
    // 平方根曲线：前段（低难度）快速上升，后段趋缓，贴合实际难度分布
    const t = Math.min(1, (idx - 10) / 990);
    base = lerp(15, 85, Math.sqrt(t));
  }
  if (idx % 10 === 0) base += 8;
  if (idx % 100 === 0) base += 4;
  return Math.max(0, Math.min(100, Math.round(base)));
}

/**
 * 依据关卡实际构成计算难度分。
 * 公式见 02-关卡格式与算法规格.md 第 4.2 节。
 */
export function computeDiff(input: {
  w: number; h: number;
  blocks: number; oneways: number;
  turns: number;
  /** 最短路条数，最小 1 */
  pathCount: number;
  /** 实际开放面积比 */
  openRatio: number;
}): number {
  const { w, h, blocks, oneways, turns, pathCount, openRatio } = input;
  const area = w * h;
  // 唯一性（按规格 02 §4.2 注释：1 表示唯一解）。公式 1 - uniqueness 使唯一解
  // 不额外加分、多解加分 —— 与 GDD 01 §5「唯一性越唯一越好」的措辞表面相悖，
  // 但「唯一解占比」实为 batch-audit 的独立质量门禁（§4.4），不并入难度分。
  const uniqueness = pathCount <= 1 ? 1 : clamp01(1 - Math.log2(pathCount) / 6);

  const raw =
    0.30 * clamp01(blocks / (area * 0.45)) +
    0.15 * clamp01(oneways / (area * 0.25)) +
    0.25 * clamp01(turns / 8) +
    0.20 * clamp01((1 - openRatio) / 0.55) +
    0.10 * clamp01(1 - uniqueness);

  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}
