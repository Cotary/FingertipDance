/**
 * 主题拼装工具（第二批典藏用）。
 *
 * ## 为什么要这一层
 *
 * 一套主题的画序是固定的：底板 → 格 → 提示 → 线 → 图标 → 线头 → 端点。
 * 四套新主题如果各写一遍这段流程，改一处画序要改四遍，而且必然有一份忘了改
 * （第一批的 `linear.ts` 和金线就是各自实现的，好在只有两份）。
 *
 * 所以这里只保留**流程**，把「像不像这套主题」的部分全部抽成钩子：
 * 背景、底板、单个格、线、线头、端点，各一个函数。主题文件里只有这些钩子。
 *
 * ## 一个必须守住的顺序
 *
 * 提示画在**线之前**。第一批做过一次反的：提示高亮压在连线上，
 * 连线横穿高亮框，玩家看到的是一圈被切断的金色 → 提示读作「这里有东西坏了」。
 */
import type { BoardLayout } from '../layout';
import { BOARD_GAP } from '../layout';
import { roundRect } from '../board';
import { cellDir, cellGroup, cellType, CoverCell, type Dir } from '../../core/cover/v3/types';
import {
  drawGlyph,
  type GlyphDecor,
  type GlyphKind,
  type GlyphPalette,
  type GlyphShapes,
  type GlyphStyle,
} from './glyphs';
import type { BoardTheme, DesignBox, ThemeMotion, ThemeState, ThemeTier, ThemeUnlock } from './types';

/** 一个格子的绘制上下文。四套主题的 `cell` 钩子都吃它。 */
export interface CellGeom {
  ctx: CanvasRenderingContext2D;
  /** 格左上角 */
  x: number;
  y: number;
  /** 格心 */
  cx: number;
  cy: number;
  /** 网格坐标（棋盘格配色要用，不能靠 idx 反推 w） */
  gx: number;
  gy: number;
  cell: number;
  idx: number;
  /** `CoverCell` 的类型值 */
  type: number;
  /** 已走过 */
  walk: boolean;
  /**
   * 状态变体键（`gateOpen` / `portalA` / `star2` …）。
   *
   * `cell` 钩子在**图标之前**跑，却常常要按图标的状态改格面（开着的门
   * 整颗棋子变亮）。没有这一项，`cell` 只能按类型猜，开着和关着就一个样。
   */
  variant?: string;
  now: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** 变体查询的入参：这一格的类型、分组、坐标，以及整个盘面与运行状态。 */
export interface VariantCtx {
  type: number;
  group: number;
  idx: number;
  /** 网格坐标 */
  x: number;
  y: number;
  board: { w: number; h: number; grid: Uint8Array };
  st: ThemeState;
}

/** 一套主题的差异化部分。没实现的钩子用通用版本。 */
export interface ThemeKit {
  backdrop(ctx: CanvasRenderingContext2D, box: DesignBox, now?: number): void;
  plate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void;
  /**
   * 盘子的裁切边界（只在**进场**期间生效）。
   *
   * 整盘落格时第一行要从盘沿上方掉进来，没有这道裁切就会看到几块土砖
   * 飘在盘外的墙上 —— 砖块是"落进盘子里"，不是"贴在墙上的盘子外面"。
   * 不传 = 不裁（主题的盘子和背景同料，飞出来也不穿模）。
   */
  clip?(ctx: CanvasRenderingContext2D, layout: BoardLayout): void;
  cell(g: CellGeom): void;
  /** 已走线的绘制。默认三遍描边（halo / core / hot），颜色由 `trailColors` 给。 */
  /**
   * 已走线的绘制。
   *
   * `grow` 是这一笔**堆到哪儿了**（0..1，1 = 已堆完）。主题用它做两件事：
   * 高光线滞后主线一点跟上（设计稿 80ms）、辉光在 30% 处脉冲一次再衰减。
   * 不给这个数，主题只能画一条"整体亮着"的静态线 —— 那就没有"描"的过程了。
   */
  trail?(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number, now: number, grow?: number): void;
  /** 不传则用 `trailColors` + 默认三层宽度。 */
  trailColors?: { halo: string; core: string; hot: string };
  /** 提示高亮的形状。默认是内缩的圆角方框；圆格 / 胶囊主题要自己画。 */
  hint?(ctx: CanvasRenderingContext2D, p: Pt, cell: number, i: number, color: string): void;
  glyph: {
    style: GlyphStyle;
    pal: GlyphPalette;
    /**
     * 按格状态换一套图标色。
     *
     * 暗色棋盘上，图标必须是浅色；但鎏金/霜青这类**亮格**上浅色图标会消失。
     * 主题自己按 type 决定用哪套（`CoverCell.SHARD` → 深墨、其余 → 浅釉）。
     *
     * 第二个参数是**状态**（可选）：门开之后整枚门要换色（玄墨 → 天青透光），
     * 只按 type 判断的话，开着的门还是那块玄墨，读不出"已经能过了"。
     */
    palFor?: (type: number, state?: { variant?: string; wasOpen?: boolean }) => GlyphPalette;
    /**
     * 按格类型微调图标倍率（乘在 `scale` 上）。
     *
     * 不同图标的**视觉重量**不一样：五角星这个形状几乎顶满 24×24 的画布，
     * 而钥匙 / 门的线条只占中间 60% —— 用同一个倍率画出来，
     * 星比门大一圈。设计稿是靠各自的留白控制的，这里按类型回调一次。
     */
    scaleFor?: (type: number) => number;
    /** 图标底盘；空串 = 不画 */
    back: string;
    backEdge: string;
    backR?: number;
    /**
     * 地形记号（石障 / 冰）的填色覆盖。
     *
     * 默认跟 `pal.accent`。但 accent 是金的主题（mise）必须压住它：
     * 石块上一摊金填色会把路线的金压没——「金贵如缮」死在这里。
     * 设成暗色/浅刻痕色，金只留给线。
     */
    terrainAccent?: string;
    /**
     * 图标相对格宽的倍率（默认 0.50）。
     *
     * 默认值是给「有格面」的主题定的：格子本身有填充，图标只要压在面上就清楚。
     * 但浅底 / 留白大的主题（瓷、纸）里，0.50 的图标会漂在一大片空白中，
     * 读起来像「页面上贴了个小图标」。这类主题自己往上推到 0.60~0.66。
     */
    scale?: number;
    /**
     * 不画图标的格类型。
     *
     * `cell` 钩子已经把这一格画成一个**实体**（比如秘色天青的墨石，
     * 有接触阴影和两个面），再叠一层同形状的线稿就是"石头外面还套着石头"——
     * 早先那颗石头看着像"一个带边线的洞"就是这么来的。
     */
    skip?: number[];
    /**
     * 主题自己的图标几何（整条替换某一类）。
     *
     * 见 `GlyphShapes`：同一个机制在两套主题里可以是两个形状。
     */
    shapes?: GlyphShapes;
    /** 笔触之后的细节补充（星箔亮边、干笔缺口、冰晶分水面……）。 */
    decor?: GlyphDecor;
    /**
     * 禁止格内落字。
     *
     * 天青的纪律是「格内永远不落字」—— 星阶靠**星数**递进、传送门靠实虚环，
     * 都不写数字。角标一旦落上，"一阶/二阶"和"1/2"就变成两套并存的编号，
     * 而且角标的衬线数字会抢走金色光迹的注意力。
     */
    noCornerNumber?: boolean;
    /**
     * 状态变体：同一类机制在不同状态下换形状（门开/闭、传送门进/出口、星阶）。
     *
     * 返回 `key` 就在 `shapes` 里找同名条目；返回 `hidden` 就整格不画图标
     * （例如"已开的门"由门框自己表达，不再叠一枚符号）。
     */
    variant?: (c: VariantCtx) => { key?: string; hidden?: boolean } | undefined;
  };
  head(ctx: CanvasRenderingContext2D, p: Pt, cell: number, now: number): void;
  endpoint(ctx: CanvasRenderingContext2D, kind: 'start' | 'end', p: Pt, cell: number): void;
  /** 地形底的填充（石头 / 冰）。不传就不铺底，只靠图标本身。 */
  terrain?(g: CellGeom): void;
  /**
   * 最后一层（所有格子、线、图标之上）。
   *
   * 只有像素主题用它：CRT 扫描线必须盖住整个画面（包括盘面）才成立，
   * 画在背景层的话会被格子和底板挡掉，只剩四周一圈横纹。
   */
  overlay?(ctx: CanvasRenderingContext2D, layout: BoardLayout): void;
  hintColor: string;
  /** 提示呼吸的一个来回（ms）。默认 1900（天青设计稿是 1800）。 */
  hintPulseMs?: number;
  /** 提示高亮的线宽倍率（像素主题要粗、水墨要细） */
  hintWidth?: number;
  /**
   * 按压反馈的四个数。
   *
   * 默认值是天青的「瓷」：下沉 160ms、环 500ms 长到 1.18 —— 环是**水痕**，
   * 贴着棋子散开一圈就停。鸣沙的「沙」正好相反：压得更狠（0.93）、
   * 环更短更远（380ms 长到 1.9），因为那一圈是**掐起来的土**，
   * 会一直扬到隔壁格上去。同一段代码，两组数就是两种材质。
   */
  press?: {
    /** 下沉回弹时长（ms） */
    down?: number;
    /** 尘环时长（ms） */
    ring?: number;
    /** 环的起始倍率 */
    from?: number;
    /** 环的终止倍率 */
    to?: number;
    /** 棋子最快压到多小 */
    scale?: number;
    /** 环色；不填用 `hintColor` */
    color?: string;
    /** 线宽（相对棋子边长） */
    width?: number;
    /**
     * **起手抬升**：起手那一格按下时，放大到这个倍率（而不是 `scale` 缩小）。
     *
     * 设计稿把「按压」和「起手抬升」当两件事：
     * - `按压`（TOKEN 表）：任何格按下 → 缩到 0.94，"按进绒面"；
     * - `起手抬升`（立体读法 + 格态卡"起手按下 · 抬升"）：**起点那一格**
     *   → 放大到 1.1 + 抬升 3px，"**被拿起来**"，全屏同时只有 1 格。
     *
     * 语义是反的，因为动作是反的：普通按下是"按下去"，按起点是"拿起笔开始画"。
     * 不填 = 所有格都用 `scale`（没有拿起这个语言的主题）。
     */
    liftScale?: number;
    /** 起手抬升的位移（相对棋子边长，向上为负）。设计稿 −3px / 64 ≈ −0.047。 */
    liftDy?: number;
  };
  /**
   * 动效参数。**不给就是不动**。
   *
   * 动效是每套主题自己的语言：天青的东西是"浮在釉上"，减一点动反而更贵；
   * 鸣沙的东西是"沙落、堆起、扬起、沉淀"，每一格都该落下来。
   * 所以这些参数按主题给，没给的主题保持静止 —— 不给不会退化成半套动画。
   */
  motion?: ThemeMotion;
  /**
   * 通关那一下的印。不实现就用黏土的圆形朱印（`drawWinSeal`）。
   */
  winSeal?(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, elapsed: number): void;
  /** 抵达终点那一格的爆闪（见 `BoardTheme.arrive`）。不传 = 没有这一下。 */
  arrive?(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    elapsed: number,
  ): void;
}

/**
 * 落子 / 铺满 / 盖印 / 沥金的动效参数。
 *
 * 定义在 `types.ts`：`BoardTheme.motion` 要能被 `main` 读到 ——
 * 通关波次跑不跑、盖印的音画延到哪一帧，都是**时序**决定，
 * 只能由知道全局时钟的那一层来排。这里只做再导出，避免两处各写一份。
 */
export type { ThemeMotion } from './types';

/**
 * 按下的两段时长（ms）。
 *
 * 下沉 160 而不是设计稿的 120：120 是 CSS `:active` 的 transition，
 * 那是"手指按着不放"的时长；这里每一格都是"落子"，要有一下**回弹**，
 * 太短会读成掉帧。环是 500ms —— 珠子滚过瓷面留下的那一圈水痕。
 */
const PRESS_DOWN_MS = 160;
const PRESS_RING_MS = 500;
/** 棋子最快压到多小（设计稿 `.tap-ring` 同帧的 `scale(.94)`） */
const PRESS_SCALE = 0.94;

/**
 * 无效落子的左右摆：振幅 = 0.06 格，260ms 内摆两个半来回并衰减到 0。
 *
 * 两个半来回 ≈ 9.6Hz。再快（3 个来回 / 220ms = 13.6Hz）在 60fps 上只剩三帧，
 * 读起来不是"晃了一下"，是"掉帧了"。
 */
const SHAKE_MS = 260;
const SHAKE_CYCLES = 2.5;

export function composeTheme(meta: {
  id: string;
  name: string;
  tagline: string;
  tier?: ThemeTier;
  unlock: ThemeUnlock;
  chrome?: BoardTheme['chrome'];
  legend?: BoardTheme['legend'];
  legendMarks?: BoardTheme['legendMarks'];
  wipe?: BoardTheme['wipe'];
  haptics?: BoardTheme['haptics'];
  swatches?: BoardTheme['swatches'];
  kit: ThemeKit;
}): BoardTheme {
  const { kit } = meta;
  return {
    id: meta.id,
    name: meta.name,
    tagline: meta.tagline,
    tier: meta.tier ?? 'premium',
    unlock: meta.unlock,
    chrome: meta.chrome,
    legend: meta.legend,
    legendMarks: meta.legendMarks,
    wipe: meta.wipe,
    haptics: meta.haptics,
    swatches: meta.swatches,
    backdrop: (ctx, box, now) => kit.backdrop(ctx, box, now),
    winSeal: kit.winSeal,
    arrive: kit.arrive,
    motion: kit.motion,
    board: (c) => {
      const { ctx, board, layout, state: st, now } = c;
      const mo = kit.motion;

      ctx.save();

      // 盖印：石章砸到墙上的那一下，**整面墙**抖三帧（设计稿 `wallShake`）。
      // 只让印自己抖是"贴纸在动"，墙抖才是"砸进去了"
      if (mo?.seal && st.wonAt) {
        const [sx, sy] = wallShake(now - st.wonAt, mo.seal, layout.cell);
        if (sx !== 0 || sy !== 0) ctx.translate(sx, sy);
      }

      kit.plate(ctx, layout);

      const dropMs = mo?.drop?.ms ?? 260;
      const settleMs = mo?.settle?.ms ?? 260;

      // 进场：开局整盘逐格落下。`gate` 为 undefined 时下面所有判定都退化成"已在场"。
      // 幕（剥壁）还在退的 480ms 里格子就开始落了 —— 同向，读起来是
      // "墙被抹开，沙面上一块块砖跟着拍下来"，不是两件事
      const en = mo?.enter;
      const gate: EnterGate | undefined = en
        ? {
            at: (x, y) => enterProgress(st, en, x, y, board.w, board.h, now),
            // drop 落得远（0.62 格）、settle 只沉一点点（0.16 格）：
            // 釉水是"渗进槽里"，不是从天上掉下来
            form: en.form ?? 'drop',
            lift: en.lift ?? (en.form === 'settle' ? 0.16 : 0.62),
            swell: en.swell ?? (en.form === 'settle' ? 1.06 : 1),
          }
        : undefined;
      // 第一行是从盘沿**上方**掉进来的，所以进场期间要裁到盘子里。
      // 裁切只罩住格子这一层，plate 在它外面 —— 不然盘沿自己的磕口会被削平
      const enterLive = !!(en && st.enter && now - st.enter < enterTotalMs(en, board.w, board.h));
      ctx.save();
      if (enterLive) kit.clip?.(ctx, layout);

      // 格 + 地形
      for (let y = 0; y < board.h; y++) {
        for (let x = 0; x < board.w; x++) {
          const idx = y * board.w + x;
          const type = cellType(board.grid[idx]);
          if (type === CoverCell.VOID) continue;
          // 还没轮到这一格：整个不画。格子是在**空沙面**上一块块长出来的，
          // 不是先有一层灰再逐格变亮（那是淡入，玻璃的语言）
          const enT = gate ? gate.at(x, y) : 1;
          if (enT < 0) continue;
          // 变体必须在 `cell` 之前算：格面自己也要看状态（门开 → 整颗变亮）
          const cellVar = kit.glyph.variant?.({ type, group: cellGroup(board.grid[idx]), idx, x, y, board, st });
          const g: CellGeom = {
            ctx,
            x: layout.originX + x * layout.cell,
            y: layout.originY + y * layout.cell,
            cx: layout.originX + x * layout.cell + layout.cell / 2,
            cy: layout.originY + y * layout.cell + layout.cell / 2,
            gx: x,
            gy: y,
            cell: layout.cell,
            idx,
            type,
            walk: st.covered.has(idx),
            variant: cellVar?.key,
            now,
          };

          // 落子：这一格是刚铺下的，就从上方落进来（设计稿 `dropIn`）。
          // 它和「按压」是两件事，同一格上不能叠加 —— 新格以落子为准。
          // 撤回之后那格已经不再是"铺过的"，落子动画也要跟着作废
          const dropT = st.covered.has(idx) ? dropProgress(st.drops, idx, now, dropMs) : -1;
          // 铺满：通关时逐格"沉一下就位"（设计稿 `settleGlaze`）。
          //
          // 它和落子（`dropIn`）是两段不同的曲线：落子是"掉下来"，铺满
          // "胀一下、收平"。也是**同一个机制**：谁最近动过这一格，就让谁管。
          // 早先 `settle` 只驱动扬尘和末格脉冲 —— 级联时格子一颗都不动，
          // 那 48ms 的步进就成了"一束看不见的光在跑"，画面是死的。
          const setT = st.covered.has(idx) ? dropProgress(st.settle, idx, now, settleMs) : -1;
          // 按下：整颗棋子缩下去再弹回。
          //
          // 只在**这一格**自己的坐标系里缩，坐标原点仍是格心 ——
          // 换主题时不用改一行，所有主题都自动获得这个手感。
          const press =
            dropT >= 0 || setT >= 0 ? 0 : pressProgress(st, idx, now, kit.press?.down ?? PRESS_DOWN_MS);
          const shake = shakeOffset(st, idx, now, layout.cell);
          ctx.save();
          // 进场在最外层：先落到自己该在的位置，再谈按下的手感。
          // 反过来的话，正在落的格子被按一下会绕着**半空中的**格心缩，
          // 看起来像被人从下面顶了一下
          if (gate && enT < 1) applyEnter(ctx, enT, g.cx, g.cy, gate, layout.cell);
          if (shake !== 0) ctx.translate(shake, 0);
          if (dropT >= 0) {
            const d = dropPose(dropT, layout.cell, mo?.drop);
            ctx.globalAlpha *= d.alpha;
            ctx.translate(g.cx, g.cy + d.dy);
            ctx.scale(d.k, d.k);
            ctx.translate(-g.cx, -g.cy);
          } else if (setT >= 0) {
            const d = settlePose(setT, layout.cell, mo?.settle);
            ctx.translate(g.cx, g.cy + d.dy);
            ctx.scale(d.k, d.k);
            ctx.translate(-g.cx, -g.cy);
          } else if (press > 0) {
            /**
             * 按下有两种语义，按**格类型**分：
             *
             * - **起点**（`CoverCell.START`）：`liftScale`（1.1）+ 向上抬 `liftDy`。
             *   读者是"拿起这一片、开始画"，所以它是**放大且浮起**的。
             * - 其余格：`scale`（0.94）压下去，是"按进绒面"。
             *
             * 两者都是"全屏同时只有 1 格"（`pressCell` 只有一个），
             * 所以不会出现"一格放大、一格缩小"同时发生。
             *
             * `ease`：press 是 0→1 的**线性进度**（它衡量的是"离按下过了多久"），
             * 而手感要的是"先快后慢地就位"，所以套 `pow(press, 0.55)`。
             */
            const isStart = type === CoverCell.START;
            const target = isStart ? (kit.press?.liftScale ?? 1) : (kit.press?.scale ?? PRESS_SCALE);
            const k = 1 + (target - 1) * Math.pow(press, 0.55);
            const dy = isStart ? (kit.press?.liftDy ?? 0) * layout.cell * Math.pow(press, 0.55) : 0;
            ctx.translate(g.cx, g.cy + dy);
            ctx.scale(k, k);
            ctx.translate(-g.cx, -g.cy);
          }

          if (kit.terrain && (type === CoverCell.BLOCK || type === CoverCell.ICE)) kit.terrain(g);
          kit.cell(g);
          ctx.restore();
        }
      }

      // 扬尘：落子和铺满都会在**触底之后**才起灰。放在格子之后画，
      // 灰要盖在隔壁格上才算"扬出去"
      if (mo?.drop && st.drops) {
        dustPass(ctx, layout, board.w, st.drops, st.covered, dropMs * 0.5, 420, mo.drop.dust ?? 4, now);
      }
      if (mo?.settle && st.settle) {
        const ms = mo.settle.ms ?? 260;
        dustPass(ctx, layout, board.w, st.settle, st.covered, ms * 0.6, 380, mo.settle.dust ?? 2, now);
      }

      // 金环画在**所有格子之后**：它要越过隔壁那颗棋子，
      // 跟着格子一起画会被后画的邻居切掉半边，读作"缺了一块的圈"
      const ring = st.pressCell ?? -1;
      if (ring >= 0) drawPressRing(ctx, layout, ring, board.w, st, now, kit);

      drawHint(ctx, board.w, layout, st, kit, now);

      ctx.save();
      // 宽限期整条线压暗一半。旧管线是在 main 里用 globalAlpha 包的，
      // 主题接管后忘了这件事，玩家会以为「只要别按就有救」。
      if (st.paused) ctx.globalAlpha = 0.5;
      drawTrail(ctx, board.w, layout, st, kit, now);
      ctx.restore();

      drawMarks(ctx, board, layout, st, kit, gate);
      if (st.path.length > 0) {
        const p = center(layout, st.path[st.path.length - 1], board.w);
        kit.head(ctx, p, layout.cell, now);
      }
      drawEndpoints(ctx, board, layout, st, kit, gate);
      // 末粒沙光：整盘最后落定的那一粒之后，盘面亮一记再退掉。
      // 必须画在端点之后、`overlay` 之前 —— 它是一层**光**，要被像素主题的
      // 扫描线/暗角压住，否则光会浮在整个画面之上，像贴了块半透明的纸
      if (mo?.settle?.pulse) settlePulse(ctx, layout, board.w, board.h, st.settle, mo.settle.pulse, now);
      // 进场的末格：整盘亮一记（天青 420ms）。
      // 和"铺满"的末粒是同一段光，只是时刻不同 —— 一个在开局、一个在通关。
      // 末格时刻 = 进场起点 + 全盘扫掠时长（最后一行最后一格落定的那一刻）
      if (en?.pulse && st.enter) {
        const total = enterTotalMs(en, board.w, board.h);
        boardPulse(ctx, layout, board.w, board.h, st.enter + total - Math.max(60, en.ms ?? 300), en.pulse, now);
      }
      // 解除进场裁切：`overlay` 是整屏的扫描线/暗角，不该被盘沿裁
      ctx.restore();
      kit.overlay?.(ctx, layout);

      ctx.restore();
    },
  };
}

/**
 * 传送门入口表（按盘面缓存）。
 *
 * 每一组传送门里 idx 最小的那个是**入口**（A），另一个是出口（B）。
 * 规则是"进 A 立刻出 B"，所以进出口必须能一眼分开 —— 两套主题都靠
 * "实环 / 虚环"区分，而"谁是 A"只能扫全盘才知道。
 *
 * 为什么要缓存：变体回调**每帧每格**都会被问一次，直接扫是 O(n²)
 * （11×11 盘、121 格、每帧两次 = 3 万次/帧），而答案整关不变。
 * 用 `grid` 的引用做键：换关时 `grid` 是新数组，缓存自动失效。
 */
let portalCache: { grid: Uint8Array; first: Map<number, number> } | null = null;

/** 这一组传送门的入口格下标。没有 entry 时返回 -1。 */
export function portalEntrance(grid: Uint8Array, group: number): number {
  if (!portalCache || portalCache.grid !== grid) {
    const first = new Map<number, number>();
    for (let i = 0; i < grid.length; i++) {
      const b = grid[i];
      if (cellType(b) !== CoverCell.PORTAL) continue;
      const g = cellGroup(b);
      if (!first.has(g)) first.set(g, i);
    }
    portalCache = { grid, first };
  }
  return portalCache.first.get(group) ?? -1;
}

export function center(layout: BoardLayout, idx: number, w: number): Pt {
  return {
    x: layout.originX + (idx % w) * layout.cell + layout.cell / 2,
    y: layout.originY + Math.floor(idx / w) * layout.cell + layout.cell / 2,
  };
}

/** 稳定伪随机（同一格每帧必须同值，否则尘粒会跳位）。 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ── 落子 ───────────────────────────────────────────────────

/**
 * 落子进度（0..1）；-1 = 这一格不是刚落下的。
 *
 * 设计稿 `dropIn`：`0% translateY(-16px) scale(1.14) opacity 0` →
 * `55% translateY(2px) scale(.97)` → `100% translateY(0) scale(1)`。
 * 前 55% 是**掉下来**，后 45% 是**沉回去** —— 那 3% 的过冲就是"砸在墙上"的手感。
 */
function dropProgress(
  drops: Map<number, number> | undefined,
  idx: number,
  now: number,
  ms: number,
): number {
  if (!drops || ms <= 0) return -1;
  const at = drops.get(idx);
  if (at === undefined) return -1;
  const age = now - at;
  if (age < 0 || age >= ms) return -1;
  return age / ms;
}

/**
 * 进度 → 位移 / 缩放 / 透明度。
 *
 * CSS 的 `cubic-bezier(.22,1,.36,1)` 是**沙落**：前三分之一就走完大半路程。
 * 这里用 `1-(1-t)³` 逼近它 —— 真正的三次贝塞尔求解要迭代，为一条 260ms 的
 * 下落曲线在每帧每格算四五个 Newton 步，不划算。
 */
function dropPose(
  t: number,
  cell: number,
  cfg?: { lift?: number; swell?: number },
): { dy: number; k: number; alpha: number } {
  const p = 1 - Math.pow(1 - t, 3);
  const lift = (cfg?.lift ?? 0.30) * cell;
  const swell = cfg?.swell ?? 1.14;
  if (p < 0.55) {
    const k = p / 0.55;
    return {
      dy: -lift * (1 - k) + cell * 0.037 * k,
      k: swell + (0.97 - swell) * k,
      alpha: Math.min(1, k * 1.6),
    };
  }
  const k = (p - 0.55) / 0.45;
  return { dy: cell * 0.037 * (1 - k), k: 0.97 + 0.03 * k, alpha: 1 };
}

// ── 进场 ───────────────────────────────────────────────────

/** 进场扫掠的节奏。`at` 取的是「这一格什么时候开始落」，不是主题参数本身。 */
export interface EnterGate {
  at(x: number, y: number): number;
  lift: number;
  /** 起始放大（天青的 settle 形态用：1.06 → 1） */
  swell: number;
  /** 形态：`drop` 落下来，`settle` 原地弹（不下落那么远、有胀缩） */
  form: 'drop' | 'settle';
}

/**
 * 进场节奏：`k` 是扫掠压缩比，`total` 是全盘落定要多久（ms）。
 *
 * ## 公式必须和 `enterProgress` 用同一个模型
 *
 * 这一格什么时候起步：
 *
 * ```text
 * delay = x · step + y · (row + 什么?)
 * ```
 *
 * - 鸣沙（设计稿「伍·初始界面」）是**行序**：整行一起起步，行内左→右错峰，
 *   行与行之间只隔 `ROW_GAP`（220ms）。文档公式写得很直白：
 *   `start = r * ROW_GAP + c * CHIP_STAGGER` —— 行距**不乘行内格数**。
 *   5×8 → 4×220 + 7×30 + 420(坠落) = **1510ms**，正好在设计稿的 ≤1.7s 里。
 * - 天青是**斜线扫掠**（`row: 0`），两种模型在 `row = 0` 时完全等价。
 *
 * 早先这里写的是 `(w−1)·step + (h−1)·(w·step + row)` —— 相当于每行都要
 * 先等上一行**整行走完**再加行距（锯齿扫掠）。鸣沙一旦把 `row` 调到 220，
 * 5×8 就膨胀到 2470ms（超 1.7s 的框），而且和 `enterProgress` 的实际排期
 * 对不上：格子按行序起步、总时长却按锯齿算，"末格沙光"会迟到近一秒。
 */
function enterTempo(
  en: NonNullable<ThemeMotion['enter']>,
  w: number,
  h: number,
): { k: number; ms: number; total: number } {
  const ms = Math.max(60, en.ms ?? 300);
  const step = en.step ?? 24;
  const row = en.row ?? 0;
  // 末格起步时刻 —— 与 `enterProgress` 的 delay 同源
  const sweep0 = (w - 1) * step + (h - 1) * row;
  const cap = en.sweep ?? 720;
  // `sweep` 是**总时长**上限（设计稿：「总时长封顶 2.4s」），
  // 所以要先扣掉每格坠落那一段 `ms`，余下的才是留给扫掠的预算。
  // 早先直接拿 `cap` 压 `sweep0`，落定段没算进去 —— 11×11 压完仍超 400ms。
  const budget = Math.max(0, cap - ms);
  const k = sweep0 > budget ? (budget > 0 ? budget / sweep0 : 0) : 1;
  return { k, ms, total: sweep0 * k + ms };
}

/**
 * 这一格的进场进度：-1 = 还没轮到它，0..1 = 正在落，1 = 已落定。
 *
 * 顺序是**行优先**（`x` 快、`y` 慢），行与行之间额外压一段 `row` 停顿 ——
 * 只按 `(y*w+x)*step` 排的话是一条等速斜线扫过去，读起来是"擦除"不是"一行一行落"。
 */
function enterProgress(
  st: { enter?: number },
  en: NonNullable<ThemeMotion['enter']> | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  now: number,
): number {
  // 没有 `enter` 参数 = 这套主题没有进场语言，必须整盘立刻在场。
  // 注意不能只判 `st.enter`：`main` 对每套主题都传时刻，判漏了天青会一起落格
  if (!en || !st.enter) return 1;
  const { k, ms } = enterTempo(en, w, h);
  const step = en.step ?? 24;
  // 与 `enterTempo` 的 sweep0 完全同构：行内 x·step，行间 y·row。
  // 两者不同构的话，压缩比 k 会把行序压歪 —— 末格迟迟不落定，
  // 而"末行沙光"是按 total 算的，于是光先亮、格后落。
  const delay = (x * step + y * (en.row ?? 0)) * k;
  const t = (now - st.enter - delay) / ms;
  if (t <= 0) return -1;
  return t >= 1 ? 1 : t;
}

/**
 * 进场全盘落定要多久（ms）。
 *
 * 只用来判断"还要不要裁切"—— 一过这个点就整盘在场，再裁就是白花一次
 * `clip()` 的代价（每帧每盘一次，不是免费的）。
 */
export function enterTotalMs(en: NonNullable<ThemeMotion['enter']>, w: number, h: number): number {
  return enterTempo(en, w, h).total;
}

/**
 * 铺满姿态：**胀一下、收平**（设计稿 `settleGlaze`）。
 *
 * `0% -10px/1.06 → 60% +1px/.985 → 100% 0/1`
 *
 * 它和落子的区别不在幅度而在**节奏**：落子是"掉下来砸住"（越落越快、
 * 触底有一下硬的），铺满是"釉水渗进槽里"（先沉、再轻轻过冲、然后收平）。
 * 所以位移走缓出而不是 `t²`，且最后那 40% 是一次极小的回弹。
 */
function settlePose(
  t: number,
  cell: number,
  cfg?: { ms?: number; lift?: number; swell?: number },
): { dy: number; k: number } {
  const lift = (cfg?.lift ?? 0.16) * cell;
  const swell = cfg?.swell ?? 1.06;
  if (t < 0.6) {
    const u = t / 0.6;
    const e = 1 - (1 - u) * (1 - u);
    return { dy: -lift * (1 - e) + cell * 0.016 * e, k: swell + (0.985 - swell) * e };
  }
  const u = (t - 0.6) / 0.4;
  return { dy: cell * 0.016 * (1 - u), k: 0.985 + 0.015 * u };
}

/**
 * 进场姿态。
 *
 * 两种形态各有各的曲线，因为它们说的是两件事：
 *
 * - `drop`（鸣沙）：位移用 `t²`（越落越快），落定那一下是硬的 ——
 *   格子不是在"漂到位置"，是"砸下去嵌住"。缩放只给 3.5%：再多，
 *   相邻两格的边会互相咬出缝。
 * - `settle`（天青）：照设计稿 `settleGlaze`
 *   （`-10px/1.06 → +1px/.985 → 0/1`）—— 橡筋式：先沉下去、再过冲 1px 弹回。
 *   它读作"釉水渗进槽里"，不是"东西掉下来"。
 */
function enterPose(
  t: number,
  cell: number,
  lift: number,
  swell: number,
  form: 'drop' | 'settle',
): { dy: number; k: number } {
  if (form === 'settle') {
    // 前 60% 落、后 40% 回弹（设计稿的 60% 关键帧）
    if (t < 0.6) {
      const k = t / 0.6;
      const e = 1 - (1 - k) * (1 - k); // 缓出：前半程走完大半
      return { dy: -lift * cell * (1 - e) + cell * 0.026 * e, k: swell + (0.985 - swell) * e };
    }
    const k = (t - 0.6) / 0.4;
    return { dy: cell * 0.026 * (1 - k), k: 0.985 + 0.015 * k };
  }
  const fall = t * t;
  const near = 1 - t;
  return { dy: -lift * cell * (1 - fall), k: 1 + 0.035 * near * near * near };
}

/**
 * 把入场姿态套进当前坐标系（调用方已经 `save` 过）。
 *
 * 同时给格子、刻印、起点/终点、机制图标用同一套数 —— 分开算的话，
 * 石头上去了箭头还留在原地，读作"图标浮在空气里"。
 */
function applyEnter(
  ctx: CanvasRenderingContext2D,
  t: number,
  cx: number,
  cy: number,
  gate: EnterGate,
  cell: number,
): void {
  if (t >= 1) return;
  const p = enterPose(t, cell, gate.lift, gate.swell, gate.form);
  ctx.translate(cx, cy + p.dy);
  ctx.scale(p.k, p.k);
  ctx.translate(-cx, -cy);
}

/**
 * 扬尘：4 粒，向右下 30°~99° 散开。
 *
 * 方向是**顺光**的（光从左上来，灰往右下走）；随机一半靠固定哈希，
 * 所以每次落子同一格扬的灰是同一撮，但相邻两格的灰不一样。
 * 反过来（每帧 random）会变成一团闪烁的噪点，那是"噪点"不是"尘"。
 */
function puff(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  t: number,
  seed: number,
  n: number,
): void {
  const e = 1 - Math.pow(1 - t, 3);
  for (let i = 0; i < n; i++) {
    // π/6 .. π/6 + π/2.6 ≈ 30°..99°（设计稿 `spawnDust` 同一段）
    const ang = Math.PI / 6 + hash(seed * 3.1 + i * 7.7) * (Math.PI / 2.6);
    const dist = cell * (0.18 + hash(seed * 5.3 + i * 2.1) * 0.21) * e;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist;
    const r = Math.max(1.2, cell * 0.042 * (0.45 + 0.9 * e));
    const a = 0.52 * (1 - t);
    if (a <= 0.01) continue;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(168,120,58,${a})`);
    g.addColorStop(0.7, `rgba(168,120,58,${a * 0.3})`);
    g.addColorStop(1, 'rgba(168,120,58,0)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

/** 给一批格（刚落下 / 刚铺满）补扬尘。`startAt` = 触底时刻。 */
function dustPass(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  w: number,
  marks: Map<number, number>,
  live: Set<number>,
  startAt: number,
  dur: number,
  n: number,
  now: number,
): void {
  for (const [idx, at] of marks) {
    if (!live.has(idx)) continue;
    const age = now - at - startAt;
    if (age < 0 || age > dur) continue;
    const p = center(layout, idx, w);
    puff(ctx, p.x, p.y, layout.cell, age / dur, idx, n);
  }
}

// ── 末粒沙光 ───────────────────────────────────────────────

/**
 * 铺满级联的收束：**末粒**落定那一帧，整盘亮一记暖光（设计稿 180ms）。
 *
 * ## 为什么是「叠一层光」而不是「把盘面调亮」
 *
 * 把每个格子的颜色往白里插值，会先洗掉矿物颗粒和层理 —— 那层颗粒是这套
 * 主题的立身之本，一洗就变成"蒙了雾的塑料"。`lighter` 叠一层暖色不动底下的
 * 任何细节：颗粒、磕边、沥青的高光全都原样保留，只是被照亮了一下。
 *
 * ## 为什么峰值不在 0
 *
 * 末粒还在落（`settle` 那 260ms 的落定尾巴），立刻起光会和落子抢注意力。
 * 前 15% 起光、后 85% 退掉，读起来是"最后一粒砸下去，整盘被带得亮了一下"。
 */
function settlePulse(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  w: number,
  h: number,
  marks: Map<number, number> | undefined,
  cfg: { ms?: number; color?: string; alpha?: number },
  now: number,
): void {
  if (!marks || marks.size === 0) return;
  let last = 0;
  for (const at of marks.values()) if (at > last) last = at;
  if (last <= 0) return;
  boardPulse(ctx, layout, w, h, last, cfg, now);
}

/** 盘面一层暖光（时刻由调用方给）。铺满的末粒与进场末格共用。 */
function boardPulse(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  w: number,
  h: number,
  last: number,
  cfg: { ms?: number; color?: string; alpha?: number },
  now: number,
): void {
  const ms = Math.max(60, cfg.ms ?? 180);
  const t = (now - last) / ms;
  if (t < 0 || t >= 1) return;
  const k = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  const a = (cfg.alpha ?? 0.16) * k;
  if (a <= 0.004) return;

  const x0 = layout.originX;
  const y0 = layout.originY;
  const bw = w * layout.cell;
  const bh = h * layout.cell;
  const cx = x0 + bw / 2;
  const cy = y0 + bh / 2;
  const rgb = rgbTriple(cfg.color ?? '#F6E2B2');

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 半径取**内切圆**：光的 alpha 在圆边上正好归零，所以无论亮到什么程度，
  // 都不会在矩形边界上留下一道笔直的亮边（第一版取 0.55×对角线，
  // 结果盘面外沿出现了一圈"被照亮的方框"）
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(bw, bh) / 2);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.5, `rgba(${rgb},${a * 0.44})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, bw, bh);
  ctx.restore();
}

/** `#RRGGBB` → `"r,g,b"`。给渐变拼 `rgba()` 用，省得每个主题各写一份。 */
function rgbTriple(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '246,226,178';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ── 盖印 ───────────────────────────────────────────────────

/** 墙体抖动。返回 `[dx, dy]`；不在抖动窗口里就是 0。 */
function wallShake(
  elapsed: number,
  cfg: { at?: number; ms?: number; shake?: number },
  cell: number,
): [number, number] {
  const at = cfg.at ?? 175;
  const dur = 260;
  const amp = (cfg.shake ?? 0.055) * cell;
  const t = (elapsed - at) / dur;
  if (t < 0 || t >= 1) return [0, 0];
  // 三个来回 ±3px，逐帧衰减到 0：0 (-3,1) (2,-2) (-1,1) 0
  const k = 1 - t;
  const phase = t * 3;
  const dx = Math.sin(phase * Math.PI * 2) * amp * k;
  const dy = Math.cos(phase * Math.PI * 2 + 1.1) * amp * 0.45 * k;
  void cfg.ms;
  return [dx, dy];
}

/**
 * 按下的进度（0 = 没按 / 已回弹，1 = 刚按下）。
 *
 * 返回 0 就整段跳过，不给没按过的格子白套一次 save/restore ——
 * 11×11 的盘有 121 格，每帧多两次 save 在低端机上是能感觉到的。
 */
function pressProgress(
  st: { pressCell?: number; pressAt?: number },
  idx: number,
  now: number,
  downMs = PRESS_DOWN_MS,
): number {
  if (st.pressCell !== idx || !st.pressAt) return 0;
  const t = (now - st.pressAt) / downMs;
  if (t < 0 || t >= 1) return 0;
  return t;
}

/** 无效落子的左右摆：正弦若干来回，振幅随剩余时间线性衰减。 */
function shakeOffset(
  st: { shakeCell?: number; shakeAt?: number },
  idx: number,
  now: number,
  cell: number,
): number {
  if (st.shakeCell !== idx || !st.shakeAt) return 0;
  const t = (now - st.shakeAt) / SHAKE_MS;
  if (t < 0 || t >= 1) return 0;
  return Math.sin(t * Math.PI * 2 * SHAKE_CYCLES) * cell * 0.06 * (1 - t);
}

/**
 * 按压涟漪：一圈金环从棋子边上扩散出去。
 *
 * 几何照设计稿 `.tap-ring`：从 0.92 长到 1.18、500ms 淡出。
 * 颜色取主题的 `hintColor` 而不是写死金色 —— 金色在墨色 / 纸色主题上是错的。
 */
function drawPressRing(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  idx: number,
  w: number,
  st: { pressAt?: number; drops?: Map<number, number> },
  now: number,
  kit: ThemeKit,
): void {
  const at = st.pressAt ?? 0;
  if (!at) return;
  const cfg = kit.press;
  // 落子那一格：环要等**触底**才起（设计稿「触底瞬间一枚金色涟漪环向外扩散」）。
  // `dropPose` 的触底在 55% 处，所以环的起点 = 落子时刻 + 55% 落子时长。
  // 早于那一刻从 0 开始长，会看到环先浮在**半空**的棋子上，然后棋才落地 ——
  // 环和棋是同一个动作的两半，错开就是两件事。
  const dropAt = st.drops?.get(idx);
  const dropMs = kit.motion?.drop?.ms ?? 0;
  const from = dropAt !== undefined && dropMs > 0 ? dropAt + dropMs * 0.55 : at;
  const t = (now - from) / (cfg?.ring ?? PRESS_RING_MS);
  if (t < 0 || t >= 1) return;

  const { cell } = layout;
  const p = center(layout, idx, w);
  // 环要**贴着棋子**长，不是贴着槽位：设计稿 `.tap-ring` 是 `.piece` 的子元素，
  // `inset:-2px` 相对的是 80px 的棋子。按 101 的槽位算，环从第一帧起就落在
  // 格缝里 —— 那圈奶油色细线压在近黑的底板上，读出来是灰的，涟漪就废了
  const piece = Math.max(1, cell - BOARD_GAP);
  const half = piece / 2 + 2;
  // 缓出：前半程就走完大半距离。线性插值会让环在第 100ms 还贴着棋子，
  // 看着像"抖了一下"而不是"散开"
  const e = 1 - (1 - t) * (1 - t);
  const k = (cfg?.from ?? 0.92) + ((cfg?.to ?? 1.18) - (cfg?.from ?? 0.92)) * e;
  // 淡出跟着设计稿的 `border-color: .7 → 0`：**线性**。
  // 早先写成 `0.62 * (1-t)²` —— 平方在 t=0.3 就只剩 0.30，
  // 而设计稿那一刻还有 0.49；结果环只亮了 3 帧就被误读成"没有涟漪"
  const a = 0.70 * (1 - t);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(k, k);
  ctx.translate(-p.x, -p.y);
  ctx.globalAlpha = a;
  ctx.strokeStyle = cfg?.color ?? kit.hintColor;
  // 1.5 CSS 的环，按 80 → 87 的棋子换算过来是 3.2
  ctx.lineWidth = Math.max(2.4, piece * (cfg?.width ?? 0.037));
  roundRect(ctx, p.x - half, p.y - half, half * 2, half * 2, piece * 0.32);
  ctx.stroke();
  ctx.restore();
}

/**
 * 把折线按长度比例截断（`t` = 0..1）。
 *
 * 截断点是**插值**出来的，不是取整到格 —— 沥金线必须停在半路上，
 * 一格一格地跳会让"生长"读成"一格一格地闪"。
 */
export function truncatePts(pts: Pt[], t: number): Pt[] {
  if (t >= 1 || pts.length < 2) return pts;
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  let left = total * t;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = seg[i - 1];
    if (left >= d) {
      out.push(pts[i]);
      left -= d;
      continue;
    }
    const k = d > 0 ? left / d : 0;
    out.push({
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
      y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
    });
    break;
  }
  return out;
}

function drawHint(
  ctx: CanvasRenderingContext2D,
  w: number,
  layout: BoardLayout,
  st: { hint?: number[] },
  kit: ThemeKit,
  now: number,
): void {
  const hint = st.hint;
  if (!hint || hint.length === 0) return;
  const { cell } = layout;

  ctx.save();
  for (let i = 0; i < hint.length && i < 5; i++) {
    const p = center(layout, hint[i], w);
    // 第一格亮、后四格递减：提示是一句「往这边走」，不是五个等价的目标
    const a = i === 0 ? 0.95 : Math.max(0.42, 0.82 - i * 0.12);
    // 呼吸周期：天青是 1.8s（设计稿「可连格金缘 1.8s 明暗交替」），
    // 其余主题沿用 1.9s。`hintPulseMs` 是**一个来回**的时长。
    const period = (kit.hintPulseMs ?? 1900) / 2;
    const pulse = i === 0 ? 0.80 + 0.20 * Math.abs(Math.sin(now / period)) : 1;
    ctx.globalAlpha = a * pulse;
    ctx.strokeStyle = kit.hintColor;
    if (kit.hint) {
      kit.hint(ctx, p, cell, i, kit.hintColor);
    } else {
      const inset = cell * 0.11;
      ctx.lineWidth = (i === 0 ? Math.max(3, cell * 0.075) : Math.max(1.8, cell * 0.040)) * (kit.hintWidth ?? 1);
      roundRect(ctx, p.x - cell / 2 + inset, p.y - cell / 2 + inset, cell - inset * 2, cell - inset * 2, cell * 0.18);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  w: number,
  layout: BoardLayout,
  st: { path: number[]; trailAt?: number },
  kit: ThemeKit,
  now: number,
): void {
  const path = st.path;
  if (path.length < 2) return;
  let pts = path.map((f) => center(layout, f, w));

  // 沥金生长：设计稿是 `stroke-dashoffset` 匀速推 420ms（0.57px/ms）。
  // 这里按**速度**而不是按时长复刻：一格 ≈ `1.75 × 格宽` 毫秒，
  // 于是画长线慢、画短线快，手感是一致的匀速"堆"，而不是每段都硬等 420ms。
  const grow = kit.motion?.grow ?? 0;
  let growT = 1;
  if (grow > 0 && st.trailAt) {
    growT = (now - st.trailAt) / Math.max(60, layout.cell * grow);
    if (growT < 1) pts = truncatePts(pts, Math.max(1e-4, growT));
  }

  if (kit.trail) {
    // 生长进度也传给主题：描金的高光要**滞后 80ms** 跟上主线，
    // 辉光要先在 30% 处脉冲到 0.8 再衰到 0.42 —— 这两件都需要 `elapsed`。
    // 只给 `now` 的话，主题算不出"这条线堆到哪了"，只能画一条静态的亮线。
    kit.trail(ctx, pts, layout.cell, now, Math.min(1, growT));
  } else if (kit.trailColors) {
    const c = kit.trailColors;
    const stroke = (width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };
    stroke(Math.max(8, layout.cell * 0.26), c.halo);
    stroke(Math.max(4, layout.cell * 0.14), c.core);
    stroke(Math.max(1.4, layout.cell * 0.045), c.hot);
  }

  // 传送跳段：断线画虚线 + 两端菱形。
  // 不画的话两个不相邻的格会被一条直线连起来，读作「这里能走」——
  // 而它恰恰是不能走的地方。
  ctx.save();
  ctx.setLineDash([Math.max(5, layout.cell * 0.14), Math.max(7, layout.cell * 0.14)]);
  ctx.strokeStyle = kit.trailColors?.core ?? kit.glyph.pal.ink;
  ctx.lineWidth = Math.max(3, layout.cell * 0.09);
  ctx.lineCap = 'round';
  for (let i = 1; i < path.length && i < pts.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = Math.abs((a % w) - (b % w));
    const dy = Math.abs(Math.floor(a / w) - Math.floor(b / w));
    if (dx + dy <= 1) continue;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarks(
  ctx: CanvasRenderingContext2D,
  board: { w: number; h: number; grid: Uint8Array },
  layout: BoardLayout,
  st: ThemeState,
  kit: ThemeKit,
  gate?: EnterGate,
): void {
  const { cell } = layout;
  const glyphSize = cell * (kit.glyph.scale ?? 0.50);
  const backR = cell * (kit.glyph.backR ?? 0.38);

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const byte = board.grid[idx];
      const type = cellType(byte);
      const p = center(layout, idx, board.w);
      const group = cellGroup(byte);

      let kind: GlyphKind | null = null;
      switch (type) {
        case CoverCell.SHARD: kind = 'star'; break;
        case CoverCell.ONEWAY: kind = 'arrow'; break;
        case CoverCell.KEY: kind = 'key'; break;
        case CoverCell.GATE: kind = 'gate'; break;
        case CoverCell.PORTAL: kind = 'portal'; break;
        case CoverCell.START: kind = 'start'; break;
        case CoverCell.END: kind = 'end'; break;
        case CoverCell.BLOCK: kind = 'rock'; break;
        case CoverCell.ICE: kind = 'ice'; break;
        default: break;
      }
      if (!kind) continue;
      if (kit.glyph.skip?.includes(type)) continue;
      // 进场：图标跟着**自己那一格**落，不能等整盘落完再一起出现 ——
      // 否则前半秒会看到一堆箭头悬在空沙面上
      const gt = gate ? gate.at(x, y) : 1;
      if (gt < 0) continue;
      const terrain = type === CoverCell.BLOCK || type === CoverCell.ICE;

      // 状态变体：同一类机制在**不同状态下是两个形状**。
      //
      // 门的开/闭、传送门的进/出口、星屑的一/二/三阶 —— 这些都不是"同一个图标
      // 换个透明度"，是**不同的东西**：闭的门是"此路不通"，开的门是"洞开透光"；
      // 实的环是入口，虚的环是出口。只压透明度的话，玩家在盘上分不出
      // "这扇门能不能过"，而那是整关的钥匙。
      const variant = kit.glyph.variant?.({ type, group, idx, x, y, board, st });
      // 进场：图标跟着**自己那一格**落，不能等整盘落完再一起出现
      if (variant?.hidden) continue;

      let alpha = 1;
      let size = glyphSize * (kit.glyph.scaleFor?.(type) ?? 1);
      // 已收的星 / 已拿的钥匙压暗缩小，但**不消失**：
      // 消失会让玩家以为那格空了，可以走回去
      if (type === CoverCell.SHARD && st.shardsGot.has(group)) {
        alpha = 0.30;
        size = glyphSize * 0.80;
      }
      if (type === CoverCell.KEY && st.keysHeld.has(group)) {
        alpha = 0.30;
        size = glyphSize * 0.80;
      }
      if (type === CoverCell.GATE && st.keysHeld.has(group)) alpha = 0.50;
      if (type === CoverCell.SHARD && !st.shardsGot.has(group) && st.shardNext === group) {
        size = glyphSize * 1.10;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      if (gate && gt < 1) applyEnter(ctx, gt, p.x, p.y, gate, cell);

      if (!terrain && kit.glyph.back) {
        ctx.fillStyle = kit.glyph.back;
        ctx.beginPath();
        ctx.arc(p.x, p.y, backR, 0, Math.PI * 2);
        ctx.fill();
        if (kit.glyph.backEdge !== 'transparent') {
          ctx.strokeStyle = kit.glyph.backEdge;
          ctx.lineWidth = Math.max(1, cell * 0.020);
          ctx.stroke();
        }
      }

      const gpal = kit.glyph.palFor
        ? kit.glyph.palFor(type, { variant: variant?.key, wasOpen: type === CoverCell.GATE && st.keysHeld.has(group) })
        : terrain && kit.glyph.terrainAccent
          ? { ...kit.glyph.pal, accent: kit.glyph.terrainAccent }
          : kit.glyph.pal;
      drawGlyph(ctx, kind, kit.glyph.style, p.x, p.y, size, gpal, cellDir(byte) as Dir, {
        shapes: kit.glyph.shapes,
        decor: kit.glyph.decor,
        variant: variant?.key,
      });

      // 编号：星屑写**顺序**，钥匙 / 传送门写**配对号**。
      //
      // 设计稿把它放在棋子自己的右下角（`.pc .num`：右 3 / 下 2、衬线 900），
      // 不是浮在格上的白圆牌 —— 白圆牌在这个暗盘上等于给每颗机制格装了个灯泡，
      // 而它要说的只是一个数字。
      //
      // 星屑只写数字、不写 "★N"：棋子中间已经是一颗金星，
      // 角上再来个星号是把同一句话说两遍（图例里写 ★ 是因为那里没有棋子）。
      if (cell >= 44 && !kit.glyph.noCornerNumber) {
        let num = '';
        if (type === CoverCell.SHARD) num = String(group + 1);
        else if (type === CoverCell.KEY || type === CoverCell.PORTAL) num = String(group + 1);
        if (num) cornerNumber(ctx, p, cell, num, gpal.ink);
      }
      ctx.restore();
    }
  }
}

/** 角标数字用的衬线（与 HUD 的 `SERIF_FONT` 同族，这里复制一份避免 UI 反向依赖渲染层）。 */
const SERIF = '"Songti SC", "STSong", SimSun, Georgia, serif';

/**
 * 棋子右下角的编号（顺序 / 配对）。
 *
 * 不复用 `clayTextNumber`：那一个是给"圆牌上的字"写的，带居中与描边；
 * 角标要的是**贴边、右对齐、衬线**，差一点就变成两套语言。
 * 透明度不在这里改 —— 调用方已经按"已收集"把整颗棋子压暗了。
 *
 * 0.33 格而不是 0.35：棋子的圆角半径是 0.28 格，数字再往角上推会被圆角切掉
 * 最后一笔（第一版就是这样，`★3` 的 3 被啃掉半个，看着像一颗脏点）。
 */
function cornerNumber(ctx: CanvasRenderingContext2D, p: Pt, cell: number, text: string, color: string): void {
  ctx.font = `900 ${Math.round(cell * 0.26)}px ${SERIF}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, p.x + cell * 0.33, p.y + cell * 0.33);
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  board: { w: number; h: number; grid: Uint8Array },
  layout: BoardLayout,
  st: { covered: Set<number> },
  kit: ThemeKit,
  gate?: EnterGate,
): void {
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const type = cellType(board.grid[idx]);
      if (type !== CoverCell.START && type !== CoverCell.END) continue;
      if (st.covered.has(idx)) continue;
      const t = gate ? gate.at(x, y) : 1;
      if (t < 0) continue;
      const p = center(layout, idx, board.w);
      ctx.save();
      if (gate && t < 1) applyEnter(ctx, t, p.x, p.y, gate, layout.cell);
      kit.endpoint(ctx, type === CoverCell.START ? 'start' : 'end', p, layout.cell);
      ctx.restore();
    }
  }
}

/**
 * SVG 圆弧 `A r r 0 large sweep x2 y2` → 一串折线点（**含起点**，不含重复的终点）。
 *
 * 为什么值得放进 kit：设计稿的门板是 `A6.8 6.8 0 0 1 8.2 4.7` /
 * `A13.5 13.5 0 0 1 13.5 6.5`，用二次贝塞尔逼近会把门板画成"斜切的梯形"
 * （实测读作帐篷）；而 Canvas 的 `arc()` 只认**圆心**，SVG 给的是**终点**。
 *
 * 圆心解法：弦的中垂线上，偏移量 h = √(r² − (L/2)²)，取哪一侧由
 * `large`/`sweep` 共同决定。这一版把首点显式补回起点 —— 折线从弦的端点
 * 起步，路径才不会在端点处"少一截"（表现为门板缺一角）。
 */
export function arcPts(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  large: 0 | 1,
  sweep: 0 | 1,
  steps = 10,
): Array<[number, number]> {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  // 弦比直径还长时 SVG 会把半径撑大
  const rr = L / 2 > r ? L / 2 : r;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const h = Math.sqrt(Math.max(0, rr * rr - (L / 2) * (L / 2)));
  // 弦的单位法向
  const nx = -dy / (L || 1);
  const ny = dx / (L || 1);
  // large === sweep → 圆心取负侧（SVG 规范：fA ≠ fS 时取 +）
  const sgn = large !== sweep ? 1 : -1;
  const cx = mx + sgn * h * nx;
  const cy = my + sgn * h * ny;

  const a0 = Math.atan2(y1 - cy, x1 - cx);
  let a1 = Math.atan2(y2 - cy, x2 - cx);
  if (sweep === 1 && a1 < a0) a1 += Math.PI * 2;
  if (sweep === 0 && a1 > a0) a1 -= Math.PI * 2;

  const out: Array<[number, number]> = [[x1, y1]];
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}
