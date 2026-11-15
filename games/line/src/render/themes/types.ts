/**
 * 棋盘主题接口。
 *
 * ## 为什么要单独定义一层
 *
 * 旧的 `Skin` 只带 `hue / sat / light / texture` 六个字段，`paletteOf()` 派生五色，
 * 真正受影响只有**格子面**这一层。背景、9 类机制图标、路线、提示全是写死的 `CLAY.*`，
 * 所以玩家换「皮肤」的感受是「格子变色了」，而不是「换了个世界」。
 *
 * 主题是比皮肤更高一层的东西：它连着背景、格子语言、图标族、路线画法一起换。
 * 因此接口不能只有颜色，必须能给**绘制函数**。
 *
 * ## 两个入口而不是一个
 *
 * `backdrop` 铺满整屏（背景属于页面，不属于盘面），`board` 只画盘面。
 * 分开是因为 `main.ts` 每帧先铺背景再画盘面，而且背景要按「实际可视范围」铺
 * （等比缩放后上下会留缝，见 `visibleDesignBox`）。
 */
import type { BoardLayout } from '../layout';

/** 盘面（渲染只需要这三个字段）。 */
export interface ThemeBoard {
  w: number;
  h: number;
  grid: Uint8Array;
}

/** 渲染状态（结构兼容 `CoverRenderState`，但不耦合）。 */
export interface ThemeState {
  /** 已铺的格（拍平索引） */
  covered: Set<number>;
  /** 已走过的序列（拍平索引，按顺序） */
  path: number[];
  /** 已拾取的钥匙分组 */
  keysHeld: Set<number>;
  /** 已收集的星星分组 */
  shardsGot: Set<number>;
  /** 下一颗必须收的星星分组（-1 = 没有） */
  shardNext: number;
  /** 提示窗口内的格（拍平索引）；不传就不画 */
  hint?: number[];
  /**
   * 松手宽限中。
   *
   * 主题要自己把线画淡 —— 旧管线是在 `main.ts` 里用 `globalAlpha` 包住的，
   * 主题接管后如果忘了这件事，宽限期的线会全亮，玩家会以为「只要别按就有救」。
   */
  paused?: boolean;
  /** 震动格（拍平索引）与时刻，-1 = 无 */
  shakeCell?: number;
  shakeAt?: number;
}

/** 设计坐标系里的矩形盒子。 */
export interface DesignBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一次盘面绘制所需的全部上下文。 */
export interface ThemeDrawCtx {
  ctx: CanvasRenderingContext2D;
  board: ThemeBoard;
  layout: BoardLayout;
  state: ThemeState;
  /** 当前时刻（ms），用于呼吸 / 流动 */
  now: number;
  /** 设备像素比 × 视口缩放，用于决定线宽下限 */
  dpr: number;
}

/** 主题档位。基础档换心情，典藏档换世界。 */
export type ThemeTier = 'basic' | 'premium';

/** 解锁条件。 */
export interface ThemeUnlock {
  type: 'free' | 'ad' | 'milestone';
  /** `milestone` 用：通关到第几关自动解锁 */
  value: number;
}

/**
 * 主题的界面配色（HUD / 按钮 / 进度条）。
 *
 * ## 为什么主题必须管界面
 *
 * 盘面换成深色之后，黏土的奶油按钮和深棕文字会立刻失效：实测金线主题里
 * 「起点自由」那行棕色小字压在深翡翠底上几乎看不见，陶土胶囊则像贴错了图。
 * 棋盘和界面是同一屏，不可能只换一半。
 *
 * ## 为什么只给「基色」而不是四阶
 *
 * `clayBlock` 要 4 个色阶（亮面 / 正面 / 暗面 / 阴影）。每套主题各手写 40 个色值
 * 既不可能对齐，也必然走形 —— 所以只给一个基色，四阶由 `clayFrom()` 派生。
 */
export interface ThemeChrome {
  /** 关号胶囊底 */
  pill: string;
  /** 胶囊文字 */
  pillInk: string;
  /** 主按钮（提示） */
  primary: string;
  primaryInk: string;
  /** 次要按钮（返回 / 跳过） */
  ghost: string;
  ghostInk: string;
  /** 正文 */
  ink: string;
  /** 弱化正文（读数、计数） */
  inkSoft: string;
  /**
   * 微文案（图例名、底注）。比 `inkSoft` 再暗一档 ——
   * 设计稿这两处用 `--i500` (#7A7468)，和卡片里的读数不是一个亮度层级。
   * 不填则回落 `inkSoft`。
   */
  inkDim?: string;
  /** 进度槽 */
  groove: string;
  /** 进度填充 */
  fill: string;
}

/** 黏土四阶（与 `ui/clay.ts` 的 `ClayColor` 结构一致）。 */
export interface ClayTones {
  base: string;
  light: string;
  dark: string;
  shade: string;
}

/**
 * 单个基色 → 黏土四阶。
 *
 * 亮面往白推 26%、暗面往黑推 22%、阴影 42% —— 这组比例是照着手写的 `CLAY`
 * 反推出来的，所以派生出来的块和原生黏土块摆在一起不会像另一种材质。
 *
 * **深色基色要收着推**：同样的 +26% 打在中灰上只是「亮一点」，
 * 打在近黑上会直接跳到中灰 —— 深色主题的按钮实测就是这样变成一片脏灰、
 * 读作「禁用」的。所以按亮度分两档，暗色基色只推 13%。
 */
export function clayFrom(hex: string): ClayTones {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { base: hex, light: hex, dark: hex, shade: hex };
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luma = 0.299 * ch[0] + 0.587 * ch[1] + 0.114 * ch[2];
  const upK = luma < 96 ? 0.13 : 0.26;
  const downK = luma < 96 ? 0.20 : 0.22;
  const toward = (target: number, k: number) =>
    ch.map((c) => Math.round(c + (target - c) * k));
  const rgb = (v: number[]) => `rgb(${v[0]},${v[1]},${v[2]})`;
  return {
    base: hex,
    light: rgb(toward(255, upK)),
    dark: rgb(toward(0, downK)),
    shade: rgb(toward(0, downK + 0.20)),
  };
}

/** 主题定义。 */
export interface BoardTheme {
  id: string;
  /** 陈列名（两个字最好，展台上要放得下） */
  name: string;
  /** 一句话卖点，只在展台铭牌上出现 */
  tagline: string;
  tier: ThemeTier;
  unlock: ThemeUnlock;
  /**
   * 铺整屏背景。
   *
   * `box` 是**实际可视范围**（可能超出 750×1334），主题必须按它铺，
   * 否则 390×844 上会看到上下各 75px 的接缝。
   */
  backdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void;
  /** 画盘面（底板 + 格 + 线 + 图标 + 端点 + 提示）。 */
  board(c: ThemeDrawCtx): void;
  /**
   * 界面配色。不传 = 用黏土默认色（经典盘面就是这个情况）。
   *
   * 深色主题必须传：不传的话奶油按钮 + 深棕文字会直接读不出来。
   */
  chrome?: ThemeChrome;
}

/** 判断某个主题在给定最高关号下是否已解锁。 */
export function themeUnlocked(
  theme: BoardTheme,
  maxLevel: number,
  adUnlocked: ReadonlySet<string>,
): boolean {
  switch (theme.unlock.type) {
    case 'free': return true;
    // 里程碑直接由 `maxLevel` 推导，不落盘。
    // 好处是跨设备天然一致 —— 服务端只同步关号，不同步「我解锁过哪些主题」，
    // 存成本地数组的话换机就会丢。
    case 'milestone': return maxLevel >= theme.unlock.value;
    case 'ad': return adUnlocked.has(theme.id);
  }
}
