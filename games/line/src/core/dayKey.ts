/**
 * 「今天」到底是哪一天 —— 全仓唯一实现。
 *
 * ## 为什么这件事需要单独一个文件
 *
 * 每日额度（看广告次数、跳关次数）在**两边各自算了一遍**：
 *
 * - 客户端：`ad_rewarded_2026-11-23`、`skip_count_2026-11-23` 这类本地键
 * - 服务端：`skips` 表按 `day` 列数当日行数（`cover_skip.go`）
 *
 * 两边的「今天」如果不是同一天，就会在**每天有一段窗口两边不一致**：
 * 客户端以为额度还在、服务端说今天已经用完了（或者反过来）。
 * 表现是「点了跳关没反应」「看完广告还是不给跳」，而且只在特定时段出现，
 * 极难复现。
 *
 * ## 所以统一到东八区
 *
 * 服务端按 `Asia/Shanghai` 判日（`time.Now()` 配 `TZ=Asia/Shanghai`，
 * 见 `deploy/docker-compose.prod.yml` 的 postgres 段）。客户端以它为基准，
 * 玩家在中国境内的体感也才是「过零点换新的一天」。
 *
 * ## 不用 `toISOString()`
 *
 * `new Date().toISOString()` 是 **UTC** —— 东八区 00:00~08:00 这八小时里，
 * UTC 还停在前一天。曾经两边都用 UTC，看起来"一致"，但和服务端的
 * `time.Now().Format("2006-01-02")`（东八区）差了整整八小时：
 * 早上 7 点玩家跳关，客户端记在昨天、服务端记在今天。
 *
 * ## 也不用 `toLocaleDateString()`
 *
 * 它依赖运行环境的 locale 与时区（小游戏里尤其不可控，不同机型返回
 * `2026/11/23` 或 `11/23/2026`）。按 UTC 毫秒数减偏移自己算，结果是确定的。
 */

/** 东八区相对 UTC 的偏移（毫秒）。 */
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 东八区的「今天」，格式 `YYYY-MM-DD`。
 *
 * @param now 时间戳（毫秒）。测试可注入；缺省取当前时间。
 */
export function dayKeyCN(now: number = Date.now()): string {
  // 先把时间平移到「东八区的墙上时间」，再按 UTC 读年月日 ——
  // 平移之后 UTC 读出来的就是东八区的日期，不受运行环境时区影响。
  const d = new Date(now + CN_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地存储键的统一前缀，避免和别的 key 撞。 */
export const DAY_KEY_PREFIX = {
  /** 今日已看激励视频次数 */
  adRewarded: 'ad_rewarded_',
  /** 今日已跳关次数 */
  skipCount: 'skip_count_',
  /** 某关今天是否已跳过：`skip_<day>_<idx>` */
  skipLevel: 'skip_',
} as const;

/** `ad_rewarded_<day>` */
export function adRewardedKey(now?: number): string {
  return DAY_KEY_PREFIX.adRewarded + dayKeyCN(now);
}

/** `skip_count_<day>` */
export function skipCountKey(now?: number): string {
  return DAY_KEY_PREFIX.skipCount + dayKeyCN(now);
}

/** `skip_<day>_<idx>` */
export function skipLevelKey(levelIdx: number, now?: number): string {
  return `${DAY_KEY_PREFIX.skipLevel}${dayKeyCN(now)}_${levelIdx}`;
}
