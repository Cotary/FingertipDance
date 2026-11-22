/**
 * cover 提示机制的测试。
 *
 * 提示的核心要求：**给出的每一步都必须是合法的一步**，
 * 而且走完提示给的步数后，剩余盘面仍有解。
 *
 * 这条性质很重要 —— 提示如果给错，玩家照做就死，
 * 那比不给提示还糟。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeCoverLevel, buildCoverRuntime } from '../src/game/coverLevel';
import {
  beginCoverDrag,
  createCoverState,
  movesFrom,
  setHintPlan,
  releaseCover,
  tryCoverMove,
  type CoverState,
} from '../src/game/coverState';
import { findCoverHint, findCoverHintWith } from '../src/game/coverHint';
import { decodeSolution, decodeGrid, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import { cellType, CoverCell } from '../src/core/cover/v3/types';

function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] };
  return raw.levels;
}

const LEVELS = loadLevels();

/** 均匀抽样 n 个关卡。 */
function pickSamples<T>(arr: T[], n: number): T[] {
  if (arr.length === 0) return [];
  const step = Math.max(1, Math.floor(arr.length / n));
  const out: T[] = [];
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
}

/** 建一个状态并起手。 */
function startedState(entry: LevelEntryWithSolution): CoverState {
  const level = decodeCoverLevel(entry);
  const runtime = buildCoverRuntime(level);
  const state = createCoverState(runtime);
  const start = runtime.rs.startAt >= 0 ? runtime.rs.startAt : 0;
  expect(beginCoverDrag(state, start)).toBe(true);
  return state;
}

describe('cover 提示', () => {
  it('起手后提示能给出合法的一步', () => {
    const state = startedState(LEVELS[400]);
    const hint = findCoverHint(state);
    expect(hint.found).toBe(true);
    expect(hint.cells.length).toBeGreaterThan(0);
  });

  it('提示给出的每一步都是合法移动（抽样 80 关，每关走 3 步）', () => {
    const picks = pickSamples(LEVELS, 80);

    for (const entry of picks) {
      const state = startedState(entry);

      for (let round = 0; round < 3; round++) {
        const hint = findCoverHint(state);
        if (!hint.found) break;
        expect(hint.cells.length).toBeGreaterThan(0);

        // 提示的第 1 格（下一个要走的格）必须能真的走
        const nextFlat = hint.cells[0];
        const nextLocal = state.runtime.rs.localOf[nextFlat];
        expect(nextLocal).toBeGreaterThanOrEqual(0);

        const r = tryCoverMove(state, nextLocal);
        expect(r, `第 ${entry.idx} 关提示的落点应可走`).toBe('moved');
      }
    }
  });

  it('提示的落点必定在「线头的合法移动」之中（抽样 60 关）', () => {
    const picks = pickSamples(LEVELS, 60);

    for (const entry of picks) {
      const state = startedState(entry);
      const hint = findCoverHintWith(state, { maxCells: 1 });
      if (!hint.found || hint.cells.length < 2) continue;

      const head = state.path[state.path.length - 1];
      /**
       * 注意比的是**移动的第一格**（`consumed[0]`）而不是落点（`consumed[last]`）。
       *
       * 冰块滑行时一次移动消耗多格：
       *   `consumed = [冰格, 滑行格1, 滑行格2, ...]`
       * 提示给的是「玩家要碰的第一格」= 冰格，
       * 而落点是滑行末格 —— 两者不是同一个东西。
       */
      const legal = new Set<number>();
      for (const mv of movesFrom(state, head)) {
        legal.add(state.runtime.rs.flatOf[mv.consumed[0]]);
      }
      expect(legal.has(hint.cells[0]), `第 ${entry.idx} 关提示应落在合法移动里`).toBe(true);
    }
  });

  it('沿参考解走到底后提示不再报错', () => {
    const state = startedState(LEVELS[500]);
    const solFlat = decodeSolution(LEVELS[500].solution, LEVELS[500].w);
    const solLocal = solFlat.map((f) => state.runtime.rs.localOf[f]);

    let pos = 1;
    while (pos < solLocal.length) {
      const before = state.path.length;
      const r = tryCoverMove(state, solLocal[pos]);
      if (r !== 'moved') break;
      pos += state.path.length - before;
    }
    expect(releaseCover(state)).toBe(true);

    const hint = findCoverHint(state);
    expect(hint.found).toBe(true);
  });

  it('提示耗时可接受（每关 < 400ms）', () => {
    const picks = pickSamples(LEVELS, 30);
    for (const entry of picks) {
      const state = startedState(entry);
      const hint = findCoverHint(state);
      expect(hint.ms, `第 ${entry.idx} 关提示耗时 ${hint.ms}ms`).toBeLessThan(400);
    }
  });

  it('冰面关的提示不会给出「滑行会冲过头」的错误落点（抽样 30 关）', () => {
    const picks = pickSamples(LEVELS.filter((l) => l.mechKinds >= 3), 30);
    for (const entry of picks) {
      const state = startedState(entry);
      const hint = findCoverHint(state);
      if (!hint.found) continue;

      // 提示现在是一条**完整路线**，所以不能像以前那样「拿初始盘面逐对判邻接」——
      // 第 40 步的合法性取决于前 39 步走完之后的状态。
      // 这里改成**真重放**：每一格都让状态机自己判，判不过就是提示错了。
      setHintPlan(state, hint.cells);
      for (const flat of hint.cells) {
        const local = state.runtime.rs.localOf[flat];
        // 冰格滑行会一次吃掉后面几格，已走过的跳过
        if (state.visited[local]) continue;
        const r = tryCoverMove(state, local);
        expect(r, `第 ${entry.idx} 关沿提示走到 ${flat} 应可走`).toBe('moved');
      }
    }
  });

  /**
   * 默认必须**有限时**。
   *
   * 求解在主线程同步跑，不限时的话后期大关卡会把画面冻住一两秒。
   * 见 `coverHint.ts` 的 `DEFAULT_DEADLINE_MS`。
   */
  it('默认有限时（不会无限跑下去卡住主线程）', () => {
    const state = startedState(LEVELS[400]);
    const hint = findCoverHint(state);
    // 有限时 → 耗时一定有上界（默认 120ms + 一点调度误差）
    expect(hint.ms).toBeLessThan(1000);
  });

  it('显式传 deadlineMs: 0 可以不限时（测试用）', () => {
    const state = startedState(LEVELS[400]);
    const hint = findCoverHintWith(state, { deadlineMs: 0 });
    expect(hint.found).toBe(true);
  });

  it('deadlineMs 极小时仍能返回合法结果（超时不崩溃）', () => {
    const state = startedState(LEVELS[400]);
    const hint = findCoverHintWith(state, { deadlineMs: 1 });
    // 要么找到（碰巧很快），要么明确没找到 —— 但不能抛异常
    expect(typeof hint.found).toBe('boolean');
    expect(hint.ms).toBeLessThan(1000);
  });

  /**
   * **传送门关卡的提示必须按完整规则求解**。
   *
   * 「进入即传送」下，纯网格求解会**穿过**传送格而不传送 ——
   * 那条路线在真实玩法下根本走不通。
   *
   * 所以传送门关卡的提示要开传送边，并且给出的每一格都能真的走。
   */
  it('传送门关卡的提示走完整规则，每一步都能真的走', () => {
    const portals = LEVELS.filter((e) => {
      const grid = decodeGrid(e.grid, e.w * e.h);
      for (let i = 0; i < grid.length; i++) {
        if (cellType(grid[i]) === CoverCell.PORTAL) return true;
      }
      return false;
    });
    expect(portals.length, '关卡表里应有传送门关卡').toBeGreaterThan(0);

    for (const entry of pickSamples(portals, 40)) {
      const state = startedState(entry);

      // 起手后的提示
      const hint = findCoverHint(state);
      expect(hint.found, `第 ${entry.idx} 关起手后应有提示`).toBe(true);
      if (!hint.found) continue;

      // 提示的第一格必须能真的走（传送门关卡尤其如此）
      const nextLocal = state.runtime.rs.localOf[hint.cells[0]];
      const r = tryCoverMove(state, nextLocal);
      expect(r, `第 ${entry.idx} 关提示的落点应可走`).toBe('moved');
    }
  });

  it('传送门关卡：沿提示走完全程能通关（抽样 20 关）', () => {
    const portals = LEVELS.filter((e) => {
      const grid = decodeGrid(e.grid, e.w * e.h);
      for (let i = 0; i < grid.length; i++) {
        if (cellType(grid[i]) === CoverCell.PORTAL) return true;
      }
      return false;
    });

    for (const entry of pickSamples(portals, 20)) {
      const state = startedState(entry);
      const hint = findCoverHint(state);
      expect(hint.found, `第 ${entry.idx} 关应有提示`).toBe(true);
      if (!hint.found) continue;

      setHintPlan(state, hint.cells);
      for (const flat of hint.cells) {
        const local = state.runtime.rs.localOf[flat];
        if (state.visited[local]) continue;
        const r = tryCoverMove(state, local);
        expect(r, `第 ${entry.idx} 关沿提示走到 ${flat} 应可走`).toBe('moved');
      }
      expect(releaseCover(state), `第 ${entry.idx} 关应通关`).toBe(true);
    }
  });
});
