import type { Platform } from './types';

/** Web 端的 mock 存储。 */
const mem = new Map<string, string>();

/**
 * Web 平台实现。广告用假倒计时模拟，登录返回 mock code。
 */
export const webPlatform: Platform = {
  name: 'web',

  async login() {
    return { code: 'web_mock_code_' + Date.now() };
  },

  async request<T>(url: string, method: 'GET' | 'POST', data?: unknown, header?: Record<string, string>): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(header ?? {}) },
      body: method === 'POST' ? JSON.stringify(data ?? {}) : undefined,
    });
    const json = (await res.json()) as { code: number; msg: string; data: T };
    if (json.code !== 0) throw new Error(`${json.code}: ${json.msg}`);
    return json.data;
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

  vibrate() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(30);
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

  openDataAvailable: false,
};
