/**
 * 回归测试：Web 端 mock 登录必须是**同一个用户**。
 *
 * ## 背景
 *
 * mock 模式下服务端把 openid 算成 `"mock_openid_" + code`，
 * 所以 **code 变了就是另一个用户**。
 *
 * 以前 web 端的 code 是 `'web_mock_code_' + Date.now()` ——
 * 每次刷新页面都是新用户：
 *
 *   - 进度（max_level / 星级 / 皮肤）全部归零
 *   - 好友榜里堆出一堆同名僵尸账号
 *   - 玩家刷新一次，之前打的关全没了
 *
 * 微信端不会这样（code 由微信服务器签发，同一用户 openid 一致），
 * 所以这是 Web 端**能直接复现**的体验 bug。
 */
import { describe, it, expect, beforeEach } from 'vitest';

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

// localStorage 在 node 环境不存在，要先造一个
(globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;

const { webPlatform } = await import('../src/platform/web');

describe('web 端 mock 登录身份稳定', () => {
  beforeEach(() => store.clear());

  it('同一浏览器多次 login 拿到同一个 code', async () => {
    const a = await webPlatform.login();
    const b = await webPlatform.login();
    const c = await webPlatform.login();
    expect(a.code).toBe(b.code);
    expect(b.code).toBe(c.code);
  });

  it('code 不是基于时间戳的（不随时间变化）', async () => {
    const a = await webPlatform.login();
    await new Promise((r) => setTimeout(r, 30));
    const b = await webPlatform.login();
    expect(a.code).toBe(b.code);
  });

  it('code 被持久化到 localStorage（刷新页面后仍是同一个用户）', async () => {
    const a = await webPlatform.login();
    expect(localStorageMock.getItem('mock_login_code')).toBe(a.code);
  });

  it('code 非空（服务端要求 code 不能为空）', async () => {
    const a = await webPlatform.login();
    expect(a.code.length).toBeGreaterThan(0);
  });
});
