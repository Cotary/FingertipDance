/**
 * Cover 模式棋盘 **v2 视觉原型**（只用于截图评审，不进生产包）。
 *
 * ## 这一版在治什么
 *
 * 1. **底板**：旧实现「整块矩形 + `destination-out` 抠洞」有两个致命后果 ——
 *    ① 洞会连背景一起擦掉，微信端（无 CSS 背景）就是一块黑斑；
 *    ② 轮廓永远是矩形，缺口读作「板被啃了一块」而不是「形状本来如此」。
 *    现在：把「属于板的格子」并成一条方角路径，**用圆角 join 描粗 + 填充**
 *    → 得到并集的外扩轮廓（Minkowski 膨胀），外角自然圆润、内部没有格缝。
 *    板是**静态的**，所以整块板缓存到离屏画布，每帧只 drawImage。
 * 2. **格子三级只靠明度**：未走 = 比板暗一点的「未上色槽」（几乎融进板里）；
 *    走过 = 皮肤色；当前格 = 白环（画在连线**之上**，否则会被线盖住）。
 *    旧版用「奶油白砖 vs 皮肤绿」两套色相，整盘读作拼图，读不出进度。
 * 3. **路径线**：线上 `segmentPath` 有 bug（每个相邻步都切成单格段，
 *    全部因 `length < 2` 被跳过），所以线上**从来没画出过线**，只剩每格一颗珠。
 *    这里重写分段，并且拐角珠只在真转弯处出现。
 * 4. **机制筹码**：圆形纸白底盘 + 单色符号，色弱可读；星屑/传送门带编号徽章
 *    （「顺序必经」是核心规则，只靠颜色表达等于没表达）。
 * 5. **密度自适应**：cell < 56 时关掉每格亮面与颗粒，11×11 不再是华夫饼。
 */
import { CoverCell, cellDir, cellGroup, cellType } from '../src/core/cover/v3/types';
import {
  CLAY,
  CLAY_UI,
  clayBlock,
  clayDisc,
  clayLock,
  clayStar,
  clayText,
  type ClayColor,
} from '../src/ui/clay';
import { roundRect } from '../src/render/board';
import type { BoardLayout } from '../src/render/layout';
import { paletteOf, type Skin } from '../src/render/skins';

/** 机制筹码的底盘（纸白，衬在皮肤色上也读得出符号）。 */
const CHIP: ClayColor = { base: '#FFF8EC', light: '#FFFFFF', dark: '#E2D3BE', shade: '#BCA78C' };

/** 渲染状态（与生产 `CoverRenderState` 对齐的子集）。 */
export interface ProtoRenderState {
  covered: Set<number>;
  path: number[];
  keysHeld: Set<number>;
  shardsGot: Set<number>;
  shardNext: number;
}

export interface ProtoBoard {
  w: number;
  h: number;
  grid: Uint8Array;
}

/** 板缓存：同一关的板每帧重画不划算（一次并集 + 两层描边）。 */
const plateCache = new Map<string, HTMLCanvasElement>();

/**
 * 生成底板离屏图。
 *
 * ① 方角矩形并集（外扩 pad）→ 一条路径
 * ② 用 `lineJoin:'round'` 描同一条路径（线宽 2R）+ 填充 = 并集外扩 R 的圆角轮廓
 * ③ `source-atop` 上移重填 → 底边露出 thickness 的暗色 = 厚度
 * ④ `source-atop` 描一圈亮边 = 轮廓光
 */
function buildPlate(w: number, h: number, grid: Uint8Array, layout: BoardLayout): HTMLCanvasElement {
  const { cell, originX, originY } = layout;
  const key = `${w}x${h}:${cell}:${originX},${originY}:${Array.from(grid).join('')}`;
  const hit = plateCache.get(key);
  if (hit) return hit;

  const pad = Math.max(3, cell * 0.06);   // 外扩：把格间缝盖掉
  const R = Math.max(6, cell * 0.22);     // 外轮廓圆角
  const thickness = Math.max(3, cell * 0.06);
  const margin = pad + R + thickness + 8;
  const cw = w * cell + margin * 2;
  const ch = h * cell + margin * 2;

  const off = document.createElement('canvas');
  off.width = Math.ceil(cw);
  off.height = Math.ceil(ch);
  const g = off.getContext('2d');
  if (!g) return off;
  g.translate(margin - originX, margin - originY);

  // ① 方角并集（外扩 pad）
  const union = new Path2D();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cellType(grid[y * w + x]) === CoverCell.VOID) continue;
      union.rect(originX + x * cell - pad, originY + y * cell - pad, cell + pad * 2, cell + pad * 2);
    }
  }

  /** 绘制「并集膨胀 R」的形状：描粗（圆角接头）+ 填充。 */
  const blob = (dy: number, color: string, strokeW = R) => {
    g.save();
    g.translate(0, dy);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = strokeW * 2;
    g.stroke(union);
    g.fill(union);
    g.restore();
  };

  // ② 暗色整体（最底层，底边会露出来 = 板厚）
  blob(0, CLAY.board.dark);
  // ③ 顶面：整体上移，底边留出 thickness 的暗色
  //
  // 注意：这里**不能**再叠一层 `blob(..., light)` —— `blob` 会 fill 整块，
  // 那等于把整个顶面刷成亮色，板会失去黏土的重量感（第一版就是这么翻的）。
  g.globalCompositeOperation = 'source-atop';
  blob(-thickness, CLAY.board.base);
  g.globalCompositeOperation = 'source-over';

  plateCache.set(key, off);
  return off;
}

/** 画底板（含软投影）。 */
export function drawPlateV2(
  ctx: CanvasRenderingContext2D,
  board: ProtoBoard,
  layout: BoardLayout,
): void {
  const plate = buildPlate(board.w, board.h, board.grid, layout);
  const margin = (plate.width - board.w * layout.cell) / 2;
  const dx = layout.originX - margin;
  const dy = layout.originY - margin;

  // 投影：整块板一层（不是每格一层）—— 这是「一整块板」的关键
  ctx.save();
  ctx.filter = 'blur(8px)';
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#4A3327';
  ctx.drawImage(plate, dx, dy + Math.max(4, layout.cell * 0.07));
  ctx.restore();

  ctx.drawImage(plate, dx, dy);
}

/** 画格子：未上色槽 / 皮肤砖 / 石头。当前格的白环在连线之后单独画。 */
export function drawCellsV2(
  ctx: CanvasRenderingContext2D,
  board: ProtoBoard,
  layout: BoardLayout,
  covered: Set<number>,
  skin: Skin,
): void {
  const { cell, originX, originY } = layout;
  const gap = Math.max(1.5, cell * 0.035);
  const size = cell - gap * 2;
  const small = cell < 56;
  const p = paletteOf(skin);
  const skinClay: ClayColor = { base: p.base, light: p.light, dark: p.dark, shade: p.border };

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const t = cellType(board.grid[idx]);
      if (t === CoverCell.VOID) continue;

      const px = originX + x * cell + gap;
      const py = originY + y * cell + gap;
      const r = Math.max(3, size * 0.20);

      if (t === CoverCell.BLOCK) {
        // 石头：陷进板里。不做「×」——小尺寸上就是一块脏点；
        // 靠「比板深得多 + 顶部哑光」表达不可通行
        clayBlock(ctx, px, py, size, size, r * 0.9, CLAY.boardDark, idx + 31, {
          depth: small ? 0 : 2,
          lit: false,
          jitter: 0.004,
        });
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#FFF6E9';
        ctx.beginPath();
        ctx.ellipse(px + size * 0.5, py + size * 0.26, size * 0.30, size * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (covered.has(idx)) {
        // 已走：皮肤色黏土砖（凸起）
        clayBlock(ctx, px, py, size, size, r, skinClay, idx + 17, {
          depth: small ? 2 : 3,
          lit: !small,
          jitter: 0.004,
        });
      } else {
        // 未走：**不做凹坑**。凹坑在 cell≥90 时是一排「碗」，整盘读作「一堆洞」。
        // 改成「板上浅刻一格」：一条极淡的刻线 + 上沿一丝内影。
        // 这样未走区域几乎融进板里，只有「已走」的彩色在跳 —— 进度一眼可读。
        ctx.save();
        ctx.strokeStyle = 'rgba(74,51,39,0.13)';
        ctx.lineWidth = Math.max(1, size * 0.022);
        roundRect(ctx, px + 0.5, py + 0.5, size - 1, size - 1, r);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,251,243,0.18)';
        ctx.lineWidth = Math.max(1, size * 0.018);
        roundRect(ctx, px + 1.5, py + 1.5 + size * 0.02, size - 3, size - 3, r);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/**
 * 画路径线。
 *
 * 旧 `segmentPath` 把每个相邻步都切成「只有一个格」的段，
 * 所有段都因 `length < 2` 被跳过 —— 线**从来没画出来过**。
 * 这里按「这一步的 kind」合并成真正的段。
 */
export function drawTrailV2(
  ctx: CanvasRenderingContext2D,
  path: number[],
  board: ProtoBoard,
  layout: BoardLayout,
  c: ClayColor = CLAY.terracotta,
): void {
  if (path.length < 2) return;
  const { cell, originX, originY } = layout;
  const w = board.w;
  const at = (idx: number) => ({
    x: originX + (idx % w) * cell + cell / 2,
    y: originY + Math.floor(idx / w) * cell + cell / 2,
  });
  const kindOf = (a: number, b: number): 'walk' | 'ice' | 'portal' => {
    const dx = Math.abs((a % w) - (b % w));
    const dy = Math.abs(Math.floor(a / w) - Math.floor(b / w));
    if (dx + dy !== 1) return 'portal';
    return cellType(board.grid[a]) === CoverCell.ICE ? 'ice' : 'walk';
  };

  const segs: Array<{ cells: number[]; kind: 'walk' | 'ice' | 'portal' }> = [];
  let cur = { cells: [path[0], path[1]], kind: kindOf(path[0], path[1]) };
  for (let i = 2; i < path.length; i++) {
    const k = kindOf(path[i - 1], path[i]);
    if (k === cur.kind && k !== 'portal') cur.cells.push(path[i]);
    else {
      segs.push(cur);
      cur = { cells: [path[i - 1], path[i]], kind: k };
    }
  }
  segs.push(cur);

  const strokeSegs = (color: string, width: number, dy = 0) => {
    ctx.save();
    ctx.translate(0, dy);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const seg of segs) {
      if (seg.kind === 'portal') continue;
      ctx.beginPath();
      seg.cells.forEach((idx, i) => {
        const p = at(idx);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
    ctx.restore();
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 压痕 → 侧暗 → 主色 → 亮芯：与经典模式同一套体积语言
  strokeSegs('rgba(74,51,39,0.20)', cell * 0.30);
  strokeSegs(c.dark, cell * 0.215);
  strokeSegs(c.base, cell * 0.175, -cell * 0.020);
  strokeSegs(c.light, cell * 0.048, -cell * 0.020);

  // 传送门跳跃：虚线弧
  for (const seg of segs) {
    if (seg.kind !== 'portal') continue;
    const a = at(seg.cells[0]);
    const b = at(seg.cells[1]);
    ctx.save();
    ctx.setLineDash([cell * 0.13, cell * 0.11]);
    ctx.strokeStyle = c.base;
    ctx.lineWidth = cell * 0.085;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - cell * 0.38, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/** 当前格白环：必须在连线**之后**画，否则被线盖掉。 */
export function drawHead(
  ctx: CanvasRenderingContext2D,
  head: number,
  board: ProtoBoard,
  layout: BoardLayout,
): void {
  if (head < 0) return;
  const { cell, originX, originY } = layout;
  const gap = Math.max(1.5, cell * 0.035);
  const size = cell - gap * 2;
  const x = originX + (head % board.w) * cell + gap;
  const y = originY + Math.floor(head / board.w) * cell + gap;
  const r = Math.max(3, size * 0.20);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,251,243,0.92)';
  ctx.lineWidth = Math.max(2.5, size * 0.06);
  roundRect(ctx, x + 1.5, y + 1.5, size - 3, size - 3, r);
  ctx.stroke();
  ctx.restore();
}

/** 机制筹码：圆形纸白底盘 + 单色符号。 */
function chip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  glyph: (r: number) => void,
  tint: ClayColor = CHIP,
): void {
  clayDisc(ctx, cx, cy, r, tint, 700 + seed, { depth: 3, hi: 0.12, jitter: 0.006, segs: 18 });
  ctx.save();
  ctx.translate(cx, cy);
  glyph(r * 0.62);
  ctx.restore();
}

/** 编号徽章：顺序必经必须可读，不能只靠色相。 */
function badge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number): void {
  clayDisc(ctx, cx, cy, r, CLAY.terracotta, 880 + n, { depth: 1, hi: 0.2, segs: 12 });
  clayText(ctx, String(n + 1), cx, cy - r * 0.08, r * 1.4, {
    fill: '#FFF6E9',
    outlineWidth: 0,
    emboss: false,
    weight: 700,
  });
}

/** 画机制标记（在连线之上、端点之下）。 */
export function drawMarksV2(
  ctx: CanvasRenderingContext2D,
  board: ProtoBoard,
  layout: BoardLayout,
  st: ProtoRenderState,
): void {
  const { cell, originX, originY } = layout;
  const chipR = cell * 0.26;
  const ink = CLAY_UI.ink;

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const byte = board.grid[idx];
      const type = cellType(byte);
      const group = cellGroup(byte);
      const cx = originX + x * cell + cell / 2;
      const cy = originY + y * cell + cell / 2;

      switch (type) {
        case CoverCell.SHARD: {
          const got = st.shardsGot.has(group);
          chip(ctx, cx, cy, chipR, idx, (r) => {
            clayStar(ctx, 0, 0, r, got ? CLAY.mustard : CLAY.sand, 900 + group, { depth: 2, lit: got });
          });
          if (!got) badge(ctx, cx + chipR * 0.78, cy + chipR * 0.78, chipR * 0.40, group);
          break;
        }
        case CoverCell.ONEWAY: {
          const dir = cellDir(byte);
          chip(ctx, cx, cy, chipR * 0.94, idx, (r) => {
            ctx.rotate((dir * Math.PI) / 2);
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.moveTo(0, -r);
            ctx.lineTo(r * 0.86, r * 0.66);
            ctx.lineTo(0, r * 0.30);
            ctx.lineTo(-r * 0.86, r * 0.66);
            ctx.closePath();
            ctx.fill();
          });
          break;
        }
        case CoverCell.KEY: {
          const held = st.keysHeld.has(group);
          chip(ctx, cx, cy, chipR, idx, (r) => {
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.arc(-r * 0.32, 0, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(-r * 0.04, -r * 0.14, r * 1.0, r * 0.28);
            ctx.fillRect(r * 0.60, -r * 0.14, r * 0.15, r * 0.46);
            ctx.fillRect(r * 0.30, -r * 0.14, r * 0.14, r * 0.36);
          }, held ? CLAY.mint : CHIP);
          break;
        }
        case CoverCell.GATE: {
          const locked = !st.keysHeld.has(group);
          chip(ctx, cx, cy, chipR, idx, () => {}, locked ? CLAY.rose : CLAY.mint);
          clayLock(ctx, cx, cy + chipR * 0.08, chipR * 1.1, locked ? CLAY.rose : CLAY.mint);
          break;
        }
        case CoverCell.PORTAL: {
          const tint = group % 2 === 0 ? CLAY.blue : CLAY.terracotta;
          chip(ctx, cx, cy, chipR * 0.96, idx, (r) => {
            ctx.strokeStyle = tint.shade;
            ctx.lineWidth = Math.max(2, r * 0.30);
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = tint.base;
            ctx.lineWidth = Math.max(1.5, r * 0.18);
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.50, 0, Math.PI * 2);
            ctx.stroke();
          });
          badge(ctx, cx + chipR * 0.78, cy + chipR * 0.78, chipR * 0.38, group);
          break;
        }
        case CoverCell.ICE: {
          // 冰：玻璃砖。旧实现是半透白块 —— 在奶油底上被读成「空格子」。
          const s = cell * 0.84;
          ctx.save();
          roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.16);
          ctx.clip();
          ctx.fillStyle = 'rgba(198,228,246,0.70)';
          ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.beginPath();
          ctx.moveTo(cx - s / 2, cy - s * 0.10);
          ctx.lineTo(cx + s / 2, cy - s * 0.34);
          ctx.lineTo(cx + s / 2, cy - s * 0.16);
          ctx.lineTo(cx - s / 2, cy + s * 0.08);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(120,170,205,0.85)';
          ctx.lineWidth = Math.max(1.2, cell * 0.030);
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.28, cy - s * 0.20);
          ctx.lineTo(cx - s * 0.02, cy);
          ctx.lineTo(cx - s * 0.10, cy + s * 0.26);
          ctx.moveTo(cx - s * 0.02, cy);
          ctx.lineTo(cx + s * 0.28, cy - s * 0.06);
          ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = 'rgba(96,150,190,0.65)';
          ctx.lineWidth = Math.max(1.4, cell * 0.028);
          roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.16);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
    }
  }
}

/** 端点圆片：压在最上层（盖住线头），起终点用符号区分。 */
export function drawEndpointsV2(
  ctx: CanvasRenderingContext2D,
  board: ProtoBoard,
  layout: BoardLayout,
): void {
  const { cell, originX, originY } = layout;
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const type = cellType(board.grid[y * board.w + x]);
      if (type !== CoverCell.START && type !== CoverCell.END) continue;
      const cx = originX + x * cell + cell / 2;
      const cy = originY + y * cell + cell / 2;
      const seed = 900 + (type === CoverCell.START ? 1 : 2);
      const ring: ClayColor = type === CoverCell.START ? CLAY.mint : CLAY.rose;

      clayDisc(ctx, cx, cy, cell * 0.32, CLAY.paper, seed, { depth: 5, hi: 0.06 });
      clayDisc(ctx, cx, cy, cell * 0.25, ring, seed + 1, { depth: 3, hi: 0.16 });

      ctx.save();
      ctx.fillStyle = '#FFF6E9';
      ctx.strokeStyle = '#FFF6E9';
      if (type === CoverCell.START) {
        // 起点：三角（从这里出发）
        ctx.beginPath();
        ctx.moveTo(cx + cell * 0.07, cy - cell * 0.09);
        ctx.lineTo(cx + cell * 0.07, cy + cell * 0.09);
        ctx.lineTo(cx - cell * 0.07, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        // 终点：方框（到这里收）
        ctx.lineWidth = Math.max(2, cell * 0.045);
        roundRect(ctx, cx - cell * 0.075, cy - cell * 0.075, cell * 0.15, cell * 0.15, cell * 0.03);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/** 一次性画完（画廊用）。生产接入时按需拆开调用。 */
export function drawCoverV2(
  ctx: CanvasRenderingContext2D,
  board: ProtoBoard,
  layout: BoardLayout,
  st: ProtoRenderState,
  skin: Skin,
): void {
  drawPlateV2(ctx, board, layout);
  drawCellsV2(ctx, board, layout, st.covered, skin);
  drawTrailV2(ctx, st.path, board, layout);
  drawMarksV2(ctx, board, layout, st);
  drawHead(ctx, st.path.length ? st.path[st.path.length - 1] : -1, board, layout);
  drawEndpointsV2(ctx, board, layout);
}
