import { platform } from '../platform';

/** 埋点事件名。 */
export type EventName =
  | 'app_start' | 'login_success' | 'level_start' | 'tile_light' | 'level_pass'
  | 'level_fail' | 'level_abandon' | 'hint_use' | 'skip_use'
  | 'ad_start' | 'ad_complete' | 'ad_abort' | 'ad_error'
  | 'skin_unlock' | 'skin_equip' | 'skin_page_view'
  | 'leaderboard_view' | 'share_click' | 'share_success'
  | 'challenge_start' | 'challenge_result';

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
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.slice(0, 50);
    const token = platform.storage.get('token');
    try {
      await platform.request('/api/report', 'POST', { events: batch }, token ? { Authorization: `Bearer ${token}` } : undefined);
      this.buffer.splice(0, batch.length);
      this.persist();
      if (this.buffer.length > 0) setTimeout(() => void this.flush(), 1000);
    } catch {
      // 上报失败 → 保留在缓冲里，下次重试
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
