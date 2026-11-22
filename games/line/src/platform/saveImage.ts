/**
 * 把画布存进相册。
 *
 * ## 为什么海报不能「长按保存」
 *
 * 海报是 **canvas 渲染**出来的（`ui/share.ts` 的 `renderPoster`），
 * 不是 `<img>` 标签。canvas 的像素不是 DOM 节点，**没有长按菜单** ——
 * 原来那句「请长按海报保存到相册」是个假承诺，玩家按半天什么也不会发生。
 *
 * 小游戏端要真存进去，必须走两步：
 *
 *   1. `wx.canvasToTempFilePath` —— 把画布导出成临时文件
 *   2. `wx.saveImageToPhotosAlbum` —— 存进相册（**需要用户授权**）
 *
 * ## 为什么这两步不能省
 *
 * 第 1 步给的是**临时文件路径**（`wxfile://tmp/...`），不是相册里的图片；
 * 第 2 步才有授权弹窗（用户拒绝过就再也调不出来，必须有兜底）。
 *
 * ## 授权被拒怎么办
 *
 * `saveImageToPhotosAlbum` 失败时微信会返回 `errMsg` 含 `auth deny` /
 * `authorize no response`。这时**不能重试**（重试还是弹同一个框），
 * 应该引导玩家去设置里手动开权限。老基础库没有 `wx.openSetting` 时
 * 就只能如实告知。
 *
 * ## 抖音端
 *
 * 抖音小游戏**没有** `saveImageToPhotosAlbum`，但有 `tt.saveImageToPhotosAlbum`
 * —— API 名字一样、参数也一样，所以这个模块两端共用。
 * 抖音另有 `tt.shareAppMessage` 分享视频的路径，不需要相册。
 */
import type { SaveImageResult } from './types';

/** 平台全局对象（微信 `wx` / 抖音 `tt`，签名一致）。 */
interface MiniGlobal {
  canvasToTempFilePath?: (opts: {
    canvas?: unknown;
    success?: (res: { tempFilePath: string }) => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
  saveImageToPhotosAlbum?: (opts: {
    filePath: string;
    success?: () => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
  getSetting?: (opts: {
    success?: (res: { authSetting?: Record<string, boolean> }) => void;
    fail?: () => void;
  }) => void;
  openSetting?: (opts: {
    success?: (res: { authSetting?: Record<string, boolean> }) => void;
    fail?: () => void;
  }) => void;
}

/** 取平台全局（微信 `wx` / 抖音 `tt`）。 */
function miniGlobal(): MiniGlobal | undefined {
  const g = globalThis as { wx?: MiniGlobal; tt?: MiniGlobal };
  return g.wx ?? g.tt;
}

/** 保存结果。 */
export type { SaveImageResult };

/**
 * 能被保存的画布（最小结构）。
 *
 * ## 为什么不用 `HTMLCanvasElement`
 *
 * 海报是**离屏**画布（`ui/share.ts` 的 `PosterCanvas`），它只保证
 * `width / height / getContext / toDataURL` 都在 —— 微信的
 * `wx.createOffscreenCanvas` 返回的对象不是 DOM 的 `HTMLCanvasElement`，
 * 结构上差着三百多个成员（`addEventListener` / `toBlob` / …）。
 *
 * 但 `canvasToTempFilePath` 要的**只有画布本身**，那些 DOM 方法
 * 一个都用不上。所以这里收最小结构，而不是让调用方去断言。
 */
export interface SaveableCanvas {
  width: number;
  height: number;
}

/**
 * 把画布存进相册。
 *
 * **不抛异常** —— 调用方只需要给一句不同的提示，
 * 抛出来会让「保存失败」变成「游戏崩了」。
 */
export function saveCanvasToAlbum(canvas: SaveableCanvas): Promise<SaveImageResult> {
  const g = miniGlobal();
  // 存到**局部常量**再调用：可选链 `?.()` 在回调里再用 `g.xxx`
  // 时，TS 无法保证回调执行那一刻 `g` 上的方法还在（窄化会失效）。
  const toTempFile = g?.canvasToTempFilePath;
  const saveToAlbum = g?.saveImageToPhotosAlbum;
  if (!toTempFile || !saveToAlbum) {
    return Promise.resolve('unsupported');
  }

  return new Promise<SaveImageResult>((resolve) => {
    // ── 1. 导出临时文件 ──
    toTempFile({
      canvas,
      success: (res) => {
        const path = res?.tempFilePath;
        if (!path) {
          resolve('failed');
          return;
        }
        // ── 2. 存进相册 ──
        saveToAlbum({
          filePath: path,
          success: () => resolve('saved'),
          fail: (err) => {
            const msg = err?.errMsg ?? '';
            // 授权被拒：`auth deny` / `authorize` 相关。
            // 重试没用（会弹同一个框），要引导去设置里开。
            if (/auth|deny/i.test(msg)) {
              resolve('denied');
              return;
            }
            resolve('failed');
          },
        });
      },
      fail: () => resolve('failed'),
    });
  });
}

/**
 * 把画布导出成临时文件。
 *
 * 微信的 `wx.shareAppMessage({ imageUrl })` 要的是**本地文件路径**，
 * 不是 dataURL —— 传 dataURL 会被忽略，卡片就退回默认图。
 *
 * 抖音的 `tt.shareAppMessage` 同样吃本地路径。
 *
 * @returns 临时文件路径；不支持 / 失败返回空串
 */
export function exportCanvasToTempFile(canvas: SaveableCanvas): Promise<string> {
  const toTempFile = miniGlobal()?.canvasToTempFilePath;
  if (!toTempFile) return Promise.resolve('');

  return new Promise<string>((resolve) => {
    try {
      toTempFile({
        canvas,
        success: (res) => resolve(res?.tempFilePath ?? ''),
        fail: () => resolve(''),
      });
    } catch {
      resolve('');
    }
  });
}

/**
 * 拉起系统设置页（让玩家手动开相册权限）。
 *
 * 微信叫 `wx.openSetting`，抖音叫 `tt.openSetting`，签名一致。
 * 老基础库没有这个 API —— 返回 false，调用方改用纯文字提示。
 */
export function openPlatformSettings(): Promise<boolean> {
  const openSetting = miniGlobal()?.openSetting;
  if (!openSetting) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    try {
      openSetting({
        success: (res) => {
          const granted = res?.authSetting?.['scope.writePhotosAlbum'];
          resolve(granted !== false);
        },
        fail: () => resolve(false),
      });
    } catch {
      resolve(false);
    }
  });
}
