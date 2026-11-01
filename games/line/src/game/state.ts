import { CellType, type Level } from '../core/types';
import { idxOf, canEnter } from '../core/grid';

export type Phase = 'idle' | 'dragging' | 'won' | 'lost';

/** 关内状态。 */
export interface GameState {
  level: Level;
  phase: Phase;
  /** 当前路径（格子索引序列） */
  path: number[];
  /** 已点亮的格子 */
  lit: Set<number>;
  /** 提示高亮 */
  hint: Set<number>;
  /** 断线抖动的格子 */
  shakeCell: number;
  /** 断线时间戳 */
  shakeAt: number;
  /** 本关开始时间 */
  startAt: number;
  /** 已用提示次数 */
  hintUsed: number;
  /** 是否被跳过 */
  skipped: boolean;
}

/** 创建初始状态。 */
export function createState(level: Level): GameState {
  return {
    level,
    phase: 'idle',
    path: [],
    lit: new Set(),
    hint: new Set(),
    shakeCell: -1,
    shakeAt: 0,
    startAt: Date.now(),
    hintUsed: 0,
    skipped: false,
  };
}

/** 找到起点索引。 */
export function findStart(level: Level): number {
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      if (level.grid[y][x].type === CellType.START) return idxOf(x, y, level.w);
    }
  }
  return -1;
}

/**
 * 尝试移动到指定格子。
 * @returns 'moved' | 'break' | 'blocked' | 'same'
 */
export function tryMove(state: GameState, targetIdx: number): 'moved' | 'break' | 'blocked' | 'same' {
  if (state.phase !== 'dragging') return 'blocked';
  if (state.path.length === 0) return 'blocked';

  const last = state.path[state.path.length - 1];
  if (targetIdx === last) return 'same';

  const w = state.level.w;
  const lx = last % w, ly = Math.floor(last / w);
  const tx = targetIdx % w, ty = Math.floor(targetIdx / w);
  const dx = tx - lx, dy = ty - ly;

  // 非相邻 → 断线：只回退一格，玩家可继续拖动（GDD 3.2）
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    if (state.path.length > 1) {
      const popped = state.path.pop();
      if (popped !== undefined) state.lit.delete(popped);
    }
    state.shakeCell = last;
    state.shakeAt = Date.now();
    return 'break'; // phase 仍为 dragging，玩家可继续
  }

  // 目标不可进入
  const enterDir = dirOf(dx, dy);
  if (!canEnter(state.level.grid, targetIdx, enterDir)) return 'blocked';

  state.path.push(targetIdx);
  state.lit.add(targetIdx);
  return 'moved';
}

/** 由坐标差求方向。 */
export function dirOf(dx: number, dy: number): 0 | 1 | 2 | 3 {
  if (dy === -1) return 0;
  if (dy === 1) return 1;
  if (dx === -1) return 2;
  return 3;
}

/** 松手：判断是否通关。 */
export function release(state: GameState): boolean {
  if (state.phase !== 'dragging') return false;
  state.phase = 'idle';
  const last = state.path[state.path.length - 1];
  if (last === undefined) return false;
  const cell = state.level.grid[Math.floor(last / state.level.w)][last % state.level.w];
  if (cell.type === CellType.END) {
    state.phase = 'won';
    return true;
  }
  // 没到终点 → 本段作废
  state.path = [];
  state.lit.clear();
  return false;
}
