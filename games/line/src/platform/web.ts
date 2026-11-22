import type { Platform } from './types';
import { ApiError } from './apiError';

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
 * 写剪贴板（浏览器）。
 *
 * 两条路：`navigator.clipboard` 需要**安全上下文**（https / localhost），
 * 内网 http 调试时不满足，所以再挂一个 `execCommand` 兜底 ——
 * 否则本地调试时会发现「复制链接」永远失败。
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 落到下面的 execCommand
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Web 平台实现。广告用假倒计时模拟，登录返回 mock code。
 */
export const webPlatform: Platform = {
  name: 'web',

  async login() {
    return { code: stableMockCode() };
  },

  /**
   * 启动参数 = URL 的 search。
   *
   * Web 端没有「热启动」这回事（刷新即重载），所以只有这一处来源。
   */
  launchQuery(): Record<string, string> {
    if (typeof location === 'undefined') return {};
    try {
      return Object.fromEntries(new URLSearchParams(location.search).entries());
    } catch {
      return {};
    }
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
      if (json.code !== 0) throw new ApiError(json.code, json.msg);
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

  /**
   * 分享（Web 端）。
   *
   * 浏览器里没有"好友 / 朋友圈"这两个目标，但有两级能力可以借用：
   *
   * 1. **系统分享面板** —— `navigator.share`（移动端 Safari / Chrome 支持）。
   *    它把链接交给系统的分享目标（微信、消息、邮件…），是最接近
   *    「分享给好友」的等价物。用户取消会抛 `AbortError`，要当作失败，
   *    不能算成分享成功。
   * 2. **复制链接** —— 没有系统分享时的兜底。链接进剪贴板，
   *    玩家自己粘到任何地方。
   *
   * 注意 `navigator.share` 必须在**用户手势**的调用栈里才可用，
   * 异步链路太长（先拉数据再分享）会被浏览器拒绝 —— 这里已经是
   * 按钮回调的同步尾巴，暂时安全，将来加异步前置要重新评估。
   */
  async share(opts) {
    const url = `${location.origin}${location.pathname}${opts.query ? `?${opts.query}` : ''}`;

    // 系统分享面板：只有真能分享时才走，避免每次都弹一个假的
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: opts.title, url });
        return 'sent';
      } catch (e) {
        // 用户主动取消 ≠ 失败，但也不该报「已分享」。
        // 两条路都落到剪贴板兜底：链接已经在手里了，别让他空手走。
        if ((e as DOMException)?.name === 'AbortError') return 'failed';
      }
    }

    return (await copyText(url)) ? 'copied' : 'failed';
  },

  /** 复制链接（与 `share` 内部的兜底同一个实现，避免两处不一致）。 */
  clipboard: { set: copyText },

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

  /**
   * Web 只有「分享」一个通道 —— 走 `navigator.share`，由系统面板
   * 决定能发给谁（微信 / 消息 / 邮件…）。没有朋友圈这个概念。
   */
  shareChannels: ['friend'] as const,
};
