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

/** 图元公共开关。`fill` / `stroke` 对所有形态都可选 —— 线也能被填（无实际效果，但省得逐个窄化）。 */
interface PartBase {
  fill?: boolean;
  stroke?: boolean;
}

/** 单位空间里的一个图元。 */
type Part = PartBase &
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
  | 'porcelain';

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

/** 六角雪花：三条主轴 + 六个端点上的短枝。 */
function snowParts(): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push({ k: 'line', pts: [[-c * 0.92, -s * 0.92], [c * 0.92, s * 0.92]] });
    // 端点短枝：雪花的辨识度全在这六个分叉上
    for (const sign of [-1, 1]) {
      const px = c * 0.92 * sign;
      const py = s * 0.92 * sign;
      for (const side of [-1, 1]) {
        const b = a + (side * Math.PI) / 3;
        parts.push({ k: 'line', pts: [[px, py], [px - Math.cos(b) * 0.34 * sign, py - Math.sin(b) * 0.34 * sign]] });
      }
    }
  }
  return parts;
}

/** 九种图标的几何。 */
const GLYPHS: Record<GlyphKind, Part[]> = {
  star: [{ k: 'poly', pts: starPts(0.94), fill: true, stroke: true }],

  // 箭头朝上；绘制时按方向旋转
  arrow: [
    {
      k: 'poly',
      pts: [[0, -0.86], [0.72, 0.34], [0, 0.06], [-0.72, 0.34]],
      fill: true,
      stroke: true,
    },
  ],

  key: [
    { k: 'circle', cx: -0.34, cy: 0, r: 0.40, stroke: true },
    { k: 'circle', cx: -0.34, cy: 0, r: 0.13, fill: true },
    { k: 'rect', x: -0.02, y: -0.11, w: 0.94, h: 0.22, fill: true },
    { k: 'rect', x: 0.56, y: -0.11, w: 0.16, h: 0.50, fill: true },
    { k: 'rect', x: 0.28, y: -0.11, w: 0.14, h: 0.38, fill: true },
  ],

  // 拱门：两根柱 + 顶弧，门洞是负形
  gate: [
    { k: 'arc', cx: 0, cy: -0.06, r: 0.62, a0: Math.PI, a1: 0 },
    { k: 'line', pts: [[-0.62, -0.06], [-0.62, 0.78]] },
    { k: 'line', pts: [[0.62, -0.06], [0.62, 0.78]] },
    { k: 'line', pts: [[-0.86, 0.78], [0.86, 0.78]] },
    { k: 'circle', cx: 0, cy: 0.30, r: 0.15, fill: true },
  ],

  portal: [
    { k: 'circle', cx: 0, cy: 0, r: 0.86, stroke: true },
    { k: 'circle', cx: 0, cy: 0, r: 0.52, stroke: true },
    { k: 'arc', cx: 0, cy: 0, r: 0.28, a0: Math.PI * 0.2, a1: Math.PI * 1.2 },
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

  ice: snowParts(),

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
function tracePart(ctx: CanvasRenderingContext2D, p: Part): void {
  ctx.beginPath();
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
function fillable(p: Part): boolean {
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
  (ctx: CanvasRenderingContext2D, parts: Part[], half: number, pal: GlyphPalette) => void
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
      tracePart(ctx, p);
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
      tracePart(ctx, p);
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
      tracePart(ctx, p);
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
        tracePart(ctx, p);
        ctx.fillStyle = pal.accent;
        ctx.fill();
      }
    }
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = px(0.14, half);
    for (const p of parts) {
      // 填过的面也要描轮廓：青花里「一块色」从来不是一团雾，它有料线的边
      if (p.stroke || (fillable(p) && p.fill)) {
        tracePart(ctx, p);
        ctx.stroke();
      }
    }
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
      tracePart(ctx, p);
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
        tracePart(ctx, p);
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
      tracePart(ctx, p);
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
      tracePart(ctx, p);
      ctx.fill();
    }
    ctx.strokeStyle = pal.chip;
    ctx.lineWidth = px(0.11, half);
    for (const p of parts) {
      tracePart(ctx, p);
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
): void {
  const parts = GLYPHS[kind];
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
  ctx.restore();
  ctx.restore();
}

/** 单位图元 → 像素图元。 */
function scalePart(p: Part, half: number): Part {
  switch (p.k) {
    case 'poly':
      return { ...p, pts: p.pts.map(([x, y]) => [x * half, y * half] as [number, number]) };
    case 'circle':
      return { ...p, cx: p.cx * half, cy: p.cy * half, r: p.r * half };
    case 'rect':
      return { ...p, x: p.x * half, y: p.y * half, w: p.w * half, h: p.h * half };
    case 'line':
      return { ...p, pts: p.pts.map(([x, y]) => [x * half, y * half] as [number, number]) };
    case 'arc':
      return { ...p, cx: p.cx * half, cy: p.cy * half, r: p.r * half };
  }
}
