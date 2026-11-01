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
  maxLevel: number;
  unlockedSkins: string[];
  currentSkin: string;
  adWatchCnt: number;
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
    maxLevel: 1,
    unlockedSkins: ['wood', 'mint'],
    currentSkin: 'wood',
    adWatchCnt: 0,
  };

  /** 读取进度。 */
  get current(): Progress { return this.progress; }

  /** 从服务端同步。 */
  sync(p: Partial<Progress>): void {
    this.progress = { ...this.progress, ...p };
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
}
