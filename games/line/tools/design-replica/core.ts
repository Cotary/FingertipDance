/**
 * 出图核心 —— 40 文档 S4 前置：让「游戏侧」按 manifest 口径出图。
 *
 * ## 走过的弯路（记录一下，避免下次重犯）
 *
 * **第一版**：直接调 `theme.board()`，得到一颗棋子 + 背后一整块深色展柜底板。
 * 原因：`composeTheme` 的 board() 是「plate(整块展柜) → 逐格」的完整流程，
 * 而设计稿的 `.pc.pale` 元素**没有底板**（它就是一颗棋子）。
 *
 * **第二版（失败）**：造 8×8 大盘把目标格挪到视口外。行不通 ——
 * 底板是绝对坐标 `cardOf(layout)`（固定在 x∈[44,706]），
 * 而目标格必须在盘内，两者无法分离。
 *
 * **最终做法**：正常调 board()，但在外面套一层 **clip 到目标格槽位**。
 * 底板照画（画完被裁掉），只留一颗棋子。
 * 零侵入生产代码，且以后主题怎么改都不影响这个工具。
 *
 * ## 为什么不顺便裁掉「相邻格」
 *
 * 因为只放了一颗棋子（其余是 VOID），本来就没有邻居。
 * clip 只用来挡底板和盘沿。
 */

import { CoverCell, DIR, type CoverCellType, type Dir } from '../../src/core/cover/v3/types';
import { computeLayout, BOARD_GAP } from '../../src/render/layout';
import { themeById } from '../../src/render/themes';
import type { ThemeState } from '../../src/render/themes/types';

export interface CellSpec {
  id: string;
  cell: CoverCellType;
  dir?: Dir;
  group?: number;
  covered?: boolean;
  isPath?: boolean;
  isPress?: boolean;
  isHint?: boolean;
  note: string;
}

/**
 * 单格状态清单 —— 必须与 40 文档 S1 的 TARGETS 一一对应。
 *
 * 注意「状态空间由玩法决定，不由主题决定」：两套主题共用这一份清单，
 * 换主题只换皮肤，不换有哪些状态。
 */
export const CELL_SPECS: CellSpec[] = [
  { id: 'tile.pale', cell: CoverCell.BRICK, note: '未铺 · 普通格' },
  { id: 'tile.deep', cell: CoverCell.BRICK, covered: true, note: '已铺 · 普通格' },
  { id: 'tile.stone', cell: CoverCell.BLOCK, note: '石障' },
  { id: 'tile.frost', cell: CoverCell.ICE, note: '冰砖' },
  { id: 'tile.pale.start', cell: CoverCell.START, note: '起点' },
  { id: 'tile.pale.end', cell: CoverCell.END, note: '终点' },
  { id: 'tile.pale.trail', cell: CoverCell.BRICK, isPath: true, covered: true, note: '路径块' },
  { id: 'tile.pale.pressed', cell: CoverCell.BRICK, isPress: true, note: '按下' },
  { id: 'tile.pale.oneway', cell: CoverCell.ONEWAY, dir: DIR.RIGHT, note: '单向门 · 朝右' },
  { id: 'tile.pale.key', cell: CoverCell.KEY, group: 1, note: '钥匙' },
  { id: 'tile.pale.door', cell: CoverCell.GATE, group: 1, note: '门 · 闭' },
  { id: 'tile.pale.portalA', cell: CoverCell.PORTAL, group: 1, note: '传送门 · 入' },
  { id: 'tile.pale.portalB', cell: CoverCell.PORTAL, group: 2, note: '传送门 · 出' },
  /**
   * 星屑：`group` 决定画一/二/三阶（`starVariant`：0→star, 1→star2, 2→star3）。
   *
   * 设计稿的格态卡用的是 `makePC('deep star', ...)` ——
   * 那是**单星**（`MARKS.star1 = sparkAt(12,12,1.05)`），
   * 所以基线图里是**一颗**星。这里必须传 `group: 0`，
   * 传 1 会画成双星、传 2 是三星，都会跟基线对不上。
   *
   * （早先写的 `group: 1`，出图是双星，跟设计稿的单星差了整整一个数量级 ——
   *  靠肉眼看"都有星"很难察觉，是并排图才看出来的。）
   */
  { id: 'tile.deep.star', cell: CoverCell.SHARD, group: 0, covered: true, note: '星屑 · 一阶（单星）' },
  { id: 'tile.pale.arrive', cell: CoverCell.END, covered: true, isPath: true, note: '抵达' },
  { id: 'tile.pale.hintcell', cell: CoverCell.BRICK, isHint: true, note: '提示高亮' },
];

export function pickSpec(id: string | null): CellSpec | undefined {
  return id ? CELL_SPECS.find((s) => s.id === id) : undefined;
}

/** cover v3 字节编码：(type << 4) | (dir << 2) | group */
export function encodeCell(type: number, dir = 0, group = 0): number {
  return (type << 4) | (dir << 2) | (group & 3);
}

/**
 * 用 8×8 盘而不是 1×1。
 *
 * 因为 `computeLayout` 的 cell 是按格数算的：1×1 会把格子撑到 594，
 * 与真实关卡的 70 完全不同 —— 尺寸对不上，后面所有比对都失去意义。
 * 8×8 是真实关卡最常见的规模，cell=70，棋子 56。
 */
/**
 * 盘格数。用 8×8 而不是 1×1：
 * `computeLayout` 的 cell 按格数算，1×1 会把格子撑到 594，与真实关卡（76）差太远，
 * 所有立体量（侧壁、阴影）都会按 594 的比例放大，出图完全对不上。
 */
const BOARD_N = 8;

/**
 * 目标格在盘里的位置。
 *
 * ## 为什么是 (0,0) 而不是中间格
 *
 * 格内纹样由 `motifOf(gx, gy) = NINE[(gx*2 + gy*3) % 9]` 轮换决定。
 * 设计稿的格态卡里**恒用 moon**（`NINE[0]`），所以要挑一个
 * `(gx*2 + gy*3) % 9 === 0` 的坐标 —— (0,0) 就是。
 *
 * 之前用 (3,3)：(6+9)%9 = 6，画出来是第六品纹样，
 * 与设计稿的月亮完全不同 —— 那一项 16 的偏差全是这个造成的。
 *
 * 放在 (0,0) 的代价：靠盘沿，底板和盘沿的绘制会进入这个区域。
 * 但我们有 `cellsOnly` 跳过底板，且 clip 只留一格，所以无影响。
 */
const TARGET_GX = 0;
const TARGET_GY = 0;

export interface ShootResult {
  dataUrl: string;
  /** 逻辑尺寸（含外扩） */
  logical: { w: number; h: number };
  /** 棋子边长（设计坐标系） */
  pieceSize: number;
  /** 槽位边长 */
  cell: number;
}

/**
 * 画一颗棋子。
 *
 * ## 为什么要传 targetW / pad，而不是自己算
 *
 * 设计稿里同一个概念的元素在不同章节尺寸不同：
 * `.pc.pale` 在图标章节是 64px，`.pc.pale.pressed` 是 70.4px（放大态）。
 * 出图台如果固定按 62 画，**第一道闸门就报「尺寸不一致」**，永远比不了。
 *
 * 所以尺寸和 pad 必须**从 baseline 的 manifest 读取**，与基线严格同源。
 * 这就是 40 文档说的「按 manifest 的 clip 口径出图」。
 *
 * @param targetW 内容区逻辑边长（= 设计稿该元素的 box 宽度）
 * @param pad     外扩量（= baseline 的 calcPad 结果）
 * @param now     时刻；0 = 静止（避免动画相位随机导致每次出图不同）
 */
export function shootCell(
  canvas: HTMLCanvasElement,
  themeId: string,
  spec: CellSpec,
  targetW: number,
  pad: number,
  now = 0,
): ShootResult {
  const theme = themeById(themeId);
  if (!theme) throw new Error(`未知主题：${themeId}`);

  const layout = computeLayout(BOARD_N, BOARD_N);
  /**
   * 棋子边长 —— 必须与主题内部算法完全一致。
   *
   * 主题里（`mise.ts drawCell`）：
   *   inset = BOARD_GAP / 2        （= 7）
   *   s     = cell - inset * 2     （= 76 - 14 = 62）
   *
   * 之前写成 `cell - BOARD_GAP`，看着像一回事，其实：
   *   cell - 14 = 62  ✓ 数值一样，但**八格盘的 cell 是 76 不是 70**，
   *   所以真正的错在别处 —— 见下方 k 的计算注释。
   */
  const inset = BOARD_GAP / 2;
  const pieceSize = layout.cell - inset * 2;
  // 把棋子的自然尺寸缩放到设计稿的 targetW
  const k = targetW / pieceSize;

  const logicalW = targetW + pad * 2;

  const DPR = 3;
  /**
   * 尺寸取整必须与 baseline 的截图口径**完全一致**。
   *
   * baseline 用 `screenshot({ clip })` 截，clip 的 width/height 是浮点
   * （如 70.4 + 85*2 = 240.4），Chromium 按四舍五入落到整数物理像素。
   * 出图台若自己 `round(logical*3)` 会得到 721 而基线是 720 —— 差 1px，
   * 闸门直接判「尺寸不一致」，后面全白比。
   *
   * 所以先按 clip 的逻辑宽高取整，再乘 DPR。
   */
  const wLogical = Math.round(logicalW);
  canvas.width = Math.round(wLogical * DPR);
  canvas.height = Math.round(wLogical * DPR);
  canvas.style.width = `${wLogical}px`;
  canvas.style.height = `${wLogical}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('拿不到 2d 上下文');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(DPR * k, DPR * k);

  // 目标格「槽位」左上角（设计坐标）
  const slotX = layout.originX + TARGET_GX * layout.cell;
  const slotY = layout.originY + TARGET_GY * layout.cell;

  // ⚠️ 顺序很要紧：**先 translate 再 clip**。
  //
  // clip 的坐标会被当前变换矩阵作用。如果先 clip 再 translate，
  // 裁切矩形会停留在画布原点附近的绝对坐标上（slotX≈272），
  // 而画布只有 186 宽 —— 整块裁切跑到画布外，结果是什么都画不出来
  // （实测：只看到中心一个绿点）。
  //
  // ## 锚点：槽位的**中心**对到画布中心
  //
  // 早先按"槽位左上角 → (pad, pad)"对齐，实测偏了 44px。
  // 原因：设计稿的元素框（.pc）是**居中等比**的，而槽位比棋子大 14px，
  // 左上角对齐会让棋子在框内偏右下。
  //
  // 正确做法：把**棋子中心**放在画布的正中（= pad + targetW/2）。
  const cxDesign = slotX + layout.cell / 2;
  const cyDesign = slotY + layout.cell / 2;
  // padDesign：pad 是逻辑像素，除以 k 换回设计单位
  const padDesign = pad / k;
  const centerOnCanvas = padDesign + targetW / 2 / k;
  ctx.translate(centerOnCanvas - cxDesign, centerOnCanvas - cyDesign);

  // 裁到「棋子 + 阴影」，把整块展柜底板挡在外面。
  //
  // ⚠️ 两个数字的含义必须分清：
  //   - 槽位（layout.cell = 76）只比棋子（62）大 14，
  //     而阴影 sprite 的 pad 是 `ceil(s * 0.72)` = 45 —— **远超槽位**。
  //   - 所以裁切半径必须按「棋子 + 45」算，不能按槽位算，
  //     否则投影会被斜切掉一圈（实测：包围盒 260 → 232，差 11%）。
  //
  // 上限：pad（manifest 的外扩）本身就是"内容 + 阴影"的总量，
  // 所以 max(阴影, pad) 一定够，同时不会露出底板。
  const pieceHalf = pieceSize / 2;
  const shadowPad = pieceSize * 0.72;
  const half = Math.max(pieceHalf + shadowPad, layout.cell);
  ctx.beginPath();
  ctx.rect(cxDesign - half, cyDesign - half, half * 2, half * 2);
  ctx.clip();

  const grid = new Uint8Array(BOARD_N * BOARD_N);
  const idx = TARGET_GY * BOARD_N + TARGET_GX;
  grid[idx] = encodeCell(spec.cell, spec.dir ?? 0, spec.group ?? 0);

  const state: ThemeState = {
    covered: new Set(spec.covered ? [idx] : []),
    path: spec.isPath ? [idx] : [],
    keysHeld: new Set(),
    shardsGot: new Set(),
    shardNext: -1,
  };
  if (spec.isHint) state.hint = [idx];
  if (spec.isPress) {
    state.pressCell = idx;
    state.pressAt = now;
  }

  theme.board({
    ctx,
    board: { w: BOARD_N, h: BOARD_N, grid },
    layout,
    state,
    now,
    dpr: DPR * k,
    // 跳过展柜底板 —— 设计稿的单格元素没有底板
    cellsOnly: true,
  });

  ctx.restore();

  return {
    dataUrl: canvas.toDataURL('image/png'),
    logical: { w: logicalW, h: logicalW },
    pieceSize,
    cell: layout.cell,
  };
}
