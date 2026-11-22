import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ApiError, ApiCode } from '../src/platform/apiError';

/**
 * 令牌过期必须自动重登。
 *
 * ## 为什么这条值得单独测
 *
 * 服务端 JWT 是 72 小时（`config.prod.yaml` 的 `jwt.ttl_hours`）。
 * 玩家玩到第四天时，**所有**带鉴权的请求都返回 4001，而每个调用点
 * 都在自己的 try/catch 里把它当网络问题吞掉：
 *
 * - 进度不再同步（界面上数字就是不动了）
 * - 通关上报失败 → 乐观更新本地 → 下次登录被服务端冲掉
 * - 排行榜 / 好友榜空白
 *
 * 全都没有报错。所以「4001 → 重登 → 重试」这一条必须是**请求层**的
 * 统一行为，不能指望每个调用点自己记得处理。
 */

const store = new Map<string, string>();

/** 一个只够跑 api.ts 的最小平台桩。 */
function makePlatform(opts: {
  /** 第 n 次请求（从 1 开始）返回什么。返回 ApiError 表示抛错。 */
  respond: (n: number, auth: string | undefined) => unknown;
}) {
  let n = 0;
  return {
    name: 'web' as const,
    login: async () => ({ code: 'mock-code' }),
    request: async (_url: string, _method: string, _data?: unknown, header?: Record<string, string>) => {
      n++;
      const auth = header?.Authorization;
      const r = opts.respond(n, auth);
      if (r instanceof Error) throw r;
      return r;
    },
    storage: {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v),
      remove: (k: string) => void store.delete(k),
    },
  };
}

let platformStub: ReturnType<typeof makePlatform>;

vi.mock('../src/platform', () => ({
  get platform() { return platformStub; },
}));
vi.mock('../src/analytics/tracker', () => ({
  tracker: { flush: async () => {}, track: () => {} },
}));

/** 每次都重新加载 api.ts（它把 token 缓存在模块作用域里）。 */
async function loadApi(p: ReturnType<typeof makePlatform>) {
  platformStub = p;
  store.set('token', 'OLD_TOKEN');
  vi.resetModules();
  return import('../src/net/api');
}

describe('令牌过期', () => {
  beforeEach(() => store.clear());
  afterEach(() => vi.resetModules());

  it('4001 → 重新登录 → 用新令牌重试原请求', async () => {
    let retryAuth: string | undefined;
    const api = await loadApi(makePlatform({
      respond: (n, auth) => {
        // 第 1 次：旧令牌 → 4001
        if (n === 1) return new ApiError(ApiCode.Unauthorized, '令牌无效');
        // 第 2 次：登录，发新令牌
        if (n === 2) return { token: 'NEW_TOKEN', uid: 7 };
        // 第 3 次：原请求，必须带新令牌
        retryAuth = auth;
        return { maxLevel: 12, unlockedSkins: [] };
      },
    }));

    const res = await api.fetchProfile();
    expect(res.maxLevel).toBe(12);
    expect(retryAuth).toBe('Bearer NEW_TOKEN');
    // 新令牌要落盘，下次冷启动直接用
    expect(store.get('token')).toBe('NEW_TOKEN');
  });

  it('重登后仍然 4001 → 不无限重试，直接把错误抛出去', async () => {
    let requests = 0;
    const api = await loadApi(makePlatform({
      respond: (n) => {
        requests = n;
        // 登录成功发令牌，但业务请求永远 4001（签名错了 / 账号被封）
        if (n === 2) return { token: 'NEW_TOKEN', uid: 7 };
        return new ApiError(ApiCode.Unauthorized, '令牌无效');
      },
    }));

    await expect(api.fetchProfile()).rejects.toBeInstanceOf(ApiError);
    // 1 次原请求 + 1 次登录 + 1 次重试 = 3，绝不能更多
    expect(requests).toBe(3);
  });

  it('并发请求撞上 4001 只重登一次（不各登一遍）', async () => {
    let logins = 0;
    const api = await loadApi(makePlatform({
      respond: (_n, auth) => {
        // 登录请求不带 Authorization —— 用它区分「登录」和「业务请求」
        if (auth === undefined) {
          logins++;
          return { token: 'NEW_TOKEN', uid: 1 };
        }
        // 用旧令牌的业务请求一律 4001，用新令牌的放行
        if (auth === 'Bearer OLD_TOKEN') return new ApiError(ApiCode.Unauthorized, '令牌无效');
        return { maxLevel: 1, unlockedSkins: [] };
      },
    }));

    const [a, b] = await Promise.allSettled([api.fetchProfile(), api.fetchProfile()]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    // 两个请求同时撞上 4001，但共用同一个重登 Promise
    expect(logins).toBe(1);
  });

  it('非 4001 的错误不触发重登（网络故障照常抛给调用方）', async () => {
    let requests = 0;
    const api = await loadApi(makePlatform({
      respond: (n) => {
        requests = n;
        return new Error('网络请求失败');
      },
    }));

    await expect(api.fetchProfile()).rejects.toThrow('网络请求失败');
    expect(requests).toBe(1);
  });

  it('业务拒绝（4008 路径非法）不触发重登 —— 那是数据问题，不是身份问题', async () => {
    let requests = 0;
    const api = await loadApi(makePlatform({
      respond: (n) => {
        requests = n;
        return new ApiError(ApiCode.PathIllegal, '路径非法');
      },
    }));

    await expect(api.fetchProfile()).rejects.toBeInstanceOf(ApiError);
    expect(requests).toBe(1);
  });
});
