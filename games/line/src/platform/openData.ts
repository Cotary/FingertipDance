import { platform } from './index';

/**
 * 开放数据域写入的玩家档案。
 * 好友榜与好友进度面板都读这个 KV。
 */
export interface FriendProfile {
  maxLevel: number;
  totalTimeMs: number;
  totalSteps: number;
  skinCount: number;
  nickname: string;
  avatar: string;
  updatedAt: number;
}

/** 排行榜分数公式。与服务端 ComputeScore 保持一致。 */
export function computeRankScore(maxLevel: number, totalTimeMs: number): number {
  const seconds = Math.min(999999, Math.floor(totalTimeMs / 1000));
  return maxLevel * 1000000 - seconds;
}

/** 微信开放数据域 API 的最小类型（仅声明用到的字段）。 */
interface WxOpenDataContext {
  canvas: { width: number; height: number };
}

interface WxGlobal {
  setUserCloudStorage?: (opts: {
    KVDataList: Array<{ key: string; value: string }>;
    fail?: (err: unknown) => void;
  }) => void;
  getOpenDataContext?: () => WxOpenDataContext | undefined;
}

/** 取全局 wx（微信小游戏环境才有）。 */
function wxGlobal(): WxGlobal | undefined {
  return (globalThis as { wx?: WxGlobal }).wx;
}

/**
 * 把自己的进度写入开放数据域，好友才能看到。
 */
export function publishProfile(p: FriendProfile): void {
  if (!platform.openDataAvailable) return;
  const wx = wxGlobal();
  if (!wx?.setUserCloudStorage) return;
  wx.setUserCloudStorage({
    KVDataList: [{ key: 'line_profile', value: JSON.stringify(p) }],
    fail: (err: unknown) => console.warn('写入开放数据域失败', err),
  });
}

/**
 * 获取开放数据域的 canvas（用于把好友榜画到主域）。
 */
export function getOpenDataCanvas(): { canvas: HTMLCanvasElement; width: number; height: number } | null {
  if (!platform.openDataAvailable) return null;
  const wx = wxGlobal();
  if (!wx?.getOpenDataContext) return null;
  const ctx = wx.getOpenDataContext();
  if (!ctx?.canvas) return null;
  // 开放数据域 canvas 与 HTMLCanvasElement 结构兼容，可被主域 drawImage 使用
  return { canvas: ctx.canvas as unknown as HTMLCanvasElement, width: ctx.canvas.width, height: ctx.canvas.height };
}
