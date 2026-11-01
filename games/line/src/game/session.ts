import type { LevelData } from '../core/levelTable';
import { createState, findStart, tryMove, release, type GameState } from './state';
import { computeLayout, type BoardLayout } from '../render/layout';

export type SessionListener = (e: SessionEvent) => void;

export type SessionEvent =
  | { type: 'level_loaded'; level: LevelData }
  | { type: 'moved'; idx: number }
  | { type: 'break' }
  | { type: 'blocked' }
  | { type: 'won'; steps: number; timeMs: number; path: number[] }
  | { type: 'abandoned' };

/**
 * 关卡会话。管理当前关卡的状态、输入与事件广播。
 */
export class Session {
  state: GameState | null = null;
  layout: BoardLayout | null = null;

  private listeners: SessionListener[] = [];
  private dragging = false;

  /** 订阅事件。 */
  on(fn: SessionListener): void {
    this.listeners.push(fn);
  }

  /** 广播事件。 */
  private emit(e: SessionEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** 载入关卡。 */
  load(level: LevelData): void {
    this.state = createState(level);
    this.layout = computeLayout(level.w, level.h);
    this.dragging = false;
    this.emit({ type: 'level_loaded', level });
  }

  /** 按下。 */
  pointerDown(x: number, y: number): void {
    if (!this.state || this.state.phase !== 'idle') return;
    const idx = this.pick(x, y);
    if (idx !== findStart(this.state.level)) return;
    this.state.phase = 'dragging';
    this.state.path = [idx];
    this.state.lit.add(idx);
    this.dragging = true;
  }

  /** 移动。 */
  pointerMove(x: number, y: number): void {
    if (!this.state || !this.dragging) return;
    const idx = this.pick(x, y);
    if (idx < 0) return;
    const r = tryMove(this.state, idx);
    if (r === 'moved') this.emit({ type: 'moved', idx });
    else if (r === 'break') { this.emit({ type: 'break' }); this.dragging = false; }
    else if (r === 'blocked') this.emit({ type: 'blocked' });
  }

  /** 松手。 */
  pointerUp(): void {
    if (!this.state || !this.dragging) return;
    this.dragging = false;
    const won = release(this.state);
    if (won && this.state) {
      this.emit({
        type: 'won',
        steps: this.state.path.length - 1,
        timeMs: Date.now() - this.state.startAt,
        path: this.state.path.slice(),
      });
    }
  }

  /** 提示高亮。 */
  setHint(cells: number[]): void {
    if (!this.state) return;
    this.state.hint = new Set(cells);
    this.state.hintUsed++;
  }

  /** 标记为跳过通关。 */
  markSkipped(): void {
    if (!this.state) return;
    this.state.skipped = true;
    this.state.phase = 'won';
  }

  /** 放弃当前关卡（退出游戏时调用）。 */
  abandon(): void {
    if (!this.state || this.state.phase === 'won') return;
    this.emit({ type: 'abandoned' });
  }

  /** 设计坐标 → 格子索引。 */
  private pick(x: number, y: number): number {
    if (!this.state || !this.layout) return -1;
    const { cell, originX, originY } = this.layout;
    const cx = Math.floor((x - originX) / cell);
    const cy = Math.floor((y - originY) / cell);
    if (cx < 0 || cy < 0 || cx >= this.state.level.w || cy >= this.state.level.h) return -1;
    return cy * this.state.level.w + cx;
  }
}
