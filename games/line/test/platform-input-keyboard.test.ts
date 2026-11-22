import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { inputTextOn, pickImageOn, readFileBase64 } from '../src/platform/input';

/**
 * 系统键盘与相册选图。
 *
 * ## 这两条最容易写错的地方
 *
 * 1. **键盘结果不是 Promise 返回的** —— `showKeyboard` 只是"弹出来"，
 *    文本通过 `onKeyboardConfirm` / `onKeyboardComplete` 推过来。
 * 2. **iOS 会推两次**（confirm 之后又来 complete），不去重的话
 *    `complete` 的 `value` 常常是空串，会把用户输入盖掉。
 * 3. 拿不到能力时必须 `unsupported`，**不能**退化成自己画输入框
 *    （Canvas 画不出输入法，玩家只能打英文）。
 */

type G = { wx?: Record<string, unknown>; tt?: Record<string, unknown> };
const KEYS = ['wx', 'tt'] as const;
const SAVED = KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);

beforeEach(() => {
  const g = globalThis as G;
  delete g.wx;
  delete g.tt;
});

afterEach(() => {
  for (const [k, desc] of SAVED) {
    if (desc) Object.defineProperty(globalThis, k, desc);
    else delete (globalThis as Record<string, unknown>)[k];
  }
});

/** 造一个键盘宿主：记录注册的回调，供测试手动触发。 */
function keyboardHost() {
  const cb: Record<string, ((r?: unknown) => void) | undefined> = {};
  const shown: Record<string, unknown>[] = [];
  let hidden = 0;
  const api = {
    showKeyboard: (o: Record<string, unknown>) => { shown.push(o); },
    hideKeyboard: () => { hidden++; },
    onKeyboardConfirm: (f: (r?: unknown) => void) => { cb.confirm = f; },
    onKeyboardComplete: (f: (r?: unknown) => void) => { cb.complete = f; },
    offKeyboardConfirm: (f?: unknown) => { if (!f || cb.confirm === f) cb.confirm = undefined; },
    offKeyboardComplete: (f?: unknown) => { if (!f || cb.complete === f) cb.complete = undefined; },
  };
  return { api, cb, shown, hiddenCount: () => hidden };
}

describe('inputText · 微信', () => {
  it('按「完成」返回输入的文字', async () => {
    const h = keyboardHost();
    (globalThis as G).wx = h.api;
    const p = inputTextOn('wx', { defaultValue: 'abc' });
    h.cb.confirm!({ value: '第 47 关过不去' });
    const r = await p;
    expect(r).toEqual({ kind: 'ok', text: '第 47 关过不去' });
  });

  it('弹键盘时带上默认值与字数上限', async () => {
    const h = keyboardHost();
    (globalThis as G).wx = h.api;
    const p = inputTextOn('wx', { defaultValue: '旧内容', maxLength: 300 });
    h.cb.confirm!({ value: '' });
    await p;
    expect(h.shown[0]).toMatchObject({ defaultValue: '旧内容', maxLength: 300 });
  });

  it('收起键盘（complete 且无文本）→ cancel', async () => {
    const h = keyboardHost();
    (globalThis as G).wx = h.api;
    const p = inputTextOn('wx', {});
    h.cb.complete!({ value: '' });
    expect(await p).toEqual({ kind: 'cancel' });
  });

  it('iOS 上 confirm 之后的 complete **不能**把结果盖成空串', async () => {
    const h = keyboardHost();
    (globalThis as G).wx = h.api;
    const p = inputTextOn('wx', {});
    // 真实 iOS 行为：confirm 与 complete 都已经被排进事件队列，
    // 所以即使我们注销了回调，那一帧仍会调用**先前捕获的引用**。
    const completeRef = h.cb.complete!;
    h.cb.confirm!({ value: '真实输入' });
    completeRef({ value: '' });
    expect(await p).toEqual({ kind: 'ok', text: '真实输入' });
  });

  it('只有 complete 且带文本时也当确认（部分安卓机没有 confirm）', async () => {
    const h = keyboardHost();
    (globalThis as G).wx = h.api;
    const p = inputTextOn('wx', {});
    h.cb.complete!({ value: '安卓输入' });
    expect(await p).toEqual({ kind: 'ok', text: '安卓输入' });
  });

  it('结束时会收键盘（否则安卓上留一个悬空键盘盖半屏）', async () => {
    const h = keyboardHost();
    (globalThis as G).wx = h.api;
    const p = inputTextOn('wx', {});
    h.cb.confirm!({ value: 'x' });
    await p;
    expect(h.hiddenCount()).toBe(1);
  });

  it('没有 showKeyboard 时返回 unsupported，不抛', async () => {
    (globalThis as G).wx = {};
    expect(await inputTextOn('wx', {})).toEqual({ kind: 'unsupported' });
    expect(await inputTextOn('wx', {})).not.toHaveProperty('text');
  });

  it('抖音走 tt 命名空间', async () => {
    const h = keyboardHost();
    (globalThis as G).tt = h.api;
    const p = inputTextOn('tt', {});
    h.cb.confirm!({ value: '抖音' });
    expect(await p).toEqual({ kind: 'ok', text: '抖音' });
  });
});

describe('pickImage', () => {
  it('chooseMedia 优先，取 tempFiles[0].tempFilePath', async () => {
    let used = '';
    (globalThis as G).wx = {
      chooseMedia: (o: any) => {
        used = 'media';
        o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/a.jpg' }] });
      },
      chooseImage: () => { used = 'image'; },
    };
    expect(await pickImageOn('wx')).toEqual({ kind: 'ok', path: 'wxfile://tmp/a.jpg' });
    expect(used).toBe('media');
  });

  it('老基础库退回 chooseImage，取 tempFilePaths[0]', async () => {
    (globalThis as G).wx = {
      chooseImage: (o: any) => o.success({ tempFilePaths: ['wxfile://tmp/b.jpg'] }),
    };
    expect(await pickImageOn('wx')).toEqual({ kind: 'ok', path: 'wxfile://tmp/b.jpg' });
  });

  it('用户取消 → cancel（不是错误）', async () => {
    (globalThis as G).wx = {
      chooseMedia: (o: any) => o.fail({ errMsg: 'chooseMedia:fail cancel' }),
    };
    expect(await pickImageOn('wx')).toEqual({ kind: 'cancel' });
  });

  it('权限被拒 → unsupported（调用方据此改文案，不能假装用户取消）', async () => {
    (globalThis as G).wx = {
      chooseMedia: (o: any) => o.fail({ errMsg: 'chooseMedia:fail auth deny' }),
    };
    expect(await pickImageOn('wx')).toEqual({ kind: 'unsupported' });
  });

  it('压缩参数必须带上（原图 5MB 会撞 nginx 的 2m 上限）', async () => {
    let opts: any = null;
    (globalThis as G).wx = { chooseMedia: (o: any) => { opts = o; o.fail({ errMsg: 'cancel' }); } };
    await pickImageOn('wx');
    expect(opts.sizeType).toEqual(['compressed']);
    expect(opts.count).toBe(1);
  });

  it('能力全无 → unsupported', async () => {
    expect(await pickImageOn('wx')).toEqual({ kind: 'unsupported' });
  });
});

describe('readFileBase64', () => {
  it('读成 base64', async () => {
    (globalThis as G).wx = {
      getFileSystemManager: () => ({
        readFile: (o: any) => o.success({ data: 'AAAA' }),
      }),
    };
    expect(await readFileBase64('wx', 'wxfile://tmp/a.jpg')).toBe('AAAA');
  });

  it('读失败返回 null（调用方据此丢图保文字）', async () => {
    (globalThis as G).wx = {
      getFileSystemManager: () => ({ readFile: (o: any) => o.fail({}) }),
    };
    expect(await readFileBase64('wx', 'x')).toBeNull();
  });

  it('没有 FS 管理器时返回 null，不抛', async () => {
    expect(await readFileBase64('wx', 'x')).toBeNull();
  });

  it('抖音走 tt', async () => {
    (globalThis as G).tt = {
      getFileSystemManager: () => ({ readFile: (o: any) => o.success({ data: 'BBBB' }) }),
    };
    expect(await readFileBase64('tt', 'x')).toBe('BBBB');
  });
});
