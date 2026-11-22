/**
 * 离屏画布。
 *
 * ## 为什么必须收成一个函数
 *
 * 主题把棋子贴片烘到离屏画布上复用（一格二十几次绘制，11×11 的盘每帧
 * 上千次——不烘就是低端机个位数帧率）。浏览器里 `document.createElement`
 * 随手可得，**小游戏端没有 `document`**，得走 `wx.createOffscreenCanvas` /
 * `tt.createOffscreenCanvas`。
 *
 * 之前三套主题各写各的，结果只有 `coverBoard` / `grain` 写了分支，
 * `mise`（默认主题）和 `mingsha` 直接 `document.createElement` ——
 * 包发上去点一下棋子就崩。同一件事写三遍，必然漏两处。
 *
 * ## 为什么 Web 端不用 `new OffscreenCanvas()`
 *
 * `OffscreenCanvas` 在 Safari 上不能作为 `createPattern` 的图源
 * （霓虹主题的网点、天青的颗粒都靠 `createPattern`），
 * 而 `document.createElement('canvas')` 在哪都能用。离屏只是"不在 DOM 里"，
 * 不需要 `OffscreenCanvas` 这个更窄的 API。
 *
 * ## 拿不到就返回 `null`
 *
 * 单元测试（node 环境）和小游戏基础库过旧时都可能拿不到。返回 `null`
 * 让调用方**跳过自家那层装饰**（影子 / 贴片纹理），而不是抛异常把整盘带崩 ——
 * 少一层影子和直接黑屏，哪个更像产品不用讨论。
 */

type OffscreenFactory = (opts: {
  type: '2d';
  width: number;
  height: number;
}) => HTMLCanvasElement | null | undefined;

interface CanvasGlobals {
  wx?: { createOffscreenCanvas?: OffscreenFactory };
  tt?: { createOffscreenCanvas?: OffscreenFactory };
}

/** 小游戏端创建离屏画布的工厂（微信 / 抖音同一套签名）。 */
function miniFactory(): OffscreenFactory | undefined {
  const g = globalThis as CanvasGlobals;
  return g.wx?.createOffscreenCanvas ?? g.tt?.createOffscreenCanvas;
}

/** 当前环境能不能建离屏画布（预览页据此决定画不画真盘面）。 */
export function canCreateOffscreenCanvas(): boolean {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') return true;
  return miniFactory() !== undefined;
}

/**
 * 建一张 `w × h` 的离屏画布。
 *
 * 小游戏端返回值按 2D 上下文用（`getContext('2d')` 的签名一致），
 * 这里统一断言成 `HTMLCanvasElement` —— 主域只调 `getContext` / `drawImage` /
 * `toDataURL`，三样两端都有。
 */
export function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement | null {
  const width = Math.max(1, Math.ceil(w));
  const height = Math.max(1, Math.ceil(h));

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }

  const factory = miniFactory();
  if (!factory) return null;
  try {
    const c = factory({ type: '2d', width, height });
    if (!c) return null;
    // 个别基础库返回的画布尺寸是 0：显式赋一次，否则 `getContext('2d')`
    // 拿到的是一张 0×0 的图，`drawImage` 画出来什么都没有（静默失败）
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    return c as unknown as HTMLCanvasElement;
  } catch {
    return null;
  }
}
