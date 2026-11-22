import { platform } from '../platform';
import { skipCountKey, skipLevelKey } from '../core/dayKey';

/**
 * 每关**免费**提示次数（服务端 `ad.hintFreeUses` 下发）。
 *
 * 0 = 第一次提示就要看广告（改造前的行为）。
 * 2 = 前两次免费，第三次看一次广告，之后本关全部免费。
 *
 * ## 为什么是「付一次就解锁本关」而不是「每次都付」
 *
 * 改造前的规则是 `hintUsed === 0`：第一次看广告，之后免费。
 * 默认值必须保持这个行为 —— 否则一次上线会让所有玩家的
 * 每次提示都要看广告，这是最恶劣的那种「配置没生效，行为却变了」。
 *
 * 所以判定写成 `hintUsed === hintFreeUses`（等号，不是 `>=`）：
 * 前 N 次免费，第 N+1 次付一次广告费，再往后不再问。
 *
 * 放在模块级而不是每次传参：调用点是 `useHint()`，
 * 那里同时在做关卡状态流转，不该再塞一个「配置从哪来」的问题。
 */
let hintFreeUses = 0;

/** 每日跳关次数上限（服务端 `ad.skipDailyLimit` 下发）。0 = 不限。 */
let skipDailyLimit = 0;

/**
 * 应用服务端下发的频控参数。
 *
 * 只接受非负整数：负数会让「已用次数 >= 上限」永远成立，
 * 等于把功能直接关死，而界面上看不出来是配置的错。
 */
export function applyRewardFrequency(cfg: { hintFreeUses?: number; skipDailyLimit?: number }): void {
  if (typeof cfg.hintFreeUses === 'number' && cfg.hintFreeUses >= 0) {
    hintFreeUses = Math.floor(cfg.hintFreeUses);
  }
  if (typeof cfg.skipDailyLimit === 'number' && cfg.skipDailyLimit >= 0) {
    skipDailyLimit = Math.floor(cfg.skipDailyLimit);
  }
}

/**
 * 检查本关提示是否需要看广告。
 *
 * `hintUsed` 是**本关已用次数**（不是总数）：每关重新计，
 * 玩家换一关就重新享有免费额度。
 *
 * 等号而不是 `>=`：每关最多只收一次广告费（见上面的说明）。
 * 用 `>=` 会让「免费次数」变成「每次都要付」，与改造前行为不符。
 */
export function needsAdForHint(levelIdx: number, hintUsed: number): boolean {
  void levelIdx;
  return hintUsed === hintFreeUses;
}

/** 今日已跳过关卡数。 */
export function skipUsedToday(): number {
  return parseInt(platform.storage.get(skipCountKey()) ?? '0', 10) || 0;
}

/** 今日跳关上限（0 = 不限），供 UI 文案使用。 */
export function skipLimitToday(): number {
  return skipDailyLimit;
}

/**
 * 现在能不能跳过这一关。返回不能的理由（能跳返回 null）。
 *
 * ## 两个条件是「或」不是「与」
 *
 * - 本关今天已经跳过：防止一关反复跳过刷进度（旧规则，保留）
 * - 今日跳关次数用完：运营配的上限
 *
 * 两者都要报清楚，否则玩家点了一下没反应，会以为按钮坏了。
 */
export function skipBlockReason(levelIdx: number): string | null {
  if (platform.storage.get(skipLevelKey(levelIdx)) === '1') {
    return '本关今天已经跳过了';
  }
  if (skipDailyLimit > 0 && skipUsedToday() >= skipDailyLimit) {
    return `今天的跳关次数用完了（${skipDailyLimit} 次）`;
  }
  return null;
}

/**
 * 检查本关跳过是否还能用。
 *
 * 客户端做本地预检（服务端也会校验）。
 */
export function canSkipToday(levelIdx: number): boolean {
  return skipBlockReason(levelIdx) === null;
}

/**
 * 标记本关今日已跳过。
 *
 * 同时累加当日总数 —— 两个计数必须一起写，
 * 否则上限永远读不到变化（表现为「配置了 3 次，实际能跳无限次」）。
 */
export function markSkippedToday(levelIdx: number): void {
  // 两个键必须来自**同一次** `dayKeyCN()` 调用：
  // 跨零点那一瞬间各算一次的话，会写出「昨天的关 + 今天的计数」这种错配。
  platform.storage.set(skipLevelKey(levelIdx), '1');
  platform.storage.set(skipCountKey(), String(skipUsedToday() + 1));
}

/**
 * 检查皮肤是否已解锁过（防止重复看广告）。
 */
export function isSkinUnlocked(unlocked: Set<string>, skinId: string): boolean {
  return unlocked.has(skinId);
}
