import { platform } from '../platform';
import type { Level } from '../core/types';
import { deserializeLevel, type SerializedLevel } from '../core/levelTable';
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
  unlockedSkins: string[];
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

/** 拉取关卡表。 */
export async function fetchLevels(from: number, count: number): Promise<Level[]> {
  const res = await platform.request<{ version: string; levels: SerializedLevel[] }>(
    API + '/api/levels?from=' + from + '&count=' + count, 'GET',
  );
  return res.levels.map(deserializeLevel);
}

/** 上报通关成绩。 */
export function reportProgress(levelIdx: number, steps: number, timeMs: number, path: number[]): Promise<ProgressResult> {
  return authed<ProgressResult>('/api/progress', 'POST', { levelIdx, steps, timeMs, path, skipped: false });
}

/** 跳过关卡。 */
export function reportSkip(levelIdx: number): Promise<{ maxLevel: number }> {
  return authed<{ maxLevel: number }>('/api/skip', 'POST', { levelIdx });
}

/** 拉取总榜。 */
export function fetchLeaderboard(): Promise<{ list: any[]; myRank: number; total: number }> {
  return authed('/api/leaderboard', 'GET');
}

/** 拉取好友列表。 */
export function fetchFriends(): Promise<{ list: any[]; stats: any }> {
  return authed('/api/friends', 'GET');
}

/** 上报埋点（走 tracker，带本地缓冲 + 断网补传）。 */
export function reportEvent(name: EventName, params: Record<string, unknown> = {}): void {
  tracker.track(name, params);
}
