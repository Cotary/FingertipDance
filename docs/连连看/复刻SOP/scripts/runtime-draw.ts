/**
 * 烘焙贴图的运行时绘制 —— 路线 B 的最后一块拼图
 *
 * 这个文件不是"示例"，是**可以直接抄进游戏的实现**。
 * 它回答一个具体问题：bake.mjs 产出的 baked.manifest.json + PNG，
 * 在游戏里到底怎么画出来？
 *
 * ## 三个必须处理的细节
 *
 * 1. **素材倍率 ≠ 屏幕倍率**
 *    素材按 3× 存（564px 的图对应 188 CSS px）。屏幕 dpr 可能是 2 或 3，
 *    直接 drawImage 到 CSS 像素尺寸会糊。正确做法：按 CSS 逻辑尺寸 × dpr 绘制。
 *
 * 2. **九宫格**
 *    圆角面板拉伸必须走九宫格，否则圆角变椭圆（实测对比见
 *    ../复刻验证/九宫格vs直接拉伸.png）。
 *
 * 3. **锚点**
 *    manifest 里的 logical 尺寸**含外扩**（阴影空间）。绘制时要用外扩量
 *    往回退，否则整个元素会偏移 pad 像素 —— 这个错很常见，且很难看出
 *    （因为所有元素都偏一样的距离，看起来"就是这样的"）。
 */

export interface BakedAsset {
  id: string;
  file: string;
  /** 含外扩的逻辑尺寸（CSS px） */
  logical: { w: number; h: number; pad: number; contentW: number; contentH: number };
  bakeScale: number;
  drawScale: number;
  ninePatch?: {
    corner: number;
    radius: number;
    /** 素材像素单位 */
    slices: { left: number; right: number; top: number; bottom: number };
  };
}

export interface BakedManifest {
  bakeScale: number;
  drawScale: number;
  assets: BakedAsset[];
}

const imageCache = new Map<string, HTMLImageElement>();

/** 预加载（进游戏时调一次，别在 draw 里加载） */
export async function preload(srcOf: (a: BakedAsset) => string, man: BakedManifest): Promise<void> {
  await Promise.all(man.assets.map((a) => new Promise<void>((res, rej) => {
    const img = new Image();
    img.onload = () => { imageCache.set(a.id, img); res(); };
    img.onerror = () => rej(new Error(`贴图加载失败：${a.id}`));
    img.src = srcOf(a);
  })));
}

/**
 * 绘制一个烘焙资产（1:1，不拉伸）
 *
 * @param ctx     canvas 上下文（**已经 setTransform(dpr) 处理过缩放**）
 * @param id      资产 id
 * @param x,y     **内容区左上角**（不含外扩）—— 这是最容易搞错的地方
 */
export function drawAsset(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  man: BakedManifest,
): void {
  const a = man.assets.find((v) => v.id === id);
  if (!a) { console.warn(`未知资产 ${id}`); return; }
  const img = imageCache.get(id);
  if (!img) { console.warn(`未预加载 ${id}`); return; }

  // 从内容区左上角，退回到外扩后的左上角
  const dx = x - a.logical.pad;
  const dy = y - a.logical.pad;

  ctx.drawImage(img, dx, dy, a.logical.w, a.logical.h);
}

/**
 * 绘制一个可拉伸面板（九宫格）
 *
 * 用九宫格而不是直接 drawImage，是因为圆角和阴影会被拉变形。
 *
 * @param w,h  期望的**内容区**尺寸（不含外扩）
 */
export function drawNinePatch(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  man: BakedManifest,
): void {
  const a = man.assets.find((v) => v.id === id);
  if (!a?.ninePatch) { console.warn(`非九宫格资产 ${id}`); return; }
  const img = imageCache.get(id);
  if (!img) { console.warn(`未预加载 ${id}`); return; }

  const pad = a.logical.pad;
  const dx0 = x - pad;
  const dy0 = y - pad;

  // 目标总尺寸 = 内容 + 外扩×2
  const totalW = w + pad * 2;
  const totalH = h + pad * 2;

  // 源切片（素材像素）
  const { left: sL, right: sR, top: sT, bottom: sB } = a.ninePatch.slices;
  const sw = img.width, sh = img.height;
  const sCw = sw - sL - sR;
  const sCh = sh - sT - sB;

  // 目标切片（逻辑像素）。角保持原尺寸，只有中间拉伸。
  const scale = totalW / a.logical.w;  // 横向放大比
  const scaleH = totalH / a.logical.h;
  const dL = sL / a.drawScale * (scale < 1 ? scale : 1);
  const dR = sR / a.drawScale * (scale < 1 ? scale : 1);
  const dT = sT / a.drawScale * (scaleH < 1 ? scaleH : 1);
  const dB = sB / a.drawScale * (scaleH < 1 ? scaleH : 1);
  const dCw = Math.max(1, totalW - dL - dR);
  const dCh = Math.max(1, totalH - dT - dB);

  const xs = [0, sL, sw - sR, sw];
  const ys = [0, sT, sh - sB, sh];
  const dxs = [dx0, dx0 + dL, dx0 + dL + dCw, dx0 + totalW];
  const dys = [dy0, dy0 + dT, dy0 + dT + dCh, dy0 + totalH];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const sW = xs[c + 1] - xs[c];
      const sH = ys[r + 1] - ys[r];
      const dW = dxs[c + 1] - dxs[c];
      const dH = dys[r + 1] - dys[r];
      if (sW <= 0 || sH <= 0 || dW <= 0 || dH <= 0) continue;
      ctx.drawImage(img, xs[c], ys[r], sW, sH, dxs[c], dys[r], dW, dH);
    }
  }
}

/**
 * 缓存建议 —— 什么时候该烘、什么时候该手绘
 *
 * 复刻项目最容易走偏的地方：把"能动的东西"也烘成死图，
 * 或者把"不会动的东西"手绘得满头大汗。
 */
export const BAKE_RULES = {
  /** 必须烘：结构复杂、不会变 */
  bake: [
    '棋子各材质（pale/deep/stone/frost）—— 10 层阴影，手绘必然有偏差',
    '机制图标（8 个）—— SVG 描边 + 双线立体，重绘成本高',
    '面板/卡片 —— 一律九宫格',
    '纹理（冰裂纹、噪点）—— 烘 1 张，运行时随机变换出变体',
  ],
  /** 必须手绘：会实时变化 */
  handDraw: [
    '渐变（任意尺寸，如棋盘底、背景光晕）—— canvas 原生渐变更清晰',
    '文字 —— 内容会变，且要做字体子集',
    '选中态/提示态 —— 状态太多，用"基础贴图 + 叠加高亮层"',
    '连径金线、涟漪 —— 逐帧变化',
  ],
  /** 都不能用：Canvas2D 表达不了 */
  neither: [
    '3D 翻面（perspective + preserve-3d）—— 需 WebGL 或降级',
  ],
} as const;
