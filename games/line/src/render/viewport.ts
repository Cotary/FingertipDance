/**
 * 视口：设计坐标系 ↔ 屏幕 ↔ 设备像素。
 *
 * ## 坐标系
 *
 * - **设计坐标**：750×1334 的虚拟画布，所有布局代码都用它（`originX`/`cell`/按钮矩形…）。
 * - **屏幕坐标（CSS px）**：浏览器页面坐标。
 * - **设备像素**：Canvas 内部坐标（= CSS 尺寸 × dpr）。
 *
 * 三者的换算关系：
 *
 * ```
 * 屏幕 = 设计 * scale + offset
 * 设备 = 屏幕 * dpr
 * ```
 *
 * ## 为什么 offset 必须在 CSS 像素下算
 *
 * `offsetX/offsetY` 是「把 750×1334 的设计稿居中放进实际画布」留下的空白，
 * 它天生是 **CSS 像素**（来自 `window.innerWidth`/`innerHeight`）。
 * 乘 dpr 是在换到设备像素，**不能提前除**。
 *
 * ## 这个模块存在的意义（2026-11-07）
 *
 * 之前渲染端写的是 `ctx.scale(dpr*scale)` + `ctx.translate(offsetX/dpr)`。
 * Canvas 变换是**右乘**的 —— `scale(a) ∘ translate(t)` 等价于 `x' = a*(x + t)`，
 * 平移量被平白乘了一个 `a`。实际偏移变成 `offsetX * scale` 而不是 `offsetX * dpr`。
 *
 * 在 1920×1080（16:9，而设计稿是 9:16，横向留白 656px）下横向偏 **125px**，
 * 约等于一整格 —— 玩家看到的是「鼠标点 A 格，游戏响应 B 格」。
 *
 * 抽出这个模块是为了能**测**：「渲染变换」和「输入反变换」必须严格互逆，
 * 这条不变量用测试锁死，避免以后再被改歪。
 */

/** 视口参数。 */
export interface Viewport {
  /** 设计坐标 → 屏幕坐标的缩放系数。 */
  readonly scale: number;
  /** 水平居中留白（CSS 像素）。 */
  readonly offsetX: number;
  /** 垂直居中留白（CSS 像素）。 */
  readonly offsetY: number;
  /** 设备像素比。 */
  readonly dpr: number;

  /** 设计坐标 → 屏幕坐标（CSS px）。 */
  toCss(x: number, y: number): { x: number; y: number };
  /** 屏幕坐标（CSS px）→ 设计坐标。 */
  toDesign(cssX: number, cssY: number): { x: number; y: number };
  /** 设计坐标 → 设备像素（Canvas 内部坐标）。 */
  toDevice(x: number, y: number): { x: number; y: number };
  /**
   * 把「设计坐标 → 设备像素」的变换应用到 2D 上下文。
   *
   * 用 `setTransform` 一次写死 —— `scale`/`translate` 链式调用的右乘顺序
   * 太容易写错（见文件头注释）。
   */
  applyTo(ctx: { setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void }): void;
}

/** 设备像素比。 */
export interface ViewportOptions {
  width: number;
  height: number;
  dpr: number;
  /** 设计坐标系宽度。 */
  designWidth: number;
  /** 设计坐标系高度。 */
  designHeight: number;
}

/**
 * 创建视口。
 *
 * 采用「等比缩放 + 居中」策略：设计稿整体缩放，两侧留白。
 * 这样在任何屏幕上宽高比都不变 —— 棋盘的格子永远是方的。
 */
export function createViewport(opts: ViewportOptions): Viewport {
  const { width, height, dpr, designWidth, designHeight } = opts;
  const scale = Math.min(width / designWidth, height / designHeight);
  const offsetX = (width - designWidth * scale) / 2;
  const offsetY = (height - designHeight * scale) / 2;

  return {
    scale,
    offsetX,
    offsetY,
    dpr,

    toCss(x, y) {
      return { x: x * scale + offsetX, y: y * scale + offsetY };
    },

    toDesign(cssX, cssY) {
      return { x: (cssX - offsetX) / scale, y: (cssY - offsetY) / scale };
    },

    toDevice(x, y) {
      return { x: x * scale * dpr + offsetX * dpr, y: y * scale * dpr + offsetY * dpr };
    },

    applyTo(ctx) {
      ctx.setTransform(
        scale * dpr, 0, 0, scale * dpr,
        offsetX * dpr, offsetY * dpr,
      );
    },
  };
}
