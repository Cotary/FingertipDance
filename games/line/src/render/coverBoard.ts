/**
 * Cover 模式 v3：棋盘渲染。
 *
 * ## 与经典渲染的差异
 *
 * 经典模式只有 5 种格子（砖 / 阻挡 / 单向 / 起 / 终），
 * cover 模式有 11 种，且**轮廓不规则**（VOID 是缺口，形状由洞决定）。
 *
 * ## 视觉语言：一块板 + 板上的痕迹
 *
 * 这一版（2026-11-08 重构）修掉了四个把棋盘读成「坏掉的图」的问题：
 *
 * 1. **底板**：旧实现是「整块矩形 + `destination-out` 抠洞」。
 *    画布是透明的 —— 抠掉的不只是板，还有先画上去的背景层，
 *    微信端（无 CSS 背景）直接露出一块黑斑。而且轮廓永远是矩形，
 *    缺格越多越像「板被啃了」。
 *    现在：把「属于板的格子」并成一条路径，用圆角 join 描粗 + 填充
 *    → 并集的外扩圆角轮廓（Minkowski 膨胀），缺口自然不覆盖。
 *    板是静态的，整块缓存到离屏画布，每帧只 `drawImage` 一次。
 * 2. **格子只靠明度分级**：未走 = 板上浅刻线（几乎融进板里），
 *    走过 = 皮肤色凸起，当前 = 白环。
 *    旧版「奶油白凹坑 vs 皮肤绿砖」是两套高明度不同色相的面并置，
 *    整盘读作拼图，进度只能靠数格子。
 * 3. **机制统一成筹码**：纸白圆盘 + 单色符号，色弱 / 小屏 / 缩略图都能读。
 *    星屑与传送门带编号徽章 ——「顺序必经」是核心规则，只给颜色等于没表达。
 * 4. **密度三档**：cell 从 134 到 60，同一套绘制函数要服务 2.2 倍尺寸跨度。
 *    小格上关掉亮面与编号，否则 11×11 就是「一锅芝麻」。
 *
 * ## 绘制顺序（调用方负责）
 *
 * ```
 * drawCoverPlate → drawCoverCells → [drawCoverTrail] → drawCoverMarks
 *   → drawCoverHead → drawCoverEndpoints
 * ```
 * 连线必须在格子之上、筹码之下；当前格白环必须在连线之上，否则被线盖掉。
 */
import { cellDir, cellGroup, cellType, CoverCell } from '../core/cover/v3/types';
import { HINT_WINDOW, type CoverHintPlan } from '../game/coverState';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayLock, clayStar, clayText, type ClayColor } from '../ui/clay';
import { roundRect } from './board';
import { fillGrain } from './grain';
import { BOARD_BOTTOM, BOARD_TOP, DESIGN_W, type BoardLayout } from './layout';
import { paintSkin, paletteOf, type Skin } from './skins';
import { portalEntrance } from './themes/kit';
import { createOffscreenCanvas } from '../platform/offscreen';

/** 机制筹码的底盘：纸白，衬在皮肤色上也读得出符号。 */
const CHIP: ClayColor = { base: '#FFF8EC', light: '#FFFFFF', dark: '#E2D3BE', shade: '#BCA78C' };

/**
 * 提示窗口内由近到远的描边不透明度。
 *
 * 第一版用的是 1 / .72 / .52 / .36 / .24，实拍出来第 3 格起就看不见了：
 * 盘面的空格是**蓝灰**的，琥珀色描边压上去本来就缺明度对比，
 * 再乘 0.36 等于没画。现在把下限抬到 0.44，让「远」靠**变细**表达，
 * 而不是靠「淡到消失」。
 */
const HINT_ALPHA = [1, 0.85, 0.7, 0.56, 0.44];

/**
 * 提示窗口内由近到远的底色不透明度。
 *
 * 只画描边的话，隔着两个机制筹码的格子会读不出「这一格也在路线上」。
 * 铺一层暖白：五格连起来就是一条带子，比五个孤立的环更像「路」。
 */
const HINT_FILL = [0.3, 0.24, 0.19, 0.15, 0.12];

/** 渲染状态。 */
export interface CoverRenderState {
  /** 已覆盖的格（拍平索引集合） */
  covered: Set<number>;
  /** 当前路径（拍平索引序列） */
  path: number[];
  /** 提示路线（null = 没有提示） */
  hint: CoverHintPlan | null;
  /** 已拾取的钥匙分组（0 基集合） */
  keysHeld: Set<number>;
  /** 已收集的星星分组（0 基集合） */
  shardsGot: Set<number>;
  /** 下一个必须收集的星星分组（0 基）；-1 = 无 */
  shardNext: number;
  /** 抖动格（拍平索引），-1 = 无 */
  shakeCell: number;
  /** 抖动时间戳 */
  shakeAt: number;
}

/** 棋盘尺寸（设计坐标系）。 */
export interface CoverBoard {
  w: number;
  h: number;
  /** 每格 1 字节的盘面编码 */
  grid: Uint8Array;
}

/** 密度档位：按格宽分三档，小格降级细节。 */
export type Density = 'rich' | 'standard' | 'compact';

export function densityOf(cell: number): Density {
  if (cell >= 90) return 'rich';
  if (cell >= 70) return 'standard';
  return 'compact';
}

/** 格间缝 & 格块尺寸。 */
function cellGeom(layout: BoardLayout): { gap: number; size: number } {
  const gap = Math.max(1.5, layout.cell * 0.035);
  return { gap, size: layout.cell - gap * 2 };
}

// ────────────────────────────── 底板 ──────────────────────────────

interface PlateEntry {
  cv: HTMLCanvasElement;
  /** 离屏图左上角在设计坐标系里的位置 */
  dx: number;
  dy: number;
  /** 设计坐标系下的绘制尺寸 */
  cw: number;
  ch: number;
}

/**
 * 板缓存。
 *
 * key 用**关卡号**（盘面静态，同关的板永远一样）。
 * 不用 `grid.join('')` 当 key —— 每帧拼一次 121 字符的字符串比画板还贵。
 */
const plateCache = new Map<string, PlateEntry>();
/** 只留最近几关（一张 750×900 @2x 的板约 10MB，微信端不能无限存）。 */
const PLATE_CACHE_MAX = 2;

/** 建离屏画布；拿不到就返回 null（无 document 的录制 / 测试环境走直画兜底）。 */
function newPlateCanvas(w: number, h: number): HTMLCanvasElement | null {
  return createOffscreenCanvas(w, h);
}

/** 把「属于板的格子」并成一条方角路径（外扩 pad，盖掉格缝）。 */
function addUnionPath(
  g: CanvasRenderingContext2D,
  board: CoverBoard,
  layout: BoardLayout,
  pad: number,
): void {
  const { cell, originX, originY } = layout;
  g.beginPath();
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      if (cellType(board.grid[y * board.w + x]) === CoverCell.VOID) continue;
      g.rect(originX + x * cell - pad, originY + y * cell - pad, cell + pad * 2, cell + pad * 2);
    }
  }
}

/**
 * 画一层「膨胀 R 的并集」。
 *
 * 描粗 + 填充同一路径：描边把并集向外扩 R（`lineJoin:'round'` 让外角变圆），
 * 填充补齐内部。重叠矩形的内部描边和填充同色，看不出来。
 */
function paintBlob(
  g: CanvasRenderingContext2D,
  board: CoverBoard,
  layout: BoardLayout,
  pad: number,
  R: number,
  dy: number,
  color: string,
): void {
  g.save();
  g.translate(0, dy);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = R * 2;
  addUnionPath(g, board, layout, pad);
  g.stroke();
  g.fill();
  g.restore();
}

/**
 * 生成（并缓存）底板离屏图。
 *
 * 层次：软投影 3 层 → 暗色整体（底边露出 = 板厚）→ 顶面（`source-atop` 上移）。
 *
 * 顶面**只能填一次**。第一版试过再叠一层亮色做轮廓光，`fill` 会把整块顶面
 * 刷成亮色，黏土的重量感全丢（见 `out/shots/proto2-*`）。
 */
function buildPlate(board: CoverBoard, layout: BoardLayout, pxScale: number): PlateEntry | null {
  const { cell, originX, originY } = layout;
  const pad = Math.max(3, cell * 0.06);
  const R = Math.max(6, cell * 0.22);
  const thickness = Math.max(3, cell * 0.06);
  const shadow = Math.max(5, cell * 0.10);
  const margin = pad + R + thickness + shadow + 8;

  const cw = board.w * cell + margin * 2;
  const ch = board.h * cell + margin * 2;
  // 离屏图按设备像素建，否则 DPR 2~3 的屏上板边会糊成一团
  const k = Math.min(3, Math.max(1, pxScale));

  const cv = newPlateCanvas(Math.ceil(cw * k), Math.ceil(ch * k));
  if (!cv) return null;
  const g = cv.getContext('2d');
  if (!g) return null;

  g.setTransform(k, 0, 0, k, 0, 0);
  g.translate(margin - originX, margin - originY);

  // ① 软投影：同一轮廓错位叠 3 层（不用 shadowBlur，微信端逐像素太贵）
  for (let i = 3; i >= 1; i--) {
    paintBlob(g, board, layout, pad, R * (1 + i * 0.015), thickness * 0.4 + (shadow * i) / 3, 'rgba(74,51,39,0.055)');
  }

  // ② 暗色整体：底边比顶面低 thickness，露出来的那一条就是板厚
  paintBlob(g, board, layout, pad, R, 0, CLAY.board.dark);

  // ③ 顶面：上移，且只画在已有暗色之内
  g.globalCompositeOperation = 'source-atop';
  paintBlob(g, board, layout, pad, R, -thickness, CLAY.board.base);
  // 颗粒：整块板一层。黏土工坊的所有大面都带颗粒，
  // 板面一旦是纯色，和旁边的黏土按钮就不是同一种材质了。
  fillGrain(g, originX - pad - R, originY - pad - R, board.w * cell + (pad + R) * 2, board.h * cell + (pad + R) * 2, 0.34);
  g.globalCompositeOperation = 'source-over';

  return { cv, dx: originX - margin, dy: originY - margin, cw, ch };
}

/**
 * 画底板。
 *
 * @param levelId 关卡号（缓存 key；同一关的板只生成一次）
 * @param pxScale 设备像素 / 设计像素（`viewport.scale * viewport.dpr`）
 */
export function drawCoverPlate(
  ctx: CanvasRenderingContext2D,
  board: CoverBoard,
  layout: BoardLayout,
  levelId: number,
  pxScale = 1,
): void {
  const key = `${levelId}:${layout.cell}:${Math.round(pxScale * 100)}`;
  let entry = plateCache.get(key);
  if (!entry) {
    const built = buildPlate(board, layout, pxScale);
    if (!built) {
      drawPlateDirect(ctx, board, layout);
      return;
    }
    entry = built;
    plateCache.set(key, entry);
    // Map 按插入序迭代 → 第一个就是最旧的
    while (plateCache.size > PLATE_CACHE_MAX) {
      const oldest = plateCache.keys().next().value;
      if (oldest === undefined) break;
      plateCache.delete(oldest);
    }
  }
  ctx.drawImage(entry.cv, entry.dx, entry.dy, entry.cw, entry.ch);
}

/** 兜底：拿不到离屏画布时直接在主画布上画（无缓存、无厚度）。 */
function drawPlateDirect(ctx: CanvasRenderingContext2D, board: CoverBoard, layout: BoardLayout): void {
  const pad = Math.max(3, layout.cell * 0.06);
  const R = Math.max(6, layout.cell * 0.22);
  paintBlob(ctx, board, layout, pad, R, 0, CLAY.board.dark);
  paintBlob(ctx, board, layout, pad, R, -Math.max(2, layout.cell * 0.05), CLAY.board.base);
}

// ────────────────────────────── 格子 ──────────────────────────────

/**
 * 画所有格子（不含机制筹码，筹码在连线之后画）。
 *
 * 冰块在这里画（不是筹码层）：冰是**地面**，连线要压在它上面才读得出「滑过去」；
 * 若放到筹码层，线会被玻璃盖住、断成一截一截。
 */
export function drawCoverCells(
  ctx: CanvasRenderingContext2D,
  board: CoverBoard,
  layout: BoardLayout,
  state: CoverRenderState,
  skin: Skin,
  now: number,
): void {
  const { cell, originX, originY } = layout;
  const { gap, size } = cellGeom(layout);
  const d = densityOf(cell);
  const small = d === 'compact';
  const p = paletteOf(skin);
  const skinClay: ClayColor = { base: p.base, light: p.light, dark: p.dark, shade: p.border };
  const r = Math.max(3, size * 0.20);

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const type = cellType(board.grid[idx]);
      if (type === CoverCell.VOID) continue;

      let px = originX + x * cell + gap;
      const py = originY + y * cell + gap;

      // 断线抖动（无效走法时那一格左右摆一下）
      if (state.shakeCell === idx && state.shakeAt > 0) {
        const elapsed = now - state.shakeAt;
        if (elapsed < 200) px += Math.sin((elapsed / 200) * Math.PI * 6) * 4;
      }

      const covered = state.covered.has(idx);

      // 石头：陷进板里的一块深色黏土。
      // 不画「×」—— 20px 格上那就是一块脏点；靠「比板深得多 + 顶部哑光」表达不可通行
      if (type === CoverCell.BLOCK) {
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

      if (covered) {
        // 已走：皮肤色黏土砖（凸起）
        clayBlock(ctx, px, py, size, size, r, skinClay, idx + 17, {
          depth: small ? 2 : 3,
          lit: !small,
          jitter: 0.004,
        });
        // 皮肤纹理只在大格上贴：小格上那层纹理就是噪点
        if (d === 'rich') {
          ctx.save();
          roundRect(ctx, px, py, size, size, r);
          ctx.clip();
          ctx.globalAlpha = 0.34;
          paintSkin(ctx, skin, px, py, size, size, idx + 1, now);
          ctx.restore();
        }
      } else {
        // 未走：**不做凹坑**。凹坑在 cell≥90 时是一排「碗」，整盘读作一堆洞。
        // 改成「板上浅刻一格」：一条极淡刻线 + 上沿一丝内影。
        // 未走区域几乎融进板里，只有已走的彩色在跳 —— 进度一眼可读。
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

      if (type === CoverCell.ICE) drawIce(ctx, px, py, size, r);
    }
  }
}

/** 冰块：玻璃砖（淡蓝底 + 白色反光斜带 + 2 条裂纹 + 冰蓝描边）。 */
function drawIce(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  r: number,
): void {
  ctx.save();
  roundRect(ctx, x, y, size, size, r);
  ctx.clip();
  ctx.fillStyle = 'rgba(198,228,246,0.70)';
  ctx.fillRect(x, y, size, size);
  // 反光斜带
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.40);
  ctx.lineTo(x + size, y + size * 0.16);
  ctx.lineTo(x + size, y + size * 0.34);
  ctx.lineTo(x, y + size * 0.58);
  ctx.closePath();
  ctx.fill();
  // 裂纹
  ctx.strokeStyle = 'rgba(120,170,205,0.85)';
  ctx.lineWidth = Math.max(1.2, size * 0.030);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * 0.30, y + size * 0.34);
  ctx.lineTo(x + size * 0.52, y + size * 0.50);
  ctx.lineTo(x + size * 0.44, y + size * 0.70);
  ctx.moveTo(x + size * 0.52, y + size * 0.50);
  ctx.lineTo(x + size * 0.74, y + size * 0.45);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(96,150,190,0.65)';
  ctx.lineWidth = Math.max(1.4, size * 0.028);
  roundRect(ctx, x, y, size, size, r);
  ctx.stroke();
}

// ────────────────────────────── 机制筹码 ──────────────────────────────

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
  clayTextNumber(ctx, String(n + 1), cx, cy, r * 1.5);
}

/**
 * 徽章上的数字：直接用 canvas 文字。
 *
 * 不走 `clayText` —— 它默认带描边和凸起投影，在 10px 的徽章上
 * 描边比字还宽，数字会糊成一个白点。
 */
function clayTextNumber(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFF6E9';
  ctx.fillText(text, cx, cy + size * 0.06);
  ctx.restore();
}

/** 方向 → 旋转角。`DIR` 是 0=上 1=下 2=左 3=右，**不是**顺时针序。 */
const DIR_ANGLE = [0, Math.PI, -Math.PI / 2, Math.PI / 2];

/**
 * 画机制筹码（在连线之上、端点之下）。
 *
 * compact 档（cell < 70）**不上编号**：60px 格上徽章只有 5px，等于没有。
 * 改成 HUD 显示「下一个 ★N」。
 */
export function drawCoverMarks(
  ctx: CanvasRenderingContext2D,
  board: CoverBoard,
  layout: BoardLayout,
  state: CoverRenderState,
): void {
  const { cell, originX, originY } = layout;
  const d = densityOf(cell);
  const chipR = cell * (d === 'compact' ? 0.23 : 0.26);
  const withBadge = d !== 'compact';
  const ink = CLAY_UI.ink;

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const idx = y * board.w + x;
      const byte = board.grid[idx];
      const type = cellType(byte);
      if (type === CoverCell.BRICK || type === CoverCell.VOID || type === CoverCell.BLOCK) continue;
      if (type === CoverCell.START || type === CoverCell.END) continue;
      if (type === CoverCell.ICE) continue; // 冰在格子层画，连线要压在它上面

      const group = cellGroup(byte);
      const cx = originX + x * cell + cell / 2;
      const cy = originY + y * cell + cell / 2;

      switch (type) {
        case CoverCell.SHARD: {
          const got = state.shardsGot.has(group);
          // 未收集的下一颗放大 + 点亮：顺序必经是核心规则，
          // 「该收哪一颗」必须在盘面上看得出来（compact 档没有编号，全靠这个）
          const next = !got && state.shardNext === group;
          chip(ctx, cx, cy, chipR * (next ? 1.06 : 1), idx, (r) => {
            clayStar(ctx, 0, 0, r * (next ? 1.1 : 1), got || next ? CLAY.mustard : CLAY.sand, 900 + group, {
              depth: next ? 4 : 2,
              lit: got || next,
            });
          });
          if (withBadge && !got) badge(ctx, cx + chipR * 0.78, cy + chipR * 0.78, chipR * 0.40, group);
          break;
        }
        case CoverCell.ONEWAY: {
          const ang = DIR_ANGLE[cellDir(byte)] ?? 0;
          chip(ctx, cx, cy, chipR * 0.94, idx, (r) => {
            ctx.rotate(ang);
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
          const held = state.keysHeld.has(group);
          chip(
            ctx,
            cx,
            cy,
            chipR,
            idx,
            (r) => {
              ctx.fillStyle = ink;
              ctx.beginPath();
              ctx.arc(-r * 0.32, 0, r * 0.38, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillRect(-r * 0.04, -r * 0.14, r * 1.0, r * 0.28);
              ctx.fillRect(r * 0.60, -r * 0.14, r * 0.15, r * 0.46);
              ctx.fillRect(r * 0.30, -r * 0.14, r * 0.14, r * 0.36);
            },
            held ? CLAY.mint : CHIP,
          );
          break;
        }
        case CoverCell.GATE: {
          const locked = !state.keysHeld.has(group);
          // 底盘固定纸白，**锁本身**染色表示开合 ——
          // 之前底盘和锁同色，锁体整个消失在底盘里，只剩锁梁一道弧
          chip(ctx, cx, cy, chipR, idx, () => {}, CHIP);
          // `clayLock` 的第三参是**缩放系数**（锁体基准宽 24px），不是尺寸 ——
          // 直接传 chipR 会得到一把 24×18 倍大的锁，糊满整个屏幕
          clayLock(ctx, cx, cy + chipR * 0.06, chipR / 21, locked ? CLAY.rose : CLAY.mint);
          break;
        }
        case CoverCell.PORTAL: {
          // 入口实环 / 出口虚环（设计稿 `MARKS['portal-a'] / ['portal-b']`）。
          //
          // ## 为什么要分实虚
          //
          // 传送门的线**不在盘上连过去**：线在入口中心断掉、在出口中心重新出现。
          // 那么"谁进谁出"就必须由格子自己说清楚 —— 否则玩家只看到两段断线，
          // 不知道它们是一条路。实环 = 钻进去，虚环 = 冒出来，这个区分不需要图例。
          //
          // ## 为什么去掉数字徽章
          //
          // 编号徽章是给**星屑**用的（顺序必经：第 1 颗、第 2 颗……）。
          // 传送门不参与排序，两个格子却都标 `1`（同组号），
          // 读起来像"这两格都是第 1 个"，是纯粹的错误信息。
          const isEntrance = portalEntrance(board.grid, group) === idx;
          const tint = group % 2 === 0 ? CLAY.blue : CLAY.terracotta;
          chip(ctx, cx, cy, chipR * 0.96, idx, (r) => {
            // 外环：入口实、出口虚。
            //
            // 虚线的**段长必须按半径算**，不能写死比例然后乘小值 ——
            // 第一版用 `r*0.34 / r*0.26`，在小格上节奏变成 6px 一段、
            // 5px 一空，绕一圈 9 段，缩略图里读作"一圈噪点"而不是虚线。
            // 现在段长的下限跟半径挂钩，小格上会自然变成 6~7 段长划。
            const dash = Math.max(3, r * 0.52);
            const gap = Math.max(2.4, r * 0.42);
            ctx.strokeStyle = tint.shade;
            ctx.lineWidth = Math.max(2, r * 0.30);
            if (!isEntrance) ctx.setLineDash([dash, gap]);
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // 内环：两态都画成实线（只差粗细色阶）。
            // 设计稿里内环也是虚的，但在 chip 这个尺寸上再叠一圈虚线，
            // 两圈虚线会互相穿插成一团麻 —— 入口/出口的区分交给外环和芯点就够了。
            ctx.strokeStyle = tint.base;
            ctx.lineWidth = Math.max(1.5, r * (isEntrance ? 0.18 : 0.14));
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.50, 0, Math.PI * 2);
            ctx.stroke();

            // 芯点：只有入口有。线正是从这个点钻进去的。
            if (isEntrance) {
              ctx.fillStyle = tint.base;
              ctx.beginPath();
              ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
              ctx.fill();
            }
          });
          break;
        }
        default:
          break;
      }
    }
  }
}

// ────────────────────────────── 当前格 / 提示 ──────────────────────────────

/**
 * 当前格白环 + 提示高亮。
 *
 * 必须在连线**之后**调用：先画会被线盖掉。
 * 旧实现在 `drawCoverCell` 里跟着格子一起画，连线横穿时高亮就断了。
 */
export function drawCoverHead(
  ctx: CanvasRenderingContext2D,
  board: CoverBoard,
  layout: BoardLayout,
  state: CoverRenderState,
  now: number,
): void {
  const { cell, originX, originY } = layout;
  const { gap, size } = cellGeom(layout);
  const r = Math.max(3, size * 0.20);
  const rectOf = (idx: number) => ({
    x: originX + (idx % board.w) * cell + gap,
    y: originY + Math.floor(idx / board.w) * cell + gap,
  });

  // 提示路线：窗口内最多 HINT_WINDOW 格，由近到远渐弱
  //
  // 最近的一格 = 下一步，必须一眼看到：更亮、更粗、带一层底色。
  // 往后依次递减，形成一条由亮到暗的箭头 —— 玩家顺着最亮的那头走就行。
  //
  // 递减不只是好看：它本身就是方向信息。
  // 五个一样亮的环只会被读成「这五格随便点一个」。
  if (state.hint) {
    const plan = state.hint;

    // 第一遍只算「每一格此刻亮到什么程度、在哪」，
    // 派生两件事：错峰点亮的进度、沿窗口流动的呼吸相位。
    const vis: Array<{ x: number; y: number; a: number; f: number }> = [];
    for (let k = 0; k < HINT_WINDOW; k++) {
      const i = plan.at + k;
      if (i >= plan.cells.length) break;

      // 错峰点亮：litAt 是绝对时刻，还没到点就算「还没轮到它」
      const litAt = plan.litAt[i];
      if (!litAt) break;
      const appear = Math.min(1, Math.max(0, (now - litAt) / 170));
      if (appear <= 0) break;

      const wave = 0.5 + 0.5 * Math.sin(now / 300 - k * 0.9);
      const base = HINT_ALPHA[k] ?? 0.4;
      const amp = k === 0 ? 0.3 : 0.12;
      const { x, y } = rectOf(plan.cells[i]);
      vis.push({ x, y, a: appear * base * (1 - amp + amp * wave), f: appear * (0.85 + 0.15 * wave) });
    }

    // 曾经在这里试过一条连接窗口各格的虚线（「实线是走过的、虚线是没走的」）。
    // 实拍否掉了：一格一段的距离配上虚线间隙，2× 放大后是一堆零碎短横，
    // 既没有连成路的形态，又把环和底色衬得更乱。
    // 顺序感交给「底色带由近到远变淡 + 环由近到远变细」就够了。

    ctx.save();
    for (let k = 0; k < vis.length; k++) {
      const { x, y, a: alpha, f: fillFactor } = vis[k];
      // 底色：整格铺一层暖白，五格连成一条带子。
      //
      // 用暖白而不是金色：蓝灰格上叠金会变成脏绿，
      // 暖白只会把它「提亮 + 变暖」，无论底下是空格、冰格还是已走的青格都读得出来。
      const fillA = (HINT_FILL[k] ?? 0.1) * fillFactor;
      if (fillA > 0.01) {
        ctx.fillStyle = `rgba(255,236,186,${fillA.toFixed(3)})`;
        roundRect(ctx, x + 1.5, y + 1.5, size - 3, size - 3, r);
        ctx.fill();
      }
      // 描边：近处亮金、远处深琥珀；粗细同步递减，「远」靠变细表达
      ctx.strokeStyle =
        k === 0
          ? `rgba(255,206,64,${alpha.toFixed(3)})`
          : `rgba(196,128,36,${alpha.toFixed(3)})`;
      ctx.lineWidth =
        k === 0
          ? Math.max(4, size * 0.115)
          : Math.max(2.5, size * (0.085 - k * 0.009));
      roundRect(ctx, x + 1.5, y + 1.5, size - 3, size - 3, r);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 当前格：白环。这是盘面上**唯一**告诉玩家「你在这」的标记 ——
  // 旧版没有，玩家只能靠线头猜自己走到哪了。
  const head = state.path.length > 0 ? state.path[state.path.length - 1] : -1;
  if (head < 0) return;
  const { x, y } = rectOf(head);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,251,243,0.92)';
  ctx.lineWidth = Math.max(2.5, Math.min(4, size * 0.06));
  roundRect(ctx, x + 1.5, y + 1.5, size - 3, size - 3, r);
  ctx.stroke();
  ctx.restore();
}

// ────────────────────────────── 起点自由提示 ──────────────────────────────

/**
 * D=0 关卡（起终点都自由）开局时的提示。
 *
 * 这类关卡盘面上**没有任何锚点**：没有起终点圆片、没有线头，
 * 第一次遇到会不知道从哪下手。补一行小字，放在桌面空位更大的一侧。
 *
 * 两侧都塞不下（11×11 撑满可用区）就不画 —— 宁可没有提示，
 * 也不能让字压在板上。
 */
export function drawCoverFreeStartHint(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  /** 文字色；不传 = 黏土墨色。深色主题必须传，否则这行字直接消失 */
  ink?: string,
): void {
  const { cell, originY, boardH } = layout;
  const pad = Math.max(3, cell * 0.06);
  const R = Math.max(6, cell * 0.22);
  const plateTop = originY - pad - R;
  const plateBottom = originY + boardH + pad + R + Math.max(5, cell * 0.1);
  const above = plateTop - BOARD_TOP;
  const below = BOARD_BOTTOM - plateBottom;

  let y = -1;
  if (above >= 64 && above >= below) y = plateTop - 34;
  else if (below >= 64) y = plateBottom + 46;
  if (y < 0) return;

  clayText(ctx, '起点自由 · 任意格都能起手', DESIGN_W / 2, y, 24, {
    fill: ink ?? CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
}

// ────────────────────────────── 端点 ──────────────────────────────
/**
 * 叠画起点 / 终点糖果圆片。
 *
 * 必须**在连线之后**调用：连线从格心出发，圆片后画才能盖住线头。
 * 起终点用**符号**区分（三角 = 从这里出发，方框 = 到这里收），
 * 不只靠薄荷 / 玫红两色 —— 色弱玩家与缩略图上色相会失效。
 */
export function drawCoverEndpoints(
  ctx: CanvasRenderingContext2D,
  board: CoverBoard,
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
        ctx.beginPath();
        ctx.moveTo(cx + cell * 0.07, cy - cell * 0.09);
        ctx.lineTo(cx + cell * 0.07, cy + cell * 0.09);
        ctx.lineTo(cx - cell * 0.07, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.lineWidth = Math.max(2, cell * 0.045);
        roundRect(ctx, cx - cell * 0.075, cy - cell * 0.075, cell * 0.15, cell * 0.15, cell * 0.03);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
