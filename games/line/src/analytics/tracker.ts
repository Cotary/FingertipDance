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
  // 没有 `level_fail`：cover 玩法没有"失败"这个状态（松手只是宽限期，
  // 玩家随时可以接着拖）。真正值得记的两种"没通关"是
  // `level_abandon`（作废重起一笔）与退出关卡 —— 后者靠 `level_start`
  // 的会话时长就能看出来。留一个永远不上报的事件名，只会让人以为漏埋了。
  | 'level_abandon' | 'hint_use' | 'skip_use'
  | 'level_load_fail' | 'progress_report_failed' | 'progress_report_rejected' | 'canvas_resize'
  | 'ad_start' | 'ad_complete' | 'ad_abort' | 'ad_error' | 'ad_blocked'
  | 'skin_unlock' | 'skin_equip' | 'skin_page_view' | 'theme_equip' | 'theme_unlock' | 'theme_page_view'
  | 'leaderboard_view' | 'share_click' | 'share_success'
  // ── 新手引导 ──
  //
  // `tutorial_step` 是每关开始的序号，`tutorial_done` 是三关走完。
  // 后台算引导漏斗就靠这两个：`level_start` 里也带 `tutorial_step`，
  // 所以「走到第 2 关就没再动」这类流失能直接查出来。
  //
  // 引导完成后**首关**的表现才真正决定留存，所以 `tutorial_done`
  // 要带 `maxLevel`（那时通常还是 0），和后面的 `level_pass` 串起来看。
  | 'tutorial_done' | 'tutorial_start'
  // ── 意见反馈 ──
  //
  // `feedback_open` 与 `feedback_submit` 的差值 = 打开文案却放弃提交的人。
  // 那个比例高说明输入体验有问题（键盘弹不出来 / 字数限制太紧），
  // 而不是"玩家不想反馈"——两种结论的改法完全相反。
  | 'feedback_open' | 'feedback_submit'
  // ── 机制首见说明卡 ──
  //
  // `show` 与 `dismiss` 的差值 + dismiss 的 `reason` 一起看：
  // `reason='play'` 占比高 = 玩家根本不读卡就上手（那这张卡设计得没用）；
  // `reason='timeout'` 占比高 = 5 秒不够读（该加长或精简文案）。
  | 'mech_card_show' | 'mech_card_dismiss'
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
