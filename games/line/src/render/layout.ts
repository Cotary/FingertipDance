/** 设计分辨率。 */
export const DESIGN_W = 750;
export const DESIGN_H = 1334;

/**
 * 棋盘卡片（展柜）的几何。
 *
 * 2026-11-16 按设计稿 03 屏重定：卡片是**满栏的展柜**（331 CSS → 662），
 * 内边距 17 CSS → 34，格间距 7 CSS → 14，格 31 CSS → 62。
 * 8×8 时正好是 8×62 + 7×14 = 594 的内区 + 34×2 的门框 = 662 的正方形，
 * 也就是说卡片的宽高相等 —— 这是「展柜」而不是「一条横板」的关键。
 *
 * 为什么不再用「按可用区取最大格」的老算法：那会让 7×7 的盘把格子撑到
 * 96px、8×8 撑到 83px，同一个游戏在不同关卡里棋子大小不一样，
 * 换关时整块盘会跳一下。设计稿给的是**固定的器型**，格子数变、器物不变。
 */
export const BOARD_CARD_X = 44;
export const BOARD_CARD_W = 662;
/** 卡内边（设计稿 padding 16 + border 1 ≈ 17 CSS） */
export const BOARD_PAD = 34;
/** 格间距（设计稿 7 CSS） */
export const BOARD_GAP = 14;
/** 卡片顶（设计稿 129 CSS，减 36 状态栏 ×2） */
export const BOARD_TOP = 186;

/** 老常量：黏土管线用它算「盘面上下还剩多少空」。保留，值跟随新卡片。 */
export const BOARD_BOTTOM = BOARD_TOP + BOARD_CARD_W;
export const BOARD_SIDE = BOARD_CARD_X;

/** 棋盘布局信息。 */
export interface BoardLayout {
  /**
   * 格子的**槽位**边长（设计坐标系）。
   *
   * 注意不是棋子边长：槽位里还含一格间距，主题自己内缩 gap/2 画棋子。
   * 输入命中测试也按槽位算（见 `session.pick`），所以两者必须同源。
   */
  cell: number;
  /** 棋盘左上角（第一格槽位的左上角，设计坐标系） */
  originX: number;
  originY: number;
  /** 棋子群的实际外接宽高（不含首尾的半格间距） */
  boardW: number;
  boardH: number;
}

/**
 * 根据棋盘尺寸计算布局。
 *
 * 卡片宽度固定，格子数越多格子越小；**两个方向都要看**。
 *
 * 真实的盘不是正方形：无尽模式的关卡是 5×6（宽 5、高 6）。只按宽度定格子
 * （`(inner+gap)/w`）会让 5×6 的盘算出 121 的格子、整块盘高 712，
 * 直接顶出 662 的卡片 —— 顶点会被卡片上沿切掉，下发按钮压在盘上。
 * 取两向的较小值，棋盘才永远在自己的门框里。
 */
export function computeLayout(w: number, h: number): BoardLayout {
  const inner = BOARD_CARD_W - BOARD_PAD * 2;
  // 槽位 = (内区 + 一个间距) / 格数：这样 n 个槽位减去末尾的一格间距正好铺满内区
  const cell = Math.floor(Math.min((inner + BOARD_GAP) / w, (inner + BOARD_GAP) / h));
  const boardW = cell * w - BOARD_GAP;
  const boardH = cell * h - BOARD_GAP;
  return {
    cell,
    // 首格槽位向左让出半格间距，棋子群（而非槽位群）才真正居中
    originX: Math.round((DESIGN_W - boardW) / 2 - BOARD_GAP / 2),
    // 纵向同理：槽位里含半格间距，棋子从「槽位顶 + gap/2」开始画，
    // 所以槽位顶要**先抬半个间距**，棋子群的上沿才落在门框内边线上。
    // 少了这 7px，整盘棋子会比设计稿低半格缝 —— 卡片看起来"偏右下"就是这个
    originY: BOARD_TOP + BOARD_PAD - BOARD_GAP / 2 + Math.round((inner - boardH) / 2),
    boardW,
    boardH,
  };
}

/** 棋盘卡片（展柜）在设计坐标系里的矩形 —— 主题画底板用。 */
export function cardOf(layout: BoardLayout): { x: number; y: number; w: number; h: number } {
  // 高度 = 内区 + 上下门框，但**不小于正方形**：
  // 5×6 的盘高 592、8×8 的高 594，卡片都在 654~662 之间，
  // 换关时整块展柜不会跳一下。宽度永远是满栏 662。
  return {
    x: BOARD_CARD_X,
    y: BOARD_TOP,
    w: BOARD_CARD_W,
    h: Math.max(layout.boardH + BOARD_PAD * 2, BOARD_CARD_W),
  };
}

/** 把设计坐标系的点转成画布像素坐标。 */
export function toCanvas(scale: number, offsetX: number, offsetY: number, x: number, y: number): { x: number; y: number } {
  return { x: x * scale + offsetX, y: y * scale + offsetY };
}
