import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 埋点上报测试。
 *
 * ## 为什么要测这个
 *
 * 2026-11-07 查出两个真实 bug：
 *
 *  1. `tracker.flush()` 用的是**相对路径** `'/api/report'`，
 *     它会打到前端 dev server（Vite）而不是后端 —— 404，事件永远卡在本地缓冲里。
 *     更糟的情况是页面挂在反向代理后面时，相对路径会解析到别人的域名。
 *  2. 缓冲**无上限**，后端长期不可达时会把 localStorage 撑爆。
 */

/** 记录所有发出的请求。 */
const requests: Array<{ url: string; method: string; data: unknown; header?: Record<string, string> }> = [];

/** mock 的 storage。 */
const store = new Map<string, string>();

/** 请求失败开关（模拟后端不通）。 */
let failRequests = false;

vi.mock('../src/platform', () => ({
  platform: {
    name: 'web',
    storage: {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => { store.set(k, v); },
      remove: (k: string) => { store.delete(k); },
    },
    request: async (url: string, method: string, data?: unknown, header?: Record<string, string>) => {
      requests.push({ url, method, data, header });
      if (failRequests) throw new Error('网络请求失败');
      return { ok: true };
    },
  },
}));

const { tracker } = await import('../src/analytics/tracker');

describe('tracker', () => {
  beforeEach(() => {
    requests.length = 0;
    store.clear();
    failRequests = false;
  });

  it('上报到后端地址（不能用相对路径）', async () => {
    tracker.track('app_start');
    await tracker.flush();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toBe(__API_BASE__ + '/api/report');
    // 相对路径会打到前端 dev server 或反向代理 —— 必须是绝对的后端地址
    expect(requests[0].url.startsWith('/')).toBe(false);
    expect(requests[0].url).toMatch(/^https?:\/\//);
  });

  it('有 token 时带上 Authorization', async () => {
    store.set('token', 'test-token');
    tracker.track('app_start');
    await tracker.flush();

    expect(requests[0].header).toEqual({ Authorization: 'Bearer test-token' });
  });

  it('无 token 时也能上报（服务端允许匿名）', async () => {
    tracker.track('app_start');
    await tracker.flush();

    // 登录之前的事件没有 token，服务端 /api/report 允许匿名上报
    expect(requests[0].header).toBeUndefined();
  });

  it('上报成功后清空缓冲', async () => {
    tracker.track('app_start');
    tracker.track('level_start');
    await tracker.flush();

    const buffered = JSON.parse(store.get('event_buffer') ?? '[]');
    expect(buffered.length).toBe(0);
  });

  it('上报失败时保留事件等重试', async () => {
    failRequests = true;
    tracker.track('app_start');
    await tracker.flush();

    const buffered = JSON.parse(store.get('event_buffer') ?? '[]');
    expect(buffered.length).toBe(1);
    expect(buffered[0].name).toBe('app_start');
  });

  it('缓冲有上限：后端长期不通不会撑爆 localStorage', async () => {
    failRequests = true;
    // 连续记录远超过上限
    for (let i = 0; i < 500; i++) tracker.track('tile_light');
    await tracker.flush();

    const buffered = JSON.parse(store.get('event_buffer') ?? '[]');
    // tracker.ts 里 MAX_BUFFER = 200
    expect(buffered.length).toBeLessThanOrEqual(200);
    expect(buffered.length).toBeGreaterThan(0);
  });
});
