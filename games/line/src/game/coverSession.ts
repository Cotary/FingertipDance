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
  resumeCoverStep,
  setHintPlan,
  tryCoverMove,
  undoCoverStep,
  coveredCount,
  type CoverState,
} from './coverState';
import type { CoverRuntime } from './coverLevel';

/**
 * 松手后**不再作废**。
 *
 * 早先这里有一个 `GRACE_MS = 1500` 的宽限期：松手后路径只保留 1.5 秒，
 * 超时整段作废（`undos + 1`）。现在改成**松手即定住，保持原状**——
 * 玩家抬手不等于放弃，他可能只是在看盘、在想下一步。
 *
 * 三种做法对比过：
 *
 * 1. **松手就作废** —— 触屏上误抬手概率极高，一次误碰丢一颗星，
 *    体感是"莫名其妙被扣星"（这是最早的版本，已被宽限期取代）；
 * 2. **1.5 秒宽限**（上一个版本）—— 缓解了误抬，但引入了新问题：
 *    玩家放下手机想想，回来发现"刚才画的线自己没了"，而且**没有任何解释**。
 *    倒计时本身就是一种压力，与这套主题「静观釉色」的调子相反；
 * 3. **松手定住**（现在）—— 路径一直亮着，随时按回线头接着拖。
 *    代价是玩家可以无限期停着；但 cover 模式没有计时计分，
 *    停着不吃亏也不吃亏于别人，没有必须催他的理由。
 *
 * 真正"这一段不要了"的出口是**重新起一笔**（按别处）和**撤销**，
 * 两者都是玩家的显式动作，不是时间到了自动发生。
 */
export const GRACE_MS = Number.POSITIVE_INFINITY;

/** 会话事件。 */
export type CoverSessionEvent =
  | { type: 'level_loaded'; runtime: CoverRuntime }
  | { type: 'moved'; idx: number; consumed: number }
  | { type: 'backtracked'; idx: number }
  | { type: 'break' }
  | { type: 'blocked'; idx: number }
  | { type: 'undo' }
  | { type: 'won'; steps: number; timeMs: number; path: number[]; undos: number }
  /**
   * 松手未通关 → **定住**（路径、钥匙、星星全部保留，没有倒计时）。
   *
   * `remainMs` 保留字段但恒为 `Infinity`；新代码不该再读它。
   */
  | { type: 'paused'; remainMs: number }
  /** 按回线头 / 线头邻格 → 继续拖 */
  | { type: 'resumed' }
  /**
   * 玩家按了**别的格子** → 显式放弃这一笔（`undos + 1`）。
   *
   * 这是唯一的作废入口。早先还有一个 `expired`，由 1.5 秒超时触发 ——
   * 已删：作废必须由玩家的动作触发。
   */
  | { type: 'abandoned'; steps?: number };

/** cover 关卡会话。 */
export class CoverSession {
  state: CoverState | null = null;
  layout: BoardLayout | null = null;

  private listeners: Array<(e: CoverSessionEvent) => void> = [];
  private dragging = false;
  /** 宽限期截止时刻（`Date.now()` 基准）；0 = 不在宽限期 */

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
    this.emit({ type: 'level_loaded', runtime });
  }

  /** 按下。 */
  pointerDown(x: number, y: number): void {
    if (!this.state) return;

    // ── 松手定住：按回线头 / 线头的邻格 → 接着走；按别处 → 作废后照常起步 ──
    if (this.state.phase === 'paused') {
      const local = this.pick(x, y);
      if (local >= 0 && resumeCover(this.state, local)) {
        this.dragging = true;
        this.emit({ type: 'resumed' });
        return;
      }
      // 「点着走」的玩家：第二下点在线头旁边，本来就是接着往前走一步。
      // 不认这一下的话，整条线会被判成"按别处"直接作废 —— 手没滑、步没错却被扣星
      if (local >= 0 && resumeCoverStep(this.state, local)) {
        const before = this.state.path.length;
        if (tryCoverMove(this.state, local) === 'moved') {
          this.dragging = true;
          this.emit({ type: 'resumed' });
          this.emit({ type: 'moved', idx: this.flatOf(local), consumed: this.state.path.length - before });
          return;
        }
        // 这一格走不通（石头 / 没钥匙的门 / 单向逆行）：状态没动，退回松手态走原流程
        this.state.phase = 'paused';
      }
      // 按在别的格子上 = **玩家显式要重新起一笔**。这是现在唯一的"作废"入口，
      // 也是它该有的样子：由玩家的动作触发，而不是等一个计时器到期。
      this.abandonPath();
    }

    if (this.state.phase !== 'idle') return;
    const local = this.pick(x, y);
    if (local < 0) {
      // 这一格在编号空间里不存在 = 石头或缺口。玩家点的确实是盘上的一格，
      // 他期待有回应；"这一格不能起手"就是回应。点盘外则一声不吭。
      const flat = this.pickFlat(x, y);
      if (flat >= 0) this.emit({ type: 'blocked', idx: flat });
      return;
    }
    if (!beginCoverDrag(this.state, local)) {
      this.emit({ type: 'blocked', idx: this.flatOf(local) });
      return;
    }
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
      this.emit({ type: 'blocked', idx: this.flatOf(local) });
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

    // 未通关 → **原样定住**：路径、钥匙、星星全部保留，不计时、不作废。
    // `paused` 这个 phase 名沿用下来了，它现在表示"手指抬起，但这一笔还算数"。
    this.state.phase = 'paused';
    this.emit({ type: 'paused', remainMs: GRACE_MS });
  }

  /**
   * 每帧调用。
   *
   * **现在什么都不做** —— 松手后路径保持原状，不再有"到点作废"。
   * 留着这个方法是给游戏循环一个稳定的调用点（`main` 每帧都调），
   * 以后若要加"久停提示"之类的温和引导，落在这里；不要重新引入自动作废。
   */
  tick(_now = Date.now()): void {
    // 故意为空：见 `GRACE_MS` 的说明（松手定住，保持原状）
  }

  /**
   * 宽限期剩余毫秒。
   *
   * 保留接口但**永远返回 0** —— 没有倒计时了。调用方如果还在用它画进度条，
   * 应当改为不画（倒计时本身就是这一版要拆掉的压力源）。
   */
  graceRemain(_now = Date.now()): number {
    return 0;
  }

  /**
   * 作废当前这一笔（`undos + 1`、清空、回到待起步）。
   *
   * 唯一的调用点是 `pointerDown` 里「按在别的格子上」——
   * **玩家显式要重新起一笔**。以前它有两处调用者（这里 + 宽限期超时），
   * 超时那处已经删掉：作废必须由动作触发，不能由时间触发。
   */
  private abandonPath(): void {
    if (!this.state) return;
    const steps = this.state.path.length - 1;
    const hadPath = this.state.path.length > 0;
    failCover(this.state);
    this.dragging = false;
    if (hadPath) this.emit({ type: 'abandoned', steps });
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

  /**
   * 设计坐标 -> **拍平索引**，不管这格能不能走。
   *
   * `pick` 只认"能走的格"（石头 / 缺口在它的编号空间里根本不存在），
   * 所以玩家点在石头上时它也返回 -1 —— 和"点在盘外"完全一样。
   * 但这两件事要对玩家说两句不同的话：一个是"这一格不行"，一个是"没点到盘上"。
   */
  private pickFlat(x: number, y: number): number {
    if (!this.state || !this.layout) return -1;
    const { cell, originX, originY } = this.layout;
    const w = this.state.runtime.level.w;
    const h = this.state.runtime.level.h;
    const cx = Math.floor((x - originX) / cell);
    const cy = Math.floor((y - originY) / cell);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return -1;
    return cy * w + cx;
  }

  /** 局部编号 -> 拍平索引。 */
  private flatOf(local: number): number {
    if (!this.state) return -1;
    return this.state.runtime.rs.flatOf[local];
  }
}
