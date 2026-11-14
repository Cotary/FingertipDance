/**
 * Cover 模式 v3：关卡会话（游戏循环封装）。
 *
 * 与经典模式的 `Session` 结构一致（都是「事件广播 + 输入分发」），
 * 但内部状态是 cover 专属的（`CoverState`），判定逻辑在 `coverState.ts`。
 *
 * ## 指针采样
 *
 * 手指移动时，指针位置对应一个格（`pick`）。
 * cover 模式下有三个额外处理：
 *
 * 1. **起点自由**：任何可走格都能起步（钉死时只有指定格）。
 * 2. **快拖补齐**：手指甩得快 → 采样跳过中间的格 →
 *    `coverState.tryCoverMove` 里的 `autoFill` 自动补齐。
 * 3. **松手不立即作废**：玩家可能只是抬手看效果。
 *    松手后进入 `paused`，路径保留 `GRACE_MS`；
 *    这段时间内按回线头可以接着拖，超时才真正作废（`undos + 1`）。
 *    触屏上误抬手的概率极高，而一次误抬就丢一颗星 —— 体感上是「莫名其妙被扣星」。
 */
import { computeLayout, type BoardLayout } from '../render/layout';
import {
  beginCoverDrag,
  createCoverState,
  failCover,
  isCoverSolved,
  resetPath,
  resumeCover,
  setHintPlan,
  tryCoverMove,
  undoCoverStep,
  coveredCount,
  type CoverState,
} from './coverState';
import type { CoverRuntime } from './coverLevel';

/**
 * 松手后的宽限时长（毫秒）。
 *
 * 1.5 秒：足够发现「哎还没完」并按回线上，又不至于让玩家以为松手后可以一直停着。
 * 太短（<800ms）来不及反应；太长（>3s）玩家会以为游戏卡住了。
 */
export const GRACE_MS = 1500;

/** 会话事件。 */
export type CoverSessionEvent =
  | { type: 'level_loaded'; runtime: CoverRuntime }
  | { type: 'moved'; idx: number; consumed: number }
  | { type: 'backtracked'; idx: number }
  | { type: 'break' }
  | { type: 'blocked' }
  | { type: 'undo' }
  | { type: 'won'; steps: number; timeMs: number; path: number[]; undos: number }
  /** 松手未通关 → 进入宽限期（路径还在） */
  | { type: 'paused'; remainMs: number }
  /** 宽限期内按回线头 → 继续拖 */
  | { type: 'resumed' }
  /** 宽限期结束 → 这一段作废 */
  | { type: 'expired'; steps: number }
  | { type: 'abandoned' };

/** cover 关卡会话。 */
export class CoverSession {
  state: CoverState | null = null;
  layout: BoardLayout | null = null;

  private listeners: Array<(e: CoverSessionEvent) => void> = [];
  private dragging = false;
  /** 宽限期截止时刻（`Date.now()` 基准）；0 = 不在宽限期 */
  private graceUntil = 0;

  /** 订阅事件。 */
  on(fn: (e: CoverSessionEvent) => void): void {
    this.listeners.push(fn);
  }

  /** 广播事件。 */
  private emit(e: CoverSessionEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** 载入关卡。 */
  load(runtime: CoverRuntime): void {
    this.state = createCoverState(runtime);
    this.layout = computeLayout(runtime.level.w, runtime.level.h);
    this.dragging = false;
    this.graceUntil = 0;
    this.emit({ type: 'level_loaded', runtime });
  }

  /** 按下。 */
  pointerDown(x: number, y: number): void {
    if (!this.state) return;

    // ── 宽限期：按回线头 → 接着拖；按别处 → 立刻作废后照常起步 ──
    if (this.state.phase === 'paused') {
      const local = this.pick(x, y);
      if (local >= 0 && resumeCover(this.state, local)) {
        this.dragging = true;
        this.graceUntil = 0;
        this.emit({ type: 'resumed' });
        return;
      }
      this.expireGrace();
    }

    if (this.state.phase !== 'idle') return;
    const local = this.pick(x, y);
    if (local < 0) return;
    if (!beginCoverDrag(this.state, local)) return;
    this.dragging = true;
    this.emit({ type: 'moved', idx: this.flatOf(local), consumed: 1 });
  }

  /** 移动。 */
  pointerMove(x: number, y: number): void {
    if (!this.state || !this.dragging) return;
    const local = this.pick(x, y);
    if (local < 0) return;
    const before = this.state.path.length;
    const r = tryCoverMove(this.state, local);
    if (r === 'moved') {
      const consumed = this.state.path.length - before;
      this.emit({ type: 'moved', idx: this.flatOf(local), consumed });
    } else if (r === 'backtracked') {
      this.emit({ type: 'backtracked', idx: this.flatOf(local) });
    } else if (r === 'blocked') {
      this.emit({ type: 'blocked' });
    } else if (r === 'break') {
      this.emit({ type: 'break' });
    }
  }

  /** 松手。 */
  pointerUp(): void {
    if (!this.state || !this.dragging) return;
    this.dragging = false;
    if (!this.state) return;

    if (isCoverSolved(this.state)) {
      this.state.phase = 'won';
      this.graceUntil = 0;
      this.emit({
        type: 'won',
        steps: this.state.path.length - 1,
        timeMs: Date.now() - this.state.startAt,
        // **拍平索引**：上报给服务端的是棋盘坐标，不是内部局部编号
        path: this.flatPath(),
        undos: this.state.undos,
      });
      return;
    }

    // 未通关 → 先不作废，进入宽限期（路径、钥匙、星星全部保留）
    this.state.phase = 'paused';
    this.graceUntil = Date.now() + GRACE_MS;
    this.emit({ type: 'paused', remainMs: GRACE_MS });
  }

  /**
   * 每帧调用：宽限期到点就作废。
   *
   * 用 tick 而不是 `setTimeout` —— 切后台时定时器会被系统节流，
   * 回来时「时间早就过了」却要等下一次触发；每帧比对时间戳没有这个问题。
   */
  tick(now = Date.now()): void {
    if (!this.state || this.state.phase !== 'paused') return;
    if (now < this.graceUntil) return;
    this.expireGrace();
  }

  /** 宽限期剩余毫秒（0 = 没有宽限中）。 */
  graceRemain(now = Date.now()): number {
    if (!this.state || this.state.phase !== 'paused') return 0;
    return Math.max(0, this.graceUntil - now);
  }

  /** 宽限期结束：这一段正式作废。 */
  private expireGrace(): void {
    if (!this.state) return;
    const steps = this.state.path.length - 1;
    const hadPath = this.state.path.length > 0;
    failCover(this.state);
    this.graceUntil = 0;
    this.dragging = false;
    if (hadPath) this.emit({ type: 'expired', steps });
  }

  /** 当前路径（拍平索引序列）。 */
  flatPath(): number[] {
    if (!this.state) return [];
    const rs = this.state.runtime.rs;
    return this.state.path.map((l) => rs.flatOf[l]);
  }

  /** 撤销一步。 */
  undo(): void {
    if (!this.state) return;
    if (undoCoverStep(this.state)) this.emit({ type: 'undo' });
  }

  /**
   * 装上提示路线（拍平索引，完整一条）。
   *
   * 传整条而不是前几格：窗口只决定「同时亮几格」，
   * 玩家跟着走时窗口自己会往前滑，不必反复点提示。
   */
  setHint(cells: number[]): void {
    if (!this.state) return;
    setHintPlan(this.state, cells);
    this.state.hintUsed++;
  }

  /** 标记跳过通关。 */
  markSkipped(): void {
    if (!this.state) return;
    this.state.phase = 'won';
  }

  /**
   * 放弃当前关卡。
   *
   * ## 必须把状态复位，否则整局卡死
   *
   * 微信的 `onHide`（切后台）会调这个。玩家往往是**拖动到一半**切后台的 ——
   * 那时 `state.phase` 停在 `'dragging'`。
   *
   * 如果这里只 `emit` 不复位，回到前台后 `pointerDown` 会因为
   * `state.phase !== 'idle'` 直接 return（见 `pointerDown`），
   * 表现为「回来后这一关完全点不动」，只能重新进关。
   *
   * 复位内容：
   * - `resetPath`：清空已走的路径与收集状态（钥匙 / 星星）
   * - `phase = 'idle'`：允许重新起步
   * - `dragging = false`：会话层也要松手
   *
   * **不增加 `undos`**：切后台不是玩家的失误，不该扣星级。
   */
  abandon(): void {
    if (!this.state || this.state.phase === 'won') return;
    this.emit({ type: 'abandoned' });
    resetPath(this.state);
    this.state.phase = 'idle';
    this.state.lastConsumed = [];
    this.dragging = false;
    this.graceUntil = 0;
  }

  /** 已覆盖格数。 */
  covered(): number {
    return this.state ? coveredCount(this.state) : 0;
  }

  /** 设计坐标 -> 局部编号。 */
  private pick(x: number, y: number): number {
    if (!this.state || !this.layout) return -1;
    const { cell, originX, originY } = this.layout;
    const w = this.state.runtime.level.w;
    const h = this.state.runtime.level.h;
    const cx = Math.floor((x - originX) / cell);
    const cy = Math.floor((y - originY) / cell);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return -1;
    const flat = cy * w + cx;
    const local = this.state.runtime.rs.localOf[flat];
    return local === undefined ? -1 : local;
  }

  /** 局部编号 -> 拍平索引。 */
  private flatOf(local: number): number {
    if (!this.state) return -1;
    return this.state.runtime.rs.flatOf[local];
  }
}
