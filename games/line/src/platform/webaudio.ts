/**
 * 音频上下文。
 *
 * ## 为什么不能直接 `new AudioContext()`
 *
 * 微信 / 抖音小游戏**没有 `window.AudioContext`**。早了会在 `ensure()` 里
 * `if (!Ctor) return null`，整条音频链静默降级 —— 表现是"这游戏没声音"，
 * 而且日志里一句 warn 都没有（catch 兜住了）。
 *
 * 小游戏端要用平台自己的工厂：`wx.createWebAudioContext()` /
 * `tt.createWebAudioContext()`。返回的对象与 WebAudio 高度同形，
 * 但**不是** DOM 的 `AudioContext`，而且能力少几项（见 `hasConvolver`）。
 *
 * ## 为什么先试 Web 再试小游戏
 *
 * 微信开发者工具里两种全局都可能存在；浏览器里绝不会有 `wx`。
 * 先试 Web 能让浏览器/调试环境的路径与线上完全一致，
 * 小游戏真机上第一支分支必然落空，代价等于零。
 */

/** 小游戏音频上下文：结构与 `AudioContext` 同形，能力少几项。 */
export type MiniAudioContext = AudioContext & {
  /** 微信/抖音的 WebAudioContext **没有** 卷积节点。 */
  createConvolver?: () => ConvolverNode;
};

interface AudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  wx?: { createWebAudioContext?: () => MiniAudioContext | null };
  tt?: { createWebAudioContext?: () => MiniAudioContext | null };
}

/**
 * 建一个音频上下文；这个环境根本给不出就返回 `null`。
 *
 * 返回 `null` 不是异常情况：调用方（`render/audio.ts`）会整条静默降级，
 * 由 `platform.vibrate()` 兜住手感。
 */
export function createAudioContext(): MiniAudioContext | null {
  const g = globalThis as AudioGlobals & { window?: AudioGlobals };
  // 浏览器里 `globalThis === window`；但测试 / 老的 polyfill 可能只挂了
  // `window.AudioContext`，所以两个位置都看一眼（读不到就是 undefined）
  const Ctor =
    g.AudioContext ??
    g.webkitAudioContext ??
    g.window?.AudioContext ??
    g.window?.webkitAudioContext;
  if (typeof Ctor === 'function') {
    try {
      return new Ctor() as MiniAudioContext;
    } catch {
      // 浏览器有构造器但被策略拒绝（少见）：继续试小游戏工厂
    }
  }

  const make = g.wx?.createWebAudioContext ?? g.tt?.createWebAudioContext;
  if (typeof make !== 'function') return null;
  try {
    return make() ?? null;
  } catch {
    return null;
  }
}

/**
 * 这套上下文支不支持卷积混响。
 *
 * 小游戏端的 `WebAudioContext` 没有 `createConvolver` —— 混响那一层必须
 * **整条跳过**，而不是建一个空节点：`conv.buffer = null` 的卷积节点会
 * 把湿声整条吞掉，听起来像"每一声都被人捂住"。
 */
export function hasConvolver(ctx: MiniAudioContext): ctx is MiniAudioContext & {
  createConvolver: () => ConvolverNode;
} {
  return typeof ctx.createConvolver === 'function';
}
