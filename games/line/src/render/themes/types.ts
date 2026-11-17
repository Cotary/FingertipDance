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
   * 棋盘进场时刻（ms）。配合 `ThemeMotion.enter` 用：从这一刻起逐格落下。
   *
   * 不给 = 已经落定（进场结束、或这套主题根本没有进场动效）。
   */
  enter?: number;
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
  /**
   * 刚被按下的一格（拍平索引）与时刻，-1 = 无。
   *
   * 设计稿的按压反馈是**三件事同帧**：棋子下沉到 0.94（120ms）、
   * 一圈金环扩散出去（500ms）、瓷轻叩落地（90ms）。
   * 三者错开 50ms 就散——所以时刻由这里一次性给出，主题不再各算各的。
   */
  pressCell?: number;
  pressAt?: number;
  /**
   * 刚落子的格 → 时刻。
   *
   * 「落子」和「按压」不是一回事：按压是手指按住那一格（下沉再弹回），
   * 落子是色块**从上方掉下来**再沉回去。鸣沙的每一格都要落一次，
   * 天青不需要（它的东西是浮在釉上的，掉下来就变成贴纸）。
   */
  drops?: Map<number, number>;
  /** 通关逐格落定：格 → 亮起时刻（铺满级联）。 */
  settle?: Map<number, number>;
  /** 通关时刻（盖印 / 抖墙）。0 = 没通关 */
  wonAt?: number;
  /** 最近一次延长连线的时刻（沥金生长用）。0 = 不生长 */
  trailAt?: number;
}

/**
 * 落子 / 铺满 / 沥金 / 盖印的动效参数。
 *
 * ## 为什么按主题给、不给就静止
 *
 * 动效是每套主题自己的语言：天青的东西是"浮在釉上"，减一点动反而更贵；
 * 鸣沙的东西是"沙落、堆起、扬起、沉淀"，每一格都该落下来。
 * 所以这些参数定义在这里、由主题填，没填的主题保持静止 ——
 * 缺省**不会**退化成半套动画。
 */
export interface ThemeMotion {
  /**
   * 落子：新铺下的一格从上方按下落，触底扬尘。
   *
   * `lift` / `swell` 是设计稿 `dropIn` 的两个数：升起 16/54 个棋子、
   * 放大 14%。`dust` 是触底扬出的粒数（设计稿 4 粒，向右下 30°~99°）。
   */
  drop?: { ms?: number; lift?: number; swell?: number; dust?: number };
  /**
   * 铺满：通关时逐格落定（`settleSand`）。粒度由 `main` 的波次步进给。
   *
   * `pulse` 是**末粒**那一下：全盘一层沙光（设计稿 180ms）。
   * 它不是淡入 —— 是一层暖光从盘心铺开再退掉，所以用 `lighter` 叠，
   * 而不是把盘面往白色插值（插值会把矿物颗粒洗平，读作"蒙了层雾"）。
   */
  settle?: {
    ms?: number;
    dust?: number;
    /** 起始位移（相对格宽，设计稿 −10/62 = 0.161） */
    lift?: number;
    /** 起始放大（设计稿 1.06） */
    swell?: number;
    pulse?: { ms?: number; color?: string; alpha?: number };
  };
  /**
   * 进场：开局的揭幕。
   *
   * 空盘突然出现一整片格子，等于把最有质感的那一下省掉了。两种形态：
   *
   * - `form: 'drop'`（默认）—— 整盘**逐行落下**，落定即嵌进沙面。
   *   鸣沙的墙面语言：沙落在墙上。
   * - `form: 'settle'` —— 格子**原地弹一下**就位（下沉 lift + 胀 swell 收平），
   *   像釉水次第流进格槽。天青按「质感 Demo 的铺满全盘」用这一种：
   *   釉不会从天上掉下来，它是**渗进槽里**的。
   *
   * `ms` 每格多久，`step` 同行相邻两格的间隔，`row` 行与行之间的额外停顿
   * （不给 `row` 就是一条等速斜线扫过，读不出"一行一行"），
   * `lift` 起始位移（相对格宽），`swell` 起始放大。
   *
   * 不给 = 一次全在场（黏土那套页面没有这层语言）。
   *
   * `sweep` 是整条扫掠的时间上限：格子多（8×8）时按 `step`/`row` 排要 1.4 秒，
   * 那时候玩家已经在点屏幕了，所以超出上限就等比压缩每格间隔，总时长封住。
   *
   * `pulse` 是**末格**那一下：全盘一层金光（天青 420ms）。它不是淡入 ——
   * 是一层光从盘心铺开再退掉，所以用 `lighter` 叠，而不是把盘面往白色插值。
   */
  enter?: {
    ms?: number;
    step?: number;
    row?: number;
    lift?: number;
    swell?: number;
    form?: 'drop' | 'settle';
    sweep?: number;
    pulse?: { ms?: number; color?: string; alpha?: number };
  };
  /** 沥金生长：每走一格，线"堆"完这段要几毫秒。不给 = 一次画完。 */
  grow?: number;
  /**
   * 盖印：落印时刻整面墙抖一下。`shake` 是振幅（相对格宽）。
   *
   * `size` 是印的边长（相对**格宽**），不给就用卡宽的 0.25。
   * 这个数必须由主题给：鸣沙的石章是 1.65 个棋子（砸得住），
   * 天青的瓷印只有 0.8 个棋子（是"落款"，不是"盖住"）。
   * 同一个 0.25 卡宽套到两套上，必有一套大得离谱。
   */
  seal?: { ms?: number; at?: number; shake?: number; size?: number };
  /**
   * 通关末粒之后，多久起"结束音"（鸣沙是土埙、天青是玉磬）。
   *
   * 两个数不一样是有道理的：鸣沙的埙要等沙雨的**尾音**散一散才起
   * （168ms，否则两段噪声叠在一起）；天青的磬是单记的点音，
   * 早 48ms 就接得上（120ms，设计稿 `N*48 + 120`）。
   */
  winGap?: number;
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
  /**
   * 强调正文（关号、底注里那个决定星级的数）。
   *
   * 天青是暗底，强调 = 更亮的奶油金（#F2DCA8）；鸣沙是亮底，
   * 同一个值会直接消失在土壁上 —— 亮色主题必须自己给一个**更暗**的值。
   * 不填则回落 `#F2DCA8`（深色主题的历史值）。
   */
  inkStrong?: string;
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
   *
   * `now` 给会动的背景用（鸣沙的光柱尘埃）。静态背景可以不理它。
   */
  backdrop(ctx: CanvasRenderingContext2D, box: DesignBox, now?: number): void;
  /** 画盘面（底板 + 格 + 线 + 图标 + 端点 + 提示）。 */
  board(c: ThemeDrawCtx): void;
  /**
   * 通关那一下的印。不实现就用黏土的圆形朱印。
   *
   * 印本身是这套主题的「款」：天青是圆的朱印、鸣沙是方的石章。
   * 形状不同，砸下来的动效也不同（圆印是缩放回弹，石章是自由落体 + 抖墙）。
   */
  winSeal?(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, elapsed: number): void;
  /**
   * 抵达终点那一格的**爆闪**（设计稿「抵达 · 爆闪」）。
   *
   * 它和 `winSeal` 是两件事，时间上也错开：
   * 爆闪在**线头碰到终点那一帧**（`wonAt`），落印在级联跑完之后。
   * 中间隔着整段"从终点反向点亮全路径"—— 先亮起，再落款。
   *
   * 不传 = 这一套没有这一下（玻璃/黏土那几套的终点不是"抵达"）。
   */
  arrive?(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    elapsed: number,
  ): void;
  /**
   * 这套主题的动效参数（透传自 `ThemeKit.motion`）。
   *
   * `main` 需要它做两件**时序**上的事，而这两件都不能由主题自己做：
   * - 通关波次要不要跑（没有 `settle` 的主题跳过整段级联）
   * - 盖印的音画要不要延到级联之后（土埙在末粒、石章在印落定的那一帧）
   */
  motion?: ThemeMotion;
  /**
   * 切页转场。
   *
   * 不填 = 这个世界的切页不做转场（黏土那几套就是）。
   * 给了就等于声明：这一套的语言是"幕被抹开"，而不是"两片玻璃叠化"。
   *
   * `kind` 决定边的形态 —— `wall` 是撕开的墙皮（鸣沙的土壁），
   * `glaze` 是刮过的釉面（天青的直边 + 42px 高光带）。两者共用一个推移器，
   * 但边完全不一样：一个是崩口，一个是刀口。
   */
  wipe?: {
    from: string;
    to: string;
    edge?: string;
    kind?: 'wall' | 'glaze';
    /** 幕布时长（ms）；省略 480。天青 520。 */
    ms?: number;
  };
  /**
   * 触感五档（ms / 数组，语义同 `navigator.vibrate`）。
   *
   * 不填 = 用通用那组（落子 8 / 连径 15 / 铺满 [10,25,10,25,18] / 盖印 40 / 按钮 5）。
   * 给了就整套覆盖 —— 手感是**节奏**，五档必须一起定，单独改一档会失衡。
   *
   * 天青给的是 `[8] / [20] / [15,30,15,30,25] / [45] / [5]`：
   * 瓷的叩击更"脆"（20 而不是 15），玉磬的余韵更"长"（三段 30 的停），
   * 印落纸更"沉"（45）。
   */
  haptics?: {
    step?: number | number[];
    trail?: number | number[];
    settle?: number | number[];
    seal?: number | number[];
    tap?: number | number[];
  };
  /**
   * 界面配色。不传 = 用黏土默认色（经典盘面就是这个情况）。
   *
   * 深色主题必须传：不传的话奶油按钮 + 深棕文字会直接读不出来。
   */
  chrome?: ThemeChrome;
  /**
   * 盘下图例的色块。
   *
   * 图例是**世界观的索引**：它列的是"这个世界有哪几种东西"，
   * 所以色块必须取这一套主题自己的机制色族 —— 天青是暗石板 + 金线，
   * 鸣沙是矿物色片。不填则用深石板（深色盘面的历史值），
   * 亮色盘面上那六块深色会像六张贴纸。
   */
  legend?: Partial<Record<LegendKind, { bg: string; ink: string }>>;
  /**
   * 图例色片上的记号。
   *
   * 默认那套记号是第一批主题画的（冰面是一道斜坡、箭是一根杆）。
   * 但记号必须和**盘面上那一枚**同形状：鸣沙的冰是六边晶，
   * 那道斜坡压在他的石青片上，实测读成「A/」。
   */
  legendMarks?: Partial<Record<LegendKind, LegendMark>>;
  /**
   * 展台上的五色签。
   *
   * 不填则由 `chrome` 派生（深→浅排序），但界面五色 ≠ 盘面五色：
   * 鸣沙的界面是土黄系，盘面是石绿/朱砂/石青 —— 派生出来的五格会全是土黄。
   */
  swatches?: readonly string[];
}

/** 图例的七种机制记号（与 `ui/hud.ts` 的 `LegendItem['kind']` 一一对应）。 */
export type LegendKind = 'arrow' | 'star' | 'key' | 'gate' | 'portal' | 'ice' | 'rock';

/**
 * 图例记号：在 `sw × sw` 的色片中心画一枚符号。
 *
 * 坐标用 **48 视图**（和设计稿的 SVG 同一个空间），按 `sw / 48` 缩放 ——
 * 这样主题可以直接拿它自己图标那份路径数据，只换颜色。
 */
export type LegendMark = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sw: number,
  ink: string,
) => void;

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
