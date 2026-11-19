import { platform } from '../platform';

/**
 * 埋点上报的后端地址。
 *
 * ## 为什么要显式拼 `__API_BASE__`
 *
 * 之前这里写的是相对路径 `'/api/report'`。在本地开发时它会打到 **前端 dev server**
 * （Vite），而不是后端 —— 而 Vite 上没有这个路由，于是 404，
 * 埋点事件就永远卡在本地缓冲里（现象：`localStorage.event_buffer` 一直增长）。
 *
 * 更糟的情况是页面被挂在反向代理后面时，相对路径会解析成
 * `https://<代理域名>/api/report` —— 打到别人的服务上。
 *
 * 统一用 `__API_BASE__`（构建期注入的后端地址），和 `net/api.ts` 保持一致。
 */
const API_BASE = __API_BASE__;

/** 埋点事件名。 */
export type EventName =
  | 'app_start' | 'login_success'   | 'level_start' | 'tile_light' | 'level_pass'
  | 'level_fail' | 'level_abandon' | 'hint_use' | 'skip_use'
  | 'level_load_fail' | 'progress_report_failed' | 'progress_report_rejected' | 'canvas_resize'
  | 'ad_start' | 'ad_complete' | 'ad_abort' | 'ad_error'
  | 'skin_unlock' | 'skin_equip' | 'skin_page_view' | 'theme_equip' | 'theme_page_view'
  | 'leaderboard_view' | 'share_click' | 'share_success'
  | 'challenge_start' | 'challenge_result'
  // 大厅体系（T23）
  | 'nav_click' | 'home_start_click' | 'map_level_click'
  | 'leaderboard_tab_switch' | 'profile_view' | 'profile_stats_view';

/** 缓冲的事件。 */
interface BufferedEvent {
  name: EventName;
  ts: number;
  params: Record<string, unknown>;
}

const KEY_BUFFER = 'event_buffer';
const MAX_BUFFER = 200;

/**
 * 埋点追踪器。本地缓冲 + 批量上报 + 断网补传。
 * 注意：本模块只依赖 platform（含 storage 里的 token），不 import net/api，
 * 以避免 net/api → tracker → net/api 的循环依赖。
 */
export class Tracker {
  private buffer: BufferedEvent[] = [];

  /** 初始化：从本地恢复缓冲。 */
  init(): void {
    const raw = platform.storage.get(KEY_BUFFER);
    if (!raw) return;
    try {
      const arr = JSON.parse(raw) as BufferedEvent[];
      if (Array.isArray(arr)) this.buffer = arr.slice(0, MAX_BUFFER);
    } catch { /* 忽略损坏缓存 */ }
    // 恢复后立即补传
    if (this.buffer.length > 0) void this.flush();
  }

  /**
   * 记录一个事件。
   */
  track(name: EventName, params: Record<string, unknown> = {}): void {
    this.buffer.push({ name, ts: Date.now(), params });
    if (this.buffer.length >= 20) {
      void this.flush();
    } else {
      this.persist();
    }
  }

  /**
   * 批量上报。
   *
   * ## 鉴权是可选的
   *
   * 埋点在 `login()` **之前**就开始记了（`app_start` 是启动第一个事件），
   * 所以上报时可能还没有 token —— 服务端 `/api/report` 允许匿名上报，
   * 事件按 uid=0 归档，等登录成功后的下一批再补上带 uid 的。
   *
   * 失败时**保留缓冲**等下次重试，但要有上限，否则
   * 「后端一直没通」会导致缓冲无限增长（localStorage 写满 → 整个存储不可用）。
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.slice(0, 50);
    const token = platform.storage.get('token');
    try {
      await platform.request(
        API_BASE + '/api/report',
        'POST',
        { events: batch },
        token ? { Authorization: `Bearer ${token}` } : undefined,
      );
      this.buffer.splice(0, batch.length);
      this.persist();
      if (this.buffer.length > 0) setTimeout(() => void this.flush(), 1000);
    } catch {
      // 上报失败 → 保留在缓冲里，下次重试
      //
      // 但不能无限重试：缓冲满了就**丢弃最旧的**，
      // 否则后端长期不可达时缓冲会涨到把 localStorage 撑爆。
      if (this.buffer.length >= MAX_BUFFER) {
        this.buffer.splice(0, this.buffer.length - MAX_BUFFER + 1);
      }
      this.persist();
    }
  }

  /** 持久化缓冲。 */
  private persist(): void {
    try {
      platform.storage.set(KEY_BUFFER, JSON.stringify(this.buffer.slice(-MAX_BUFFER)));
    } catch { /* 存储满了就放弃 */ }
  }
}

/** 全局单例。 */
export const tracker = new Tracker();

/**
 * 便捷函数。保留与 `net/api.reportEvent` 的兼容。
 */
export function track(name: EventName, params: Record<string, unknown> = {}): void {
  tracker.track(name, params);
}
