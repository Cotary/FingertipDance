import { platform } from '../platform';
import type { Level } from '../core/types';
import { deserializeLevel, type SerializedLevel } from '../core/levelTable';
import type { LevelEntry as CoverLevelEntry } from '../core/cover/v3/codec';
import { tracker } from '../analytics/tracker';
import type { EventName } from '../analytics/tracker';

const API = __API_BASE__;

/** 登录响应。 */
export interface LoginResult {
  token: string;
  uid: number;
  nickname: string;
  avatar: string;
  maxLevel: number;
  totalTimeMs: number;
  totalSteps: number;
  unlockedSkins: string[];
  adWatchCnt: number;
}

/** 服务器配置。 */
export interface ServerConfig {
  levelVersion: string;
  levelCount: number;
  /** cover 模式（现行玩法）的关卡表版本。 */
  coverLevelVersion?: string;
  /** cover 模式的总关数。 */
  coverLevelCount?: number;
  skins: Array<{ id: string; name: string; tier: string; unlockType: string; unlockValue: number }>;
  ad: { rewardedVideoId: string; interstitialId: string };
  features: { hint: boolean; skip: boolean; shareChallenge: boolean };
  serverTime: number;
}

/** 进度上报结果。 */
export interface ProgressResult {
  passed: boolean;
  unlockedSkin: { id: string; name: string } | null;
  isNewBest: boolean;
  maxLevel: number;
  totalTimeMs: number;
  /** 累计步数（服务端 users.total_steps） */
  totalSteps: number;
  unlockedSkins: string[];
  /** 本次通关该关星级（1~3） */
  stars: number;
}

/** 令牌存取。 */
let token: string | null = platform.storage.get('token');

/** 带令牌的请求。 */
function authed<T>(url: string, method: 'GET' | 'POST', data?: unknown): Promise<T> {
  return platform.request<T>(API + url, method, data, token ? { Authorization: `Bearer ${token}` } : undefined);
}

/** 登录并保存令牌。 */
export async function login(): Promise<LoginResult> {
  const { code } = await platform.login();
  const res = await platform.request<LoginResult>(API + '/api/login', 'POST', { code });
  token = res.token;
  platform.storage.set('token', token);
  return res;
}

/** 拉取服务器配置。 */
export function fetchConfig(): Promise<ServerConfig> {
  return platform.request<ServerConfig>(API + '/api/config', 'GET');
}

/** 拉取当前用户进度（切后台回前台时刷新）。 */
export function fetchProfile(): Promise<{ maxLevel: number; unlockedSkins: string[]; totalTimeMs: number; totalSteps: number }> {
  return authed('/api/profile', 'GET');
}

/** 拉取关卡表。 */
export async function fetchLevels(from: number, count: number): Promise<Level[]> {
  const res = await platform.request<{ version: string; levels: SerializedLevel[] }>(
    API + '/api/levels?from=' + from + '&count=' + count, 'GET',
  );
  return res.levels.map(deserializeLevel);
}

/**
 * 拉取 cover 模式（v3）关卡表。
 *
 * 服务端不可用时抛错 —— 调用方（`CoverLevelStore`）会回退到内置表。
 *
 * **count 上限是 100**（服务端 `count 参数需在 1..100 之间`）。
 * 请求超过 100 会被 400 拒掉 —— 早期版本一次要 1000 关，
 * 结果每次启动都被拒、**永远在用内置表**，服务端的表从没生效过。
 */
export async function fetchCoverLevels(from: number, count: number): Promise<CoverLevelEntry[]> {
  const res = await platform.request<{ version: string; levels: CoverLevelEntry[] }>(
    API + '/api/levels-v3?from=' + from + '&count=' + count, 'GET',
  );
  return res.levels;
}

/**
 * 拉取 cover 关卡表的**版本号**（不拉关卡内容）。
 *
 * 用它做「要不要重拉」的判断 —— 版本一致就跳过整表下载。
 */
export async function fetchCoverTableVersion(): Promise<string> {
  const res = await platform.request<{ version: string }>(
    API + '/api/levels-v3?from=1&count=1', 'GET',
  );
  return res.version;
}

/**
 * 上报通关成绩（**经典模式 · 已废弃**）。
 *
 * @deprecated 经典模式已下线，客户端没有调用者。
 *   cover 模式请用 {@link reportCoverProgress}。
 *   保留这个函数只是为了老版本客户端（或调试脚本）还能用 ——
 *   新代码不要调用它。
 */
export function reportProgress(levelIdx: number, steps: number, timeMs: number, path: number[]): Promise<ProgressResult> {
  return authed<ProgressResult>('/api/progress', 'POST', { levelIdx, steps, timeMs, path, skipped: false });
}

/**
 * 上报 cover 模式通关成绩。
 *
 * 与经典模式的差异：
 *  - 多传 `undos`（悔棋次数）—— cover 模式的星级由它决定，
 *    而不是步数（步数恒为 required−1，没有区分度）。
 *  - 走独立接口 `/api/cover/progress` —— 服务端按 cover 的完整规则
 *    （冰块滑行 / 单向门 / 钥匙门 / 传送门 / 星星顺序）回放校验。
 */
export function reportCoverProgress(
  levelIdx: number,
  steps: number,
  timeMs: number,
  undos: number,
  path: number[],
): Promise<ProgressResult> {
  return authed<ProgressResult>('/api/cover/progress', 'POST', {
    levelIdx, steps, timeMs, undos, path, skipped: false,
  });
}

/**
 * 上报 cover 模式的**跳过**。
 *
 * 必须走独立接口 —— 经典模式的 `/api/skip` 用经典的 `shortest` 写步数、
 * 且写进 `mode=0` 的记录行，cover 的记录会被覆盖。
 */
export function reportCoverSkip(levelIdx: number): Promise<{ maxLevel: number }> {
  return authed<{ maxLevel: number }>('/api/cover/skip', 'POST', { levelIdx });
}

/**
 * 提交 cover 模式的挑战成绩（不推进主线进度）。
 *
 * 走独立接口 —— 经典的 `/api/challenge` 用 `ValidatePath`（起终点连线），
 * cover 的路径用它校验**必然失败**（长度都对不上）。
 */
export function reportCoverChallenge(
  levelIdx: number,
  steps: number,
  timeMs: number,
  undos: number,
  path: number[],
): Promise<{ passed: boolean; best: { undos: number; timeMs: number }; isNewBest: boolean }> {
  return authed('/api/cover/challenge', 'POST', {
    levelIdx, steps, timeMs, undos, path, skipped: false,
  });
}

/**
 * 跳过关卡（**经典模式 · 已废弃**）。
 *
 * @deprecated 经典模式已下线，客户端没有调用者。
 *   cover 模式请用 {@link reportCoverSkip} ——
 *   经典接口会用经典的 `shortest` 写步数、且写进 `mode=0` 的记录行，
 *   cover 的记录会被覆盖。
 */
export function reportSkip(levelIdx: number): Promise<{ maxLevel: number }> {
  return authed<{ maxLevel: number }>('/api/skip', 'POST', { levelIdx });
}

/**
 * 提交挑战成绩（**经典模式 · 已废弃**）。
 *
 * @deprecated 经典模式已下线，客户端没有调用者。
 *   cover 模式请用 {@link reportCoverChallenge}。
 */
export function reportChallenge(
  levelIdx: number,
  steps: number,
  timeMs: number,
  path: number[],
): Promise<{ passed: boolean; best: { steps: number; timeMs: number }; isNewBest: boolean }> {
  return authed('/api/challenge', 'POST', { levelIdx, steps, timeMs, path, skipped: false });
}

/**
 * 跳到指定关卡（**仅调试模式**）。
 *
 * 服务端只在配置了 `debug.enabled: true` 时才允许这个接口（否则 403）。
 * 客户端的调试开关（构建期常量 `__DEBUG__`）与服务端的是**两个独立开关** ——
 * 客户端只管界面，服务端自己把关。
 *
 * 跳关**只推进 `max_level`，不写成绩表** ——
 * 详见服务端 `debug_jump.go` 的说明（补写记录会让之后的真实成绩
 * 永远刷不了新纪录）。
 */
export function debugJump(levelIdx: number): Promise<{ ok: boolean; maxLevel: number; jumpedTo: number }> {
  return authed('/api/debug/jump', 'POST', { levelIdx });
}

/** 好友条目（服务端返回）。 */
export interface FriendItem {
  uid: number;
  nickname: string;
  avatar: string;
  maxLevel: number;
  totalTimeMs: number;
  skinCount: number;
  isMutual: boolean;
}

/** 好友进度统计。 */
export interface FriendStats {
  friendCount: number;
  avgLevel: number;
  maxLevel: number;
}

/** 榜单条目。 */
export interface LeaderboardItem {
  rank: number;
  uid: number;
  nickname: string;
  avatar: string;
  maxLevel: number;
  totalTimeMs: number;
}

/** 拉取总榜。 */
export function fetchLeaderboard(): Promise<{ list: LeaderboardItem[]; myRank: number; total: number }> {
  return authed('/api/leaderboard', 'GET');
}

/** 拉取好友列表。 */
export function fetchFriends(): Promise<{ list: FriendItem[]; stats: FriendStats }> {
  return authed('/api/friends', 'GET');
}

/**
 * 拉取玩家每关星级（关号 → 星级）。
 *
 * ## 必须指定 mode
 *
 * 经典模式与 cover 模式**共用同一套关号空间**（1..1000），
 * 但星级算法完全不同（经典看步数比，cover 看悔棋次数）。
 * 服务端按 `mode` 过滤，客户端也必须知道要的是哪种模式的星星。
 */
export function fetchStars(mode: 'classic' | 'cover' = 'classic'): Promise<{ stars: Record<string, number> }> {
  return authed('/api/progress/stars?mode=' + mode, 'GET');
}

/** 上报埋点（走 tracker，带本地缓冲 + 断网补传）。 */
export function reportEvent(name: EventName, params: Record<string, unknown> = {}): void {
  tracker.track(name, params);
}
