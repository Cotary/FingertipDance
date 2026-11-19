/**
 * 头像贴图加载（跨平台）。
 *
 * ## 为什么需要它
 *
 * 服务端会下发 `avatar`（微信头像 URL）。此前我的页**完全忽略**这个字段，
 * 只画昵称首字 —— 玩家在别处设置的微信头像，进来看到的是个「小」字，
 * 会以为没登录上。`drawAvatar` 的 `_url` 参数也是被丢掉的。
 *
 * ## 平台差异
 *
 * - **web**：`new Image()` + `crossOrigin='anonymous'`。不加 crossOrigin 时
 *   微信/QQ 的头像 CDN 不带 CORS 头，画进 canvas 后再 `toDataURL` 会直接抛
 *   `SecurityError`（污染画布）。加了但对方不支持，图片会加载失败 —— 两者都比
 *   「静默污染」好，所以宁可失败。
 * - **微信小游戏**：`wx.createImage()`，同源策略比 web 宽松（小游戏里画远程图
 *   不需要 crossOrigin），所以分支处理。
 *
 * ## 缓存的三个状态
 *
 * 同一个 URL 不能反复尝试加载（每帧一次就是每秒 60 个请求）。所以按 URL 缓存：
 *
 * - `undefined` —— 还没试过
 * - `'loading'` —— 正在加载
 * - `'failed'` —— 试过且失败（**永久**不再试，见下）
 * - `HTMLImageElement` / 微信 Image —— 成功
 *
 * ## 为什么失败要永久记住
 *
 * 头像是**装饰**，加载失败不该让页面变慢或抖。若失败后每帧重试，
 * 一个失效 URL 会以 60fps 一直打请求；而头像在本次会话里几乎不会自己变好。
 * 失败就安静地退回首字，下次冷启动再试一次即可。
 */

/** 能 drawImage 的最小接口（web / 微信共存）。 */
export interface LoadedImage {
  width: number;
  height: number;
}

type CacheEntry = 'loading' | 'failed' | LoadedImage;

const cache = new Map<string, CacheEntry>();

/**
 * 取一张已加载的头像图。
 *
 * @returns 已就绪的图；未就绪 / 失败时返回 null（调用方回退首字）
 */
export function getAvatarImage(url: string): LoadedImage | null {
  if (!url) return null;

  const hit = cache.get(url);
  if (hit === undefined) {
    startLoad(url);
    return null;
  }
  if (hit === 'loading' || hit === 'failed') return null;
  return hit;
}

/** 发起一次加载（同一 URL 只发一次）。 */
function startLoad(url: string): void {
  cache.set(url, 'loading');

  const img = createImage();
  if (!img) {
    cache.set(url, 'failed');
    return;
  }

  img.onload = () => {
    cache.set(url, img);
  };
  img.onerror = () => {
    cache.set(url, 'failed');
  };
  img.src = url;
}

/** 能挂回调的 Image（web / 微信共存的最小交集）。 */
interface RawImage extends LoadedImage {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  crossOrigin?: string;
}

/** 平台分支创建 Image。 */
function createImage(): RawImage | null {
  const g = globalThis as unknown as {
    wx?: { createImage?: () => RawImage };
    Image?: new () => RawImage;
  };

  // 微信小游戏
  if (g.wx?.createImage) {
    try {
      return g.wx.createImage();
    } catch {
      return null;
    }
  }
  // web
  if (typeof g.Image === 'function') {
    const img = new g.Image();
    // 避免污染画布（见文件头）
    img.crossOrigin = 'anonymous';
    return img;
  }
  return null;
}

/**
 * 把头像画进一个圆（含边框）。
 *
 * 调用方负责「没有图就画首字」的兜底，这里只管有图的情况。
 * 用 `cover` 语义裁切：微信头像是方的，直接拉伸到圆里会变形。
 */
export function drawAvatarImage(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  img: LoadedImage,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // cover：取短边对齐，居中裁
  const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(
    img as unknown as CanvasImageSource,
    cx - dw / 2,
    cy - dh / 2,
    dw,
    dh,
  );
  ctx.restore();
}

/** 供测试重置缓存（生产代码不要调）。 */
export function __resetAvatarCache(): void {
  cache.clear();
}

/** 供测试查询状态（生产代码不要调）。 */
export function __avatarCacheState(url: string): string {
  const v = cache.get(url);
  if (v === undefined) return 'none';
  if (v === 'loading') return 'loading';
  if (v === 'failed') return 'failed';
  return 'loaded';
}
