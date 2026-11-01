/** 设计分辨率。 */
export const DESIGN_W = 750;
export const DESIGN_H = 1334;

/** 棋盘区域在设计坐标系里的边界。 */
export const BOARD_TOP = 220;
export const BOARD_BOTTOM = 1000;
export const BOARD_SIDE = 40;

/** 棋盘布局信息。 */
export interface BoardLayout {
  /** 每格像素尺寸（设计坐标系） */
  cell: number;
  /** 棋盘左上角（设计坐标系） */
  originX: number;
  originY: number;
  /** 棋盘宽高（设计坐标系） */
  boardW: number;
  boardH: number;
}

/**
 * 根据棋盘尺寸计算布局。
 */
export function computeLayout(w: number, h: number): BoardLayout {
  const maxW = DESIGN_W - BOARD_SIDE * 2;
  const maxH = BOARD_BOTTOM - BOARD_TOP;
  const cell = Math.floor(Math.min(maxW / w, maxH / h));
  const boardW = cell * w;
  const boardH = cell * h;
  return {
    cell,
    originX: Math.round((DESIGN_W - boardW) / 2),
    originY: Math.round(BOARD_TOP + (maxH - boardH) / 2),
    boardW,
    boardH,
  };
}

/** 把设计坐标系的点转成画布像素坐标。 */
export function toCanvas(scale: number, offsetX: number, offsetY: number, x: number, y: number): { x: number; y: number } {
  return { x: x * scale + offsetX, y: y * scale + offsetY };
}
