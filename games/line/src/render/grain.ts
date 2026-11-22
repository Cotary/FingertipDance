/**
 * 黏土颗粒层 —— 表面那层「砂质」。
 *
 * 为什么单独一层：黏土和软陶 / 塑料的最后分界线不在体积，在**表面**。
 * 前几层的色阶 + 手捏轮廓解决的是「形状像捏出来的」，
 * 这一层解决「摸上去是什么手感」—— 没有它，一块色阶再准的黏土也读作哑光塑料。
 *
 * 三层结构（越往下越细，代价也越贵）：
 * 1. **砂粒**（本文件）—— 256×256 可平铺噪声贴图，`createPattern` 一次填充。
 *    只生成一次、之后每帧一次 `fillRect`，是唯一能承受的细颗粒做法。
 * 2. **指压痕**（`clay.ts` 的 `clayPress`）—— 固定 seed 的浅弧，只给大件画。
 * 3. **轮廓抖动**（`clay.ts` 的 `discPts` / `rrectPts`）—— 已有。
 *
 * 三个必须守住的点：
 * - **tile 必须可平铺**：256 在 750 宽上只重复 3 次，肉眼分辨不出接缝
 * - **颗粒必须成块**（2×2 像素一块），单像素独立随机是「电视雪花」，不是砂
 * - **密度必须不均**：低频值噪声调制疏密，否则像均匀噪点滤镜
 */

import { createOffscreenCanvas } from '../platform/offscreen';

/** 贴图边长（设计像素）。128 会有可见周期，512 生成耗时翻倍，256 最划算。 */
const TILE = 256;

/** 颗粒块边长（像素）。1 = 细砂（要这个），2 开始像芝麻。 */
const BLK = 1;

/** 稀疏阈值：低于它的像素完全透明。0.72 意味着只有 28% 的像素落砂。 */
const SPARSE = 0.72;

/** 疏密调制的采样网格（tile 内 32×32 个格）。 */
const DENS_GRID = 32;

/** 离屏画布的最小接口（浏览器 canvas 与微信 offscreen 都满足）。 */
interface TileCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

let tile: TileCanvas | null = null;
let tileTried = false;
const patterns = new WeakMap<object, CanvasPattern | null>();

/** xorshift32：确定性，同一 seed 每台机器都得到同一张颗粒图。 */
function makeRnd(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0x100000000);
  };
}

/** 2D 值噪声（双线性插值），用来调制颗粒疏密 —— 让某些区域更糙、某些更光。 */
function valueNoise(x: number, y: number, grid: number, seed: number): number {
  const gx = x * grid;
  const gy = y * grid;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const rnd = (a: number, b: number) => {
    const v = Math.sin((a * 127.1 + b * 311.7 + seed) * 0.017) * 43758.5453;
    return v - Math.floor(v);
  };
  // 平滑插值，避免网格边界出现直角
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = rnd(x0, y0);
  const n10 = rnd(x0 + 1, y0);
  const n01 = rnd(x0, y0 + 1);
  const n11 = rnd(x0 + 1, y0 + 1);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

/** 建一张离屏画布；拿不到就返回 null（离线 SVG 录制器走这条）。 */
function newTileCanvas(size: number): TileCanvas | null {
  // 小游戏端要 wx/tt 的离屏工厂，Web 端用 DOM —— 分支收在 platform/offscreen 里
  return createOffscreenCanvas(size, size) as unknown as TileCanvas | null;
}

/**
 * 生成颗粒贴图（只跑一次）。
 *
 * 像素规则：
 * - 72% 完全透明 —— 颗粒是**稀疏**的，铺满就成了噪点滤镜
 * - `pow(r, 2.4)` 压分布 —— 大部分很淡，少数较实，像砂粒的粗细不均
 * - 34% 亮 / 66% 暗 —— 黏土上的颗粒以**凹坑**为主，凸点少
 * - alpha 上限 46/255 ≈ 18%，叠到色阶上只是一层雾，不抢结构
 */
function buildTile(): TileCanvas | null {
  const c = newTileCanvas(TILE);
  if (!c) return null;
  const g = c.getContext('2d');
  if (!g || typeof g.createImageData !== 'function') return null;

  const img = g.createImageData(TILE, TILE);
  const d = img.data;
  const rnd = makeRnd(20261101);

  // 低频疏密预表：65536 个像素各算一次 valueNoise（含 4 次 sin）在手机上要 100ms，
  // 降到 32×32 查表后只剩 1024 次，肉眼分辨不出差别。
  const step = TILE / DENS_GRID;
  const densTab = new Float32Array(DENS_GRID * DENS_GRID);
  for (let j = 0; j < DENS_GRID; j++) {
    for (let i = 0; i < DENS_GRID; i++) {
      densTab[j * DENS_GRID + i] = 0.70 + valueNoise(i / DENS_GRID, j / DENS_GRID, 5, 7.3) * 0.38;
    }
  }

  for (let by = 0; by < TILE; by += BLK) {
    const dj = Math.min(DENS_GRID - 1, Math.floor(by / step));
    for (let bx = 0; bx < TILE; bx += BLK) {
      const r = rnd();
      // 低频疏密：越靠噪声高处越糙
      const dens = densTab[dj * DENS_GRID + Math.min(DENS_GRID - 1, Math.floor(bx / step))];
      const cut = SPARSE * dens;
      const hit = r < cut ? 0 : Math.pow((r - cut) / (1 - cut), 2.4);

      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      if (hit > 0.02) {
        // 暗坑多、亮点少
        const bright = rnd() < 0.34;
        if (bright) {
          rr = 255;
          gg = 246;
          bb = 233;
        } else {
          rr = 74;
          gg = 51;
          bb = 39;
        }
        aa = Math.round(hit * 46);
      }

      for (let py = by; py < by + BLK && py < TILE; py++) {
        for (let px = bx; px < bx + BLK && px < TILE; px++) {
          const i = (py * TILE + px) * 4;
          d[i] = rr;
          d[i + 1] = gg;
          d[i + 2] = bb;
          d[i + 3] = aa;
        }
      }
    }
  }

  g.putImageData(img, 0, 0);
  return c;
}

/** 取（并缓存）颗粒 pattern。并发/多 ctx 安全：按 ctx 缓存。 */
export function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const cached = patterns.get(ctx as unknown as object);
  if (cached !== undefined) return cached;

  if (!tileTried) {
    tile = buildTile();
    tileTried = true;
  }
  if (!tile || !ctx.createPattern) {
    patterns.set(ctx as unknown as object, null);
    return null;
  }

  const p = ctx.createPattern(tile as unknown as CanvasImageSource, 'repeat');
  patterns.set(ctx as unknown as object, p);
  return p;
}

/**
 * 在一段已经 `clip()` 的路径里铺一层颗粒。
 *
 * 调用方必须自己 save/clip/restore —— 这里不碰裁剪，避免和主原语的裁剪栈打架。
 * `alpha` 是**整层**的强度，具体颗粒浓度已烘进贴图。
 */
export function fillGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const p = grainPattern(ctx);
  if (!p) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = p;
  // 外扩 2px：clip 后的形状有抖动，贴图边缘不能露出没铺到的直边
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.restore();
}
