/**
 * Cover 模式 v3：关卡表存储。
 *
 * ## 与经典模式 `LevelStore` 的关系
 *
 * 经典模式按需从服务端拉关卡（`/api/levels?from&count`），
 * cover 模式的数据结构完全不同（v3 编码 + 11 种格子），
 * 所以单独一套存储。
 *
 * ## 数据来源优先级
 *
 * 1. **服务端**（`/api/levels-v3?from&count`）—— 权威版本，能拿到新关卡。
 * 2. **内置表**（`data/levels-v3-client.json`）—— 打包进客户端，
 *    保证「没有后端也能玩」，也让 web 预览、离线调试、单元测试都能跑。
 *
 * 内置表是**客户端版**（不含参考解）—— 参考解是答案，绝不能下发到客户端。
 *
 * ## 为什么内置表直接静态 import
 *
 * 微信小游戏没有 `fetch`，而走文件管理器读包内文件要额外适配。
 * 静态 import 在两个平台都能用（vite 会把它内联进 bundle），
 * 代价是 bundle 大约多 300 KB —— 对小游戏来说可以接受。
 */
import clientTable from '../../data/levels-v3-client.json';
import { platform } from '../platform';
import { fetchCoverLevels, fetchCoverTableVersion } from '../net/api';
import type { LevelEntry } from '../core/cover/v3/codec';

/** 内置客户端关卡表（1000 关，无参考解）。 */
const BUILTIN = clientTable as unknown as { version: string; count: number; levels: LevelEntry[] };

/** cover 关卡表存储。 */
export class CoverLevelStore {
  private levels = new Map<number, LevelEntry>();
  private version = '';

  /** 当前表版本号。 */
  get tableVersion(): string { return this.version; }

  /** 全部已加载的关卡数。 */
  get loadedCount(): number { return this.levels.size; }

  /** 某关（未加载返回 null）。 */
  get(idx: number): LevelEntry | null {
    return this.levels.get(idx) ?? null;
  }

  /**
   * 初始化。
   *
   * 先把内置表灌进来（保证任何时候都有可玩的关卡），
   * 再尝试用服务端的表覆盖 —— 服务端不可用也不影响游戏。
   *
   * ## 为什么先比版本号再拉
   *
   * 客户端内置表和服务端表由**同一次生成**产出，版本号相同 → 内容必然相同。
   * 这时候把 1000 关从头拉一遍是纯浪费：小游戏首屏只有几百 KB 预算，
   * 而 cover 表约 300 KB（base64 后的 grid 占绝大部分）。
   *
   * 所以先只拉 1 关探版本号，一致就**完全跳过下载**。
   *
   * ## 为什么分批拉
   *
   * 服务端 `/api/levels-v3` 的 `count` 上限是 100（防一个人把 1000 关全拖下来）。
   * 客户端一次请求 1000 关会被 400 拒掉 —— 早期版本就是**一直**在用内置表，
   * 服务端的表从来没生效过（服务端改了关卡，客户端看不到）。
   * 所以这里按 `count=100` 分批拉。
   *
   * ## 为什么比对版本号
   *
   * 服务端返回的 `version` 与内置表不一致时，才认为服务端表更新。
   * 一致就**不覆盖** —— 内置表和客户端表由同一次生成产出，
   * 内容必然相同，覆盖只是白花一次网络与内存。
   */
  async init(serverVersion: string): Promise<void> {
    // 1) 内置表
    this.version = BUILTIN.version;
    for (const lv of BUILTIN.levels) this.levels.set(lv.idx, lv);

    // 2) 服务端覆盖（失败就用内置表）
    try {
      // 2a) 先探版本号 —— 一致就不用下载整表
      const remoteVersion = await fetchCoverTableVersion();
      if (remoteVersion && remoteVersion === BUILTIN.version) {
        // 内容一致，什么都不用做
        if (serverVersion) this.version = serverVersion;
        return;
      }

      // 2b) 版本不一致 → 分批拉全量并覆盖
      const fresh = await this.fetchAllFromServer();
      if (fresh.size > 0) {
        for (const [idx, lv] of fresh) this.levels.set(idx, lv);
        this.version = remoteVersion || serverVersion || this.version;
      }
    } catch (e) {
      console.warn('[cover] 服务端关卡表不可用，使用内置表', e);
    }
  }

  /**
   * 分批拉取服务端全量关卡表。
   *
   * 分批大小与服务端 `count` 上限一致（100）。
   * 任何一批失败就整体放弃 —— 半张表比内置表更危险（关号断层）。
   */
  private async fetchAllFromServer(): Promise<Map<number, LevelEntry>> {
    const out = new Map<number, LevelEntry>();
    const BATCH = 100;
    for (let from = 1; from <= BUILTIN.count; from += BATCH) {
      const batch = await fetchCoverLevels(from, BATCH);
      for (const lv of batch) out.set(lv.idx, lv);
    }
    return out;
  }

  /** 确保某关已加载（内置表全量在内存里，基本不会缺）。 */
  async ensure(idx: number): Promise<LevelEntry | null> {
    const cached = this.levels.get(idx);
    if (cached) return cached;
    // 内置表理论上覆盖 1..1000；万一 idx 超范围，试着从服务端补
    try {
      const fresh = await fetchCoverLevels(idx, 1);
      for (const l of fresh) this.levels.set(l.idx, l);
    } catch { /* 忽略 */ }
    return this.levels.get(idx) ?? null;
  }

  /** 总关数（内置表的数量）。 */
  get total(): number {
    return Math.max(BUILTIN.count, this.levels.size);
  }

  /** 清空缓存（换肤 / 清缓存按钮用不到关卡表，保留接口一致性）。 */
  clearCache(): void {
    platform.storage.remove('cover_levels_cache');
  }
}
