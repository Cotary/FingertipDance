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
import { roundRect } from '../board';
import { cellDir, cellGroup, cellType, CoverCell, type Dir } from '../../core/cover/v3/types';
import { drawGlyph, type GlyphKind, type GlyphPalette, type GlyphStyle } from './glyphs';
import type { BoardTheme, DesignBox, ThemeTier, ThemeUnlock } from './types';

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
  now: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** 一套主题的差异化部分。没实现的钩子用通用版本。 */
export interface ThemeKit {
  backdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void;
  plate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void;
  cell(g: CellGeom): void;
  /** 已走线的绘制。默认三遍描边（halo / core / hot），颜色由 `trailColors` 给。 */
  trail?(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number, now: number): void;
  /** 不传则用 `trailColors` + 默认三层宽度。 */
  trailColors?: { halo: string; core: string; hot: string };
  /** 提示高亮的形状。默认是内缩的圆角方框；圆格 / 胶囊主题要自己画。 */
  hint?(ctx: CanvasRenderingContext2D, p: Pt, cell: number, i: number, color: string): void;
  glyph: {
    style: GlyphStyle;
    pal: GlyphPalette;
    /**
     * 按格类型换一套图标色。
     *
     * 暗色棋盘上，图标必须是浅色；但鎏金/霜青这类**亮格**上浅色图标会消失。
     * 主题自己按 type 决定用哪套（`CoverCell.SHARD` → 深墨、其余 → 浅釉）。
     */
    palFor?: (type: number) => GlyphPalette;
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
  /** 提示高亮的线宽倍率（像素主题要粗、水墨要细） */
  hintWidth?: number;
}

export function composeTheme(meta: {
  id: string;
  name: string;
  tagline: string;
  tier?: ThemeTier;
  unlock: ThemeUnlock;
  chrome?: BoardTheme['chrome'];
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
    backdrop: kit.backdrop,
    board: (c) => {
      const { ctx, board, layout, state: st, now } = c;

      kit.plate(ctx, layout);

      // 格 + 地形
      for (let y = 0; y < board.h; y++) {
        for (let x = 0; x < board.w; x++) {
          const idx = y * board.w + x;
          const type = cellType(board.grid[idx]);
          if (type === CoverCell.VOID) continue;
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
            now,
          };
          if (kit.terrain && (type === CoverCell.BLOCK || type === CoverCell.ICE)) kit.terrain(g);
          kit.cell(g);
        }
      }

      drawHint(ctx, board.w, layout, st, kit, now);

      ctx.save();
      // 宽限期整条线压暗一半。旧管线是在 main 里用 globalAlpha 包的，
      // 主题接管后忘了这件事，玩家会以为「只要别按就有救」。
      if (st.paused) ctx.globalAlpha = 0.5;
      drawTrail(ctx, board.w, layout, st, kit, now);
      ctx.restore();

      drawMarks(ctx, board, layout, st, kit);
      if (st.path.length > 0) {
        const p = center(layout, st.path[st.path.length - 1], board.w);
        kit.head(ctx, p, layout.cell, now);
      }
      drawEndpoints(ctx, board, layout, st, kit);
      kit.overlay?.(ctx, layout);
    },
  };
}

export function center(layout: BoardLayout, idx: number, w: number): Pt {
  return {
    x: layout.originX + (idx % w) * layout.cell + layout.cell / 2,
    y: layout.originY + Math.floor(idx / w) * layout.cell + layout.cell / 2,
  };
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
    const pulse = i === 0 ? 0.80 + 0.20 * Math.abs(Math.sin(now / 300)) : 1;
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
  st: { path: number[] },
  kit: ThemeKit,
  now: number,
): void {
  const path = st.path;
  if (path.length < 2) return;
  const pts = path.map((f) => center(layout, f, w));

  if (kit.trail) {
    kit.trail(ctx, pts, layout.cell, now);
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
  for (let i = 1; i < path.length; i++) {
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
  st: {
    shardsGot: Set<number>;
    keysHeld: Set<number>;
    shardNext: number;
  },
  kit: ThemeKit,
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
      const terrain = type === CoverCell.BLOCK || type === CoverCell.ICE;

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
        ? kit.glyph.palFor(type)
        : terrain && kit.glyph.terrainAccent
          ? { ...kit.glyph.pal, accent: kit.glyph.terrainAccent }
          : kit.glyph.pal;
      drawGlyph(ctx, kind, kit.glyph.style, p.x, p.y, size, gpal, cellDir(byte) as Dir);

      // 钥匙 / 传送门的编号：同组配对，不写数字玩家只能靠记位置
      if ((type === CoverCell.KEY || type === CoverCell.PORTAL) && cell >= 48) {
        ctx.fillStyle = kit.glyph.pal.chip;
        ctx.beginPath();
        ctx.arc(p.x + backR * 0.86, p.y + backR * 0.86, backR * 0.40, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = kit.glyph.pal.deep;
        ctx.font = `700 ${Math.round(backR * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(group + 1), p.x + backR * 0.86, p.y + backR * 0.88);
      }
      ctx.restore();
    }
  }
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  board: { w: number; h: number; grid: Uint8Array },
  layout: BoardLayout,
  st: { covered: Set<number> },
  kit: ThemeKit,
): void {
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const type = cellType(board.grid[idx]);
      if (type !== CoverCell.START && type !== CoverCell.END) continue;
      if (st.covered.has(idx)) continue;
      kit.endpoint(ctx, type === CoverCell.START ? 'start' : 'end', center(layout, idx, board.w), layout.cell);
    }
  }
}
