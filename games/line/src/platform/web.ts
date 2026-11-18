import type { Platform } from './types';

/**
 * Web 端的 mock 存储。
 */
const mem = new Map<string, string>();

/**
 * 稳定的 mock 登录 code。
 *
 * ## 为什么不能每次都生成新的
 *
 * mock 模式下服务端把 openid 算成 `"mock_openid_" + code`
 * （见 `server/internal/platform/wechat/code2session.go`），
 * 所以 **code 变了就是另一个用户**。
 *
 * 以前这里写的是 `'web_mock_code_' + Date.now()` —— 每次刷新页面都是新用户：
 *
 *   - 进度（max_level / 星级 / 皮肤）全部归零
 *   - 好友榜里堆出一堆同名僵尸账号
 *   - 玩家刷新一次，之前打的关全没了
 *
 * 这在 Web 上是**能直接复现的体验 bug**（微信端不会，因为 code 由微信服务器签发，
 * 同一个用户拿到的 openid 是一致的）。
 *
 * 现在把 code 持久化到 localStorage —— 同一个浏览器始终是同一个用户。
 */
const MOCK_CODE_KEY = 'mock_login_code';

/** 取（或创建）稳定的 mock code。 */
function stableMockCode(): string {
  if (typeof localStorage !== 'undefined') {
    const existing = localStorage.getItem(MOCK_CODE_KEY);
    if (existing) return existing;
    const created = 'web_mock_code_' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(MOCK_CODE_KEY, created);
    return created;
  }
  return 'web_mock_code_' + Math.random().toString(36).slice(2, 12);
}

/**
 * Web 平台实现。广告用假倒计时模拟，登录返回 mock code。
 */
export const webPlatform: Platform = {
  name: 'web',

  async login() {
    return { code: stableMockCode() };
  },

  async request<T>(url: string, method: 'GET' | 'POST', data?: unknown, header?: Record<string, string>): Promise<T> {
    // 请求超时。
    //
    // ## 为什么必须有
    //
    // 数据库不可用时后端不会返回 500，而是**一直挂着**（连接池等不到连接）。
    // `fetch` 没有默认超时 —— 没有这段，`login()` 会永远 pending，
    // `boot()` 停在第一步，玩家看到的是「陶土背景 + 什么都没有」，
    // 控制台干干净净，连一条错误都没有。
    //
    // 10 秒是留给慢网的余量：查关卡表这种请求在 3G 上也能在 2 秒内回来，
    // 真超过 10 秒，等下去也不会变好。
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 10_000) : 0;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(header ?? {}) },
        body: method === 'POST' ? JSON.stringify(data ?? {}) : undefined,
        signal: ctrl?.signal,
      });
      const json = (await res.json()) as { code: number; msg: string; data: T };
      if (json.code !== 0) throw new Error(`${json.code}: ${json.msg}`);
      return json.data;
    } catch (e) {
      // 超时和网络错误分开报，否则日志里只剩一句 "AbortError"，看不出是哪个接口
      if ((e as Error)?.name === 'AbortError') throw new Error(`请求超时 ${Math.round(10)}s: ${url}`);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  storage: {
    get: (k) => (mem.has(k) ? mem.get(k)! : (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null)),
    set: (k, v) => { mem.set(k, v); try { localStorage.setItem(k, v); } catch { /* 隐私模式 */ } },
    remove: (k) => { mem.delete(k); try { localStorage.removeItem(k); } catch { /* noop */ } },
  },

  ad: {
    async showRewarded(placement: string) {
      console.log('[mock ad] rewarded', placement);
      // 模拟 3 秒广告
      await new Promise((r) => setTimeout(r, 3000));
      return true;
    },
    async showInterstitial(placement: string) {
      console.log('[mock ad] interstitial', placement);
    },
    showBanner() { console.log('[mock ad] banner show'); },
    hideBanner() { console.log('[mock ad] banner hide'); },
  },

  async share(opts) {
    console.log('[mock share]', opts);
    const url = `${location.origin}${location.pathname}?${opts.query ?? ''}`;
    try { await navigator.clipboard.writeText(url); } catch { /* noop */ }
  },

  vibrate(pattern: number | number[] = 15) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  },

  getCanvas() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    return { canvas, width, height, dpr };
  },

  /**
   * 重新测量画布尺寸。
   *
   * 手机端地址栏收缩 / 横竖屏切换后会调用。
   * 画布的 `width`/`height` 是**设备像素**（= CSS 尺寸 × dpr），
   * `style.width/height` 才是 CSS 尺寸 —— 两者都要更新。
   */
  resizeCanvas() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    return { canvas, width, height, dpr };
  },

  /**
   * 订阅尺寸变化。
   *
   * 监听 `resize` + `orientationchange`（后者在移动端更可靠 ——
   * 某些浏览器只触发 orientationchange 而不触发 resize）。
   */
  onResize(cb: () => void) {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('resize', cb);
    window.addEventListener('orientationchange', cb);
    return () => {
      window.removeEventListener('resize', cb);
      window.removeEventListener('orientationchange', cb);
    };
  },

  openDataAvailable: false,
};
