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
  /** 给开放数据域发消息（尺寸变化 / 请求重画）。 */
  postMessage?: (msg: Record<string, unknown>) => void;
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
 *
 * ## 尺寸由主域给
 *
 * `sharedCanvas` 一开始是屏幕尺寸，直接画进版面会被拉伸成模糊的一片。
 * 所以这里按调用方要的**版面尺寸**（设计像素）改 canvas 尺寸，并
 * `postMessage` 让开放数据域按新尺寸重画。
 *
 * 尺寸没变时不发消息 —— 这个函数每帧都会被调，每帧发一条消息
 * 等于每帧让开放数据域重画一遍整张榜，低端机会直接被拖死。
 *
 * 抖音没有开放数据域好友榜，`platform.openDataAvailable` 为 false → 返回 null，
 * 调用方回落到服务端好友列表。
 */
export function getOpenDataCanvas(
  width?: number,
  height?: number,
): { canvas: HTMLCanvasElement; width: number; height: number } | null {
  if (!platform.openDataAvailable) return null;
  const wx = wxGlobal();
  if (!wx?.getOpenDataContext) return null;
  const ctx = wx.getOpenDataContext();
  if (!ctx?.canvas) return null;

  const c = ctx.canvas;
  const w = width ? Math.max(1, Math.round(width)) : 0;
  const h = height ? Math.max(1, Math.round(height)) : 0;
  const resized = w > 0 && h > 0 && (c.width !== w || c.height !== h);
  if (resized) {
    c.width = w;
    c.height = h;
    try {
      ctx.postMessage?.({ type: 'resize', width: w, height: h });
    } catch {
      // 老基础库没有 postMessage：画布已改尺寸，只是要等它自己下一次重画
    }
  }

  // 开放数据域 canvas 与 HTMLCanvasElement 结构兼容，可被主域 drawImage 使用
  return { canvas: c as unknown as HTMLCanvasElement, width: c.width, height: c.height };
}

/**
 * 主动让开放数据域重拉一次好友数据（打开好友榜时调）。
 *
 * 开放数据域自己有 30 秒缓存；刚分享完就打开好友榜时，
 * 那条"我刚通关"的分数可能还不在缓存里。
 */
export function refreshOpenData(): void {
  if (!platform.openDataAvailable) return;
  const ctx = wxGlobal()?.getOpenDataContext?.();
  try {
    ctx?.postMessage?.({ type: 'refresh' });
  } catch {
    /* 老基础库：等它自己的缓存过期 */
  }
}
