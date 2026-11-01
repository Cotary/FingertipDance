import { platform } from '../platform';

/**
 * 检查本关提示是否需要看广告。
 * 规则：每关第一次提示必须看广告，之后免费。
 */
export function needsAdForHint(levelIdx: number, hintUsed: number): boolean {
  void levelIdx;
  return hintUsed === 0;
}

/**
 * 检查本关跳过是否超过每日限额。
 * 客户端做本地预检（服务端也会校验）。
 */
export function canSkipToday(levelIdx: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const key = `skip_${day}_${levelIdx}`;
  return platform.storage.get(key) !== '1';
}

/**
 * 标记本关今日已跳过。
 */
export function markSkippedToday(levelIdx: number): void {
  const day = new Date().toISOString().slice(0, 10);
  platform.storage.set(`skip_${day}_${levelIdx}`, '1');
}

/**
 * 检查皮肤是否已解锁过（防止重复看广告）。
 */
export function isSkinUnlocked(unlocked: Set<string>, skinId: string): boolean {
  return unlocked.has(skinId);
}
