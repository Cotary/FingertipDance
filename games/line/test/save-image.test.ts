import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveCanvasToAlbum, openPlatformSettings } from '../src/platform/saveImage';

/**
 * 保存海报到相册。
 *
 * ## 为什么这个值得测
 *
 * 海报是 **canvas 渲染**的，不是 `<img>` —— canvas 的像素不是 DOM 节点，
 * **没有长按菜单**。原来那句「请长按海报保存到相册」是假承诺，
 * 玩家按半天什么也不会发生。
 *
 * 真正能存进去靠两步（`canvasToTempFilePath` → `saveImageToPhotosAlbum`），
 * 而且第二步会弹授权框。授权被拒时**不能重试**（还是弹同一个框），
 * 必须引导玩家去设置里开权限 —— 所以「授权被拒」要与「保存失败」区分开。
 */

type G = {
  wx?: Record<string, unknown>;
  tt?: Record<string, unknown>;
};

const SAVED = Object.getOwnPropertyDescriptor(globalThis, 'wx');
const SAVED_TT = Object.getOwnPropertyDescriptor(globalThis, 'tt');

function restore(): void {
  if (SAVED) Object.defineProperty(globalThis, 'wx', SAVED);
  else delete (globalThis as Record<string, unknown>).wx;
  if (SAVED_TT) Object.defineProperty(globalThis, 'tt', SAVED_TT);
  else delete (globalThis as Record<string, unknown>).tt;
}

beforeEach(() => {
  delete (globalThis as G).wx;
  delete (globalThis as G).tt;
});

afterEach(restore);

const canvas = { width: 750, height: 1334 };

describe('saveCanvasToAlbum：两步流程', () => {
  it('导出临时文件后再存相册，成功返回 saved', async () => {
    const order: string[] = [];
    (globalThis as G).wx = {
      canvasToTempFilePath: (o: any) => {
        order.push('toTemp');
        o.success({ tempFilePath: 'wxfile://tmp/poster.png' });
      },
      saveImageToPhotosAlbum: (o: any) => {
        order.push('save');
        expect(o.filePath).toBe('wxfile://tmp/poster.png');
        o.success();
      },
    };

    expect(await saveCanvasToAlbum(canvas)).toBe('saved');
    // 顺序不能反：临时文件还没生成就存相册是必然失败
    expect(order).toEqual(['toTemp', 'save']);
  });

  it('抖音端走同一套（tt 优先于 wx）', async () => {
    (globalThis as G).tt = {
      canvasToTempFilePath: (o: any) => o.success({ tempFilePath: 'ttfile://tmp/p.png' }),
      saveImageToPhotosAlbum: (o: any) => o.success(),
    };
    expect(await saveCanvasToAlbum(canvas)).toBe('saved');
  });

  it('平台不支持这两个 API → unsupported（不是 failed）', async () => {
    // 「这端不支持」和「保存失败」要给玩家的话术不同
    expect(await saveCanvasToAlbum(canvas)).toBe('unsupported');
  });

  it('只有导出、没有存相册 → unsupported', async () => {
    (globalThis as G).wx = {
      canvasToTempFilePath: (o: any) => o.success({ tempFilePath: 'x' }),
    };
    expect(await saveCanvasToAlbum(canvas)).toBe('unsupported');
  });

  it('导出失败 → failed', async () => {
    (globalThis as G).wx = {
      canvasToTempFilePath: (o: any) => o.fail({ errMsg: 'boom' }),
      saveImageToPhotosAlbum: (o: any) => o.success(),
    };
    expect(await saveCanvasToAlbum(canvas)).toBe('failed');
  });

  it('导出成功但没给路径 → failed', async () => {
    (globalThis as G).wx = {
      canvasToTempFilePath: (o: any) => o.success({ tempFilePath: '' }),
      saveImageToPhotosAlbum: (o: any) => o.success(),
    };
    expect(await saveCanvasToAlbum(canvas)).toBe('failed');
  });

  it('授权被拒 → denied（要引导去设置，不能重试）', async () => {
    (globalThis as G).wx = {
      canvasToTempFilePath: (o: any) => o.success({ tempFilePath: 'x' }),
      saveImageToPhotosAlbum: (o: any) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }),
    };
    expect(await saveCanvasToAlbum(canvas)).toBe('denied');
  });

  it('别的失败原因 → failed（不是 denied）', async () => {
    (globalThis as G).wx = {
      canvasToTempFilePath: (o: any) => o.success({ tempFilePath: 'x' }),
      saveImageToPhotosAlbum: (o: any) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail system error' }),
    };
    expect(await saveCanvasToAlbum(canvas)).toBe('failed');
  });
});

describe('openPlatformSettings：拉起系统设置页', () => {
  it('平台有 openSetting → 调用它并回报授权状态', async () => {
    let called = false;
    (globalThis as G).wx = {
      openSetting: (o: any) => {
        called = true;
        o.success({ authSetting: { 'scope.writePhotosAlbum': true } });
      },
    };
    expect(await openPlatformSettings()).toBe(true);
    expect(called).toBe(true);
  });

  it('权限仍被拒 → false', async () => {
    (globalThis as G).wx = {
      openSetting: (o: any) => o.success({ authSetting: { 'scope.writePhotosAlbum': false } }),
    };
    expect(await openPlatformSettings()).toBe(false);
  });

  it('老基础库没有 openSetting → false（不抛）', async () => {
    expect(await openPlatformSettings()).toBe(false);
  });

  it('openSetting 抛错 → false', async () => {
    (globalThis as G).wx = {
      openSetting: () => { throw new Error('not supported'); },
    };
    expect(await openPlatformSettings()).toBe(false);
  });
});
