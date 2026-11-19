/**
 * 机制图标：几何 + 笔触分离。
 *
 * ## 为什么要把几何和笔触拆开
 *
 * 9 类机制 × 3 种图标族 = 27 种组合。逐对硬写要 27 段绘制代码，
 * 而且改一条规则（比如「所有图标统一线宽」）要改 27 处。
 *
 * 拆开之后：几何只写 9 次（`GLYPHS`），笔触只写 3 次（`PAINTERS`），
 * 组合是 `9 + 3` 而不是 `9 × 3`。新增一套主题只需要加一个笔触函数。
 *
 * ## 坐标约定
 *
 * 几何定义在单位空间 `[-1, 1]²`，原点在格心。绘制时统一 `scale(size / 2)`，
 * 所以线宽要在设置前除以缩放倍数（见 `px` 辅助）。
 */
import { DIR, type Dir } from '../../core/cover/v3/types';
import { fillGrain } from '../grain';

/** 图元公共开关。`fill` / `stroke` 对所有形态都可选 —— 线也能被填（无实际效果，但省得逐个窄化）。 */
interface PartBase {
  fill?: boolean;
  stroke?: boolean;
  /**
   * 虚线（单位空间里的 dash/gap）。
   *
   * 只对描边生效。用途很窄但很硬：传送门的**出口**必须和入口用同一对环、
   * 只把环改成虚线 —— 同色不同实虚，玩家才一眼分清"进哪个、出哪个"。
   */
  dash?: [number, number];
  /**
   * 色调。默认用 `pal.accent`（填）/ `pal.ink`（描）。
   *
   * 一枚图标里常常有**两种材质**：门是玄墨门板 + 中间透出的天青光，
   * 星屑是深釉底 + 金星。用一个 accent 画两种材质，必然有一种是错的
   * （实测：开着的门，两片门板被染成了和中间光一个颜色，整枚散掉）。
   * 所以图元可以点名要 `pal` 里的哪一档。
   */
  tone?: 'accent' | 'ink' | 'chip' | 'deep';
  /**
   * 线宽**绝对值**（单位空间长度，1 = `half`）。不填则用笔触的默认线宽。
   *
   * 存在的原因只有一个：**同心的多层环**。
   *
   * 设计稿的传送门外环不是一条线，而是「2.9 深靛 + 2.1 石青 + 0.7 亮边」
   * 三层同心叠成一条**有厚度的环**。三层如果都吃笔触的默认线宽，
   * 它们会完全重合，只剩最上面那一层可见 —— 厚环退化成一条细线，
   * 传送门就读作"两个空心圈"，没有实体感。
   *
   * ## 为什么是绝对值而不是倍数
   *
   * 倍数要对着"当前笔触的默认线宽"算，而默认线宽本身是
   * `0.26 × pal.lineW`（传送门的 `lineW = 0.55`，于是默认只有 0.143）。
   * 想得到设计稿的 0.242 就得写 `width: 1.69` —— 这个数字既不可读、
   * 又会在 `lineW` 一改时立刻失效（实测我第一次写 `2.9/3.12 = 0.93`，
   * 画出来只有应有的 55%，外环细得像根线）。
   *
   * 直接写设计稿的量：`2.9 / 12 = 0.242`。分母 12 是因为 `MARKS` 是 24 视图。
   */
  width?: number;
  /**
   * 面图元的"磕边"开关。默认 `true`（矿物的颜料比墙低半毫米，边界是阴影）。
   *
   * 但**小圆点不该有边**：设计稿的传送门芯点 `circle r=1.3 fill #F0C868`
   * 是纯色的一点金，没有描边。给它描 `deep`（深靛）会变成"金点套深圈"，
   * 读作一颗眼睛 —— 而它要读作"口里有光"。
   *
   * 判据是**尺寸**：边宽固定 0.085 half，而芯点半径才 1.3/12 = 0.108 half，
   * 描上去等于把点吃掉一半。所以这类小图元显式关掉。
   */
  edge?: boolean;
  /**
   * 线帽。默认 `'round'`（矿物笔触的钝笔）。
   *
   * 虚线必须显式给 `'butt'`：`round` 会让每段两端各鼓出**半个线宽**，
   * 段长与间隙同时被吃掉一半 —— 传送门 B 的 `dash 3.2/2.6`、线宽 2.6 时，
   * 视觉段长变成 `3.2+2.6 = 5.8`、间隙只剩 `2.6-2.6 = 0`，
   * 一圈虚线**连成实线**（实测：设计稿是 12 段分离的弧块，引擎版是一整圈）。
   */
  cap?: CanvasLineCap;
}

/** 单位空间里的一个图元。 */
export type GlyphPart = PartBase &
  (
    | { k: 'poly'; pts: Array<[number, number]> }
    | { k: 'circle'; cx: number; cy: number; r: number }
    | { k: 'rect'; x: number; y: number; w: number; h: number }
    | { k: 'line'; pts: Array<[number, number]> }
    | { k: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }
  );

/** 图标种类（与 `CoverCell` 的机制类型一一对应）。 */
export type GlyphKind = 'star' | 'arrow' | 'key' | 'gate' | 'portal' | 'rock' | 'ice' | 'start' | 'end';

/**
 * 图标族（每套主题一种笔触语言）。
 *
 * 前半是第一批典藏：`seal` 黑曜熔岩 / `ice` 玻璃穹顶 / `constellation` 圆格罗盘。
 * 后半是第二批：`ink` 水墨 / `neon` 赛博 / `pixel` 像素 / `jelly` 深海。
 *
 * 判据仍是一条：**把颜色抽掉，这九类图标还认得出是同一套语言吗？**
 * 所以每种笔触必须改「线怎么落」，而不只是换色 ——
 * 水墨是软头单线（粗细一致、留白），赛博是双色描边（外辉内白），
 * 像素是硬折角（butt / miter），深海是半透明肉体（圆头 + 内发光）。
 */
export type GlyphStyle =
  | 'seal' | 'ice' | 'constellation'
  | 'ink' | 'neon' | 'pixel' | 'jelly'
  | 'porcelain' | 'mineral';

/** 图标用色。 */
export interface GlyphPalette {
  /** 符号主色 */
  ink: string;
  /** 强调色（印章底、冰体、熔岩芯） */
  accent: string;
  /** 反白色（印章上的白文） */
  chip: string;
  /** 深色（描边 / 阴影） */
  deep: string;
  /**
   * 线宽倍率（只对「线状图元」生效）。
   *
   * 默认 1 —— 那是按"一笔厚色"定的（矿物笔触 0.26 half）。
   * 但同一个笔触画**六边形**这种闭合小环时，同样的粗细会把中间糊死：
   * 冰砖实测直接读成一个「N」。所以按面调：环越闭合，线就要越细。
   */
  lineW?: number;
  /**
   * 面状图元那圈"磕边"的线宽倍率。
   *
   * 默认 1（0.085 half）是给"颜料片"定的：边上压一道影，色块才贴在墙上。
   * 但同一套里还有**贴金箔的星**和**刻出来的箭**，它们的边是一根细线（0.04 half），
   * 按 0.085 描会变成一圈粗黑的轮廓，那正是"贴纸"的观感。
   */
  edgeW?: number;
}

// ────────────────────────────── 几何 ──────────────────────────────

/** 五角星顶点。 */
function starPts(r: number, inner = 0.42): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

/** 九种图标的几何。 */
const GLYPHS: Record<GlyphKind, GlyphPart[]> = {
  star: [{ k: 'poly', pts: starPts(0.94), fill: true, stroke: true }],

  // 箭头朝上；绘制时按方向旋转。
  //
  // 设计稿是**一根杆 + 一个折角**（`M5 12 H15` + `M11 7 L17 12 L11 17`），
  // 不是实心三角。填成实心会读成"播放键"或"指南针"，而它要说的只有一句：
  // 只能往这边走。杆比尖端早收一格，尖端才不会被杆头撑钝。
  arrow: [
    { k: 'line', pts: [[0, 0.58], [0, -0.24]] },
    { k: 'line', pts: [[0.42, 0.10], [0, -0.42], [-0.42, 0.10]] },
  ],

  // 钥匙：一把**斜着**的钥匙（环 + 杆 + 一齿）。
  //
  // 设计稿是纯线（`circle 9,9 r3.4` + `M11.4 11.4 L18 18` + `M15.5 15.5 L17.5 13.5`）。
  // 旧版是横着一把"实心环 + 粗杆 + 两齿"，在铜面上填了深褐再描边，
  // 远看是一小坨墨 —— 线稿才配得上"錾刻"这套语言。
  key: [
    { k: 'circle', cx: -0.25, cy: -0.25, r: 0.29 },
    { k: 'line', pts: [[-0.04, -0.04], [0.50, 0.50]] },
    { k: 'line', pts: [[0.30, 0.30], [0.47, 0.13]] },
  ],

  // 门：一扇立起来的板 + 一点门把（设计稿 `rect 7,4 10×16` + 把）。
  //
  // 旧版画的是"两根柱 + 顶弧"的拱门，实拍在 5×6 的大格上是一道**拱**，
  // 读起来像"通道"；而门恰恰是"过不去"——一块板 + 一个门把才说得清。
  gate: [
    { k: 'rect', x: -0.42, y: -0.66, w: 0.84, h: 1.32 },
    { k: 'circle', cx: 0.18, cy: 0.06, r: 0.11, fill: true },
  ],

  // 传送：两个**相扣**的环（设计稿 `circle 10,12 r4.6` + `circle 15,12 r4.6`）。
  // 同心环是"靶心"，读成"目标"；错开才是"一对"，才配得上"两端互通"。
  portal: [
    { k: 'circle', cx: -0.17, cy: 0, r: 0.38 },
    { k: 'circle', cx: 0.25, cy: 0, r: 0.38 },
  ],

  // 石头：不规则多边形 + 一条裂纹
  rock: [
    {
      k: 'poly',
      pts: [[-0.78, 0.36], [-0.50, -0.46], [0.06, -0.72], [0.66, -0.30], [0.74, 0.42], [0.16, 0.68]],
      fill: true,
      stroke: true,
    },
    { k: 'line', pts: [[-0.16, -0.44], [0.06, 0.06], [-0.20, 0.44]] },
  ],

  // 冰面：**斜面**（一条坡 + 一道分水线 + 一条下滑线），不是雪花。
  //
  // 雪花说的是"冷"，而这一格的规则是"踩上去会顺着坡滑到底"——
  // 玩家要先知道"这里会滑"，才不会以为自己点歪了。
  // 几何照抄设计稿 03 屏与盘下图例（`M6 16 L10 8 L14 16` / `M8.2 13 H11.8` /
  // `M15 16 L18 8`）：图例和盘面必须是同一个形状，否则图例等于没画。
  ice: [
    { k: 'line', pts: [[-0.50, 0.33], [-0.17, -0.33], [0.17, 0.33]] },
    { k: 'line', pts: [[-0.32, 0.08], [-0.02, 0.08]] },
    { k: 'line', pts: [[0.25, 0.33], [0.50, -0.33]] },
  ],

  start: [
    { k: 'circle', cx: 0, cy: 0, r: 0.70, stroke: true },
    { k: 'circle', cx: 0, cy: 0, r: 0.22, fill: true },
  ],

  end: [
    { k: 'rect', x: -0.64, y: -0.64, w: 1.28, h: 1.28, stroke: true },
    { k: 'rect', x: -0.30, y: -0.30, w: 0.60, h: 0.60, fill: true },
  ],
};

/** 方向 → 旋转角。 */
const DIR_ROT: Record<Dir, number> = {
  [DIR.UP]: 0,
  [DIR.RIGHT]: Math.PI / 2,
  [DIR.DOWN]: Math.PI,
  [DIR.LEFT]: -Math.PI / 2,
};

// ────────────────────────────── 笔触 ──────────────────────────────

/** 图元 → 路径（不描边、不填充）。 */
export function traceGlyphPart(ctx: CanvasRenderingContext2D, p: GlyphPart): void {
  ctx.beginPath();
  // 虚线在 beginPath 之后、描边之前设。这里设而不是在笔触里设，
  // 是因为 dash 是**图元属性**（传送门出口那一对环），不是语言属性 ——
  // 同一套笔触画出来的东西，有的该是实线、有的该是虚线。
  //
  // `typeof` 守卫：单测用的是极简的 canvas 桩，没有 `setLineDash`。
  // 为了一个可选装饰在测试里崩掉整个图标绘制，不值得。
  if (typeof ctx.setLineDash === 'function') {
    if (p.dash) ctx.setLineDash(p.dash);
    else ctx.setLineDash([]);
  }
  switch (p.k) {
    case 'poly':
      ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      ctx.closePath();
      break;
    case 'circle':
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      break;
    case 'rect':
      ctx.rect(p.x, p.y, p.w, p.h);
      break;
    case 'line':
      ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      break;
    case 'arc':
      ctx.arc(p.cx, p.cy, p.r, p.a0, p.a1);
      break;
  }
}

/** 是否可填充（line / arc 只描边）。 */
function fillable(p: GlyphPart): boolean {
  return p.k === 'poly' || p.k === 'circle' || p.k === 'rect';
}

/** 单位空间线宽 → 绘制线宽。 */
function px(w: number, half: number): number {
  return Math.max(0.6, w * half);
}

/**
 * 三种笔触语言。
 *
 * 每个只做两件事：定「符号用什么颜色填/描」，以及要不要附加装饰。
 * 几何完全不参与决策 —— 这是这套拆分能成立的前提。
 */
const PAINTERS: Record<
  GlyphStyle,
  (ctx: CanvasRenderingContext2D, parts: GlyphPart[], half: number, pal: GlyphPalette) => void
> = {
  // 印章：方朱底、白文。符号本身是「刻掉」的，所以用反白色描边不填充
  seal: (ctx, parts, half, pal) => {
    const s = half * 0.98;
    ctx.fillStyle = pal.accent;
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.strokeStyle = pal.chip;
    ctx.lineWidth = px(0.16, half);
    ctx.lineCap = 'round';
    for (const p of parts) {
      traceGlyphPart(ctx, p);
      if (fillable(p) && p.fill) {
        ctx.fillStyle = pal.chip;
        ctx.fill();
      } else {
        ctx.stroke();
      }
    }
  },

  // 冰雕：半透青体 + 亮边，体感靠「外亮内虚」
  ice: (ctx, parts, half, pal) => {
    ctx.fillStyle = pal.accent;
    ctx.strokeStyle = pal.chip;
    ctx.lineWidth = px(0.11, half);
    ctx.lineJoin = 'round';
    for (const p of parts) {
      traceGlyphPart(ctx, p);
      if (fillable(p) && p.fill) {
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.stroke();
      }
    }
  },

  // 星座：只有线，端点画小星芒。填充一律忽略
  constellation: (ctx, parts, half, pal) => {
    ctx.strokeStyle = pal.ink;
    // 0.09 在 28px 格上只剩 1px，实拍是一团灰线。
    // 星座语言靠「细」显得高级，但细到读不出形状就没意义了
    ctx.lineWidth = px(0.13, half);
    ctx.lineCap = 'round';
    for (const p of parts) {
      traceGlyphPart(ctx, p);
      ctx.stroke();
    }
    // 顶点小点：让线看起来「连的是星」，不是「画的图形」
    ctx.fillStyle = pal.chip;
    for (const p of parts) {
      if (p.k !== 'poly' || !p.fill) continue;
      for (const [x, y] of p.pts) {
        ctx.beginPath();
        ctx.arc(x, y, px(0.10, half), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  /**
   * 青花：淡钴染面 + 浓钴勾线。
   *
   * 青花瓷的图案只有两层结构 —— **线是浓的，面是淡的，中间全是白瓷的留白**。
   * 所以这一套不描双线（那是玻璃/霓虹的做法），也不做渐变（那是像素/熔岩的事），
   * 只把软笔蘸钴料的两档浓淡分开：填 `accent`（分水的淡），描 `ink`（勾线的浓）。
   *
   * 线宽要比水墨粗一档（0.10 → 0.14）：瓷上的线是「钴料堆起来的」，
   * 不是「笔尖划过去的」，细了就变成铅笔素描，看着像草稿。
   */
  porcelain: (ctx, parts, half, pal) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const p of parts) {
      if (fillable(p) && p.fill) {
        traceGlyphPart(ctx, p);
        ctx.fillStyle = p.tone ? pal[p.tone] : pal.accent;
        ctx.fill();
      }
    }
    ctx.strokeStyle = pal.ink;
    /**
     * 线宽：默认 0.14，可用 `pal.lineW` 覆盖。
     *
     * ## 为什么需要这个覆盖（2026-11-19 星屑）
     *
     * 原先这里写死 `px(0.14, half)`，`GlyphPalette.lineW` 在 porcelain 上**完全无效**
     * —— 于是给某个图标调细线宽时，改了 pal 却看不出变化，很容易误以为是缓存问题。
     *
     * 星屑是第一个真正需要它的情况：四芒星的腰很细（约 1.2 单位宽），
     * 0.14 的边会把两个尖角之间的腰部糊死，整颗星变成一坨。
     * 设计稿的 `sparkAt` 根本没有描边，这里只是为留住錾刻的立体感才补一道**细的**。
     *
     * 其余图标不填 `lineW`（或填 0.9 之类）时按 0.14 走，行为不变 ——
     * 只有显式写了更小的值才收细，避免"改一个图标顺手改了全盘"。
     */
    ctx.lineWidth = pal.lineW !== undefined && pal.lineW < 0.9
      ? px(0.14 * (pal.lineW / 0.9), half)
      : px(0.14, half);
    for (const p of parts) {
      // **所有**图元都要描边，不只是标了 `stroke` 的。
      //
      // 这里踩过一个很贵的坑：`stroke` 是逐图元的可选标记，几何里只要漏写一个，
      // 这个图形就在青花主题上**整块消失** —— 冰块（三条纯线）画出来是空气，
      // 门（框 + 把）只剩一颗门把的豆子。而它俩在其他笔触上都正常，
      // 于是"盘上冰面没有标记"这种 bug 看着像关卡数据错了，查半天。
      //
      // 青花的规矩本来就是"线是浓的、面是淡的"：填过的面也要有一道料线的边，
      // 所以默认全描，只有显式 `stroke: false` 才跳过。
      if (p.stroke !== false) {
        traceGlyphPart(ctx, p);
        ctx.stroke();
      }
    }
  },

  /**
   * 矿物（鸣沙·丹青）：色块堆上去，边被时间磕掉一圈。
   *
   * 壁画的形不是「画」出来的，是**把磨好的石色堆上去**的。所以这套笔触
   * 有三条和青花正好相反的规矩：
   *
   * 1. **面是实的、边是暗的**（青花是"面淡、线浓"）。颜料比墙低半毫米，
   *    边界是一道阴影，不是一道亮线 —— 描亮线立刻变成"贴纸"。
   * 2. **面上必须落颗粒**。矿物色是粗磨的，放大看是砂；不落颗粒就只是一块纯色。
   * 3. **线状图元改「钝笔」**。箭头 / 钥匙 / 传送环没有面可填，
   *    就把笔画加粗到 0.26 half（87px 的格上约 11px 宽），读起来是一笔厚色 ——
   *    再往左上错半像素补一道亮，这笔就"堆"起来了。
   */
  mineral: (ctx, parts, half, pal) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // ① 面：实填 + 颗粒 + 磕边
    //
    // `tone` 让单枚图标里能有**两种材质**：开着的门是"赭石门板 + 中间暖金"，
    // 共用一个 `accent` 会把门板染成和光一样的橙，整枚糊成一块（读作帐篷）。
    for (const p of parts) {
      if (!fillable(p) || !p.fill) continue;
      ctx.save();
      traceGlyphPart(ctx, p);
      ctx.clip();
      ctx.fillStyle = p.tone ? pal[p.tone] : pal.accent;
      ctx.fillRect(-half * 2, -half * 2, half * 4, half * 4);
      fillGrain(ctx, -half, -half, half * 2, half * 2, 0.9);
      ctx.restore();
      // `edge: false` 的小图元不描边（见 `GlyphPart.edge`）
      if (p.edge === false) continue;
      traceGlyphPart(ctx, p);
      ctx.strokeStyle = pal.deep;
      ctx.lineWidth = px(0.085 * (pal.edgeW ?? 1), half);
      ctx.stroke();
    }

    // ② 线：钝笔
    //
    // `p.width` 是**绝对线宽**（单位空间），只给"同心多层"用（传送门的三层外环）。
    // 逐条设置而不是统一一条线宽：三层如果同宽就完全重合，厚环退化成一细线。
    const lw = pal.lineW ?? 1;
    for (const p of parts) {
      if (fillable(p) && p.fill) continue;
      ctx.strokeStyle = p.tone ? pal[p.tone] : pal.accent;
      ctx.lineWidth = p.width !== undefined ? px(p.width, half) : px(0.26 * lw, half);
      // 虚线图元自带线帽要求（见 `GlyphPart.cap`）；其余沿用笔触的钝笔圆头
      ctx.lineCap = p.cap ?? 'round';
      traceGlyphPart(ctx, p);
      ctx.stroke();
      ctx.lineCap = 'round';
    }

    // ③ 堆起来的那半毫米：同一根线往左上错一点，补一道更亮的
    //
    // 粗环（有 `width`）**不补这一道**：亮边本来就是单独的一层图元，
    // 再叠一道会让环上沿发糊，厚度反而看不出来。
    ctx.save();
    ctx.translate(-half * 0.035, -half * 0.035);
    ctx.globalAlpha *= 0.55;
    ctx.strokeStyle = pal.chip;
    for (const p of parts) {
      if (fillable(p) && p.fill) continue;
      if (p.width !== undefined) continue;
      ctx.lineWidth = px(0.075 * lw, half);
      traceGlyphPart(ctx, p);
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * 水墨：一支笔、一种墨色、粗细不变。
   *
   * 水墨的辨识度**不在笔锋而在留白** —— 所以这里不描填充轮廓（会变成双线），
   * 面状的图元（星、石）直接用淡墨铺满，线状图元用浓墨一笔带过。
   * 实心图元不再叠描边：一笔下去的墨块没有第二个边。
   */
  ink: (ctx, parts, half, pal) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const p of parts) {
      traceGlyphPart(ctx, p);
      if (fillable(p) && p.fill) {
        ctx.fillStyle = pal.accent;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = pal.ink;
        // 0.10 在 28px 格上是 1.4px：比这更细就断成虚线，比这更粗就成铅笔画
        ctx.lineWidth = px(0.10, half);
        ctx.stroke();
      }
    }
  },

  /**
   * 赛博：外辉 + 内白。
   *
   * 霓虹管的物理结构就是「一圈光晕包着一根亮芯」，所以必须**两遍**：
   * 先用强调色画粗而低透明的外圈（光晕），再用反白色画细芯。
   * 只画一遍 = 一根彩色线，没有「通电」的感觉。
   */
  neon: (ctx, parts, half, pal) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const pass of [0, 1] as const) {
      ctx.strokeStyle = pass === 0 ? pal.accent : pal.chip;
      ctx.lineWidth = pass === 0 ? px(0.34, half) : px(0.11, half);
      for (const p of parts) {
        traceGlyphPart(ctx, p);
        if (pass === 1 && fillable(p) && p.fill) {
          ctx.fillStyle = pal.accent;
          ctx.fill();
        }
        ctx.stroke();
      }
    }
  },

  /**
   * 像素：硬角 + 取整线宽。
   *
   * 8-bit 的「像素感」其实是**没有抗锯齿的直角**：圆头会让方块变胶囊，
   * 斜接会让折角变尖，两者一上就不是像素画了。所以 butt + miter，
   * 线宽按 2 的倍数取整 —— 奇数宽在格心对不齐，方块会看起来「跑偏半像素」。
   */
  pixel: (ctx, parts, half, pal) => {
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.miterLimit = 3;
    const w = Math.max(2, Math.round(px(0.16, half) / 2) * 2);
    for (const p of parts) {
      traceGlyphPart(ctx, p);
      if (fillable(p) && p.fill) {
        ctx.fillStyle = pal.accent;
        ctx.fill();
      }
      if (p.stroke || !fillable(p) || !p.fill) {
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = w;
        ctx.stroke();
      }
    }
    // 四角补两颗方块：像素画里的「高光像素」，一颗就够读出体素
    ctx.fillStyle = pal.chip;
    ctx.fillRect(-half * 0.16, -half * 0.16, half * 0.16, half * 0.16);
  },

  /**
   * 深海：半透明的肉体 + 圆头轮廓。
   *
   * 生物荧光的东西都是**软**的：先铺一层半透明填充（身体），
   * 再用亮色细线勾一圈（膜），最后在轮廓上撒几个小圆点（水母的发光点）。
   * 硬边会立刻变成「塑料」。
   */
  jelly: (ctx, parts, half, pal) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = pal.accent;
    for (const p of parts) {
      if (!fillable(p)) continue;
      traceGlyphPart(ctx, p);
      ctx.fill();
    }
    ctx.strokeStyle = pal.chip;
    ctx.lineWidth = px(0.11, half);
    for (const p of parts) {
      traceGlyphPart(ctx, p);
      ctx.stroke();
    }
    ctx.fillStyle = pal.chip;
    for (const p of parts) {
      if (p.k !== 'poly') continue;
      for (const [x, y] of p.pts) {
        ctx.beginPath();
        ctx.arc(x, y, px(0.055, half), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

};

// ────────────────────────────── 对外 ──────────────────────────────

/**
 * 主题自己的几何覆盖。
 *
 * 同一个机制在不同世界里**不是同一个形状**：秘色天青的冰面是「一道斜坡」
 * （规则是"会滑"），鸣沙丹青的冰砖是「六边晶」（规则是"更亮的一格"）。
 * 强行统一成一套几何，两边至少有一边是错的。
 *
 * 所以几何表可以按类型整条替换；没列出的仍用 `GLYPHS` 里的默认值。
 *
 * ## 键的命名：设计稿的大图怎么映射到这张表
 *
 * 设计稿（`风格样片/*.html` 的 `MARK_GROUPS`）给每一张**大图**一个名字，
 * 而这里按"什么时候用哪张"来命名。对照关系只有两条规律：
 *
 * | 设计稿 | 这里 | 为什么改名 |
 * |---|---|---|
 * | `arrow` / `arrowR` / `arrowD` / `arrowL` | 一个 `arrow` | 四向是**同坯旋转**（设计稿自己也是 `<g transform="rotate(90)">`），代码用 `DIR` 转；四个键会变成四份要同步维护的路径 |
 * | `star1` / `star2` / `star3` | `star` / `star2` / `star3` | 一阶就是"基础星形"，多一个 `star1` 是冗余别名 |
 * | `door` / `door-open` | `gate` / `gateOpen` | `gate` 是内部类型名（`CoverCell.GATE`），`door` 是设计稿的叫法；两边都保留会让人以为有两个机制 |
 * | `portal-a` / `portal-b` | `portalA` / `portalB` | 连字符在对象字面量里要加引号，没必要 |
 *
 * **没有变体的机制**（`ice` / `key` / `rock`）直接用类型名，因为它们在
 * 整关内只有一个形态 —— 有变体的才需要额外键（开/闭、进/出、一/二/三阶）。
 *
 * 变体键由 `GlyphOpts.variant` 在运行时选。它们写在同一个表里是有意的：
 * 就是"同一类形状的另一版"，分成两张表之后，主题文件里同一个机制会出现在两处。
 */
export type GlyphShapes = Partial<Record<GlyphKind, GlyphPart[]>> &
  Record<string, GlyphPart[] | undefined>;

/**
 * 装饰层：笔触画完之后，主题自己再补几笔。
 *
 * 笔触是**语言**（面怎么填、线多粗），装饰是**这一枚图标的细节**——
 * 星箔左上那道错开的亮边、单向箭上那三粒干笔缺口、冰晶里的分水面、
 * 传送门虚线的后半环。这些只属于某一套的某几枚，塞进笔触里会污染所有图标。
 *
 * 拿到的是**已缩放到像素空间**的图元，`half` 是半径，所以里面的数字
 * 按 `0.1 * half` 这种比例写，换格子大小不会走形。
 */
export type GlyphDecor = (
  ctx: CanvasRenderingContext2D,
  /**
   * 现在画的是哪一版。
   *
   * 通常是 `GlyphKind`（`'gate'` / `'portal'` …），但**有变体时是变体键**
   * （`'gateOpen'` / `'portalA'` / `'star2'`）—— 因为变体的细节层本来就不一样：
   * 开的门要补透光、闭的门要补门框阴影。给的是类型而不是变体，装饰层就只能
   * 画"两种门平均一下"的细节，那两版都会不对。
   */
  kind: string,
  parts: GlyphPart[],
  half: number,
  pal: GlyphPalette,
) => void;

export interface GlyphOpts {
  shapes?: GlyphShapes;
  decor?: GlyphDecor;
  /**
   * 状态变体键。同一类机制在不同状态下**换一个形状**：
   * `gateOpen` / `portalA` / `portalB` / `star2` / `star3` ……
   *
   * `shapes` 是按类型的**静态**覆盖，变体是**运行时**的二选一。
   * 分开是因为它们的失效条件不同：类型在整关内不变，状态每走一步都可能变。
   * 变体键在 `shapes` 里找不到就回落到基础形状 —— 所以主题只需要给
   * 它真正想区分的那些状态命名。
   */
  variant?: string;
}

/** 画一个机制图标。 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: GlyphKind,
  style: GlyphStyle,
  cx: number,
  cy: number,
  size: number,
  pal: GlyphPalette,
  dir: Dir = DIR.UP,
  opts?: GlyphOpts,
): void {
  // 变体优先：`shapes[变体键]` → `shapes[类型]` → 默认几何。
  // 变体键挂在 `shapes` 上而不是单独一张表，是因为它本来就是"同一类形状的
  // 另一版"，放两张表会让主题文件里同一个机制出现两处，改一处必忘另一处。
  const shapes = opts?.shapes ?? {};
  const key = opts?.variant;
  const parts =
    (key ? (shapes as Record<string, GlyphPart[] | undefined>)[key] : undefined) ??
    shapes[kind] ??
    GLYPHS[kind];
  if (!parts) return;
  const half = size / 2;

  ctx.save();
  ctx.translate(cx, cy);
  // 图标本身不旋转（只有箭头按方向转），否则钥匙 / 门会躺倒
  const rot = kind === 'arrow' ? DIR_ROT[dir] ?? 0 : 0;
  if (rot) ctx.rotate(rot);
  // 直接按像素画，不做 scale —— scale 会让线宽和阴影模糊，
  // 而这里所有坐标都是手写的比例，乘 half 就够
  ctx.save();
  ctx.scale(1, 1);
  const scaled = parts.map((p) => scalePart(p, half));
  PAINTERS[style](ctx, scaled, half, pal);
  opts?.decor?.(ctx, key ?? kind, scaled, half, pal);
  ctx.restore();
  ctx.restore();
}

/** 单位图元 → 像素图元。 */
function scalePart(p: GlyphPart, half: number): GlyphPart {
  // `dash` 也必须缩放。单位空间里写 0.14 的 dash，在 180px 的图标上是
  // 0.14 像素 —— 画出来就是实线（实测：传送门 A/B 长得一模一样）。
  // 这是"和坐标同一套单位"的必然结果，漏掉一处就是一整个变体失效。
  const dash = p.dash ? ([p.dash[0] * half, p.dash[1] * half] as [number, number]) : undefined;
  switch (p.k) {
    case 'poly':
      return { ...p, dash, pts: p.pts.map(([x, y]) => [x * half, y * half] as [number, number]) };
    case 'circle':
      return { ...p, dash, cx: p.cx * half, cy: p.cy * half, r: p.r * half };
    case 'rect':
      return { ...p, dash, x: p.x * half, y: p.y * half, w: p.w * half, h: p.h * half };
    case 'line':
      return { ...p, dash, pts: p.pts.map(([x, y]) => [x * half, y * half] as [number, number]) };
    case 'arc':
      return { ...p, dash, cx: p.cx * half, cy: p.cy * half, r: p.r * half };
  }
}
