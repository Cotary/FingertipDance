import { platform } from '../platform';
import { fetchLevels } from '../net/api';
import type { Level } from '../core/types';

/** 本地缓存键。 */
const KEY_LEVELS = 'levels_cache';
const KEY_PROGRESS = 'progress';

/** 缓存的关卡表。 */
interface CachedLevels {
  version: string;
  levels: Level[];
}

/** 玩家进度。 */
export interface Progress {
  /**
   * 最高**已通关**关号（服务端 `users.max_level` 的原样值）。
   *
   * 语义必须和服务端一致：`0` = 一关都没通，`3` = 最高打通了第 3 关。
   *
   * ## 注意：这不是「当前该打哪一关」
   *
   * 通关第 N 关之后，**下一个可玩关号是 N+1**。
   * 所有「继续 / 解锁 / 当前关」的判断都要用 `currentLevel`，不要直接用 `maxLevel`。
   * 早期两边混用，导致通关第 1 关后大厅还写「继续 第 1 关」、地图把第 2 关锁着。
   */
  maxLevel: number;
  unlockedSkins: string[];
  currentSkin: string;
  /**
   * 当前装备的**棋盘主题** id。空串 = 不启用主题，走原来的黏土皮肤管线。
   *
   * 主题和皮肤是两层：皮肤只换格子色相（`Skin.hue/sat/light`），
   * 主题连背景、图标族、路线画法一起换。所以是两个独立字段，
   * 不是「皮肤的一个子集」。
   */
  currentTheme: string;
  /**
   * 已解锁的**广告主题** id。
   *
   * 只存广告解锁的那几套 —— 免费和里程碑主题都**不落盘**：
   * 免费的永远可用，里程碑由 `maxLevel` 直接推导（跨设备天然一致）。
   * 落盘一个可推导的值只会带来「换机丢失」和「服务端覆盖」两种麻烦。
   */
  unlockedThemes: string[];
  adWatchCnt: number;
  /** 累计步数（用于好友榜/统计）。 */
  totalSteps: number;
  /** 累计用时（毫秒，用于好友榜分数）。 */
  totalTimeMs: number;
  /** 累计重来次数（结算页点「重来」就 +1，主页/我的页的「重来累计」读它）。 */
  totalRetries: number;
  /**
   * 新手引导是否已完成。
   *
   * ## 为什么本地也要存一份
   *
   * 服务端那份是权威（换设备能同步），但**断网 / 登录失败时也要记住**：
   * 玩家刚走完三关，网一断就该被当成"没学过"再弹一遍，体验很差。
   *
   * 两处取并集：任一处为 true 就算完成（`boot()` 里合并）。
   * 不做成"以服务端为准覆盖本地"——那会让一次失败的登录把本地的
   * "已完成"冲掉。
   */
  tutorialDone: boolean;
  /** 昵称（来自服务端登录响应）。 */
  nickname: string;
  /** 头像 URL（空则程序化生成）。 */
  avatar: string;
  /** 玩家 uid（来自服务端登录响应）。分享链接要带，好友才知道谁在挑战。 */
  uid: number;
  /** 关号 → 星级（1~3），来自 /api/progress/stars。 */
  stars: Record<string, number>;
}

/**
 * 关卡表缓存。版本不一致时自动重拉。
 */
export class LevelStore {
  private levels: Level[] = [];

  /** 全部已加载的关卡。 */
  get all(): Level[] { return this.levels; }

  /** 某关（未加载返回 null）。 */
  get(idx: number): Level | null {
    return this.levels.find((l) => l.idx === idx) ?? null;
  }

  /** 当前最高已加载关号。 */
  get loadedMax(): number {
    return this.levels.length ? this.levels[this.levels.length - 1].idx : 0;
  }

  /**
   * 初始化：优先用缓存，版本不符则重拉。
   */
  async init(serverVersion: string): Promise<void> {
    const raw = platform.storage.get(KEY_LEVELS);
    if (raw) {
      try {
        const cached = JSON.parse(raw) as CachedLevels;
        if (cached.version === serverVersion && cached.levels.length > 0) {
          this.levels = cached.levels;
          return;
        }
      } catch {
        // 缓存损坏 → 重拉
      }
    }
    await this.loadMore(serverVersion, 1, 50);
  }

  /**
   * 加载更多关卡。
   */
  async loadMore(serverVersion: string, from: number, count: number): Promise<void> {
    const fresh = await fetchLevels(from, count);
    if (fresh.length === 0) return;
    const byIdx = new Map(this.levels.map((l) => [l.idx, l]));
    for (const l of fresh) byIdx.set(l.idx, l);
    this.levels = Array.from(byIdx.values()).sort((a, b) => a.idx - b.idx);
    platform.storage.set(KEY_LEVELS, JSON.stringify({ version: serverVersion, levels: this.levels }));
  }

  /**
   * 确保某关已加载，不足则拉取。
   */
  async ensure(idx: number, serverVersion: string): Promise<Level | null> {
    let lv = this.get(idx);
    if (lv) return lv;
    const from = this.loadedMax > 0 ? this.loadedMax + 1 : idx;
    await this.loadMore(serverVersion, from, 50);
    lv = this.get(idx);
    return lv;
  }
}

/**
 * 进度存取。服务端为准，本地做乐观缓存。
 */
export class ProgressStore {
  private progress: Progress = {
    // maxLevel = 最高**已通关**关号。新用户一关都没通 → 0。
    // （原来默认 1，导致新用户一进大厅就显示「第 1 关」而不是「第 0 关」，
    //   而且 currentLevel 会算成 2 —— 直接跳过第 1 关。）
    maxLevel: 0,
    unlockedSkins: ['wood', 'mint'],
    currentSkin: 'wood',
    // 默认主题 = 秘色天青（free 档）：新用户一进游戏就是展柜+金缮的世界。
    // 老存档里 currentTheme === '' 仍走经典皮肤渲染，可自行装备。
    currentTheme: 'mise',
    unlockedThemes: ['mise'],
    adWatchCnt: 0,
    totalSteps: 0,
    totalTimeMs: 0,
    totalRetries: 0,
    // 引导未完成。老存档（这个字段还不存在时）读出来是 undefined，
    // `restore()` 用 `?? ` 兜住 —— 但那时玩家其实早就玩过了，不该再弹一遍。
    // 判据放在 `boot()`：`maxLevel > 0` 的一律视为走过引导（见那里的注释）。
    tutorialDone: false,
    nickname: '玩家',
    avatar: '',
    uid: 0,
    stars: {},
  };

  /** 读取进度。 */
  get current(): Progress { return this.progress; }

  /**
   * 当前该打哪一关（= 下一个未通关的关号）。
   *
   * ## 为什么需要单独一个概念
   *
   * 服务端 `users.max_level` 的语义是「**最高已通关**关号」：
   * 一关都没通是 `0`，刚打完第 1 关是 `1`。
   *
   * 而 UI 上的「继续第 N 关」「当前关」「哪些关解锁了」需要的是
   * 「**下一个可玩**关号」：刚打完第 1 关 → 下一关是第 **2** 关。
   *
   * 两者差 1。以前客户端直接拿 `maxLevel` 当「当前关」用，
   * 结果通关第 1 关后大厅还写「继续 第 1 关」、地图把第 2 关锁着 ——
   * 玩家会觉得「明明通关了，怎么还在原地」。
   *
   * `maxLevel` 保持原样（与服务端一致，用于「最高关卡」统计与排行榜），
   * 所有「下一关 / 当前关 / 解锁」判断一律用这个派生值。
   */
  get currentLevel(): number {
    return this.progress.maxLevel + 1;
  }

  /**
   * 从服务端同步。
   *
   * ## 为什么忽略 `undefined` 字段
   *
   * `sync` 是**整体覆盖**语义，调用方常写成
   * `progress.sync({ maxLevel: res.maxLevel, unlockedSkins: res.unlockedSkins })`。
   * 只要服务端某次响应少返回了一个字段（比如 cover 模式的成绩接口
   * 一度漏了 `unlockedSkins`），这个字段就会是 `undefined`，
   * 而 `{...old, unlockedSkins: undefined}` 会把本地数组**覆盖成 undefined**。
   *
   * 后果非常隐蔽：下一帧 `progress.current.unlockedSkins.length` 抛
   * `Cannot read properties of undefined`，整个 `requestAnimationFrame` 渲染循环中断 ——
   * 表现就是「通关后画面卡住、点『下一关』没反应」，而且不会报任何网络错误。
   *
   * 所以这里把 `undefined` 当成「服务端没给这个字段」，保持本地旧值不动。
   */
  sync(p: Partial<Progress>): void {
    const merged: Partial<Progress> = {};
    for (const [k, v] of Object.entries(p) as [keyof Progress, unknown][]) {
      if (v === undefined) continue;
      (merged as Record<string, unknown>)[k] = v;
    }
    this.progress = { ...this.progress, ...merged };
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 从本地缓存恢复（启动时先渲染，再等服务端）。 */
  restore(): void {
    const raw = platform.storage.get(KEY_PROGRESS);
    if (!raw) return;
    try {
      this.progress = { ...this.progress, ...(JSON.parse(raw) as Partial<Progress>) };
    } catch { /* 忽略损坏缓存 */ }
  }

  /** 解锁皮肤。 */
  unlockSkin(id: string): void {
    if (!this.progress.unlockedSkins.includes(id)) {
      this.progress.unlockedSkins.push(id);
    }
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 装备皮肤。 */
  equipSkin(id: string): void {
    this.progress.currentSkin = id;
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 装备棋盘主题（空串 = 退回黏土皮肤管线）。 */
  equipTheme(id: string): void {
    this.progress.currentTheme = id;
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 记录一个已解锁的广告主题。 */
  unlockTheme(id: string): void {
    if (!this.progress.unlockedThemes) this.progress.unlockedThemes = [];
    if (!this.progress.unlockedThemes.includes(id)) {
      this.progress.unlockedThemes.push(id);
    }
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 标记新手引导已完成（本地立即生效，服务端另报）。 */
  setTutorialDone(): void {
    this.progress.tutorialDone = true;
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 写入全量星级（首次进大厅时拉一次）。 */  setStars(stars: Record<string, number>): void {
    this.progress.stars = stars;
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /** 写入单关星级（通关后本地即时更新，避免等下次拉取）。 */
  setStar(levelIdx: number, star: number): void {
    if (star <= 0) return;
    const key = String(levelIdx);
    if ((this.progress.stars[key] ?? 0) >= star) return;
    this.progress.stars[key] = star;
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }

  /**
   * 清掉某关的星级。
   *
   * 跳过的关卡**不给星** —— 花钱买过去的 ≠ 打过去的，
   * 地图上不能给它点亮星星。
   */
  clearStar(levelIdx: number): void {
    const key = String(levelIdx);
    if (this.progress.stars[key] === undefined) return;
    delete this.progress.stars[key];
    platform.storage.set(KEY_PROGRESS, JSON.stringify(this.progress));
  }
}
