import { platform } from '../platform';

/** 挑战上下文。 */
export interface Challenge {
  /** 被挑战的关号 */
  levelIdx: number;
  /** 挑战者的 uid */
  fromUid: number;
  /** 挑战者的昵称 */
  fromName: string;
  /** 挑战者的步数（若已知） */
  fromSteps: number;
}

/** 微信启动参数最小类型。 */
interface WxLaunchOptions {
  query?: Record<string, string>;
}

interface WxChallengeGlobal {
  getLaunchOptionsSync?: () => WxLaunchOptions;
}

function wxGlobal(): WxChallengeGlobal | undefined {
  return (globalThis as { wx?: WxChallengeGlobal }).wx;
}

/**
 * 从启动参数解析挑战信息。
 * 微信：wx.getLaunchOptionsSync().query
 * Web：URL 的 search 参数
 */
export function parseChallenge(): Challenge | null {
  let query: Record<string, string> = {};

  if (platform.name === 'wechat') {
    const wx = wxGlobal();
    const opts = wx?.getLaunchOptionsSync?.();
    query = opts?.query ?? {};
  } else if (typeof location !== 'undefined') {
    query = Object.fromEntries(new URLSearchParams(location.search).entries());
  }

  const lvl = query.l;
  if (!lvl) return null;
  const levelIdx = parseInt(lvl, 10);
  if (!Number.isFinite(levelIdx) || levelIdx < 1) return null;

  return {
    levelIdx,
    fromUid: parseInt(query.uid ?? '0', 10) || 0,
    fromName: query.name ? decodeURIComponent(query.name) : '好友',
    fromSteps: parseInt(query.steps ?? '0', 10) || 0,
  };
}

/**
 * 构造分享 query。
 */
export function buildShareQuery(challenge: { levelIdx: number; steps?: number }): string {
  const parts = [`l=${challenge.levelIdx}`];
  if (challenge.steps) parts.push(`steps=${challenge.steps}`);
  return parts.join('&');
}
