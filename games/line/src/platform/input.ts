/**
 * 系统键盘输入 + 相册选图。两端同形，收在一个文件里。
 *
 * ## 为什么不能自己画输入框
 *
 * Canvas 能画方框和光标，但**画不出输入法** —— 中文要候选词、要拼音组合，
 * 这些只有系统键盘能做。自己画的结果是玩家只能打英文，
 * 而意见反馈恰恰是最需要说清楚的地方。
 *
 * ## 为什么键盘事件要注册多个回调
 *
 * `wx.showKeyboard` 只是"弹出来"，按「完成」并不会 resolve 任何 Promise ——
 * 结果是通过 `onKeyboardConfirm` / `onKeyboardComplete` 推过来的。
 * 三个回调都可能先到：
 *
 * - `onKeyboardConfirm` —— 按了"完成"
 * - `onKeyboardComplete` —— 键盘收起了（用户点空白处、按了取消）
 * - `onKeyboardInput` —— 每次输入变化（这里不用，只用最终值）
 *
 * **必须做去重**：在 iOS 上按"完成"会先 `confirm` 再 `complete`，
 * 不去重的话同一个 Promise 被 resolve 两次（第二次无效但逻辑会走两遍），
 * 而且 `complete` 会把 `confirm` 的结果盖成空串。
 */
import type { KeyboardResult, PickImageResult } from './types';

interface MiniGlobal {
  showKeyboard?: (opts: Record<string, unknown>) => void;
  hideKeyboard?: (opts?: Record<string, unknown>) => void;
  updateKeyboard?: (opts: Record<string, unknown>) => void;
  onKeyboardConfirm?: (cb: (res: any) => void) => void;
  onKeyboardComplete?: (cb: (res: any) => void) => void;
  offKeyboardConfirm?: (cb?: (res: any) => void) => void;
  offKeyboardComplete?: (cb?: (res: any) => void) => void;
  chooseMedia?: (opts: Record<string, unknown>) => void;
  chooseImage?: (opts: Record<string, unknown>) => void;
}

function miniGlobal(name: 'wx' | 'tt'): MiniGlobal | undefined {
  const g = globalThis as { wx?: MiniGlobal; tt?: MiniGlobal };
  if (name === 'tt') return g.tt;
  return g.wx;
}

/**
 * 弹键盘让玩家输入一段文字。
 *
 * @param name 平台命名空间
 */
export function inputTextOn(name: 'wx' | 'tt', opts: {
  defaultValue?: string;
  confirmText?: string;
  maxLength?: number;
  placeholder?: string;
}): Promise<KeyboardResult> {
  const api = miniGlobal(name);
  if (!api || typeof api.showKeyboard !== 'function') {
    return Promise.resolve({ kind: 'unsupported' });
  }
  const host = api;

  return new Promise<KeyboardResult>((resolve) => {
    // 只允许 settle 一次。iOS 上 confirm 之后还会来一次 complete，
    // 不去重的话 `complete` 会把 confirm 的文本盖成空串。
    let settled = false;
    const finish = (r: KeyboardResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      // 收键盘。玩家点"完成"时平台通常自己会收，但部分安卓机不会，
      // 留下一个悬空的键盘会盖住半屏。
      try { host.hideKeyboard?.({}); } catch { /* noop */ }
      resolve(r);
    };

    const onConfirm = (res?: { value?: string }) => {
      finish({ kind: 'ok', text: String(res?.value ?? '') });
    };
    const onComplete = (res?: { value?: string }) => {
      // 收起但没按确认：用户点了空白处 / 按了取消。
      // 如果带了文本就当确认（部分机型只有 complete 没有 confirm）。
      const text = String(res?.value ?? '');
      if (text.length > 0) finish({ kind: 'ok', text });
      else finish({ kind: 'cancel' });
    };

    function cleanup() {
      try {
        host.offKeyboardConfirm?.(onConfirm);
        host.offKeyboardComplete?.(onComplete);
      } catch { /* 老基础库没有 off* */ }
    }

    try {
      host.onKeyboardConfirm?.(onConfirm);
      host.onKeyboardComplete?.(onComplete);
      host.showKeyboard!({
        defaultValue: opts.defaultValue ?? '',
        maxLength: opts.maxLength ?? 200,
        multiple: true,
        confirmHold: false,
        confirmType: 'done',
        // `confirmText` 微信要求 ≤4 字，超了会静默不生效
        confirmText: (opts.confirmText ?? '完成').slice(0, 4),
        // placeholder 只在部分版本生效，不给也不会坏
        ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
        fail: () => finish({ kind: 'unsupported' }),
      });
    } catch {
      finish({ kind: 'unsupported' });
    }
  });
}

/**
 * 从相册选一张图。
 *
 * 优先 `chooseMedia`（微信 2.10+ 推荐），退回 `chooseImage`（老版本 / 抖音）。
 * 用户取消不是错误，返回 `cancel`。
 */
export function pickImageOn(name: 'wx' | 'tt'): Promise<PickImageResult> {
  const api = miniGlobal(name);
  if (!api) return Promise.resolve({ kind: 'unsupported' });

  return new Promise<PickImageResult>((resolve) => {
    let settled = false;
    const finish = (r: PickImageResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    /** 微信 chooseMedia 返回 tempFiles，chooseImage 返回 tempFilePaths */
    const extract = (res: unknown): string | null => {
      const r = res as {
        tempFiles?: Array<{ tempFilePath?: string }>;
        tempFilePaths?: string[];
      };
      const fromMedia = r?.tempFiles?.[0]?.tempFilePath;
      if (fromMedia) return fromMedia;
      const fromImage = r?.tempFilePaths?.[0];
      if (fromImage) return fromImage;
      return null;
    };

    const isCancel = (err: unknown): boolean => {
      const msg = String((err as { errMsg?: string })?.errMsg ?? err ?? '');
      return /cancel/i.test(msg);
    };

    if (typeof api.chooseMedia === 'function') {
      api.chooseMedia({
        count: 1,
        mediaType: ['image'],
        // 压缩后再传：原图动辄 5MB，服务端限制 2m（nginx `client_max_body_size`），
        // 而且玩家在弱网下传一张原图要等半分钟。
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res: unknown) => {
          const p = extract(res);
          finish(p ? { kind: 'ok', path: p } : { kind: 'cancel' });
        },
        fail: (err: unknown) => finish(isCancel(err) ? { kind: 'cancel' } : { kind: 'unsupported' }),
      });
      return;
    }

    if (typeof api.chooseImage === 'function') {
      api.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res: unknown) => {
          const p = extract(res);
          finish(p ? { kind: 'ok', path: p } : { kind: 'cancel' });
        },
        fail: (err: unknown) => finish(isCancel(err) ? { kind: 'cancel' } : { kind: 'unsupported' }),
      });
      return;
    }

    finish({ kind: 'unsupported' });
  });
}

/**
 * 把本地临时文件读成 base64（上传用）。
 *
 * 小游戏没有 `FormData` / `FileReader`，所以走 `getFileSystemManager().readFile`
 * 的 `encoding: 'base64'`。服务端按 JSON 收 base64，再落盘 / 存库。
 */
export function readFileBase64(name: 'wx' | 'tt', path: string): Promise<string | null> {
  const g = globalThis as {
    wx?: { getFileSystemManager?: () => { readFile?: (o: Record<string, unknown>) => void } };
    tt?: { getFileSystemManager?: () => { readFile?: (o: Record<string, unknown>) => void } };
  };
  const api = name === 'tt' ? g.tt : g.wx;
  const fs = api?.getFileSystemManager?.();
  if (!fs || typeof fs.readFile !== 'function') return Promise.resolve(null);
  const readFile = fs.readFile as (o: Record<string, unknown>) => void;

  return new Promise<string | null>((resolve) => {
    readFile({
      filePath: path,
      encoding: 'base64',
      success: (res: { data?: string }) => resolve(res?.data ?? null),
      fail: () => resolve(null),
    });
  });
}
